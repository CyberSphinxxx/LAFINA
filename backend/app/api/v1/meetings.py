import json
import uuid
from datetime import datetime, timezone
from typing import Annotated, Optional
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.session import AuthSession
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.business_meeting import BusinessMeeting, BusinessMeetingRecipient
from backend.app.security.auth import get_current_user_and_session
from backend.app.services.capabilities import resolve_account_capabilities
from backend.app.clients.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["meetings"])
settings = get_settings()

MEETING_SUMMARY_SYSTEM_PROMPT = (
    "You are an expert meeting transcription analyzer and executive summarizer. "
    "Analyze the provided meeting transcript and extract a clear, concise, structured JSON summary. "
    "You MUST respond ONLY with valid JSON conforming to the following schema without markdown backticks:\n"
    "{\n"
    '  "key_points": ["string", ...],\n'
    '  "decisions": ["string", ...],\n'
    '  "open_questions": ["string", ...],\n'
    '  "action_items": [\n'
    '    {\n'
    '      "task": "string",\n'
    '      "assignee": "string or Unassigned",\n'
    '      "due": "ISO 8601 date string or null",\n'
    '      "context": "string"\n'
    "    }\n"
    "  ]\n"
    "}\n"
    "Ensure all key technical and business commitments, decisions, and deadlines mentioned in the meeting are accurately captured."
)


def get_deepseek_client(request: Request) -> DeepSeekClient:
    client: DeepSeekClient | None = getattr(request.app.state, "deepseek_client", None)
    if client is None:
        return DeepSeekClient(settings=settings)
    return client


# --- Schemas ---

class MeetingActionItem(BaseModel):
    task: str
    assignee: Optional[str] = "Unassigned"
    due: Optional[str] = None
    context: Optional[str] = None


class MeetingSummaryData(BaseModel):
    key_points: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    action_items: list[MeetingActionItem] = Field(default_factory=list)


class MeetingSummaryRequest(BaseModel):
    requestId: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transcript: str = Field(..., min_length=1)
    businessId: Optional[str] = None
    meetingTitle: Optional[str] = None


class MeetingSummaryResponse(BaseModel):
    requestId: str
    summary: MeetingSummaryData
    model: str
    createdAt: str


class MeetingRecipientOut(BaseModel):
    user_id: str
    email: Optional[str] = None


class MeetingCreateIn(BaseModel):
    id: Optional[str] = None
    title: str = "Untitled Meeting"
    duration_seconds: int = 0
    full_transcript: str = ""
    summary_json: Optional[dict] = None
    summary_status: str = "not_requested"
    recipient_user_ids: list[str] = Field(default_factory=list)


class MeetingOut(BaseModel):
    id: str
    business_id: str
    created_by: str
    creator_email: Optional[str] = None
    title: str
    duration_seconds: int
    full_transcript: str
    summary_json: Optional[dict] = None
    summary_status: str
    recipients: list[MeetingRecipientOut] = Field(default_factory=list)
    created_at: str
    updated_at: str


# --- Helpers ---

async def _verify_business_membership(
    business_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> tuple[Business, BusinessMembership]:
    b_stmt = select(Business).where(Business.id == business_id)
    b_res = await db.execute(b_stmt)
    biz = b_res.scalars().first()
    if not biz:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business workspace not found.")

    m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business_id,
        BusinessMembership.user_id == user_id,
        BusinessMembership.membership_status == "active",
    )
    m_res = await db.execute(m_stmt)
    mem = m_res.scalars().first()
    if not mem:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active business membership required.",
        )
    return biz, mem


def _parse_summary_json(content: str) -> MeetingSummaryData:
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
        return MeetingSummaryData(
            key_points=data.get("key_points", []),
            decisions=data.get("decisions", []),
            open_questions=data.get("open_questions", []),
            action_items=[
                MeetingActionItem(
                    task=item.get("task", "Untitled Task"),
                    assignee=item.get("assignee", "Unassigned"),
                    due=item.get("due"),
                    context=item.get("context"),
                )
                for item in data.get("action_items", [])
            ],
        )
    except Exception:
        # Fallback text parsing
        return MeetingSummaryData(
            key_points=[cleaned[:300]],
            decisions=[],
            open_questions=[],
            action_items=[],
        )


# --- Endpoints ---

@router.post("/v1/meetings/summary", response_model=MeetingSummaryResponse)
async def generate_meeting_summary(
    req: MeetingSummaryRequest,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
    deepseek: DeepSeekClient = Depends(get_deepseek_client),
):
    """
    Generates structured AI summary (key points, decisions, open questions, action items)
    using DeepSeek-V4 Flash. Zero audio upload; transcript text sent strictly with user consent.
    No prompt logging or retention on the server.
    """
    account, _ = auth_data
    cap_res = await resolve_account_capabilities(account, db)
    is_entitled = (
        account.role in ("student_pro", "admin", "business")
        or account.system_role == "admin"
        or account.subscription_plan in ("student_pro", "business")
        or cap_res.effective_subscription_plan in ("student_pro", "business")
        or cap_res.system_role == "admin"
    )
    if not is_entitled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="AI meeting summarization requires an active Student Pro or Business plan.",
        )

    user_content = f"Meeting Title: {req.meetingTitle or 'General Team Sync'}\n\nTranscript:\n{req.transcript}"
    messages = [
        {"role": "system", "content": MEETING_SUMMARY_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    try:
        res = await deepseek.chat_completion(messages=messages, max_tokens=1500)
        summary_data = _parse_summary_json(res.get("reply", "{}"))
        return MeetingSummaryResponse(
            requestId=req.requestId,
            summary=summary_data,
            model=res.get("model", "deepseek-chat"),
            createdAt=datetime.now(timezone.utc).isoformat(),
        )
    except DeepSeekError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DeepSeek AI summarization failed: {e.message}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal summarization error: {str(e)}",
        )


@router.post("/v1/businesses/{business_id}/meetings", response_model=MeetingOut)
async def create_or_sync_meeting(
    business_id: uuid.UUID,
    payload: MeetingCreateIn,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
):
    """
    Creates or syncs a meeting with its selective sharing recipients.
    """
    account, _ = auth_data
    biz, mem = await _verify_business_membership(business_id, account.id, db)

    meeting_uuid = uuid.UUID(payload.id) if payload.id else uuid.uuid4()
    stmt = select(BusinessMeeting).where(
        BusinessMeeting.id == meeting_uuid,
        BusinessMeeting.business_id == business_id,
    )
    res = await db.execute(stmt)
    meeting = res.scalars().first()

    now = datetime.now(timezone.utc)
    if meeting:
        if meeting.created_by != account.id and mem.member_role != "manager":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the meeting creator or a manager can update this meeting.",
            )
        meeting.title = payload.title
        meeting.duration_seconds = payload.duration_seconds
        meeting.full_transcript = payload.full_transcript
        meeting.summary_json = payload.summary_json
        meeting.summary_status = payload.summary_status
        meeting.updated_at = now
    else:
        meeting = BusinessMeeting(
            id=meeting_uuid,
            business_id=business_id,
            created_by=account.id,
            title=payload.title,
            duration_seconds=payload.duration_seconds,
            full_transcript=payload.full_transcript,
            summary_json=payload.summary_json,
            summary_status=payload.summary_status,
            created_at=now,
            updated_at=now,
        )
        db.add(meeting)

    await db.flush()

    # Sync selective recipients
    if payload.recipient_user_ids:
        del_stmt = select(BusinessMeetingRecipient).where(
            BusinessMeetingRecipient.meeting_id == meeting_uuid
        )
        del_res = await db.execute(del_stmt)
        for r in del_res.scalars().all():
            await db.delete(r)

        for uid_str in set(payload.recipient_user_ids):
            rec_uuid = uuid.UUID(uid_str)
            rec = BusinessMeetingRecipient(
                id=uuid.uuid4(),
                meeting_id=meeting_uuid,
                business_id=business_id,
                user_id=rec_uuid,
                created_at=now,
            )
            db.add(rec)

    await db.commit()
    await db.refresh(meeting)

    # Fetch recipients for response
    r_stmt = (
        select(BusinessMeetingRecipient, Account)
        .join(Account, Account.id == BusinessMeetingRecipient.user_id)
        .where(BusinessMeetingRecipient.meeting_id == meeting.id)
    )
    r_res = await db.execute(r_stmt)
    recipients_out = [
        MeetingRecipientOut(
            user_id=str(r[0].user_id),
            email=r[1].email,
        )
        for r in r_res.all()
    ]

    return MeetingOut(
        id=str(meeting.id),
        business_id=str(meeting.business_id),
        created_by=str(meeting.created_by),
        creator_email=account.email,
        title=meeting.title,
        duration_seconds=meeting.duration_seconds,
        full_transcript=meeting.full_transcript,
        summary_json=meeting.summary_json,
        summary_status=meeting.summary_status,
        recipients=recipients_out,
        created_at=meeting.created_at.isoformat(),
        updated_at=meeting.updated_at.isoformat(),
    )


@router.get("/v1/businesses/{business_id}/meetings", response_model=list[MeetingOut])
async def list_authorized_meetings(
    business_id: uuid.UUID,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
):
    """
    Returns meetings accessible to the user (created by user OR user is in selective recipients OR user is manager).
    """
    account, _ = auth_data
    biz, mem = await _verify_business_membership(business_id, account.id, db)

    if mem.member_role == "manager":
        stmt = (
            select(BusinessMeeting)
            .where(BusinessMeeting.business_id == business_id)
            .order_by(BusinessMeeting.created_at.desc())
        )
    else:
        stmt = (
            select(BusinessMeeting)
            .where(
                BusinessMeeting.business_id == business_id,
                (BusinessMeeting.created_by == account.id)
                | (
                    BusinessMeeting.id.in_(
                        select(BusinessMeetingRecipient.meeting_id).where(
                            BusinessMeetingRecipient.business_id == business_id,
                            BusinessMeetingRecipient.user_id == account.id,
                        )
                    )
                ),
            )
            .order_by(BusinessMeeting.created_at.desc())
        )

    res = await db.execute(stmt)
    meetings = res.scalars().all()

    meetings_out: list[MeetingOut] = []
    for m in meetings:
        r_stmt = (
            select(BusinessMeetingRecipient, Account)
            .join(Account, Account.id == BusinessMeetingRecipient.user_id)
            .where(BusinessMeetingRecipient.meeting_id == m.id)
        )
        r_res = await db.execute(r_stmt)
        recipients_out = [
            MeetingRecipientOut(
                user_id=str(r[0].user_id),
                email=r[1].email,
            )
            for r in r_res.all()
        ]
        meetings_out.append(
            MeetingOut(
                id=str(m.id),
                business_id=str(m.business_id),
                created_by=str(m.created_by),
                title=m.title,
                duration_seconds=m.duration_seconds,
                full_transcript=m.full_transcript,
                summary_json=m.summary_json,
                summary_status=m.summary_status,
                recipients=recipients_out,
                created_at=m.created_at.isoformat(),
                updated_at=m.updated_at.isoformat(),
            )
        )

    return meetings_out


@router.get("/v1/businesses/{business_id}/meetings/{meeting_id}", response_model=MeetingOut)
async def get_meeting_detail(
    business_id: uuid.UUID,
    meeting_id: uuid.UUID,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
):
    """
    Returns single meeting detail if authorized.
    """
    account, _ = auth_data
    biz, mem = await _verify_business_membership(business_id, account.id, db)

    stmt = select(BusinessMeeting).where(
        BusinessMeeting.id == meeting_id,
        BusinessMeeting.business_id == business_id,
    )
    res = await db.execute(stmt)
    meeting = res.scalars().first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found.")

    # Check authorization
    if meeting.created_by != account.id and mem.member_role != "manager":
        rec_stmt = select(BusinessMeetingRecipient).where(
            BusinessMeetingRecipient.meeting_id == meeting_id,
            BusinessMeetingRecipient.user_id == account.id,
        )
        rec_res = await db.execute(rec_stmt)
        if not rec_res.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this meeting transcript.",
            )

    r_stmt = (
        select(BusinessMeetingRecipient, Account)
        .join(Account, Account.id == BusinessMeetingRecipient.user_id)
        .where(BusinessMeetingRecipient.meeting_id == meeting.id)
    )
    r_res = await db.execute(r_stmt)
    recipients_out = [
        MeetingRecipientOut(
            user_id=str(r[0].user_id),
            email=r[1].email,
        )
        for r in r_res.all()
    ]

    return MeetingOut(
        id=str(meeting.id),
        business_id=str(meeting.business_id),
        created_by=str(meeting.created_by),
        title=meeting.title,
        duration_seconds=meeting.duration_seconds,
        full_transcript=meeting.full_transcript,
        summary_json=meeting.summary_json,
        summary_status=meeting.summary_status,
        recipients=recipients_out,
        created_at=meeting.created_at.isoformat(),
        updated_at=meeting.updated_at.isoformat(),
    )


@router.delete("/v1/businesses/{business_id}/meetings/{meeting_id}/recipients/{user_id}")
async def revoke_meeting_recipient(
    business_id: uuid.UUID,
    meeting_id: uuid.UUID,
    user_id: uuid.UUID,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
):
    """
    Revokes access to a meeting for a recipient.
    """
    account, _ = auth_data
    biz, mem = await _verify_business_membership(business_id, account.id, db)

    stmt = select(BusinessMeeting).where(
        BusinessMeeting.id == meeting_id,
        BusinessMeeting.business_id == business_id,
    )
    res = await db.execute(stmt)
    meeting = res.scalars().first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found.")

    if meeting.created_by != account.id and mem.member_role != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the meeting creator or a manager can revoke recipient access.",
        )

    del_stmt = select(BusinessMeetingRecipient).where(
        BusinessMeetingRecipient.meeting_id == meeting_id,
        BusinessMeetingRecipient.user_id == user_id,
    )
    del_res = await db.execute(del_stmt)
    rec = del_res.scalars().first()
    if rec:
        await db.delete(rec)
        await db.commit()

    return {"status": "success", "message": "Recipient access revoked."}

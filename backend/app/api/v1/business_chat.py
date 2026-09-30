import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db, set_transaction_rls_user
from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.business_chat import (
    BusinessChatChannel,
    BusinessChatMessage,
    BusinessTaskComment,
)
from backend.app.models.business_collaboration import BusinessTask
from backend.app.models.session import AuthSession
from backend.app.security.auth import get_current_user_and_session
from backend.app.services.chat_broadcast import (
    chat_manager,
    create_chat_ticket,
    verify_chat_ticket,
)

router = APIRouter(prefix="/v1/businesses/{business_id}", tags=["business-chat"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def verify_business_membership(
    db: AsyncSession, business_id: uuid.UUID, user_id: uuid.UUID
) -> BusinessMembership:
    """Verifies that the user is an active member or owner of the business."""
    # Check if user is owner
    biz_stmt = select(Business).where(Business.id == business_id)
    biz_res = await db.execute(biz_stmt)
    biz = biz_res.scalar_one_or_none()
    if not biz:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Business not found."
        )

    # Check active membership
    mem_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business_id,
        BusinessMembership.user_id == user_id,
        BusinessMembership.membership_status == "active",
    )
    mem_res = await db.execute(mem_stmt)
    membership = mem_res.scalar_one_or_none()

    if not membership and biz.owner_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not an active member of this business.",
        )

    return membership


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------


class ChatTicketResponse(BaseModel):
    ticket: str
    expires_in: int
    ws_url: str


class ChannelResponse(BaseModel):
    id: str
    business_id: str
    name: str
    channel_type: str
    is_archived: bool
    created_at: str
    updated_at: str


class ChatMessageRequest(BaseModel):
    client_message_id: str = Field(..., max_length=128)
    content: str = Field(..., min_length=1, max_length=4000)
    task_link_id: Optional[str] = None


class ChatMessageResponse(BaseModel):
    id: str
    channel_id: str
    business_id: str
    sender_id: str
    sender_email: Optional[str] = None
    client_message_id: str
    content: str
    task_link_id: Optional[str] = None
    task_title: Optional[str] = None
    created_at: str
    updated_at: str


class TaskCommentRequest(BaseModel):
    client_comment_id: str = Field(..., max_length=128)
    content: str = Field(..., min_length=1, max_length=4000)


class TaskCommentResponse(BaseModel):
    id: str
    task_id: str
    business_id: str
    user_id: str
    user_email: Optional[str] = None
    client_comment_id: str
    content: str
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# WebSocket Ticket & Connection Handlers
# ---------------------------------------------------------------------------


@router.post("/chat/ticket", response_model=ChatTicketResponse)
async def generate_ws_ticket(
    business_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    ticket = create_chat_ticket(account.id, business_id)
    return ChatTicketResponse(
        ticket=ticket,
        expires_in=60,
        ws_url=f"/v1/businesses/{business_id}/chat/ws",
    )


@router.websocket("/chat/ws")
async def websocket_chat_endpoint(
    websocket: WebSocket,
    business_id: uuid.UUID,
    ticket: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        user_id = verify_chat_ticket(ticket, business_id)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Verify active membership
    try:
        await verify_business_membership(db, business_id, user_id)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await chat_manager.connect(business_id, websocket)
    try:
        while True:
            # Client heartbeat ping/pong or event handling
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        chat_manager.disconnect(business_id, websocket)
    except Exception:
        chat_manager.disconnect(business_id, websocket)


# ---------------------------------------------------------------------------
# Channels & Messages Endpoints
# ---------------------------------------------------------------------------


@router.get("/chat/channels", response_model=List[ChannelResponse])
async def list_channels(
    business_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    stmt = (
        select(BusinessChatChannel)
        .where(
            BusinessChatChannel.business_id == business_id,
            BusinessChatChannel.is_archived.is_(False),
        )
        .order_by(BusinessChatChannel.created_at.asc())
    )
    res = await db.execute(stmt)
    channels = list(res.scalars().all())

    # Ensure default "general" channel exists
    if not channels:
        general_channel = BusinessChatChannel(
            id=uuid.uuid4(),
            business_id=business_id,
            name="general",
            channel_type="general",
            is_archived=False,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        db.add(general_channel)
        await db.commit()
        await db.refresh(general_channel)
        channels = [general_channel]

    return [
        ChannelResponse(
            id=str(c.id),
            business_id=str(c.business_id),
            name=c.name,
            channel_type=c.channel_type,
            is_archived=c.is_archived,
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat(),
        )
        for c in channels
    ]


@router.get("/chat/channels/{channel_id}/messages", response_model=List[ChatMessageResponse])
async def get_channel_messages(
    business_id: uuid.UUID,
    channel_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    before: Optional[str] = Query(default=None),
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    query = (
        select(BusinessChatMessage, Account.email, BusinessTask.title)
        .join(Account, Account.id == BusinessChatMessage.sender_id)
        .outerjoin(BusinessTask, BusinessTask.id == BusinessChatMessage.task_link_id)
        .where(
            BusinessChatMessage.business_id == business_id,
            BusinessChatMessage.channel_id == channel_id,
        )
    )

    if before:
        try:
            if before.endswith("Z"):
                before = before[:-1] + "+00:00"
            before_dt = datetime.fromisoformat(before)
            query = query.where(BusinessChatMessage.created_at < before_dt)
        except Exception:
            pass

    query = query.order_by(desc(BusinessChatMessage.created_at)).limit(limit)
    res = await db.execute(query)
    rows = list(res.all())

    # Reverse to return chronological order
    rows.reverse()

    results = []
    for msg, sender_email, task_title in rows:
        results.append(
            ChatMessageResponse(
                id=str(msg.id),
                channel_id=str(msg.channel_id),
                business_id=str(msg.business_id),
                sender_id=str(msg.sender_id),
                sender_email=sender_email,
                client_message_id=msg.client_message_id,
                content=msg.content,
                task_link_id=str(msg.task_link_id) if msg.task_link_id else None,
                task_title=task_title,
                created_at=msg.created_at.isoformat(),
                updated_at=msg.updated_at.isoformat(),
            )
        )
    return results


@router.post("/chat/channels/{channel_id}/messages", response_model=ChatMessageResponse)
async def send_channel_message(
    business_id: uuid.UUID,
    channel_id: uuid.UUID,
    req: ChatMessageRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    # 1. Idempotency check on client_message_id
    existing_stmt = (
        select(BusinessChatMessage, Account.email, BusinessTask.title)
        .join(Account, Account.id == BusinessChatMessage.sender_id)
        .outerjoin(BusinessTask, BusinessTask.id == BusinessChatMessage.task_link_id)
        .where(
            BusinessChatMessage.business_id == business_id,
            BusinessChatMessage.client_message_id == req.client_message_id,
        )
    )
    existing_res = await db.execute(existing_stmt)
    existing_row = existing_res.first()
    if existing_row:
        existing_msg, sender_email, task_title = existing_row
        return ChatMessageResponse(
            id=str(existing_msg.id),
            channel_id=str(existing_msg.channel_id),
            business_id=str(existing_msg.business_id),
            sender_id=str(existing_msg.sender_id),
            sender_email=sender_email,
            client_message_id=existing_msg.client_message_id,
            content=existing_msg.content,
            task_link_id=str(existing_msg.task_link_id) if existing_msg.task_link_id else None,
            task_title=task_title,
            created_at=existing_msg.created_at.isoformat(),
            updated_at=existing_msg.updated_at.isoformat(),
        )

    # 2. Parse task_link_id if provided
    task_link_uuid = None
    task_title = None
    if req.task_link_id:
        try:
            task_link_uuid = uuid.UUID(req.task_link_id)
            t_stmt = select(BusinessTask).where(
                BusinessTask.id == task_link_uuid, BusinessTask.business_id == business_id
            )
            t_res = await db.execute(t_stmt)
            task_obj = t_res.scalar_one_or_none()
            if task_obj:
                task_title = task_obj.title
        except Exception:
            task_link_uuid = None

    now = utc_now()
    new_message = BusinessChatMessage(
        id=uuid.uuid4(),
        channel_id=channel_id,
        business_id=business_id,
        sender_id=account.id,
        client_message_id=req.client_message_id,
        content=req.content.strip(),
        task_link_id=task_link_uuid,
        created_at=now,
        updated_at=now,
    )
    db.add(new_message)
    await db.commit()

    response_data = ChatMessageResponse(
        id=str(new_message.id),
        channel_id=str(new_message.channel_id),
        business_id=str(new_message.business_id),
        sender_id=str(new_message.sender_id),
        sender_email=account.email,
        client_message_id=new_message.client_message_id,
        content=new_message.content,
        task_link_id=str(new_message.task_link_id) if new_message.task_link_id else None,
        task_title=task_title,
        created_at=new_message.created_at.isoformat(),
        updated_at=new_message.updated_at.isoformat(),
    )

    # 3. Broadcast real-time event to connected WebSockets
    await chat_manager.broadcast(
        business_id,
        {"type": "new_message", "message": response_data.model_dump()},
    )

    return response_data


# ---------------------------------------------------------------------------
# Task Comments Endpoints
# ---------------------------------------------------------------------------


@router.get("/tasks/{task_id}/comments", response_model=List[TaskCommentResponse])
async def get_task_comments(
    business_id: uuid.UUID,
    task_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    stmt = (
        select(BusinessTaskComment, Account.email)
        .join(Account, Account.id == BusinessTaskComment.user_id)
        .where(
            BusinessTaskComment.business_id == business_id,
            BusinessTaskComment.task_id == task_id,
        )
        .order_by(BusinessTaskComment.created_at.asc())
    )
    res = await db.execute(stmt)
    rows = list(res.all())

    return [
        TaskCommentResponse(
            id=str(c.id),
            task_id=str(c.task_id),
            business_id=str(c.business_id),
            user_id=str(c.user_id),
            user_email=email,
            client_comment_id=c.client_comment_id,
            content=c.content,
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat(),
        )
        for c, email in rows
    ]


@router.post("/tasks/{task_id}/comments", response_model=TaskCommentResponse)
async def add_task_comment(
    business_id: uuid.UUID,
    task_id: uuid.UUID,
    req: TaskCommentRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    await set_transaction_rls_user(db, account.id)
    await verify_business_membership(db, business_id, account.id)

    # 1. Idempotency check on client_comment_id
    existing_stmt = (
        select(BusinessTaskComment, Account.email)
        .join(Account, Account.id == BusinessTaskComment.user_id)
        .where(
            BusinessTaskComment.task_id == task_id,
            BusinessTaskComment.client_comment_id == req.client_comment_id,
        )
    )
    existing_res = await db.execute(existing_stmt)
    existing_row = existing_res.first()
    if existing_row:
        existing_comment, email = existing_row
        return TaskCommentResponse(
            id=str(existing_comment.id),
            task_id=str(existing_comment.task_id),
            business_id=str(existing_comment.business_id),
            user_id=str(existing_comment.user_id),
            user_email=email,
            client_comment_id=existing_comment.client_comment_id,
            content=existing_comment.content,
            created_at=existing_comment.created_at.isoformat(),
            updated_at=existing_comment.updated_at.isoformat(),
        )

    # 2. Verify task exists
    t_stmt = select(BusinessTask).where(
        BusinessTask.id == task_id, BusinessTask.business_id == business_id
    )
    t_res = await db.execute(t_stmt)
    if not t_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Task not found."
        )

    now = utc_now()
    new_comment = BusinessTaskComment(
        id=uuid.uuid4(),
        task_id=task_id,
        business_id=business_id,
        user_id=account.id,
        client_comment_id=req.client_comment_id,
        content=req.content.strip(),
        created_at=now,
        updated_at=now,
    )
    db.add(new_comment)
    await db.commit()

    response_data = TaskCommentResponse(
        id=str(new_comment.id),
        task_id=str(new_comment.task_id),
        business_id=str(new_comment.business_id),
        user_id=str(new_comment.user_id),
        user_email=account.email,
        client_comment_id=new_comment.client_comment_id,
        content=new_comment.content,
        created_at=new_comment.created_at.isoformat(),
        updated_at=new_comment.updated_at.isoformat(),
    )

    # 3. Broadcast real-time event to connected WebSockets
    await chat_manager.broadcast(
        business_id,
        {"type": "new_comment", "comment": response_data.model_dump()},
    )

    return response_data

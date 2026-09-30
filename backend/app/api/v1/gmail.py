import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.v1.auth import get_current_user_and_session
from backend.app.clients.gmail import GmailClient, base64url_encode
from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.gmail import GmailConnection, GmailOAuthState, GmailSendAudit
from backend.app.models.session import AuthSession
from backend.app.services.capabilities import resolve_account_capabilities
from backend.app.services.gmail_crypto import decrypt_token, encrypt_token

router = APIRouter(prefix="/v1/email/gmail", tags=["gmail"])
settings = get_settings()
gmail_client = GmailClient(settings=settings)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def generate_pkce_pair() -> tuple[str, str]:
    """Generates PKCE code_verifier and code_challenge (S256)."""
    verifier_bytes = secrets.token_bytes(32)
    code_verifier = base64url_encode(verifier_bytes)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64url_encode(digest)
    return code_verifier, code_challenge


# Request / Response Schemas
class ConnectStartResponse(BaseModel):
    auth_url: str
    state: str


class ConnectionStatusResponse(BaseModel):
    connected: bool
    email_address: Optional[str] = None
    scopes: list[str] = Field(default_factory=list)
    connected_at: Optional[str] = None


class DisconnectResponse(BaseModel):
    status: str = "disconnected"


class AttachmentMetadata(BaseModel):
    id: str
    filename: str
    mime_type: str
    size: int


class MessageDetail(BaseModel):
    message_id: str
    thread_id: str
    subject: str
    from_address: str
    to_address: str
    cc_address: str
    bcc_address: str
    date: str
    internal_date: str
    snippet: str
    body_plain: str
    body_html: str
    is_unread: bool
    attachments: list[AttachmentMetadata] = Field(default_factory=list)


class ThreadSummary(BaseModel):
    thread_id: str
    history_id: str
    snippet: str


class ThreadListResponse(BaseModel):
    threads: list[ThreadSummary]
    next_page_token: Optional[str] = None
    result_size_estimate: int


class ThreadDetailResponse(BaseModel):
    thread_id: str
    history_id: str
    subject: str
    messages: list[MessageDetail]
    has_attachments: bool
    is_unread: bool
    message_count: int


class CreateDraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None
    thread_id: Optional[str] = None


class UpdateDraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None
    thread_id: Optional[str] = None


class DraftResponse(BaseModel):
    draft_id: str
    message_id: Optional[str] = None
    thread_id: Optional[str] = None


class SendDraftRequest(BaseModel):
    idempotency_key: Optional[str] = None


class SendDraftResponse(BaseModel):
    status: str = "sent"
    message_id: Optional[str] = None
    thread_id: Optional[str] = None
    idempotent_replay: bool = False


async def require_business_gmail_capability(account: Account, db: AsyncSession) -> None:
    """Verifies that the account has active Gmail integration entitlement."""
    cap = await resolve_account_capabilities(account, db)
    if "gmail" not in cap.capabilities:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active Business subscription with Gmail capability is required.",
        )


async def get_valid_access_token(
    user_id: UUID, db: AsyncSession
) -> tuple[str, GmailConnection]:
    """
    Retrieves and decrypts the user's Gmail access token, automatically refreshing
    it with the encrypted refresh token if expired.
    """
    stmt = select(GmailConnection).where(
        GmailConnection.user_id == user_id, GmailConnection.is_active.is_(True)
    )
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()

    if not conn:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail account is not connected. Please connect your Gmail account.",
        )

    now = utc_now()
    at_expires = ensure_utc(conn.access_token_expires_at)
    # If cached access token is valid for at least 60 seconds, use it
    if (
        conn.encrypted_access_token
        and at_expires
        and at_expires > now + timedelta(seconds=60)
    ):
        try:
            return decrypt_token(conn.encrypted_access_token), conn
        except Exception:
            pass  # Fall through to refresh

    # Decrypt refresh token and request new access token from Google
    try:
        plain_refresh_token = decrypt_token(conn.encrypted_refresh_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Stored Gmail credentials could not be decrypted. Please reconnect.",
        )

    try:
        token_data = await gmail_client.refresh_access_token(plain_refresh_token)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Failed to refresh Gmail access token: {str(e)}",
        )

    new_access_token = token_data.get("access_token")
    expires_in = token_data.get("expires_in", 3600)
    if not new_access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid response during token refresh.",
        )

    conn.encrypted_access_token = encrypt_token(new_access_token)
    conn.access_token_expires_at = now + timedelta(seconds=expires_in)
    conn.last_synced_at = now
    conn.updated_at = now
    await db.commit()

    return new_access_token, conn


@router.post("/connect/start", response_model=ConnectStartResponse)
async def start_gmail_connect(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Initiates OAuth 2.0 PKCE flow for the authenticated user and returns Google authorization URL.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)

    code_verifier, code_challenge = generate_pkce_pair()
    state = secrets.token_hex(24)
    redirect_uri = settings.get_google_redirect_uri()
    expires_at = utc_now() + timedelta(minutes=10)

    # Clean old uncompleted states for this user
    await db.execute(delete(GmailOAuthState).where(GmailOAuthState.user_id == account.id))

    oauth_state = GmailOAuthState(
        user_id=account.id,
        state=state,
        code_verifier=code_verifier,
        redirect_uri=redirect_uri,
        expires_at=expires_at,
    )
    db.add(oauth_state)
    await db.commit()

    client_id = gmail_client.get_client_id()
    scopes = (
        "https://www.googleapis.com/auth/gmail.readonly "
        "https://www.googleapis.com/auth/gmail.compose"
    )

    auth_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&scope={scopes.replace(' ', '%20')}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
    )

    return ConnectStartResponse(auth_url=auth_url, state=state)


@router.get("/connect/callback", response_class=HTMLResponse)
async def gmail_connect_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    OAuth2 callback endpoint executed in browser. Exchanges code + PKCE verifier,
    stores encrypted refresh token, and returns deep link to app.
    """
    if error:
        return HTMLResponse(
            content=f"""
            <!DOCTYPE html>
            <html>
            <head><title>Gmail Connection Error</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h2 style="color: #DC2626;">Gmail Connection Cancelled</h2>
                <p>Google OAuth returned: {error}</p>
                <p><a href="lafina://email/callback?status=error&error={error}">Return to LAFINA</a></p>
                <script>window.location.href = "lafina://email/callback?status=error&error={error}";</script>
            </body>
            </html>
            """,
            status_code=400,
        )

    if not state or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required code or state parameter.",
        )

    # Validate state
    stmt = select(GmailOAuthState).where(GmailOAuthState.state == state)
    res = await db.execute(stmt)
    oauth_state = res.scalar_one_or_none()

    if not oauth_state or ensure_utc(oauth_state.expires_at) < utc_now():
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head><title>Invalid State</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h2 style="color: #DC2626;">Session Expired</h2>
                <p>The Gmail connection session has expired. Please try connecting again from the app.</p>
                <p><a href="lafina://email/callback?status=error&error=session_expired">Return to LAFINA</a></p>
            </body>
            </html>
            """,
            status_code=400,
        )

    user_id = oauth_state.user_id
    code_verifier = oauth_state.code_verifier
    redirect_uri = oauth_state.redirect_uri

    # State is one-use: delete it immediately
    await db.delete(oauth_state)
    await db.commit()

    try:
        token_data = await gmail_client.exchange_code_for_tokens(
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
        )
    except Exception as e:
        return HTMLResponse(
            content=f"""
            <!DOCTYPE html>
            <html>
            <head><title>Token Exchange Failed</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 40px;">
                <h2 style="color: #DC2626;">Authentication Failed</h2>
                <p>{str(e)}</p>
                <p><a href="lafina://email/callback?status=error&error=token_exchange_failed">Return to LAFINA</a></p>
            </body>
            </html>
            """,
            status_code=400,
        )

    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    scopes = token_data.get("scope", "")

    # Fetch user's Gmail address
    profile = await gmail_client.get_user_profile(access_token)
    email_address = profile.get("emailAddress", "unknown@gmail.com")

    # Upsert GmailConnection
    stmt_conn = select(GmailConnection).where(GmailConnection.user_id == user_id)
    res_conn = await db.execute(stmt_conn)
    existing_conn = res_conn.scalar_one_or_none()

    encrypted_at = encrypt_token(access_token)
    at_expires = utc_now() + timedelta(seconds=expires_in)

    if existing_conn:
        existing_conn.email_address = email_address
        if refresh_token:
            existing_conn.encrypted_refresh_token = encrypt_token(refresh_token)
        existing_conn.encrypted_access_token = encrypted_at
        existing_conn.access_token_expires_at = at_expires
        if scopes:
            existing_conn.scopes = scopes
        existing_conn.is_active = True
        existing_conn.last_synced_at = utc_now()
        existing_conn.updated_at = utc_now()
    else:
        if not refresh_token:
            # Fallback for dev/mock
            refresh_token = f"mock-refresh-{secrets.token_hex(16)}"
        new_conn = GmailConnection(
            user_id=user_id,
            email_address=email_address,
            encrypted_refresh_token=encrypt_token(refresh_token),
            encrypted_access_token=encrypted_at,
            access_token_expires_at=at_expires,
            scopes=scopes or "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
            is_active=True,
            last_synced_at=utc_now(),
        )
        db.add(new_conn)

    await db.commit()

    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
        <head><title>Gmail Connected</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px; background-color: #F8FAFC;">
            <div style="max-width: 400px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                <h2 style="color: #16A34A; margin-bottom: 8px;">✓ Gmail Connected</h2>
                <p style="color: #475569; font-size: 14px;">Connected as <b>{email_address}</b></p>
                <p style="color: #64748B; font-size: 13px;">Returning to LAFINA...</p>
                <p style="margin-top: 20px;"><a href="lafina://email/callback?status=success&email={email_address}" style="display: inline-block; background-color: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Open App</a></p>
            </div>
            <script>
                setTimeout(function() {{
                    window.location.href = "lafina://email/callback?status=success&email={email_address}";
                }}, 600);
            </script>
        </body>
        </html>
        """
    )


@router.get("/connection", response_model=ConnectionStatusResponse)
async def get_connection_status(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the user's Gmail connection status and linked email address.
    """
    account, _ = auth_data
    stmt = select(GmailConnection).where(
        GmailConnection.user_id == account.id, GmailConnection.is_active.is_(True)
    )
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()

    if not conn:
        return ConnectionStatusResponse(connected=False)

    return ConnectionStatusResponse(
        connected=True,
        email_address=conn.email_address,
        scopes=conn.scopes.split(" "),
        connected_at=conn.created_at.isoformat(),
    )


@router.delete("/connection", response_model=DisconnectResponse)
async def disconnect_gmail(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Revokes OAuth tokens and permanently removes Gmail connection for the user.
    """
    account, _ = auth_data
    stmt = select(GmailConnection).where(GmailConnection.user_id == account.id)
    res = await db.execute(stmt)
    conn = res.scalar_one_or_none()

    if conn:
        try:
            plain_rt = decrypt_token(conn.encrypted_refresh_token)
            await gmail_client.revoke_token(plain_rt)
        except Exception:
            pass  # Best-effort token revocation
        await db.delete(conn)

    # Delete any pending oauth states
    await db.execute(delete(GmailOAuthState).where(GmailOAuthState.user_id == account.id))
    await db.commit()

    return DisconnectResponse(status="disconnected")


@router.get("/threads", response_model=ThreadListResponse)
async def list_threads(
    q: Optional[str] = Query(None, description="Search query string"),
    pageToken: Optional[str] = Query(None, description="Next page token"),
    maxResults: int = Query(50, ge=1, le=50, description="Max threads to fetch (capped at 50)"),
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetches up to 50 Gmail thread summaries matching search criteria.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)
    access_token, _ = await get_valid_access_token(account.id, db)

    try:
        data = await gmail_client.list_threads(
            access_token=access_token,
            q=q,
            page_token=pageToken,
            max_results=maxResults,
        )
        return ThreadListResponse(
            threads=[ThreadSummary(**t) for t in data.get("threads", [])],
            next_page_token=data.get("next_page_token"),
            result_size_estimate=data.get("result_size_estimate", 0),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error listing threads: {str(e)}",
        )


@router.get("/threads/{thread_id}", response_model=ThreadDetailResponse)
async def get_thread_detail(
    thread_id: str,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetches full thread messages, attachment metadata, and plain/HTML bodies from Gmail.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)
    access_token, _ = await get_valid_access_token(account.id, db)

    try:
        data = await gmail_client.get_thread_detail(access_token, thread_id)
        messages_parsed = []
        for m in data.get("messages", []):
            attachments_parsed = [
                AttachmentMetadata(**att) for att in m.get("attachments", [])
            ]
            messages_parsed.append(
                MessageDetail(
                    message_id=m["message_id"],
                    thread_id=m["thread_id"],
                    subject=m["subject"],
                    from_address=m["from_address"],
                    to_address=m["to_address"],
                    cc_address=m["cc_address"],
                    bcc_address=m["bcc_address"],
                    date=m["date"],
                    internal_date=m["internal_date"],
                    snippet=m["snippet"],
                    body_plain=m["body_plain"],
                    body_html=m["body_html"],
                    is_unread=m["is_unread"],
                    attachments=attachments_parsed,
                )
            )

        return ThreadDetailResponse(
            thread_id=data["thread_id"],
            history_id=data["history_id"],
            subject=data["subject"],
            messages=messages_parsed,
            has_attachments=data["has_attachments"],
            is_unread=data["is_unread"],
            message_count=data["message_count"],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error fetching thread: {str(e)}",
        )


@router.post("/drafts", response_model=DraftResponse)
async def create_draft(
    req: CreateDraftRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Creates a new draft message in the user's connected Gmail account.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)
    access_token, conn = await get_valid_access_token(account.id, db)

    try:
        draft = await gmail_client.create_draft(
            access_token=access_token,
            from_address=conn.email_address,
            to_address=req.to,
            subject=req.subject,
            body=req.body,
            cc=req.cc,
            bcc=req.bcc,
            thread_id=req.thread_id,
        )
        return DraftResponse(
            draft_id=draft["draft_id"],
            message_id=draft.get("message_id"),
            thread_id=draft.get("thread_id"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error creating draft: {str(e)}",
        )


@router.put("/drafts/{draft_id}", response_model=DraftResponse)
async def update_draft(
    draft_id: str,
    req: UpdateDraftRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Updates an existing draft message in the user's connected Gmail account.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)
    access_token, conn = await get_valid_access_token(account.id, db)

    try:
        draft = await gmail_client.update_draft(
            access_token=access_token,
            draft_id=draft_id,
            from_address=conn.email_address,
            to_address=req.to,
            subject=req.subject,
            body=req.body,
            cc=req.cc,
            bcc=req.bcc,
            thread_id=req.thread_id,
        )
        return DraftResponse(
            draft_id=draft["draft_id"],
            message_id=draft.get("message_id"),
            thread_id=draft.get("thread_id"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error updating draft: {str(e)}",
        )


@router.post("/drafts/{draft_id}/send", response_model=SendDraftResponse)
async def send_draft(
    draft_id: str,
    req: SendDraftRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    """
    Sends an existing draft message via Gmail API with optional idempotency verification.
    """
    account, _ = auth_data
    await require_business_gmail_capability(account, db)
    access_token, _ = await get_valid_access_token(account.id, db)

    audit_entry: Optional[GmailSendAudit] = None

    if req.idempotency_key:
        stmt_audit = select(GmailSendAudit).where(
            GmailSendAudit.user_id == account.id,
            GmailSendAudit.idempotency_key == req.idempotency_key,
        )
        res_audit = await db.execute(stmt_audit)
        audit_entry = res_audit.scalar_one_or_none()

        if audit_entry:
            if audit_entry.status == "sent":
                return SendDraftResponse(
                    status="sent",
                    message_id=audit_entry.gmail_message_id,
                    idempotent_replay=True,
                )
            if audit_entry.status == "pending":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email send is already in progress with this idempotency key.",
                )
        else:
            audit_entry = GmailSendAudit(
                user_id=account.id,
                idempotency_key=req.idempotency_key,
                status="pending",
            )
            db.add(audit_entry)
            await db.commit()

    try:
        send_result = await gmail_client.send_draft(access_token, draft_id)
        msg_id = send_result.get("message_id")
        thread_id = send_result.get("thread_id")

        if audit_entry:
            audit_entry.status = "sent"
            audit_entry.gmail_message_id = msg_id
            audit_entry.updated_at = utc_now()
            await db.commit()

        return SendDraftResponse(
            status="sent",
            message_id=msg_id,
            thread_id=thread_id,
            idempotent_replay=False,
        )
    except Exception as e:
        if audit_entry:
            audit_entry.status = "failed"
            audit_entry.updated_at = utc_now()
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gmail API error sending draft: {str(e)}",
        )

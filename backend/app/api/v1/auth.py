import secrets
from datetime import UTC, datetime, timedelta

from backend.app.config import get_settings
from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.recovery import RecoveryCode
from backend.app.models.session import AuthSession
from backend.app.security.auth import (
    create_access_token,
    generate_refresh_token,
    get_current_user_and_session,
    hash_password,
    hash_token,
    normalize_email,
    validate_password_strength,
    verify_password,
)
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/v1/auth", tags=["auth"])
settings = get_settings()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    device_info: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class RecoverRequest(BaseModel):
    email: EmailStr
    recovery_code: str
    new_password: str


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 900
    user_id: str
    email: str
    role: str
    recovery_codes: list[str] | None = None


class UserProfileResponse(BaseModel):
    id: str
    email: str
    role: str
    is_active: bool
    created_at: str


@router.post("/register", response_model=AuthTokenResponse, status_code=status.HTTP_201_CREATED)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    validate_password_strength(req.password)
    normalized_email = normalize_email(str(req.email))
    stmt = select(Account).where(func.lower(Account.email) == normalized_email)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Account with this email already exists."
        )

    password_hash = hash_password(req.password)
    account = Account(email=normalized_email, password_hash=password_hash, role="student")
    db.add(account)
    await db.flush()

    raw_refresh = generate_refresh_token()
    refresh_hash = hash_token(raw_refresh)
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    session = AuthSession(
        owner_id=account.id, refresh_token_hash=refresh_hash, expires_at=expires_at
    )
    db.add(session)
    await db.flush()

    # Generate 4 one-time recovery codes
    raw_recovery_codes = [secrets.token_hex(4).upper() for _ in range(4)]
    for rec_code in raw_recovery_codes:
        db.add(RecoveryCode(owner_id=account.id, code_hash=hash_token(rec_code)))

    await db.commit()

    access_token, _ = create_access_token(str(account.id), str(session.id), account.role)

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        user_id=str(account.id),
        email=account.email,
        role=account.role,
        recovery_codes=raw_recovery_codes,
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    validate_password_strength(req.password)
    normalized_email = normalize_email(str(req.email))
    stmt = select(Account).where(func.lower(Account.email) == normalized_email)
    res = await db.execute(stmt)
    account = res.scalar_one_or_none()

    if not account or not verify_password(req.password, account.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password."
        )

    if not account.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled.")

    raw_refresh = generate_refresh_token()
    refresh_hash = hash_token(raw_refresh)
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    session = AuthSession(
        owner_id=account.id,
        refresh_token_hash=refresh_hash,
        device_info=req.device_info,
        expires_at=expires_at,
    )
    db.add(session)
    await db.commit()

    access_token, _ = create_access_token(str(account.id), str(session.id), account.role)

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh,
        user_id=str(account.id),
        email=account.email,
        role=account.role,
    )


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh(req: RefreshRequest, db: AsyncSession = Depends(get_db)):
    old_hash = hash_token(req.refresh_token)
    stmt = select(AuthSession).where(AuthSession.refresh_token_hash == old_hash)
    res = await db.execute(stmt)
    old_session = res.scalar_one_or_none()

    now = datetime.now(UTC)
    if not old_session or old_session.is_revoked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token."
        )

    old_expires_at = old_session.expires_at
    if old_expires_at.tzinfo is None:
        old_expires_at = old_expires_at.replace(tzinfo=UTC)

    if old_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token."
        )

    # Revoke old session (token rotation)
    old_session.is_revoked = True

    account_stmt = select(Account).where(Account.id == old_session.owner_id)
    account_res = await db.execute(account_stmt)
    account = account_res.scalar_one_or_none()

    if not account or not account.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account inactive.")

    # Issue new refresh token & session
    new_raw_refresh = generate_refresh_token()
    new_refresh_hash = hash_token(new_raw_refresh)
    new_expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    new_session = AuthSession(
        owner_id=account.id,
        refresh_token_hash=new_refresh_hash,
        device_info=old_session.device_info,
        expires_at=new_expires_at,
    )
    db.add(new_session)
    await db.commit()

    access_token, _ = create_access_token(str(account.id), str(new_session.id), account.role)

    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=new_raw_refresh,
        user_id=str(account.id),
        email=account.email,
        role=account.role,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    _, session = auth_data
    session.is_revoked = True
    await db.commit()


@router.post("/recover", status_code=status.HTTP_200_OK)
async def recover(req: RecoverRequest, db: AsyncSession = Depends(get_db)):
    validate_password_strength(req.new_password)

    normalized_email = normalize_email(str(req.email))
    account_stmt = select(Account).where(func.lower(Account.email) == normalized_email)
    account_res = await db.execute(account_stmt)
    account = account_res.scalar_one_or_none()

    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")

    rec_hash = hash_token(req.recovery_code.upper())
    rec_stmt = select(RecoveryCode).where(
        RecoveryCode.owner_id == account.id,
        RecoveryCode.code_hash == rec_hash,
        RecoveryCode.is_used.is_(False),
    )
    rec_res = await db.execute(rec_stmt)
    rec_code = rec_res.scalar_one_or_none()

    if not rec_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or previously used recovery code.",
        )

    rec_code.is_used = True
    rec_code.used_at = datetime.now(UTC)

    account.password_hash = hash_password(req.new_password)

    # Revoke all active sessions
    await db.execute(
        update(AuthSession).where(AuthSession.owner_id == account.id).values(is_revoked=True)
    )

    await db.commit()
    return {"detail": "Password successfully reset. Please log in with your new password."}


@router.get("/me", response_model=UserProfileResponse)
async def get_me(auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session)):
    account, _ = auth_data
    return UserProfileResponse(
        id=str(account.id),
        email=account.email,
        role=account.role,
        is_active=account.is_active,
        created_at=account.created_at.isoformat(),
    )

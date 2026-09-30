import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessInvitation, BusinessMembership
from backend.app.models.session import AuthSession
from backend.app.security.auth import get_current_user_and_session, normalize_email
from backend.app.services.capabilities import (
    BusinessSessionData,
    resolve_account_capabilities,
)

router = APIRouter(prefix="/v1/businesses", tags=["businesses"])


# Request & Response Schemas
class CreateBusinessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=128)
    timezone: str = Field("UTC", max_length=64)


class MemberResponse(BaseModel):
    user_id: str
    email: str
    member_role: str
    membership_status: str
    joined_at: str


class InvitationResponse(BaseModel):
    id: str
    business_id: str
    business_name: str
    invited_by: str
    email: str
    member_role: str
    status: str
    expires_at: str
    created_at: str


class BusinessDetailResponse(BaseModel):
    id: str
    name: str
    owner_id: str
    timezone: str
    subscription_plan: str
    subscription_status: str
    seat_limit: int
    active_seats: int
    my_role: str
    my_status: str
    members: list[MemberResponse]
    pending_invitations: list[InvitationResponse]
    created_at: str


class CreateInvitationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    member_role: Literal["manager", "employee"] = "employee"


class UpdateMemberStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "suspended", "removed"]


class UpdateMemberRoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["manager", "employee"]


async def _get_active_seat_count(business_id: uuid.UUID, db: AsyncSession) -> int:
    stmt = (
        select(func.count(BusinessMembership.id))
        .where(
            BusinessMembership.business_id == business_id,
            BusinessMembership.membership_status == "active",
        )
    )
    res = await db.execute(stmt)
    return res.scalar() or 0


async def _require_business_manager(
    business_id: uuid.UUID,
    account_id: uuid.UUID,
    db: AsyncSession,
) -> tuple[Business, BusinessMembership]:
    b_stmt = select(Business).where(Business.id == business_id)
    b_res = await db.execute(b_stmt)
    business = b_res.scalar_one_or_none()
    if not business:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found.")

    m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business_id,
        BusinessMembership.user_id == account_id,
        BusinessMembership.membership_status == "active",
    )
    m_res = await db.execute(m_stmt)
    membership = m_res.scalar_one_or_none()

    if not membership or membership.member_role != "manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager permissions required.",
        )
    return business, membership


@router.post("", response_model=BusinessDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_business(
    req: CreateBusinessRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data

    # One active business membership per account in v1
    active_m_stmt = select(BusinessMembership).where(
        BusinessMembership.user_id == account.id,
        BusinessMembership.membership_status == "active",
    )
    active_m_res = await db.execute(active_m_stmt)
    if active_m_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account already belongs to an active business.",
        )

    now = datetime.now(timezone.utc)
    business = Business(
        owner_id=account.id,
        name=req.name.strip(),
        timezone=req.timezone.strip() or "UTC",
        subscription_plan="business",
        subscription_status="active",
        seat_limit=5,
        valid_from=now,
    )
    db.add(business)
    await db.flush()

    # Owner is automatically an active manager and consumes 1 seat
    owner_membership = BusinessMembership(
        business_id=business.id,
        business_owner_id=business.owner_id,
        user_id=account.id,
        member_role="manager",
        membership_status="active",
    )
    db.add(owner_membership)

    account.subscription_plan = "business"
    await db.commit()

    return BusinessDetailResponse(
        id=str(business.id),
        name=business.name,
        owner_id=str(business.owner_id),
        timezone=business.timezone,
        subscription_plan=business.subscription_plan,
        subscription_status=business.subscription_status,
        seat_limit=business.seat_limit,
        active_seats=1,
        my_role="manager",
        my_status="active",
        members=[
            MemberResponse(
                user_id=str(account.id),
                email=account.email,
                member_role="manager",
                membership_status="active",
                joined_at=now.isoformat(),
            )
        ],
        pending_invitations=[],
        created_at=now.isoformat(),
    )


@router.get("/current", response_model=BusinessDetailResponse)
async def get_current_business(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data

    stmt = (
        select(BusinessMembership, Business)
        .join(Business, Business.id == BusinessMembership.business_id)
        .where(
            BusinessMembership.user_id == account.id,
            BusinessMembership.membership_status == "active",
        )
    )
    res = await db.execute(stmt)
    row = res.first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active business membership found.",
        )

    membership, business = row

    # Fetch all members
    members_stmt = (
        select(BusinessMembership, Account)
        .join(Account, Account.id == BusinessMembership.user_id)
        .where(BusinessMembership.business_id == business.id)
    )
    members_res = await db.execute(members_stmt)
    members_list = [
        MemberResponse(
            user_id=str(m.user_id),
            email=acc.email,
            member_role=m.member_role,
            membership_status=m.membership_status,
            joined_at=m.created_at.isoformat(),
        )
        for m, acc in members_res.all()
    ]

    active_seats = sum(1 for m in members_list if m.membership_status == "active")

    # Fetch pending invitations if manager
    pending_invites: list[InvitationResponse] = []
    if membership.member_role == "manager":
        now = datetime.now(timezone.utc)
        inv_stmt = select(BusinessInvitation).where(
            BusinessInvitation.business_id == business.id,
            BusinessInvitation.status == "pending",
            BusinessInvitation.expires_at > now,
        )
        inv_res = await db.execute(inv_stmt)
        pending_invites = [
            InvitationResponse(
                id=str(inv.id),
                business_id=str(inv.business_id),
                business_name=business.name,
                invited_by=str(inv.invited_by),
                email=inv.email,
                member_role=inv.member_role,
                status=inv.status,
                expires_at=inv.expires_at.isoformat(),
                created_at=inv.created_at.isoformat(),
            )
            for inv in inv_res.scalars().all()
        ]

    return BusinessDetailResponse(
        id=str(business.id),
        name=business.name,
        owner_id=str(business.owner_id),
        timezone=business.timezone,
        subscription_plan=business.subscription_plan,
        subscription_status=business.subscription_status,
        seat_limit=business.seat_limit,
        active_seats=active_seats,
        my_role=membership.member_role,
        my_status=membership.membership_status,
        members=members_list,
        pending_invitations=pending_invites,
        created_at=business.created_at.isoformat(),
    )


@router.post("/{business_id}/invitations", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    business_id: uuid.UUID,
    req: CreateInvitationRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    business, _ = await _require_business_manager(business_id, account.id, db)

    normalized_target_email = normalize_email(str(req.email))

    # Verify target email belongs to a registered LAFINA user
    target_acc_stmt = select(Account).where(func.lower(Account.email) == normalized_target_email)
    target_acc_res = await db.execute(target_acc_stmt)
    target_account = target_acc_res.scalar_one_or_none()
    if not target_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target email is not a registered LAFINA account.",
        )

    # Check if target already has active membership in this business
    existing_m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business.id,
        BusinessMembership.user_id == target_account.id,
        BusinessMembership.membership_status == "active",
    )
    existing_m_res = await db.execute(existing_m_stmt)
    if existing_m_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User is already an active member of this business.",
        )

    # Check seat limit capacity
    active_seats = await _get_active_seat_count(business.id, db)
    if active_seats >= business.seat_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Business seat limit reached ({business.seat_limit}). Upgrade seats to invite more members.",
        )

    now = datetime.now(timezone.utc)
    # Check for existing active pending invitation for this email
    existing_inv_stmt = select(BusinessInvitation).where(
        BusinessInvitation.business_id == business.id,
        func.lower(BusinessInvitation.email) == normalized_target_email,
        BusinessInvitation.status == "pending",
        BusinessInvitation.expires_at > now,
    )
    existing_inv_res = await db.execute(existing_inv_stmt)
    if existing_inv_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A pending invitation already exists for this email.",
        )

    token = secrets.token_urlsafe(32)
    invitation = BusinessInvitation(
        business_id=business.id,
        invited_by=account.id,
        email=normalized_target_email,
        member_role=req.member_role,
        token=token,
        status="pending",
        expires_at=now + timedelta(days=7),
    )
    db.add(invitation)
    await db.commit()

    return InvitationResponse(
        id=str(invitation.id),
        business_id=str(business.id),
        business_name=business.name,
        invited_by=str(invitation.invited_by),
        email=invitation.email,
        member_role=invitation.member_role,
        status=invitation.status,
        expires_at=invitation.expires_at.isoformat(),
        created_at=invitation.created_at.isoformat(),
    )


@router.get("/{business_id}/invitations", response_model=list[InvitationResponse])
async def list_business_invitations(
    business_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    business, _ = await _require_business_manager(business_id, account.id, db)

    now = datetime.now(timezone.utc)
    stmt = select(BusinessInvitation).where(
        BusinessInvitation.business_id == business.id,
        BusinessInvitation.status == "pending",
        BusinessInvitation.expires_at > now,
    )
    res = await db.execute(stmt)
    return [
        InvitationResponse(
            id=str(inv.id),
            business_id=str(inv.business_id),
            business_name=business.name,
            invited_by=str(inv.invited_by),
            email=inv.email,
            member_role=inv.member_role,
            status=inv.status,
            expires_at=inv.expires_at.isoformat(),
            created_at=inv.created_at.isoformat(),
        )
        for inv in res.scalars().all()
    ]


@router.get("/invitations/my", response_model=list[InvitationResponse])
async def list_my_invitations(
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    now = datetime.now(timezone.utc)
    stmt = (
        select(BusinessInvitation, Business)
        .join(Business, Business.id == BusinessInvitation.business_id)
        .where(
            func.lower(BusinessInvitation.email) == normalize_email(account.email),
            BusinessInvitation.status == "pending",
            BusinessInvitation.expires_at > now,
        )
    )
    res = await db.execute(stmt)
    return [
        InvitationResponse(
            id=str(inv.id),
            business_id=str(b.id),
            business_name=b.name,
            invited_by=str(inv.invited_by),
            email=inv.email,
            member_role=inv.member_role,
            status=inv.status,
            expires_at=inv.expires_at.isoformat(),
            created_at=inv.created_at.isoformat(),
        )
        for inv, b in res.all()
    ]


@router.post("/invitations/{invitation_id}/accept", response_model=BusinessSessionData)
async def accept_invitation(
    invitation_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    now = datetime.now(timezone.utc)

    inv_stmt = select(BusinessInvitation, Business).join(
        Business, Business.id == BusinessInvitation.business_id
    ).where(BusinessInvitation.id == invitation_id)
    inv_res = await db.execute(inv_stmt)
    row = inv_res.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

    invitation, business = row

    if normalize_email(invitation.email) != normalize_email(account.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation was sent to a different email address.",
        )

    if invitation.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invitation is already {invitation.status}.",
        )

    inv_expires_at = invitation.expires_at
    if inv_expires_at.tzinfo is None:
        inv_expires_at = inv_expires_at.replace(tzinfo=timezone.utc)
    if inv_expires_at <= now:
        invitation.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invitation has expired.",
        )

    # Check seat limit capacity on acceptance
    active_seats = await _get_active_seat_count(business.id, db)
    if active_seats >= business.seat_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Business seat limit reached. Please contact your manager.",
        )

    # One active business membership per account in v1
    active_m_stmt = select(BusinessMembership).where(
        BusinessMembership.user_id == account.id,
        BusinessMembership.membership_status == "active",
    )
    active_m_res = await db.execute(active_m_stmt)
    if active_m_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an active business membership. Leave your current business before accepting.",
        )

    invitation.status = "accepted"

    # Upsert or create membership
    m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business.id,
        BusinessMembership.user_id == account.id,
    )
    m_res = await db.execute(m_stmt)
    membership = m_res.scalar_one_or_none()

    if membership:
        membership.member_role = invitation.member_role
        membership.membership_status = "active"
        membership.business_owner_id = business.owner_id
        membership.updated_at = now
    else:
        membership = BusinessMembership(
            business_id=business.id,
            business_owner_id=business.owner_id,
            user_id=account.id,
            member_role=invitation.member_role,
            membership_status="active",
        )
        db.add(membership)

    await db.commit()

    cap_res = await resolve_account_capabilities(account, db)
    if not cap_res.business_session:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to initialize business session.")

    return cap_res.business_session


@router.post("/invitations/{invitation_id}/decline")
async def decline_invitation(
    invitation_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    inv_stmt = select(BusinessInvitation).where(BusinessInvitation.id == invitation_id)
    inv_res = await db.execute(inv_stmt)
    invitation = inv_res.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

    if normalize_email(invitation.email) != normalize_email(account.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invitation was sent to a different email address.",
        )

    invitation.status = "declined"
    await db.commit()
    return {"detail": "Invitation declined."}


@router.delete("/{business_id}/invitations/{invitation_id}")
async def cancel_invitation(
    business_id: uuid.UUID,
    invitation_id: uuid.UUID,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    business, _ = await _require_business_manager(business_id, account.id, db)

    inv_stmt = select(BusinessInvitation).where(
        BusinessInvitation.id == invitation_id,
        BusinessInvitation.business_id == business.id,
    )
    inv_res = await db.execute(inv_stmt)
    invitation = inv_res.scalar_one_or_none()
    if not invitation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

    invitation.status = "cancelled"
    await db.commit()
    return {"detail": "Invitation cancelled."}


@router.patch("/{business_id}/members/{user_id}/status")
async def update_member_status(
    business_id: uuid.UUID,
    user_id: uuid.UUID,
    req: UpdateMemberStatusRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    business, _ = await _require_business_manager(business_id, account.id, db)

    if user_id == business.owner_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot modify status of the organization owner.",
        )

    m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business.id,
        BusinessMembership.user_id == user_id,
    )
    m_res = await db.execute(m_stmt)
    membership = m_res.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")

    membership.membership_status = req.status
    membership.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"detail": f"Member status updated to {req.status}."}


@router.patch("/{business_id}/members/{user_id}/role")
async def update_member_role(
    business_id: uuid.UUID,
    user_id: uuid.UUID,
    req: UpdateMemberRoleRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    b_stmt = select(Business).where(Business.id == business_id)
    b_res = await db.execute(b_stmt)
    business = b_res.scalar_one_or_none()
    if not business:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found.")

    # Owner only can promote or demote managers
    if business.owner_id != account.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the organization owner can promote or demote managers.",
        )

    if user_id == business.owner_id and req.role != "manager":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner must remain a manager.",
        )

    m_stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business.id,
        BusinessMembership.user_id == user_id,
    )
    m_res = await db.execute(m_stmt)
    membership = m_res.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found.")

    membership.member_role = req.role
    membership.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"detail": f"Member role updated to {req.role}."}

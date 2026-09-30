import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Integer, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from backend.app.database import Base

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    subscription_plan: Mapped[str] = mapped_column(String(32), default="business", nullable=False)
    subscription_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    seat_limit: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    owner = relationship("Account", back_populates="businesses_owned", foreign_keys=[owner_id])
    memberships = relationship("BusinessMembership", back_populates="business", cascade="all, delete-orphan")
    invitations = relationship("BusinessInvitation", back_populates="business", cascade="all, delete-orphan")


class BusinessMembership(Base):
    __tablename__ = "business_memberships"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    # Denormalized copy of businesses.owner_id. The row-level-security policy on
    # this table must stay free of subqueries, otherwise it re-enters the policy
    # on ``businesses`` and PostgreSQL raises "infinite recursion detected in
    # policy". Kept in step by a trigger on businesses (migration 009).
    business_owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    member_role: Mapped[str] = mapped_column(String(32), default="employee", nullable=False)  # 'manager' | 'employee'
    membership_status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)  # 'invited' | 'active' | 'suspended' | 'removed'

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    business = relationship("Business", back_populates="memberships")
    user = relationship("Account", back_populates="memberships", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("business_id", "user_id", name="uq_business_membership_user"),
        Index("idx_business_memberships_user_status", "user_id", "membership_status"),
    )


class BusinessInvitation(Base):
    __tablename__ = "business_invitations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False, index=True)
    invited_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    member_role: Mapped[str] = mapped_column(String(32), default="employee", nullable=False)  # 'manager' | 'employee'
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)  # 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled'
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    business = relationship("Business", back_populates="invitations")
    inviter = relationship("Account", back_populates="invitations_sent", foreign_keys=[invited_by])

    __table_args__ = (
        Index("idx_business_invitations_email_status", "email", "status"),
    )

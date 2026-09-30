import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from backend.app.database import Base

def utc_now():
    return datetime.now(timezone.utc)

class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="student", nullable=False)
    system_role: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
    subscription_plan: Mapped[str] = mapped_column(String(32), default="student", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    sessions = relationship("AuthSession", back_populates="account", cascade="all, delete-orphan")
    recovery_codes = relationship("RecoveryCode", back_populates="account", cascade="all, delete-orphan")
    businesses_owned = relationship("Business", back_populates="owner", cascade="all, delete-orphan", foreign_keys="[Business.owner_id]")
    # BusinessMembership carries two foreign keys to accounts (the member and
    # the denormalized business owner), so the join column must be explicit.
    memberships = relationship(
        "BusinessMembership",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="[BusinessMembership.user_id]",
    )
    invitations_sent = relationship("BusinessInvitation", back_populates="inviter", cascade="all, delete-orphan", foreign_keys="[BusinessInvitation.invited_by]")

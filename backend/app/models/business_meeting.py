import uuid
from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING
from sqlalchemy import (
    String,
    Text,
    Integer,
    ForeignKey,
    DateTime,
    Index,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.database import Base

if TYPE_CHECKING:
    from backend.app.models.business import Business
    from backend.app.models.account import Account


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BusinessMeeting(Base):
    __tablename__ = "business_meetings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled Meeting")
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    full_transcript: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    summary_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="not_requested",  # 'not_requested', 'summary_pending', 'completed', 'failed'
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )

    # Relationships
    business: Mapped["Business"] = relationship(foreign_keys=[business_id])
    creator: Mapped["Account"] = relationship(foreign_keys=[created_by])
    recipients: Mapped[list["BusinessMeetingRecipient"]] = relationship(
        back_populates="meeting",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("ix_business_meetings_business_created", "business_id", "created_at"),
        Index("ix_business_meetings_creator", "created_by"),
    )


class BusinessMeetingRecipient(Base):
    __tablename__ = "business_meeting_recipients"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_meetings.id", ondelete="CASCADE"),
        nullable=False,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    # Relationships
    meeting: Mapped["BusinessMeeting"] = relationship(back_populates="recipients")
    user: Mapped["Account"] = relationship(foreign_keys=[user_id])
    business: Mapped["Business"] = relationship(foreign_keys=[business_id])

    __table_args__ = (
        UniqueConstraint("meeting_id", "user_id", name="uq_meeting_recipients_meeting_user"),
        Index("ix_meeting_recipients_user_business", "user_id", "business_id"),
    )

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class BusinessChatChannel(Base):
    __tablename__ = "business_chat_channels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(100), default="general", nullable=False)
    channel_type: Mapped[str] = mapped_column(String(32), default="general", nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    business = relationship("Business", foreign_keys=[business_id])
    messages = relationship(
        "BusinessChatMessage",
        back_populates="channel",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        Index("ix_business_chat_channels_business_id", "business_id"),
        UniqueConstraint("business_id", "name", name="uq_business_channel_name"),
    )


class BusinessChatMessage(Base):
    __tablename__ = "business_chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_chat_channels.id", ondelete="CASCADE"),
        nullable=False,
    )
    business_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("businesses.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_message_id: Mapped[str] = mapped_column(
        String(128), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    task_link_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    channel = relationship("BusinessChatChannel", back_populates="messages")
    business = relationship("Business", foreign_keys=[business_id])
    sender = relationship("Account", foreign_keys=[sender_id])
    task_link = relationship("BusinessTask", foreign_keys=[task_link_id])

    __table_args__ = (
        Index("ix_business_chat_messages_channel_created", "channel_id", "created_at"),
        Index("ix_business_chat_messages_business_id", "business_id"),
        Index("ix_business_chat_messages_sender_id", "sender_id"),
        Index("ix_business_chat_messages_task_link_id", "task_link_id"),
        Index("ix_business_chat_messages_client_msg_id", "client_message_id"),
        UniqueConstraint(
            "business_id", "client_message_id", name="uq_business_chat_client_msg_id"
        ),
    )


class BusinessTaskComment(Base):
    __tablename__ = "business_task_comments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("business_tasks.id", ondelete="CASCADE"),
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
    client_comment_id: Mapped[str] = mapped_column(
        String(128), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )

    task = relationship("BusinessTask", foreign_keys=[task_id])
    business = relationship("Business", foreign_keys=[business_id])
    user = relationship("Account", foreign_keys=[user_id])

    __table_args__ = (
        Index("ix_business_task_comments_task_created", "task_id", "created_at"),
        Index("ix_business_task_comments_business_id", "business_id"),
        Index("ix_business_task_comments_user_id", "user_id"),
        Index("ix_business_task_comments_client_comment_id", "client_comment_id"),
        UniqueConstraint(
            "task_id", "client_comment_id", name="uq_business_task_client_comment_id"
        ),
    )

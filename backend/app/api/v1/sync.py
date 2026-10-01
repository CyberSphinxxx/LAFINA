from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.change_feed import ChangeFeed
from backend.app.models.mutations import IdempotentMutation
from backend.app.models.session import AuthSession
from backend.app.models.synchronized_content import (
    CustomCategoriesSync,
    EventsSync,
    NotesSync,
    ProfileSync,
    RemindersSync,
    TasksSync,
    TimeBlocksSync,
)
from backend.app.security.auth import get_current_user_and_session
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/v1/sync", tags=["sync"])


# Strict typed entity payloads forbidding unknown/untrusted fields (extra="forbid")
class TaskPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., max_length=256)
    due_date: str | None = None
    due_time: str | None = None
    is_completed: bool = False
    priority: str = Field("medium", max_length=32)
    category: str = Field("General", max_length=64)
    notes: str | None = None
    recurrence_rule: str | None = None


class EventPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., max_length=256)
    date: str
    start_time: str
    end_time: str
    location: str | None = None
    linked_calendar_block: str | None = None
    recurrence_rule: str | None = None


class TimeBlockPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., max_length=256)
    date: str
    start_time: str
    end_time: str
    color: str
    category: str
    notes: str | None = None
    recurrence_rule: str | None = None


class ReminderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task: str = Field(..., max_length=256)
    description: str | None = None
    scheduled_at: str
    trigger_at: str
    status: str = "pending"
    snooze_count: int = 0


class NotePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(..., max_length=256)
    body: str
    is_pinned: bool = False
    tags: str = ""
    category: str = "General"
    is_voice_transcribed: bool = False
    sort_order: int = 0


class CustomCategoryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., max_length=128)
    color: str = Field(..., max_length=32)


class ProfilePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(..., max_length=128)
    wake_time: str = "07:00"
    sleep_time: str = "23:00"
    study_peak_hours: str = "morning"
    busiest_day: str = "Monday"
    reminder_lead_minutes: int = 15
    snooze_tendency: str = "medium"
    weekly_class_count: str = "5"
    longest_class_gap: str = "2"
    time_format_24h: bool = False
    week_starts_monday: bool = False
    dark_mode: bool = False


EntityType = Literal[
    "profile", "task", "event", "time_block", "reminder", "note", "custom_category"
]
OperationType = Literal["create", "update", "delete"]


class SyncMutation(BaseModel):
    mutationId: str = Field(..., max_length=128)
    entityType: EntityType
    entityId: str = Field(..., max_length=128)
    operation: OperationType
    clientUpdatedAt: str
    payload: dict


class SyncBatchRequest(BaseModel):
    mutations: list[SyncMutation] = Field(default_factory=list, max_length=100)
    cursor: int = Field(default=0, ge=0)


class MutationResult(BaseModel):
    mutationId: str
    entityType: EntityType
    entityId: str
    status: Literal["accepted", "rejected"]
    reason: str | None = None


class ChangeItem(BaseModel):
    changeId: int
    entityType: EntityType
    entityId: str
    operation: OperationType
    version: int
    payload: dict
    updatedAt: str
    deletedAt: str | None = None


class SyncBatchResponse(BaseModel):
    accepted: list[MutationResult]
    rejected: list[MutationResult]
    changes: list[ChangeItem]
    nextCursor: int
    hasMore: bool
    resetRequired: bool
    serverTime: str


MODEL_MAP = {
    "profile": ProfileSync,
    "task": TasksSync,
    "event": EventsSync,
    "time_block": TimeBlocksSync,
    "reminder": RemindersSync,
    "note": NotesSync,
    "custom_category": CustomCategoriesSync,
}

PAYLOAD_VALIDATOR_MAP = {
    "profile": ProfilePayload,
    "task": TaskPayload,
    "event": EventPayload,
    "time_block": TimeBlockPayload,
    "reminder": ReminderPayload,
    "note": NotePayload,
    "custom_category": CustomCategoryPayload,
}

FORBIDDEN_KEYS = {
    "owner_id",
    "role",
    "password_hash",
    "entitlements",
    "ai_limit",
    "server_timestamp",
}


@router.post("/batch", response_model=SyncBatchResponse)
async def sync_batch(
    req: SyncBatchRequest,
    auth_data: Annotated[tuple[Account, AuthSession], Depends(get_current_user_and_session)],
    db: AsyncSession = Depends(get_db),
):
    account, _ = auth_data
    owner_id = account.id
    now = datetime.now(UTC)
    now_str = now.isoformat()

    if len(req.mutations) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch exceeds maximum of 100 mutations.",
        )

    accepted_results: list[MutationResult] = []
    rejected_results: list[MutationResult] = []

    # Get latest global change_id
    max_change_res = await db.execute(select(func.max(ChangeFeed.change_id)))
    current_max_change_id = max_change_res.scalar() or 0

    for mut in req.mutations:
        # Check idempotency
        idempotent_stmt = select(IdempotentMutation).where(
            IdempotentMutation.mutation_id == mut.mutationId,
            IdempotentMutation.owner_id == owner_id,
        )
        idem_res = await db.execute(idempotent_stmt)
        existing_idem = idem_res.scalar_one_or_none()

        if existing_idem:
            accepted_results.append(
                MutationResult(
                    mutationId=mut.mutationId,
                    entityType=mut.entityType,
                    entityId=mut.entityId,
                    status="accepted",
                    reason="idempotent_duplicate",
                )
            )
            continue

        # Sanity check forbidden client tampering fields in payload
        if any(key in mut.payload for key in FORBIDDEN_KEYS):
            rejected_results.append(
                MutationResult(
                    mutationId=mut.mutationId,
                    entityType=mut.entityType,
                    entityId=mut.entityId,
                    status="rejected",
                    reason="Forbidden untrusted client payload fields detected",
                )
            )
            continue

        validator_cls = PAYLOAD_VALIDATOR_MAP.get(mut.entityType)
        if mut.operation != "delete" and validator_cls:
            try:
                validated_payload = validator_cls(**mut.payload).model_dump()
            except Exception as e:  # noqa: BLE001 - a bad payload must be rejected, never 500 the batch
                rejected_results.append(
                    MutationResult(
                        mutationId=mut.mutationId,
                        entityType=mut.entityType,
                        entityId=mut.entityId,
                        status="rejected",
                        reason=f"Payload validation failed: {e!s}",
                    )
                )
                continue
        else:
            validated_payload = mut.payload

        model_cls = MODEL_MAP.get(mut.entityType)
        if not model_cls:
            rejected_results.append(
                MutationResult(
                    mutationId=mut.mutationId,
                    entityType=mut.entityType,
                    entityId=mut.entityId,
                    status="rejected",
                    reason=f"Unknown entity type {mut.entityType}",
                )
            )
            continue

        # Query existing entity in DB
        entity_stmt = select(model_cls).where(
            model_cls.owner_id == owner_id, model_cls.client_id == mut.entityId
        )
        entity_res = await db.execute(entity_stmt)
        existing_entity = entity_res.scalar_one_or_none()

        current_max_change_id += 1
        new_change_id = current_max_change_id

        if mut.operation == "delete":
            deleted_at_val = now
            new_version = (existing_entity.version + 1) if existing_entity else 1
            if existing_entity:
                existing_entity.deleted_at = deleted_at_val
                existing_entity.version = new_version
                existing_entity.change_id = new_change_id
                existing_entity.updated_at = now
            else:
                db.add(
                    model_cls(
                        owner_id=owner_id,
                        client_id=mut.entityId,
                        version=new_version,
                        change_id=new_change_id,
                        payload={},
                        updated_at=now,
                        deleted_at=deleted_at_val,
                    )
                )
        else:
            new_version = (existing_entity.version + 1) if existing_entity else 1
            if existing_entity:
                existing_entity.payload = validated_payload
                existing_entity.version = new_version
                existing_entity.change_id = new_change_id
                existing_entity.updated_at = now
                existing_entity.deleted_at = None
            else:
                db.add(
                    model_cls(
                        owner_id=owner_id,
                        client_id=mut.entityId,
                        version=new_version,
                        change_id=new_change_id,
                        payload=validated_payload,
                        updated_at=now,
                        deleted_at=None,
                    )
                )

        # Record into Change Feed
        db.add(
            ChangeFeed(
                change_id=new_change_id,
                owner_id=owner_id,
                entity_type=mut.entityType,
                entity_id=mut.entityId,
                operation=mut.operation,
                version=new_version,
                payload=validated_payload,
                created_at=now,
            )
        )

        # Record Idempotent Mutation
        db.add(IdempotentMutation(mutation_id=mut.mutationId, owner_id=owner_id, status="accepted"))

        accepted_results.append(
            MutationResult(
                mutationId=mut.mutationId,
                entityType=mut.entityType,
                entityId=mut.entityId,
                status="accepted",
            )
        )

    await db.commit()

    # Query changes for pull pagination
    reset_required = False
    if req.cursor > 0:
        # Check if cursor is older than 90 days
        oldest_stmt = select(ChangeFeed).where(
            ChangeFeed.owner_id == owner_id, ChangeFeed.change_id == req.cursor
        )
        oldest_res = await db.execute(oldest_stmt)
        oldest_item = oldest_res.scalar_one_or_none()
        if oldest_item and (now - oldest_item.created_at) > timedelta(days=90):
            reset_required = True

    changes_stmt = (
        select(ChangeFeed)
        .where(ChangeFeed.owner_id == owner_id, ChangeFeed.change_id > req.cursor)
        .order_by(ChangeFeed.change_id.asc())
        .limit(501)
    )

    changes_res = await db.execute(changes_stmt)
    change_records = list(changes_res.scalars().all())

    has_more = len(change_records) > 500
    paged_changes = change_records[:500]

    out_changes: list[ChangeItem] = []
    next_cursor = req.cursor
    for c in paged_changes:
        out_changes.append(
            ChangeItem(
                changeId=c.change_id,
                entityType=c.entity_type,
                entityId=c.entity_id,
                operation=c.operation,
                version=c.version,
                payload=c.payload,
                updatedAt=c.created_at.isoformat(),
            )
        )
        next_cursor = c.change_id

    return SyncBatchResponse(
        accepted=accepted_results,
        rejected=rejected_results,
        changes=out_changes,
        nextCursor=next_cursor,
        hasMore=has_more,
        resetRequired=reset_required,
        serverTime=now_str,
    )

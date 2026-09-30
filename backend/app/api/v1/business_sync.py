import uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.business_collaboration import (
    BusinessTask,
    BusinessTaskAssignment,
    BusinessWorkBlock,
    BusinessChangeFeed,
    BusinessIdempotentMutation,
)
from backend.app.models.session import AuthSession
from backend.app.security.auth import get_current_user_and_session

router = APIRouter(prefix="/v1/businesses/{business_id}/sync", tags=["business-sync"])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    if not dt_str:
        return None
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        return datetime.fromisoformat(dt_str)
    except Exception:
        return None


async def get_active_membership(
    db: AsyncSession, business_id: uuid.UUID, user_id: uuid.UUID
) -> Optional[BusinessMembership]:
    stmt = select(BusinessMembership).where(
        BusinessMembership.business_id == business_id,
        BusinessMembership.user_id == user_id,
        BusinessMembership.membership_status.in_(["active", "invited"]),
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


class BusinessSyncMutationItem(BaseModel):
    mutation_id: str
    entity_type: str  # business_task, business_task_assignment, business_work_block
    entity_id: str
    operation: str  # create, update, delete
    base_version: int = Field(default=1)
    payload: dict = Field(default_factory=dict)


class BusinessSyncBatchRequest(BaseModel):
    mutations: List[BusinessSyncMutationItem]


class BusinessConflictDetail(BaseModel):
    mutation_id: str
    entity_type: str
    entity_id: str
    reason: str
    server_version: int
    server_payload: Optional[dict] = None


class BusinessSyncBatchResponse(BaseModel):
    applied_mutation_ids: List[str]
    conflicts: List[BusinessConflictDetail]
    latest_cursor: int


class BusinessSnapshotResponse(BaseModel):
    cursor: int
    has_more: bool
    tasks: List[dict]
    assignments: List[dict]
    work_blocks: List[dict]
    changes: List[dict]


@router.post("/batch", response_model=BusinessSyncBatchResponse)
async def sync_business_batch(
    business_id: uuid.UUID,
    body: BusinessSyncBatchRequest,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
) -> BusinessSyncBatchResponse:
    current_user, _ = auth_data
    # 1. Verify business & user membership
    biz = await db.get(Business, business_id)
    if not biz:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")

    membership = await get_active_membership(db, business_id, current_user.id)
    is_owner = biz.owner_id == current_user.id
    if not membership and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not an active member of this business",
        )

    is_manager = is_owner or (membership is not None and membership.member_role == "manager")

    applied_mutation_ids: List[str] = []
    conflicts: List[BusinessConflictDetail] = []
    now = utc_now()

    for item in body.mutations:
        # Check idempotency
        idempotency_check = await db.get(BusinessIdempotentMutation, item.mutation_id)
        if idempotency_check:
            applied_mutation_ids.append(item.mutation_id)
            continue

        try:
            entity_uuid = uuid.UUID(item.entity_id)
        except ValueError:
            conflicts.append(
                BusinessConflictDetail(
                    mutation_id=item.mutation_id,
                    entity_type=item.entity_type,
                    entity_id=item.entity_id,
                    reason="Invalid UUID format for entity_id",
                    server_version=0,
                )
            )
            continue

        # Process by entity type
        if item.entity_type == "business_task":
            if not is_manager:
                conflicts.append(
                    BusinessConflictDetail(
                        mutation_id=item.mutation_id,
                        entity_type=item.entity_type,
                        entity_id=item.entity_id,
                        reason="Only managers can create or modify business tasks",
                        server_version=0,
                    )
                )
                continue

            existing_task = await db.get(BusinessTask, entity_uuid)

            if item.operation == "create":
                if existing_task and not existing_task.deleted_at:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Task already exists",
                            server_version=existing_task.version,
                        )
                    )
                    continue

                new_task = BusinessTask(
                    id=entity_uuid,
                    business_id=business_id,
                    created_by=current_user.id,
                    title=item.payload.get("title", "Untitled Task"),
                    instructions=item.payload.get("instructions", ""),
                    priority=item.payload.get("priority", "medium"),
                    due_date=parse_iso_datetime(item.payload.get("due_date")),
                    scheduled_at=parse_iso_datetime(item.payload.get("scheduled_at")),
                    recurrence_rule=item.payload.get("recurrence_rule"),
                    reminder_lead_minutes=int(item.payload.get("reminder_lead_minutes", 15)),
                    is_cancelled=bool(item.payload.get("is_cancelled", False)),
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_task)
                applied_version = 1

            elif item.operation == "update":
                if not existing_task or existing_task.deleted_at:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Task not found",
                            server_version=0,
                        )
                    )
                    continue

                if existing_task.version > item.base_version:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Version conflict",
                            server_version=existing_task.version,
                            server_payload={
                                "title": existing_task.title,
                                "instructions": existing_task.instructions,
                                "priority": existing_task.priority,
                                "due_date": existing_task.due_date.isoformat() if existing_task.due_date else None,
                                "version": existing_task.version,
                            },
                        )
                    )
                    continue

                if "title" in item.payload:
                    existing_task.title = item.payload["title"]
                if "instructions" in item.payload:
                    existing_task.instructions = item.payload["instructions"]
                if "priority" in item.payload:
                    existing_task.priority = item.payload["priority"]
                if "due_date" in item.payload:
                    existing_task.due_date = parse_iso_datetime(item.payload["due_date"])
                if "scheduled_at" in item.payload:
                    existing_task.scheduled_at = parse_iso_datetime(item.payload["scheduled_at"])
                if "recurrence_rule" in item.payload:
                    existing_task.recurrence_rule = item.payload["recurrence_rule"]
                if "reminder_lead_minutes" in item.payload:
                    existing_task.reminder_lead_minutes = int(item.payload["reminder_lead_minutes"])
                if "is_cancelled" in item.payload:
                    existing_task.is_cancelled = bool(item.payload["is_cancelled"])

                existing_task.version += 1
                existing_task.updated_at = now
                applied_version = existing_task.version

            elif item.operation == "delete":
                if existing_task:
                    existing_task.deleted_at = now
                    existing_task.version += 1
                    existing_task.updated_at = now
                    applied_version = existing_task.version
                else:
                    applied_version = 1

            # Change Feed log
            feed = BusinessChangeFeed(
                business_id=business_id,
                actor_id=current_user.id,
                entity_type="business_task",
                entity_id=entity_uuid,
                operation=item.operation,
                version=applied_version,
                payload=item.payload,
                created_at=now,
            )
            db.add(feed)

        elif item.entity_type == "business_task_assignment":
            existing_assignment = await db.get(BusinessTaskAssignment, entity_uuid)

            if item.operation == "create":
                if not is_manager:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Only managers can create task assignments",
                            server_version=0,
                        )
                    )
                    continue

                task_id_raw = item.payload.get("business_task_id")
                target_user_id_raw = item.payload.get("user_id")
                if not task_id_raw or not target_user_id_raw:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Missing business_task_id or user_id in payload",
                            server_version=0,
                        )
                    )
                    continue

                new_assignment = BusinessTaskAssignment(
                    id=entity_uuid,
                    business_task_id=uuid.UUID(task_id_raw),
                    business_id=business_id,
                    user_id=uuid.UUID(target_user_id_raw),
                    status=item.payload.get("status", "todo"),
                    manager_review_status=item.payload.get("manager_review_status", "pending"),
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_assignment)
                applied_version = 1

            elif item.operation == "update":
                if not existing_assignment or existing_assignment.deleted_at:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Assignment not found",
                            server_version=0,
                        )
                    )
                    continue

                # Employee permission check: can only update own status
                is_assignee = existing_assignment.user_id == current_user.id
                if not is_manager and not is_assignee:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="You cannot modify assignments for another user",
                            server_version=existing_assignment.version,
                        )
                    )
                    continue

                if existing_assignment.version > item.base_version:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Version conflict",
                            server_version=existing_assignment.version,
                            server_payload={
                                "status": existing_assignment.status,
                                "manager_review_status": existing_assignment.manager_review_status,
                                "version": existing_assignment.version,
                            },
                        )
                    )
                    continue

                # Handle status changes
                if is_assignee and not is_manager:
                    if "status" in item.payload:
                        new_status = item.payload["status"]
                        if new_status in ["todo", "in_progress", "pending_review"]:
                            existing_assignment.status = new_status
                            if new_status == "pending_review":
                                existing_assignment.submitted_at = now
                                existing_assignment.manager_review_status = "pending"
                elif is_manager:
                    if "status" in item.payload:
                        existing_assignment.status = item.payload["status"]
                    if "manager_review_status" in item.payload:
                        new_review = item.payload["manager_review_status"]
                        existing_assignment.manager_review_status = new_review
                        if new_review == "approved":
                            existing_assignment.status = "completed"
                            existing_assignment.approved_at = now
                        elif new_review == "reopened":
                            existing_assignment.status = "in_progress"
                            existing_assignment.reopened_reason = item.payload.get("reopened_reason")

                existing_assignment.version += 1
                existing_assignment.updated_at = now
                applied_version = existing_assignment.version

            elif item.operation == "delete":
                if not is_manager:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Only managers can unassign tasks",
                            server_version=0,
                        )
                    )
                    continue

                if existing_assignment:
                    existing_assignment.deleted_at = now
                    existing_assignment.version += 1
                    existing_assignment.updated_at = now
                    applied_version = existing_assignment.version
                else:
                    applied_version = 1

            # Change Feed log
            feed = BusinessChangeFeed(
                business_id=business_id,
                actor_id=current_user.id,
                entity_type="business_task_assignment",
                entity_id=entity_uuid,
                operation=item.operation,
                version=applied_version,
                payload=item.payload,
                created_at=now,
            )
            db.add(feed)

        elif item.entity_type == "business_work_block":
            existing_block = await db.get(BusinessWorkBlock, entity_uuid)

            if item.operation == "create":
                if not is_manager:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Only managers can schedule work blocks",
                            server_version=0,
                        )
                    )
                    continue

                target_user_id_raw = item.payload.get("user_id", str(current_user.id))
                start_dt = parse_iso_datetime(item.payload.get("start_time"))
                end_dt = parse_iso_datetime(item.payload.get("end_time"))
                if not start_dt or not end_dt:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Invalid start_time or end_time",
                            server_version=0,
                        )
                    )
                    continue

                new_block = BusinessWorkBlock(
                    id=entity_uuid,
                    business_id=business_id,
                    user_id=uuid.UUID(target_user_id_raw),
                    title=item.payload.get("title", "Work Block"),
                    start_time=start_dt,
                    end_time=end_dt,
                    recurrence_rule=item.payload.get("recurrence_rule"),
                    created_by=current_user.id,
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_block)
                applied_version = 1

            elif item.operation == "update":
                if not existing_block or existing_block.deleted_at:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Work block not found",
                            server_version=0,
                        )
                    )
                    continue

                if not is_manager and existing_block.user_id != current_user.id:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Forbidden",
                            server_version=existing_block.version,
                        )
                    )
                    continue

                if existing_block.version > item.base_version:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Version conflict",
                            server_version=existing_block.version,
                        )
                    )
                    continue

                if "title" in item.payload:
                    existing_block.title = item.payload["title"]
                if "start_time" in item.payload:
                    existing_block.start_time = parse_iso_datetime(item.payload["start_time"]) or existing_block.start_time
                if "end_time" in item.payload:
                    existing_block.end_time = parse_iso_datetime(item.payload["end_time"]) or existing_block.end_time
                if "recurrence_rule" in item.payload:
                    existing_block.recurrence_rule = item.payload["recurrence_rule"]

                existing_block.version += 1
                existing_block.updated_at = now
                applied_version = existing_block.version

            elif item.operation == "delete":
                if not is_manager and existing_block and existing_block.user_id != current_user.id:
                    conflicts.append(
                        BusinessConflictDetail(
                            mutation_id=item.mutation_id,
                            entity_type=item.entity_type,
                            entity_id=item.entity_id,
                            reason="Forbidden",
                            server_version=0,
                        )
                    )
                    continue

                if existing_block:
                    existing_block.deleted_at = now
                    existing_block.version += 1
                    existing_block.updated_at = now
                    applied_version = existing_block.version
                else:
                    applied_version = 1

            # Change Feed log
            feed = BusinessChangeFeed(
                business_id=business_id,
                actor_id=current_user.id,
                entity_type="business_work_block",
                entity_id=entity_uuid,
                operation=item.operation,
                version=applied_version,
                payload=item.payload,
                created_at=now,
            )
            db.add(feed)

        # Record idempotent mutation
        db.add(
            BusinessIdempotentMutation(
                mutation_id=item.mutation_id,
                business_id=business_id,
                user_id=current_user.id,
                entity_type=item.entity_type,
                entity_id=entity_uuid,
                processed_at=now,
            )
        )
        applied_mutation_ids.append(item.mutation_id)

    await db.commit()

    # Get latest change feed id as latest_cursor
    cursor_stmt = (
        select(BusinessChangeFeed.id)
        .where(BusinessChangeFeed.business_id == business_id)
        .order_by(desc(BusinessChangeFeed.id))
        .limit(1)
    )
    cursor_res = await db.execute(cursor_stmt)
    latest_cursor = cursor_res.scalar_one_or_none() or 0

    return BusinessSyncBatchResponse(
        applied_mutation_ids=applied_mutation_ids,
        conflicts=conflicts,
        latest_cursor=latest_cursor,
    )


@router.get("/snapshot", response_model=BusinessSnapshotResponse)
async def get_business_snapshot(
    business_id: uuid.UUID,
    cursor: int = 0,
    limit: int = 100,
    auth_data: tuple[Account, AuthSession] = Depends(get_current_user_and_session),
    db: AsyncSession = Depends(get_db),
) -> BusinessSnapshotResponse:
    current_user, _ = auth_data
    # 1. Verify business & user membership
    biz = await db.get(Business, business_id)
    if not biz:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Business not found")

    membership = await get_active_membership(db, business_id, current_user.id)
    is_owner = biz.owner_id == current_user.id
    if not membership and not is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not an active member of this business",
        )

    if cursor == 0:
        # Full initial snapshot
        tasks_stmt = select(BusinessTask).where(
            BusinessTask.business_id == business_id,
            BusinessTask.deleted_at.is_(None),
        )
        tasks_res = await db.execute(tasks_stmt)
        tasks = [
            {
                "id": str(t.id),
                "business_id": str(t.business_id),
                "created_by": str(t.created_by),
                "title": t.title,
                "instructions": t.instructions,
                "priority": t.priority,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "scheduled_at": t.scheduled_at.isoformat() if t.scheduled_at else None,
                "recurrence_rule": t.recurrence_rule,
                "reminder_lead_minutes": t.reminder_lead_minutes,
                "is_cancelled": t.is_cancelled,
                "version": t.version,
                "created_at": t.created_at.isoformat(),
                "updated_at": t.updated_at.isoformat(),
            }
            for t in tasks_res.scalars().all()
        ]

        assignments_stmt = select(BusinessTaskAssignment).where(
            BusinessTaskAssignment.business_id == business_id,
            BusinessTaskAssignment.deleted_at.is_(None),
        )
        assignments_res = await db.execute(assignments_stmt)
        assignments = [
            {
                "id": str(a.id),
                "business_task_id": str(a.business_task_id),
                "business_id": str(a.business_id),
                "user_id": str(a.user_id),
                "status": a.status,
                "manager_review_status": a.manager_review_status,
                "reopened_reason": a.reopened_reason,
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
                "approved_at": a.approved_at.isoformat() if a.approved_at else None,
                "version": a.version,
                "created_at": a.created_at.isoformat(),
                "updated_at": a.updated_at.isoformat(),
            }
            for a in assignments_res.scalars().all()
        ]

        work_blocks_stmt = select(BusinessWorkBlock).where(
            BusinessWorkBlock.business_id == business_id,
            BusinessWorkBlock.deleted_at.is_(None),
        )
        work_blocks_res = await db.execute(work_blocks_stmt)
        work_blocks = [
            {
                "id": str(wb.id),
                "business_id": str(wb.business_id),
                "user_id": str(wb.user_id),
                "title": wb.title,
                "start_time": wb.start_time.isoformat(),
                "end_time": wb.end_time.isoformat(),
                "recurrence_rule": wb.recurrence_rule,
                "created_by": str(wb.created_by),
                "version": wb.version,
                "created_at": wb.created_at.isoformat(),
                "updated_at": wb.updated_at.isoformat(),
            }
            for wb in work_blocks_res.scalars().all()
        ]

        cursor_stmt = (
            select(BusinessChangeFeed.id)
            .where(BusinessChangeFeed.business_id == business_id)
            .order_by(desc(BusinessChangeFeed.id))
            .limit(1)
        )
        cursor_res = await db.execute(cursor_stmt)
        latest_cursor = cursor_res.scalar_one_or_none() or 0

        return BusinessSnapshotResponse(
            cursor=latest_cursor,
            has_more=False,
            tasks=tasks,
            assignments=assignments,
            work_blocks=work_blocks,
            changes=[],
        )

    # Incremental delta pull
    stmt = (
        select(BusinessChangeFeed)
        .where(
            BusinessChangeFeed.business_id == business_id,
            BusinessChangeFeed.id > cursor,
        )
        .order_by(BusinessChangeFeed.id.asc())
        .limit(limit + 1)
    )
    res = await db.execute(stmt)
    feed_rows = res.scalars().all()

    has_more = len(feed_rows) > limit
    returned_rows = feed_rows[:limit]
    new_cursor = returned_rows[-1].id if returned_rows else cursor

    changes = [
        {
            "id": row.id,
            "business_id": str(row.business_id),
            "actor_id": str(row.actor_id),
            "entity_type": row.entity_type,
            "entity_id": str(row.entity_id),
            "operation": row.operation,
            "version": row.version,
            "payload": row.payload,
            "created_at": row.created_at.isoformat(),
        }
        for row in returned_rows
    ]

    return BusinessSnapshotResponse(
        cursor=new_cursor,
        has_more=has_more,
        tasks=[],
        assignments=[],
        work_blocks=[],
        changes=changes,
    )

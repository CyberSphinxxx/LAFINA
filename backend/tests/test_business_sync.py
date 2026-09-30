import uuid
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_business_sync_batch_and_snapshot(async_client: AsyncClient):
    # 1. Register Owner
    owner_reg = await async_client.post(
        "/v1/auth/register",
        json={"email": "sync_owner@lafina.app", "password": "password1234"},
    )
    assert owner_reg.status_code == 201
    owner_token = owner_reg.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # 2. Register Employee
    emp_reg = await async_client.post(
        "/v1/auth/register",
        json={"email": "sync_emp@lafina.app", "password": "password1234"},
    )
    assert emp_reg.status_code == 201
    emp_token = emp_reg.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}
    emp_id = emp_reg.json()["user_id"]

    # 3. Owner creates business
    biz_res = await async_client.post(
        "/v1/businesses",
        json={"name": "Sync Enterprise", "timezone": "UTC"},
        headers=owner_headers,
    )
    assert biz_res.status_code == 201
    biz_id = biz_res.json()["id"]

    # 4. Invite employee and employee accepts
    inv_res = await async_client.post(
        f"/v1/businesses/{biz_id}/invitations",
        json={"email": "sync_emp@lafina.app", "member_role": "employee"},
        headers=owner_headers,
    )
    assert inv_res.status_code == 201
    inv_id = inv_res.json()["id"]

    accept_res = await async_client.post(
        f"/v1/businesses/invitations/{inv_id}/accept",
        headers=emp_headers,
    )
    assert accept_res.status_code == 200

    # 5. Owner creates Task, Assignment, and Work Block via /sync/batch
    task_id = str(uuid.uuid4())
    assignment_id = str(uuid.uuid4())
    block_id = str(uuid.uuid4())

    batch_payload = {
        "mutations": [
            {
                "mutation_id": "mut_task_1",
                "entity_type": "business_task",
                "entity_id": task_id,
                "operation": "create",
                "base_version": 1,
                "payload": {
                    "title": "Audit Network Security",
                    "instructions": "Inspect core switches and check VLAN isolation.",
                    "priority": "high",
                    "due_date": "2026-08-30T17:00:00Z",
                    "reminder_lead_minutes": 30,
                },
            },
            {
                "mutation_id": "mut_assign_1",
                "entity_type": "business_task_assignment",
                "entity_id": assignment_id,
                "operation": "create",
                "base_version": 1,
                "payload": {
                    "business_task_id": task_id,
                    "user_id": emp_id,
                    "status": "todo",
                    "manager_review_status": "pending",
                },
            },
            {
                "mutation_id": "mut_block_1",
                "entity_type": "business_work_block",
                "entity_id": block_id,
                "operation": "create",
                "base_version": 1,
                "payload": {
                    "user_id": emp_id,
                    "title": "Security Lab Session",
                    "start_time": "2026-08-30T09:00:00Z",
                    "end_time": "2026-08-30T12:00:00Z",
                },
            },
        ]
    }

    res = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json=batch_payload,
        headers=owner_headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert len(data["applied_mutation_ids"]) == 3
    assert len(data["conflicts"]) == 0
    assert data["latest_cursor"] >= 3

    # 6. Pull initial snapshot (cursor=0)
    snap_res = await async_client.get(
        f"/v1/businesses/{biz_id}/sync/snapshot?cursor=0",
        headers=emp_headers,
    )
    assert snap_res.status_code == 200, snap_res.text
    snap_data = snap_res.json()
    assert len(snap_data["tasks"]) == 1
    assert snap_data["tasks"][0]["title"] == "Audit Network Security"
    assert len(snap_data["assignments"]) == 1
    assert snap_data["assignments"][0]["status"] == "todo"
    assert len(snap_data["work_blocks"]) == 1
    assert snap_data["work_blocks"][0]["title"] == "Security Lab Session"

    initial_cursor = snap_data["cursor"]

    # 7. Owner updates Task (version increments to 2)
    update_res = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "mut_task_2",
                    "entity_type": "business_task",
                    "entity_id": task_id,
                    "operation": "update",
                    "base_version": 1,
                    "payload": {
                        "instructions": "Updated: Also test firewall rules.",
                    },
                }
            ]
        },
        headers=owner_headers,
    )
    assert update_res.status_code == 200
    update_data = update_res.json()
    assert len(update_data["applied_mutation_ids"]) == 1

    # 8. Test Optimistic Concurrency Control (stale base_version=1 should conflict because version is now 2)
    stale_res = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "mut_task_stale",
                    "entity_type": "business_task",
                    "entity_id": task_id,
                    "operation": "update",
                    "base_version": 1,
                    "payload": {
                        "title": "Stale Title",
                    },
                }
            ]
        },
        headers=owner_headers,
    )
    assert stale_res.status_code == 200
    stale_data = stale_res.json()
    assert len(stale_data["conflicts"]) == 1
    assert stale_data["conflicts"][0]["reason"] == "Version conflict"
    assert stale_data["conflicts"][0]["server_version"] == 2

    # 9. Incremental delta pull since initial_cursor
    delta_res = await async_client.get(
        f"/v1/businesses/{biz_id}/sync/snapshot?cursor={initial_cursor}",
        headers=emp_headers,
    )
    assert delta_res.status_code == 200
    delta_data = delta_res.json()
    assert len(delta_data["changes"]) >= 1
    assert delta_data["changes"][0]["operation"] == "update"
    assert delta_data["changes"][0]["entity_type"] == "business_task"


@pytest.mark.asyncio
async def test_employee_assignment_and_manager_review_workflow(async_client: AsyncClient):
    # 1. Register Manager
    mgr_reg = await async_client.post(
        "/v1/auth/register",
        json={"email": "mgr_review@lafina.app", "password": "password1234"},
    )
    assert mgr_reg.status_code == 201
    mgr_token = mgr_reg.json()["access_token"]
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

    # 2. Register Employee
    emp_reg = await async_client.post(
        "/v1/auth/register",
        json={"email": "emp_review@lafina.app", "password": "password1234"},
    )
    assert emp_reg.status_code == 201
    emp_token = emp_reg.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}
    emp_id = emp_reg.json()["user_id"]

    # 3. Create Business & join employee
    biz_res = await async_client.post(
        "/v1/businesses",
        json={"name": "Review Hub", "timezone": "UTC"},
        headers=mgr_headers,
    )
    biz_id = biz_res.json()["id"]

    inv_res = await async_client.post(
        f"/v1/businesses/{biz_id}/invitations",
        json={"email": "emp_review@lafina.app", "member_role": "employee"},
        headers=mgr_headers,
    )
    inv_id = inv_res.json()["id"]

    await async_client.post(
        f"/v1/businesses/invitations/{inv_id}/accept",
        headers=emp_headers,
    )

    task_id = str(uuid.uuid4())
    assignment_id = str(uuid.uuid4())

    # 4. Manager creates task and assignment
    await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "m1",
                    "entity_type": "business_task",
                    "entity_id": task_id,
                    "operation": "create",
                    "base_version": 1,
                    "payload": {"title": "Prepare Financial Report"},
                },
                {
                    "mutation_id": "m2",
                    "entity_type": "business_task_assignment",
                    "entity_id": assignment_id,
                    "operation": "create",
                    "base_version": 1,
                    "payload": {
                        "business_task_id": task_id,
                        "user_id": emp_id,
                        "status": "todo",
                    },
                },
            ]
        },
        headers=mgr_headers,
    )

    # 5. Employee updates status to in_progress and then pending_review
    sub_res = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "m3",
                    "entity_type": "business_task_assignment",
                    "entity_id": assignment_id,
                    "operation": "update",
                    "base_version": 1,
                    "payload": {"status": "pending_review"},
                }
            ]
        },
        headers=emp_headers,
    )
    assert sub_res.status_code == 200

    # 6. Verify employee cannot modify task directly
    emp_task_mod = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "m_emp_illegal",
                    "entity_type": "business_task",
                    "entity_id": task_id,
                    "operation": "update",
                    "base_version": 1,
                    "payload": {"title": "Employee Hack"},
                }
            ]
        },
        headers=emp_headers,
    )
    assert emp_task_mod.status_code == 200
    emp_mod_data = emp_task_mod.json()
    assert len(emp_mod_data["conflicts"]) == 1
    assert "Only managers" in emp_mod_data["conflicts"][0]["reason"]

    # 7. Manager reviews and approves completion
    appr_res = await async_client.post(
        f"/v1/businesses/{biz_id}/sync/batch",
        json={
            "mutations": [
                {
                    "mutation_id": "m4",
                    "entity_type": "business_task_assignment",
                    "entity_id": assignment_id,
                    "operation": "update",
                    "base_version": 2,
                    "payload": {"manager_review_status": "approved"},
                }
            ]
        },
        headers=mgr_headers,
    )
    assert appr_res.status_code == 200

    # 8. Check snapshot to verify assignment is completed and approved
    snap_res = await async_client.get(
        f"/v1/businesses/{biz_id}/sync/snapshot?cursor=0",
        headers=mgr_headers,
    )
    snap = snap_res.json()
    assign_record = snap["assignments"][0]
    assert assign_record["status"] == "completed"
    assert assign_record["manager_review_status"] == "approved"
    assert assign_record["approved_at"] is not None

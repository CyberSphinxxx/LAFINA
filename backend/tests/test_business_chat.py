import pytest
import uuid
from datetime import datetime, timezone
from httpx import AsyncClient

from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.business_collaboration import BusinessTask
from backend.app.security.auth import hash_password
from backend.app.services.chat_broadcast import verify_chat_ticket
from backend.tests.conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_business_chat_and_comments_workflow(async_client: AsyncClient):
    # 1. Setup accounts and business
    mgr_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    biz_id = uuid.uuid4()
    task_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    async with TestingSessionLocal() as db:
        mgr = Account(
            id=mgr_id,
            email="chat_mgr@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        emp = Account(
            id=emp_id,
            email="chat_emp@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        db.add_all([mgr, emp])
        await db.flush()

        biz = Business(
            id=biz_id,
            owner_id=mgr.id,
            name="Chat Test Corp",
            subscription_status="active",
            seat_limit=5,
            valid_from=now,
        )
        db.add(biz)
        await db.flush()

        db.add_all([
            BusinessMembership(business_id=biz.id, business_owner_id=mgr.id, user_id=mgr.id, member_role="manager", membership_status="active"),
            BusinessMembership(business_id=biz.id, business_owner_id=mgr.id, user_id=emp.id, member_role="employee", membership_status="active"),
        ])
        await db.flush()

        task = BusinessTask(
            id=task_id,
            business_id=biz.id,
            created_by=mgr.id,
            title="Design Chat Pipeline",
            instructions="Ensure WebSocket and REST sync are idempotent.",
            priority="high",
            due_date=now,
            created_at=now,
            updated_at=now,
        )
        db.add(task)
        await db.commit()

    # 2. Login as manager and employee
    login_mgr = await async_client.post("/v1/auth/login", json={
        "email": "chat_mgr@ustp.edu.ph",
        "password": "Password123!"
    })
    mgr_token = login_mgr.json()["access_token"]
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

    login_emp = await async_client.post("/v1/auth/login", json={
        "email": "chat_emp@ustp.edu.ph",
        "password": "Password123!"
    })
    emp_token = login_emp.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    # 3. Test WS Ticket Generation & Verification
    ticket_res = await async_client.post(
        f"/v1/businesses/{biz_id}/chat/ticket",
        headers=emp_headers
    )
    assert ticket_res.status_code == 200
    ticket_data = ticket_res.json()
    assert "ticket" in ticket_data
    assert ticket_data["expires_in"] == 60

    verified_user_id = verify_chat_ticket(ticket_data["ticket"], biz_id)
    assert verified_user_id == emp_id

    # 4. List Channels (auto-creates default "general" channel)
    channels_res = await async_client.get(
        f"/v1/businesses/{biz_id}/chat/channels",
        headers=mgr_headers
    )
    assert channels_res.status_code == 200
    channels = channels_res.json()
    assert len(channels) == 1
    assert channels[0]["name"] == "general"
    channel_id = channels[0]["id"]

    # 5. Send Chat Message with Task Link
    msg_client_id = "client_msg_uuid_001"
    send_msg_res = await async_client.post(
        f"/v1/businesses/{biz_id}/chat/channels/{channel_id}/messages",
        headers=mgr_headers,
        json={
            "client_message_id": msg_client_id,
            "content": "Please review the task link attached below.",
            "task_link_id": str(task_id),
        }
    )
    assert send_msg_res.status_code == 200
    msg_data = send_msg_res.json()
    assert msg_data["client_message_id"] == msg_client_id
    assert msg_data["content"] == "Please review the task link attached below."
    assert msg_data["task_link_id"] == str(task_id)
    assert msg_data["task_title"] == "Design Chat Pipeline"

    # Idempotent deduplication test (same client_message_id)
    dup_res = await async_client.post(
        f"/v1/businesses/{biz_id}/chat/channels/{channel_id}/messages",
        headers=mgr_headers,
        json={
            "client_message_id": msg_client_id,
            "content": "Different content that should be deduplicated",
        }
    )
    assert dup_res.status_code == 200
    assert dup_res.json()["id"] == msg_data["id"]
    assert dup_res.json()["content"] == "Please review the task link attached below."

    # 6. Fetch Channel Messages as Employee
    fetch_msgs_res = await async_client.get(
        f"/v1/businesses/{biz_id}/chat/channels/{channel_id}/messages",
        headers=emp_headers
    )
    assert fetch_msgs_res.status_code == 200
    messages = fetch_msgs_res.json()
    assert len(messages) >= 1
    assert messages[0]["client_message_id"] == msg_client_id
    assert messages[0]["sender_email"] == "chat_mgr@ustp.edu.ph"

    # 7. Add Task Comments & Idempotency
    comment_client_id = "comment_uuid_001"
    comment_res = await async_client.post(
        f"/v1/businesses/{biz_id}/tasks/{task_id}/comments",
        headers=emp_headers,
        json={
            "client_comment_id": comment_client_id,
            "content": "Working on the WebSocket reconnection handler now.",
        }
    )
    assert comment_res.status_code == 200
    comment_data = comment_res.json()
    assert comment_data["client_comment_id"] == comment_client_id
    assert comment_data["content"] == "Working on the WebSocket reconnection handler now."
    assert comment_data["user_email"] == "chat_emp@ustp.edu.ph"

    # Fetch Task Comments
    get_comments_res = await async_client.get(
        f"/v1/businesses/{biz_id}/tasks/{task_id}/comments",
        headers=mgr_headers
    )
    assert get_comments_res.status_code == 200
    comments = get_comments_res.json()
    assert len(comments) == 1
    assert comments[0]["client_comment_id"] == comment_client_id

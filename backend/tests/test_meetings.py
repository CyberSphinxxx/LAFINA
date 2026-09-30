import pytest
import uuid
from httpx import AsyncClient
from unittest.mock import patch

from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.security.auth import hash_password
from backend.tests.conftest import TestingSessionLocal


@pytest.mark.asyncio
async def test_meeting_summary_generation_entitled(async_client: AsyncClient):
    """Verifies that an entitled user can request an AI meeting summary via DeepSeek."""
    user_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        pro_user = Account(
            id=user_id,
            email="pro_meeting@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student_pro",
            is_active=True,
        )
        db.add(pro_user)
        await db.commit()

    login_res = await async_client.post("/v1/auth/login", json={
        "email": "pro_meeting@ustp.edu.ph",
        "password": "Password123!",
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    fake_deepseek_reply = {
        "reply": (
            '{\n'
            '  "key_points": ["Discussed IoT firmware v2.1 timeline", "Calibration team ready"],\n'
            '  "decisions": ["Ship firmware by Friday"],\n'
            '  "open_questions": ["Is hardware buffer size sufficient?"],\n'
            '  "action_items": [\n'
            '    {\n'
            '      "task": "Calibrate oscilloscopes",\n'
            '      "assignee": "Alice",\n'
            '      "due": "2026-08-28T17:00:00Z",\n'
            '      "context": "Needs zero jitter"\n'
            '    }\n'
            '  ]\n'
            '}'
        ),
        "model": "deepseek-chat",
    }

    with patch("backend.app.clients.deepseek.DeepSeekClient.chat_completion", return_value=fake_deepseek_reply):
        res = await async_client.post(
            "/v1/meetings/summary",
            json={
                "transcript": "Dr. Vance: Welcome team. Let's calibrate oscilloscopes by Friday.",
                "meetingTitle": "Firmware Sync",
            },
            headers=headers,
        )

        assert res.status_code == 200
        data = res.json()
        assert "summary" in data
        assert len(data["summary"]["key_points"]) == 2
        assert data["summary"]["decisions"] == ["Ship firmware by Friday"]
        assert len(data["summary"]["action_items"]) == 1
        assert data["summary"]["action_items"][0]["assignee"] == "Alice"


@pytest.mark.asyncio
async def test_meeting_creation_and_selective_sharing(async_client: AsyncClient):
    """Verifies meeting creation and selective sharing access control between manager and employee."""
    mgr_id = uuid.uuid4()
    emp_id = uuid.uuid4()
    other_emp_id = uuid.uuid4()
    biz_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        mgr = Account(
            id=mgr_id,
            email="mgr_meeting@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        emp = Account(
            id=emp_id,
            email="emp_meeting@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        other_emp = Account(
            id=other_emp_id,
            email="other_emp_meeting@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        biz = Business(
            id=biz_id,
            name="Meeting Sync Lab",
            owner_id=mgr_id,
            timezone="Asia/Manila",
            subscription_plan="business",
            subscription_status="active",
            seat_limit=10,
        )
        mem_mgr = BusinessMembership(
            id=uuid.uuid4(),
            business_id=biz_id,
            business_owner_id=mgr_id,
            user_id=mgr_id,
            member_role="manager",
            membership_status="active",
        )
        mem_emp = BusinessMembership(
            id=uuid.uuid4(),
            business_id=biz_id,
            business_owner_id=mgr_id,
            user_id=emp_id,
            member_role="employee",
            membership_status="active",
        )
        mem_other = BusinessMembership(
            id=uuid.uuid4(),
            business_id=biz_id,
            business_owner_id=mgr_id,
            user_id=other_emp_id,
            member_role="employee",
            membership_status="active",
        )
        db.add_all([mgr, emp, other_emp, biz, mem_mgr, mem_emp, mem_other])
        await db.commit()

    login_mgr = await async_client.post("/v1/auth/login", json={
        "email": "mgr_meeting@ustp.edu.ph",
        "password": "Password123!",
    })
    login_emp = await async_client.post("/v1/auth/login", json={
        "email": "emp_meeting@ustp.edu.ph",
        "password": "Password123!",
    })
    login_other = await async_client.post("/v1/auth/login", json={
        "email": "other_emp_meeting@ustp.edu.ph",
        "password": "Password123!",
    })

    mgr_headers = {"Authorization": f"Bearer {login_mgr.json()['access_token']}"}
    emp_headers = {"Authorization": f"Bearer {login_emp.json()['access_token']}"}
    other_emp_headers = {"Authorization": f"Bearer {login_other.json()['access_token']}"}

    # 1. Manager creates a meeting selectively shared ONLY with emp_id
    create_res = await async_client.post(
        f"/v1/businesses/{biz_id}/meetings",
        json={
            "title": "Confidential Architecture Sync",
            "duration_seconds": 1800,
            "full_transcript": "Discussed core architecture and deliverables.",
            "summary_json": {
                "key_points": ["Refactor scheduler"],
                "decisions": ["Use SQLite v13"],
                "open_questions": [],
                "action_items": [],
            },
            "summary_status": "completed",
            "recipient_user_ids": [str(emp_id)],
        },
        headers=mgr_headers,
    )
    assert create_res.status_code == 200
    meeting_data = create_res.json()
    meeting_id = meeting_data["id"]
    assert len(meeting_data["recipients"]) == 1
    assert meeting_data["recipients"][0]["user_id"] == str(emp_id)

    # 2. Designated recipient employee can view meeting detail
    emp_res = await async_client.get(
        f"/v1/businesses/{biz_id}/meetings/{meeting_id}",
        headers=emp_headers,
    )
    assert emp_res.status_code == 200
    assert emp_res.json()["title"] == "Confidential Architecture Sync"

    # 3. Non-recipient employee cannot view meeting detail
    other_res = await async_client.get(
        f"/v1/businesses/{biz_id}/meetings/{meeting_id}",
        headers=other_emp_headers,
    )
    assert other_res.status_code == 403

    # 4. Manager revokes recipient access
    del_res = await async_client.delete(
        f"/v1/businesses/{biz_id}/meetings/{meeting_id}/recipients/{emp_id}",
        headers=mgr_headers,
    )
    assert del_res.status_code == 200

    # 5. Revoked employee now gets 403
    emp_revoked_res = await async_client.get(
        f"/v1/businesses/{biz_id}/meetings/{meeting_id}",
        headers=emp_headers,
    )
    assert emp_revoked_res.status_code == 403

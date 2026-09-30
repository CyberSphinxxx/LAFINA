import pytest
from datetime import datetime, timezone

from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.security.auth import hash_password
from backend.app.services.capabilities import resolve_account_capabilities

@pytest.mark.asyncio
async def test_capabilities_resolution_tiers():
    from backend.tests.conftest import TestingSessionLocal

    async with TestingSessionLocal() as db:
        # 1. Student account
        student = Account(
            email="student_cap@ustp.edu.ph",
            password_hash=hash_password("password123"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        db.add(student)
        await db.commit()

        student_cap = await resolve_account_capabilities(student, db)
        assert student_cap.effective_subscription_plan == "student"
        assert student_cap.business_session is None
        assert student_cap.capabilities == []

        # 2. Account with active business
        now = datetime.now(timezone.utc)
        owner = Account(
            email="owner_cap@ustp.edu.ph",
            password_hash=hash_password("password123"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        db.add(owner)
        await db.flush()

        biz = Business(
            owner_id=owner.id,
            name="Research Lab Inc",
            subscription_status="active",
            seat_limit=10,
            valid_from=now,
        )
        db.add(biz)
        await db.flush()

        membership = BusinessMembership(
            business_id=biz.id,
            business_owner_id=owner.id,
            user_id=owner.id,
            member_role="manager",
            membership_status="active",
        )
        db.add(membership)
        await db.commit()

        owner_cap = await resolve_account_capabilities(owner, db)
        assert owner_cap.effective_subscription_plan == "business"
        assert owner_cap.business_session is not None
        assert owner_cap.business_session.business_id == str(biz.id)
        assert owner_cap.business_session.member_role == "manager"
        assert "business_core" in owner_cap.business_session.capabilities
        assert "business_chat" in owner_cap.business_session.capabilities
        assert "gmail" in owner_cap.business_session.capabilities
        assert owner_cap.business_session.lease_expires_at is not None

        # 3. Suspended membership falls back to personal tier
        membership.membership_status = "suspended"
        await db.commit()

        suspended_cap = await resolve_account_capabilities(owner, db)
        assert suspended_cap.effective_subscription_plan == "business" or suspended_cap.effective_subscription_plan == owner.subscription_plan
        assert suspended_cap.business_session is None


@pytest.mark.asyncio
async def test_business_employee_and_manager_ai_access(async_client):
    from unittest.mock import AsyncMock
    from backend.app.main import app
    from backend.tests.conftest import TestingSessionLocal
    from backend.app.models.account import Account
    from backend.app.models.business import Business, BusinessMembership
    from backend.app.security.auth import hash_password

    # Setup mock Gemini TTS client
    mock_gemini = AsyncMock()
    mock_gemini.synthesize_speech.return_value = ("bW9ja19hdWRpb19kYXRh", {"prompt_tokens": 10, "completion_tokens": 0})
    app.state.gemini_tts_client = mock_gemini

    # 1. Create a business owner and an employee
    async with TestingSessionLocal() as db:
        now = datetime.now(timezone.utc)
        mgr = Account(
            email="biz_mgr_ai@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        emp = Account(
            email="biz_emp_ai@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        db.add_all([mgr, emp])
        await db.flush()

        biz = Business(
            owner_id=mgr.id,
            name="AI Enterprise Lab",
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
        await db.commit()

    # 2. Login as employee (personal plan = student, but business seat = active)
    login_emp = await async_client.post("/v1/auth/login", json={
        "email": "biz_emp_ai@ustp.edu.ph",
        "password": "Password123!"
    })
    emp_token = login_emp.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    # Employee should successfully call TTS (not 403)
    tts_emp_res = await async_client.post(
        "/v1/ai/tts",
        json={"text": "Employee Gemini test"},
        headers=emp_headers
    )
    assert tts_emp_res.status_code == 200
    assert tts_emp_res.json()["audioBase64"] == "bW9ja19hdWRpb19kYXRh"

    # 3. Login as manager
    login_mgr = await async_client.post("/v1/auth/login", json={
        "email": "biz_mgr_ai@ustp.edu.ph",
        "password": "Password123!"
    })
    mgr_token = login_mgr.json()["access_token"]
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

    # Manager should successfully call TTS (not 403)
    tts_mgr_res = await async_client.post(
        "/v1/ai/tts",
        json={"text": "Manager Gemini test"},
        headers=mgr_headers
    )
    assert tts_mgr_res.status_code == 200
    assert tts_mgr_res.json()["audioBase64"] == "bW9ja19hdWRpb19kYXRh"

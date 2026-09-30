import uuid
from unittest.mock import AsyncMock, patch
import pytest
from httpx import AsyncClient

from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.gmail import GmailConnection
from backend.app.security.auth import hash_password
from backend.app.services.gmail_crypto import decrypt_token, encrypt_token
from backend.tests.conftest import TestingSessionLocal


def test_gmail_token_encryption():
    """Verifies AES-256-GCM token encryption and decryption."""
    original_token = "ya29.a0AfH6SMD_mock_refresh_token_1234567890"
    encrypted = encrypt_token(original_token)
    assert encrypted != original_token
    assert len(encrypted) > 20

    decrypted = decrypt_token(encrypted)
    assert decrypted == original_token


@pytest.mark.asyncio
async def test_gmail_oauth_flow_and_connection(async_client: AsyncClient):
    """Verifies end-to-end OAuth start, callback, connection query, and disconnect."""
    owner_id = uuid.uuid4()
    business_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        owner = Account(
            id=owner_id,
            email="gmail_owner@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        biz = Business(
            id=business_id,
            owner_id=owner_id,
            name="Gmail Enterprise Labs",
            subscription_plan="business",
            subscription_status="active",
            seat_limit=5,
        )
        membership = BusinessMembership(
            business_id=business_id,
            business_owner_id=owner_id,
            user_id=owner_id,
            member_role="manager",
            membership_status="active",
        )
        db.add_all([owner, biz, membership])
        await db.commit()

    login_res = await async_client.post("/v1/auth/login", json={
        "email": "gmail_owner@ustp.edu.ph",
        "password": "Password123!",
    })
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Check initially not connected
    status_res = await async_client.get("/v1/email/gmail/connection", headers=headers)
    assert status_res.status_code == 200
    assert status_res.json()["connected"] is False

    # 2. Start OAuth flow
    start_res = await async_client.post("/v1/email/gmail/connect/start", headers=headers)
    assert start_res.status_code == 200
    start_data = start_res.json()
    assert "auth_url" in start_data
    assert "state" in start_data
    state = start_data["state"]

    # 3. Simulate OAuth callback
    mock_token_data = {
        "access_token": "mock-access-token-123",
        "refresh_token": "mock-refresh-token-456",
        "expires_in": 3600,
        "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    }
    mock_profile = {
        "emailAddress": "owner_personal@gmail.com",
        "messagesTotal": 100,
        "threadsTotal": 50,
    }

    with patch(
        "backend.app.clients.gmail.GmailClient.exchange_code_for_tokens",
        new=AsyncMock(return_value=mock_token_data),
    ), patch(
        "backend.app.clients.gmail.GmailClient.get_user_profile",
        new=AsyncMock(return_value=mock_profile),
    ):
        cb_res = await async_client.get(
            f"/v1/email/gmail/connect/callback?code=mock-google-code&state={state}"
        )
        assert cb_res.status_code == 200
        assert "owner_personal@gmail.com" in cb_res.text

    # 4. Check connected status
    status_res2 = await async_client.get("/v1/email/gmail/connection", headers=headers)
    assert status_res2.status_code == 200
    conn_data = status_res2.json()
    assert conn_data["connected"] is True
    assert conn_data["email_address"] == "owner_personal@gmail.com"
    assert len(conn_data["scopes"]) == 2

    # 5. Verify token is encrypted in DB
    async with TestingSessionLocal() as db:
        from sqlalchemy import select
        res = await db.execute(
            select(GmailConnection).where(GmailConnection.user_id == owner_id)
        )
        conn = res.scalar_one()
        assert conn.encrypted_refresh_token != "mock-refresh-token-456"
        assert decrypt_token(conn.encrypted_refresh_token) == "mock-refresh-token-456"

    # 6. Disconnect
    with patch(
        "backend.app.clients.gmail.GmailClient.revoke_token",
        new=AsyncMock(return_value=True),
    ):
        dc_res = await async_client.delete("/v1/email/gmail/connection", headers=headers)
        assert dc_res.status_code == 200
        assert dc_res.json()["status"] == "disconnected"

    # 7. Check status after disconnect
    status_res3 = await async_client.get("/v1/email/gmail/connection", headers=headers)
    assert status_res3.status_code == 200
    assert status_res3.json()["connected"] is False


@pytest.mark.asyncio
async def test_gmail_threads_and_messages(async_client: AsyncClient):
    """Verifies listing threads, retrieving thread details, creating drafts, and sending."""
    user_id = uuid.uuid4()
    biz_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        user = Account(
            id=user_id,
            email="gmail_user@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        biz = Business(
            id=biz_id,
            owner_id=user_id,
            name="Gmail Operations",
            subscription_plan="business",
            subscription_status="active",
            seat_limit=5,
        )
        membership = BusinessMembership(
            business_id=biz_id,
            business_owner_id=user_id,
            user_id=user_id,
            member_role="employee",
            membership_status="active",
        )
        from datetime import datetime, timezone, timedelta
        conn = GmailConnection(
            user_id=user_id,
            email_address="employee@gmail.com",
            encrypted_refresh_token=encrypt_token("mock-refresh-token"),
            encrypted_access_token=encrypt_token("mock-access-token"),
            access_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            is_active=True,
        )
        db.add_all([user, biz, membership, conn])
        await db.commit()

    login_res = await async_client.post("/v1/auth/login", json={
        "email": "gmail_user@ustp.edu.ph",
        "password": "Password123!",
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 1. List threads
    mock_threads_data = {
        "threads": [
            {"thread_id": "t101", "history_id": "h101", "snippet": "Project update report attached."},
            {"thread_id": "t102", "history_id": "h102", "snippet": "Meeting tomorrow at 9 AM."},
        ],
        "next_page_token": "next-token-999",
        "result_size_estimate": 2,
    }

    with patch(
        "backend.app.clients.gmail.GmailClient.list_threads",
        new=AsyncMock(return_value=mock_threads_data),
    ):
        res = await async_client.get("/v1/email/gmail/threads?maxResults=10", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert len(data["threads"]) == 2
        assert data["threads"][0]["thread_id"] == "t101"
        assert data["next_page_token"] == "next-token-999"

    # 2. Get thread detail
    mock_thread_detail = {
        "thread_id": "t101",
        "history_id": "h101",
        "subject": "Project Update",
        "messages": [
            {
                "message_id": "m101",
                "thread_id": "t101",
                "subject": "Project Update",
                "from_address": "boss@partner.com",
                "to_address": "employee@gmail.com",
                "cc_address": "",
                "bcc_address": "",
                "date": "Tue, 25 Aug 2026 14:00:00 +0800",
                "internal_date": "1787644800000",
                "snippet": "Project update report attached.",
                "body_plain": "Please review the quarterly schedule.",
                "body_html": "<p>Please review the quarterly schedule.</p>",
                "is_unread": True,
                "attachments": [
                    {
                        "id": "att_1",
                        "filename": "schedule.pdf",
                        "mime_type": "application/pdf",
                        "size": 1048576,
                    }
                ],
            }
        ],
        "has_attachments": True,
        "is_unread": True,
        "message_count": 1,
    }

    with patch(
        "backend.app.clients.gmail.GmailClient.get_thread_detail",
        new=AsyncMock(return_value=mock_thread_detail),
    ):
        res_detail = await async_client.get("/v1/email/gmail/threads/t101", headers=headers)
        assert res_detail.status_code == 200
        detail = res_detail.json()
        assert detail["subject"] == "Project Update"
        assert detail["has_attachments"] is True
        assert len(detail["messages"]) == 1
        assert detail["messages"][0]["attachments"][0]["filename"] == "schedule.pdf"

    # 3. Create Draft
    mock_draft = {
        "draft_id": "d501",
        "message_id": "m501",
        "thread_id": "t101",
    }
    with patch(
        "backend.app.clients.gmail.GmailClient.create_draft",
        new=AsyncMock(return_value=mock_draft),
    ):
        draft_res = await async_client.post(
            "/v1/email/gmail/drafts",
            json={
                "to": "boss@partner.com",
                "subject": "Re: Project Update",
                "body": "Thank you, schedule looks great!",
                "thread_id": "t101",
            },
            headers=headers,
        )
        assert draft_res.status_code == 200
        assert draft_res.json()["draft_id"] == "d501"

    # 4. Update Draft
    with patch(
        "backend.app.clients.gmail.GmailClient.update_draft",
        new=AsyncMock(return_value=mock_draft),
    ):
        draft_upd_res = await async_client.put(
            "/v1/email/gmail/drafts/d501",
            json={
                "to": "boss@partner.com",
                "subject": "Re: Project Update",
                "body": "Thank you, schedule confirmed!",
                "thread_id": "t101",
            },
            headers=headers,
        )
        assert draft_upd_res.status_code == 200
        assert draft_upd_res.json()["draft_id"] == "d501"

    # 5. Send Draft with Idempotency Key
    idempotency_key = "idemp-send-12345"
    mock_send_res = {
        "message_id": "m501_sent",
        "thread_id": "t101",
        "label_ids": ["SENT"],
    }
    with patch(
        "backend.app.clients.gmail.GmailClient.send_draft",
        new=AsyncMock(return_value=mock_send_res),
    ):
        send_res = await async_client.post(
            "/v1/email/gmail/drafts/d501/send",
            json={"idempotency_key": idempotency_key},
            headers=headers,
        )
        assert send_res.status_code == 200
        assert send_res.json()["status"] == "sent"
        assert send_res.json()["message_id"] == "m501_sent"

        # Replay with same idempotency key
        send_res_replay = await async_client.post(
            "/v1/email/gmail/drafts/d501/send",
            json={"idempotency_key": idempotency_key},
            headers=headers,
        )
        assert send_res_replay.status_code == 200
        assert send_res_replay.json()["idempotent_replay"] is True


@pytest.mark.asyncio
async def test_gmail_permissions_and_account_isolation(async_client: AsyncClient):
    """Verifies that non-business users are rejected and employees cannot access manager email."""
    student_id = uuid.uuid4()
    manager_id = uuid.uuid4()
    employee_id = uuid.uuid4()
    biz_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        student = Account(
            id=student_id,
            email="regular_student@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",
            is_active=True,
        )
        manager = Account(
            id=manager_id,
            email="manager_corp@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        employee = Account(
            id=employee_id,
            email="employee_corp@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="student",  # Inherits business through active membership
            is_active=True,
        )
        biz = Business(
            id=biz_id,
            owner_id=manager_id,
            name="Isolation Corp",
            subscription_plan="business",
            subscription_status="active",
            seat_limit=5,
        )
        mem_manager = BusinessMembership(
            business_id=biz_id,
            business_owner_id=manager_id,
            user_id=manager_id,
            member_role="manager",
            membership_status="active",
        )
        mem_employee = BusinessMembership(
            business_id=biz_id,
            business_owner_id=manager_id,
            user_id=employee_id,
            member_role="employee",
            membership_status="active",
        )
        manager_conn = GmailConnection(
            user_id=manager_id,
            email_address="manager_private@gmail.com",
            encrypted_refresh_token=encrypt_token("mgr-refresh"),
            encrypted_access_token=encrypt_token("mgr-access"),
            is_active=True,
        )
        db.add_all([student, manager, employee, biz, mem_manager, mem_employee, manager_conn])
        await db.commit()

    # 1. Regular student gets 403 Forbidden
    login_student = await async_client.post("/v1/auth/login", json={
        "email": "regular_student@ustp.edu.ph",
        "password": "Password123!",
    })
    token_student = login_student.json()["access_token"]
    res_student = await async_client.post(
        "/v1/email/gmail/connect/start",
        headers={"Authorization": f"Bearer {token_student}"},
    )
    assert res_student.status_code == 403

    # 2. Employee connects: check employee connection is separate and not connected yet
    login_employee = await async_client.post("/v1/auth/login", json={
        "email": "employee_corp@ustp.edu.ph",
        "password": "Password123!",
    })
    token_employee = login_employee.json()["access_token"]
    res_emp_conn = await async_client.get(
        "/v1/email/gmail/connection",
        headers={"Authorization": f"Bearer {token_employee}"},
    )
    assert res_emp_conn.status_code == 200
    assert res_emp_conn.json()["connected"] is False  # Cannot see manager's connection!

    # 3. Manager has active connection
    login_manager = await async_client.post("/v1/auth/login", json={
        "email": "manager_corp@ustp.edu.ph",
        "password": "Password123!",
    })
    token_manager = login_manager.json()["access_token"]
    res_mgr_conn = await async_client.get(
        "/v1/email/gmail/connection",
        headers={"Authorization": f"Bearer {token_manager}"},
    )
    assert res_mgr_conn.status_code == 200
    assert res_mgr_conn.json()["connected"] is True
    assert res_mgr_conn.json()["email_address"] == "manager_private@gmail.com"


@pytest.mark.asyncio
async def test_gmail_token_refresh_on_expiry(async_client: AsyncClient):
    """Verifies that expired access tokens automatically refresh via Google token endpoint."""
    user_id = uuid.uuid4()
    biz_id = uuid.uuid4()

    async with TestingSessionLocal() as db:
        user = Account(
            id=user_id,
            email="refresh_tester@ustp.edu.ph",
            password_hash=hash_password("Password123!"),
            system_role="user",
            subscription_plan="business",
            is_active=True,
        )
        biz = Business(
            id=biz_id,
            owner_id=user_id,
            name="Refresh Labs",
            subscription_plan="business",
            subscription_status="active",
            seat_limit=5,
        )
        membership = BusinessMembership(
            business_id=biz_id,
            business_owner_id=user_id,
            user_id=user_id,
            member_role="manager",
            membership_status="active",
        )
        from datetime import datetime, timezone, timedelta
        conn = GmailConnection(
            user_id=user_id,
            email_address="refresh_tester@gmail.com",
            encrypted_refresh_token=encrypt_token("valid-rt-secret"),
            encrypted_access_token=encrypt_token("stale-at"),
            access_token_expires_at=datetime.now(timezone.utc) - timedelta(minutes=10),  # Expired
            is_active=True,
        )
        db.add_all([user, biz, membership, conn])
        await db.commit()

    login_res = await async_client.post("/v1/auth/login", json={
        "email": "refresh_tester@ustp.edu.ph",
        "password": "Password123!",
    })
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    mock_refresh_res = {
        "access_token": "brand-new-fresh-access-token",
        "expires_in": 3600,
    }
    mock_threads = {
        "threads": [],
        "next_page_token": None,
        "result_size_estimate": 0,
    }

    with patch(
        "backend.app.clients.gmail.GmailClient.refresh_access_token",
        new=AsyncMock(return_value=mock_refresh_res),
    ) as mock_refresh_call, patch(
        "backend.app.clients.gmail.GmailClient.list_threads",
        new=AsyncMock(return_value=mock_threads),
    ):
        res = await async_client.get("/v1/email/gmail/threads", headers=headers)
        assert res.status_code == 200
        mock_refresh_call.assert_called_once_with("valid-rt-secret")


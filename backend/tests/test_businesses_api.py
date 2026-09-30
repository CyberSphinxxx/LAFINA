import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_business_creation_and_membership(async_client: AsyncClient):
    # 1. Register owner account
    owner_reg = await async_client.post("/v1/auth/register", json={
        "email": "owner@business.com",
        "password": "valid-password-1234",
    })
    assert owner_reg.status_code == 201
    owner_token = owner_reg.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {owner_token}"}

    # 2. Check /v1/auth/me before business creation (Student tier)
    me_res = await async_client.get("/v1/auth/me", headers=owner_headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["system_role"] == "user"
    assert me_data["subscription_plan"] == "student"
    assert me_data["effective_subscription_plan"] == "student"
    assert me_data["business_session"] is None

    # 3. Create Business
    create_res = await async_client.post("/v1/businesses", json={
        "name": "Acme Corp",
        "timezone": "Asia/Manila",
    }, headers=owner_headers)
    assert create_res.status_code == 201
    biz_data = create_res.json()
    business_id = biz_data["id"]
    assert biz_data["name"] == "Acme Corp"
    assert biz_data["my_role"] == "manager"
    assert biz_data["active_seats"] == 1
    assert biz_data["seat_limit"] == 5

    # 4. Check /v1/auth/me after business creation (Business tier + capabilities)
    me_res2 = await async_client.get("/v1/auth/me", headers=owner_headers)
    assert me_res2.status_code == 200
    me_data2 = me_res2.json()
    assert me_data2["effective_subscription_plan"] == "business"
    assert me_data2["business_session"] is not None
    assert me_data2["business_session"]["business_id"] == business_id
    assert me_data2["business_session"]["member_role"] == "manager"
    assert "business_core" in me_data2["business_session"]["capabilities"]
    assert "gmail" in me_data2["business_session"]["capabilities"]
    assert "lease_expires_at" in me_data2["business_session"]

    # 5. Prevent double business creation
    dup_res = await async_client.post("/v1/businesses", json={
        "name": "Second Corp",
    }, headers=owner_headers)
    assert dup_res.status_code == 409


@pytest.mark.asyncio
async def test_business_invitations_and_seats(async_client: AsyncClient):
    # Setup owner
    owner_reg = await async_client.post("/v1/auth/register", json={
        "email": "boss@acme.com",
        "password": "valid-password-1234",
    })
    owner_headers = {"Authorization": f"Bearer {owner_reg.json()['access_token']}"}

    create_res = await async_client.post("/v1/businesses", json={"name": "Acme Team"}, headers=owner_headers)
    business_id = create_res.json()["id"]

    # Register employee account
    emp_reg = await async_client.post("/v1/auth/register", json={
        "email": "employee@acme.com",
        "password": "valid-password-1234",
    })
    emp_token = emp_reg.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}

    # 1. Invite non-existent email -> 404
    inv_fail = await async_client.post(f"/v1/businesses/{business_id}/invitations", json={
        "email": "nobody@nowhere.com",
        "member_role": "employee",
    }, headers=owner_headers)
    assert inv_fail.status_code == 404

    # 2. Invite registered employee
    inv_res = await async_client.post(f"/v1/businesses/{business_id}/invitations", json={
        "email": "EMPLOYEE@acme.com",
        "member_role": "employee",
    }, headers=owner_headers)
    assert inv_res.status_code == 201
    invitation_id = inv_res.json()["id"]
    assert inv_res.json()["status"] == "pending"

    # 3. Duplicate invite -> 409
    dup_inv = await async_client.post(f"/v1/businesses/{business_id}/invitations", json={
        "email": "employee@acme.com",
        "member_role": "employee",
    }, headers=owner_headers)
    assert dup_inv.status_code == 409

    # 4. Employee views their invitations
    my_invs = await async_client.get("/v1/businesses/invitations/my", headers=emp_headers)
    assert my_invs.status_code == 200
    assert len(my_invs.json()) == 1
    assert my_invs.json()[0]["id"] == invitation_id

    # 5. Non-recipient cannot accept -> 403
    other_user = await async_client.post("/v1/auth/register", json={
        "email": "stranger@other.com",
        "password": "valid-password-1234",
    })
    stranger_headers = {"Authorization": f"Bearer {other_user.json()['access_token']}"}
    bad_accept = await async_client.post(f"/v1/businesses/invitations/{invitation_id}/accept", headers=stranger_headers)
    assert bad_accept.status_code == 403

    # 6. Employee accepts invitation
    accept_res = await async_client.post(f"/v1/businesses/invitations/{invitation_id}/accept", headers=emp_headers)
    assert accept_res.status_code == 200
    accept_data = accept_res.json()
    assert accept_data["business_id"] == business_id
    assert accept_data["member_role"] == "employee"
    assert accept_data["membership_status"] == "active"

    # 7. Check current business info (2 active seats now: boss + employee)
    curr_res = await async_client.get("/v1/businesses/current", headers=owner_headers)
    assert curr_res.status_code == 200
    curr_data = curr_res.json()
    assert curr_data["active_seats"] == 2
    assert len(curr_data["members"]) == 2


@pytest.mark.asyncio
async def test_member_roles_and_status(async_client: AsyncClient):
    owner_reg = await async_client.post("/v1/auth/register", json={
        "email": "owner2@corp.com",
        "password": "valid-password-1234",
    })
    owner_headers = {"Authorization": f"Bearer {owner_reg.json()['access_token']}"}
    create_res = await async_client.post("/v1/businesses", json={"name": "Corp 2"}, headers=owner_headers)
    business_id = create_res.json()["id"]

    emp_reg = await async_client.post("/v1/auth/register", json={
        "email": "worker@corp.com",
        "password": "valid-password-1234",
    })
    emp_id = emp_reg.json()["user_id"]
    emp_headers = {"Authorization": f"Bearer {emp_reg.json()['access_token']}"}

    # Invite & accept
    inv_res = await async_client.post(f"/v1/businesses/{business_id}/invitations", json={
        "email": "worker@corp.com",
        "member_role": "employee",
    }, headers=owner_headers)
    inv_id = inv_res.json()["id"]
    await async_client.post(f"/v1/businesses/invitations/{inv_id}/accept", headers=emp_headers)

    # 1. Non-owner (employee) cannot change role -> 403
    bad_role = await async_client.patch(f"/v1/businesses/{business_id}/members/{emp_id}/role", json={
        "role": "manager",
    }, headers=emp_headers)
    assert bad_role.status_code == 403

    # 2. Owner promotes employee to manager
    promote_res = await async_client.patch(f"/v1/businesses/{business_id}/members/{emp_id}/role", json={
        "role": "manager",
    }, headers=owner_headers)
    assert promote_res.status_code == 200

    # 3. Newly promoted manager can invite other members
    new_user = await async_client.post("/v1/auth/register", json={
        "email": "intern@corp.com",
        "password": "valid-password-1234",
    })
    intern_id = new_user.json()["user_id"]
    mgr_invite = await async_client.post(f"/v1/businesses/{business_id}/invitations", json={
        "email": "intern@corp.com",
        "member_role": "employee",
    }, headers=emp_headers)
    assert mgr_invite.status_code == 201

    # 4. Suspend member
    suspend_res = await async_client.patch(f"/v1/businesses/{business_id}/members/{intern_id}/status", json={
        "status": "suspended",
    }, headers=owner_headers)
    # Intern doesn't have membership yet (pending invite only) -> 404
    assert suspend_res.status_code == 404

    # Suspend employee
    suspend_emp = await async_client.patch(f"/v1/businesses/{business_id}/members/{emp_id}/status", json={
        "status": "suspended",
    }, headers=owner_headers)
    assert suspend_emp.status_code == 200

    # 5. Cannot suspend owner
    owner_id = owner_reg.json()["user_id"]
    suspend_owner = await async_client.patch(f"/v1/businesses/{business_id}/members/{owner_id}/status", json={
        "status": "suspended",
    }, headers=owner_headers)
    assert suspend_owner.status_code == 400

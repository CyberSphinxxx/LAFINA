import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

# Ensure workspace root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from sqlalchemy import select
from backend.app.database import AsyncSessionLocal
from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership
from backend.app.models.business_collaboration import (
    BusinessTask,
    BusinessTaskAssignment,
    BusinessWorkBlock,
)
from backend.app.models.business_chat import (
    BusinessChatChannel,
    BusinessChatMessage,
    BusinessTaskComment,
)
from backend.app.security.auth import hash_password

# Fixed Identifiers for Demo Accounts & Workspace
DEMO_BIZ_ID = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
DEMO_MANAGER_ID = uuid.UUID("11111111-1111-4111-a111-111111111111")
DEMO_ALICE_ID = uuid.UUID("22222222-2222-4222-a222-222222222222")
DEMO_BOB_ID = uuid.UUID("33333333-3333-4333-a333-333333333333")

DEMO_PASSWORD = "Password123!"

DEMO_ACCOUNTS = [
    {
        "id": DEMO_MANAGER_ID,
        "email": "manager@lafina.ph",
        "role": "user",
        "system_role": "user",
        "subscription_plan": "business",
        "name": "Dr. Eleanor Vance (Manager)",
    },
    {
        "id": DEMO_ALICE_ID,
        "email": "alice@lafina.ph",
        "role": "user",
        "system_role": "user",
        "subscription_plan": "student",
        "name": "Alice Guo (Senior Researcher)",
    },
    {
        "id": DEMO_BOB_ID,
        "email": "bob@lafina.ph",
        "role": "user",
        "system_role": "user",
        "subscription_plan": "student",
        "name": "Bob Santos (Hardware Specialist)",
    },
]


async def seed_demo_accounts():
    print("[Seed] Connecting to database...")
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        pwd_hash = hash_password(DEMO_PASSWORD)

        # 1. Seed or update Accounts
        for acc_info in DEMO_ACCOUNTS:
            stmt = select(Account).where(Account.email == acc_info["email"])
            res = await db.execute(stmt)
            existing = res.scalar_one_or_none()

            if existing:
                existing.password_hash = pwd_hash
                existing.role = acc_info["role"]
                existing.system_role = acc_info["system_role"]
                existing.subscription_plan = acc_info["subscription_plan"]
                existing.is_active = True
                print(f"[Seed] Updated existing account '{acc_info['email']}'.")
            else:
                account = Account(
                    id=acc_info["id"],
                    email=acc_info["email"],
                    password_hash=pwd_hash,
                    role=acc_info["role"],
                    system_role=acc_info["system_role"],
                    subscription_plan=acc_info["subscription_plan"],
                    is_active=True,
                    created_at=now,
                    updated_at=now,
                )
                db.add(account)
                print(f"[Seed] Created new account '{acc_info['email']}'.")

        await db.commit()

        # 2. Seed or update Business Workspace
        biz_stmt = select(Business).where(Business.id == DEMO_BIZ_ID)
        biz_res = await db.execute(biz_stmt)
        existing_biz = biz_res.scalar_one_or_none()

        if existing_biz:
            existing_biz.name = "USTP Innovators Lab"
            existing_biz.owner_id = DEMO_MANAGER_ID
            existing_biz.subscription_plan = "business"
            existing_biz.subscription_status = "active"
            existing_biz.seat_limit = 5
            print(f"[Seed] Updated workspace '{existing_biz.name}'.")
        else:
            business = Business(
                id=DEMO_BIZ_ID,
                owner_id=DEMO_MANAGER_ID,
                name="USTP Innovators Lab",
                timezone="Asia/Manila",
                subscription_plan="business",
                subscription_status="active",
                seat_limit=5,
                created_at=now,
                updated_at=now,
            )
            db.add(business)
            print("[Seed] Created workspace 'USTP Innovators Lab'.")

        await db.commit()

        # 3. Seed Business Memberships
        memberships = [
            {"user_id": DEMO_MANAGER_ID, "role": "manager"},
            {"user_id": DEMO_ALICE_ID, "role": "employee"},
            {"user_id": DEMO_BOB_ID, "role": "employee"},
        ]

        for m in memberships:
            m_stmt = select(BusinessMembership).where(
                BusinessMembership.business_id == DEMO_BIZ_ID,
                BusinessMembership.user_id == m["user_id"],
            )
            m_res = await db.execute(m_stmt)
            existing_m = m_res.scalar_one_or_none()

            if existing_m:
                existing_m.member_role = m["role"]
                existing_m.membership_status = "active"
            else:
                new_m = BusinessMembership(
                    id=uuid.uuid4(),
                    business_id=DEMO_BIZ_ID,
                    user_id=m["user_id"],
                    member_role=m["role"],
                    membership_status="active",
                    created_at=now,
                    updated_at=now,
                )
                db.add(new_m)

        await db.commit()
        print("[Seed] Verified active business memberships.")

        # 4. Seed Demo Collaborative Tasks
        task1_id = uuid.UUID("44444444-4444-4444-a444-444444444441")
        task2_id = uuid.UUID("44444444-4444-4444-a444-444444444442")
        task3_id = uuid.UUID("44444444-4444-4444-a444-444444444443")

        t1_stmt = select(BusinessTask).where(BusinessTask.id == task1_id)
        if not (await db.execute(t1_stmt)).scalar_one_or_none():
            task1 = BusinessTask(
                id=task1_id,
                business_id=DEMO_BIZ_ID,
                created_by=DEMO_MANAGER_ID,
                title="Deploy Edge Server Firewall",
                instructions="Update IPTables and verify port forwarding on edge nodes.",
                priority="high",
                due_date=now + timedelta(days=2),
                reminder_lead_minutes=30,
                version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(task1)
            db.add(
                BusinessTaskAssignment(
                    id=uuid.UUID("55555555-5555-5555-a555-555555555551"),
                    business_task_id=task1_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_ALICE_ID,
                    status="in_progress",
                    manager_review_status="pending",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )
            db.add(
                BusinessTaskAssignment(
                    id=uuid.UUID("55555555-5555-5555-a555-555555555552"),
                    business_task_id=task1_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_BOB_ID,
                    status="todo",
                    manager_review_status="pending",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )

        t2_stmt = select(BusinessTask).where(BusinessTask.id == task2_id)
        if not (await db.execute(t2_stmt)).scalar_one_or_none():
            task2 = BusinessTask(
                id=task2_id,
                business_id=DEMO_BIZ_ID,
                created_by=DEMO_MANAGER_ID,
                title="Calibrate Oscilloscopes & Signal Generators",
                instructions="Check channel 1 & 2 waveforms across 100MHz bandwidth.",
                priority="medium",
                due_date=now + timedelta(days=1),
                reminder_lead_minutes=15,
                version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(task2)
            db.add(
                BusinessTaskAssignment(
                    id=uuid.UUID("55555555-5555-5555-a555-555555555553"),
                    business_task_id=task2_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_ALICE_ID,
                    status="pending_review",
                    manager_review_status="pending",
                    submitted_at=now,
                    version=2,
                    created_at=now,
                    updated_at=now,
                )
            )

        t3_stmt = select(BusinessTask).where(BusinessTask.id == task3_id)
        if not (await db.execute(t3_stmt)).scalar_one_or_none():
            task3 = BusinessTask(
                id=task3_id,
                business_id=DEMO_BIZ_ID,
                created_by=DEMO_MANAGER_ID,
                title="Submit Q3 Hardware Inventory",
                instructions="Log microcontroller and sensor inventory to lab sheet.",
                priority="low",
                due_date=now + timedelta(days=5),
                reminder_lead_minutes=60,
                version=1,
                created_at=now,
                updated_at=now,
            )
            db.add(task3)
            db.add(
                BusinessTaskAssignment(
                    id=uuid.UUID("55555555-5555-5555-a555-555555555554"),
                    business_task_id=task3_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_BOB_ID,
                    status="todo",
                    manager_review_status="pending",
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )

        # 5. Seed Demo Work Blocks
        wb1_id = uuid.UUID("66666666-6666-6666-a666-666666666661")
        wb2_id = uuid.UUID("66666666-6666-6666-a666-666666666662")

        wb1_stmt = select(BusinessWorkBlock).where(BusinessWorkBlock.id == wb1_id)
        if not (await db.execute(wb1_stmt)).scalar_one_or_none():
            db.add(
                BusinessWorkBlock(
                    id=wb1_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_ALICE_ID,
                    title="Morning Research Shift",
                    start_time=now.replace(hour=9, minute=0, second=0, microsecond=0),
                    end_time=now.replace(hour=13, minute=0, second=0, microsecond=0),
                    created_by=DEMO_MANAGER_ID,
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )

        wb2_stmt = select(BusinessWorkBlock).where(BusinessWorkBlock.id == wb2_id)
        if not (await db.execute(wb2_stmt)).scalar_one_or_none():
            db.add(
                BusinessWorkBlock(
                    id=wb2_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_BOB_ID,
                    title="Lab Hardware Maintenance",
                    start_time=now.replace(hour=13, minute=0, second=0, microsecond=0),
                    end_time=now.replace(hour=17, minute=0, second=0, microsecond=0),
                    created_by=DEMO_MANAGER_ID,
                    version=1,
                    created_at=now,
                    updated_at=now,
                )
            )

        # 6. Seed Chat Channels
        chan_id = uuid.UUID("77777777-7777-7777-a777-777777777771")
        chan_stmt = select(BusinessChatChannel).where(BusinessChatChannel.id == chan_id)
        if not (await db.execute(chan_stmt)).scalar_one_or_none():
            db.add(
                BusinessChatChannel(
                    id=chan_id,
                    business_id=DEMO_BIZ_ID,
                    name="general",
                    channel_type="general",
                    is_archived=False,
                    created_at=now,
                    updated_at=now,
                )
            )

        # 7. Seed Chat Messages
        msg1_id = uuid.UUID("88888888-8888-8888-a888-888888888881")
        msg1_stmt = select(BusinessChatMessage).where(BusinessChatMessage.id == msg1_id)
        if not (await db.execute(msg1_stmt)).scalar_one_or_none():
            db.add(
                BusinessChatMessage(
                    id=msg1_id,
                    channel_id=chan_id,
                    business_id=DEMO_BIZ_ID,
                    sender_id=DEMO_MANAGER_ID,
                    client_message_id="demo_msg_001",
                    content="Welcome team! Please review today's scheduled firmware and calibration tasks.",
                    task_link_id=task1_id,
                    created_at=now,
                    updated_at=now,
                )
            )

        msg2_id = uuid.UUID("88888888-8888-8888-a888-888888888882")
        msg2_stmt = select(BusinessChatMessage).where(BusinessChatMessage.id == msg2_id)
        if not (await db.execute(msg2_stmt)).scalar_one_or_none():
            db.add(
                BusinessChatMessage(
                    id=msg2_id,
                    channel_id=chan_id,
                    business_id=DEMO_BIZ_ID,
                    sender_id=DEMO_ALICE_ID,
                    client_message_id="demo_msg_002",
                    content="On it Dr. Vance! I submitted the oscilloscope calibration waveforms for review.",
                    task_link_id=task2_id,
                    created_at=now,
                    updated_at=now,
                )
            )

        # 8. Seed Task Comments
        com1_id = uuid.UUID("99999999-9999-9999-a999-999999999991")
        com1_stmt = select(BusinessTaskComment).where(BusinessTaskComment.id == com1_id)
        if not (await db.execute(com1_stmt)).scalar_one_or_none():
            db.add(
                BusinessTaskComment(
                    id=com1_id,
                    task_id=task2_id,
                    business_id=DEMO_BIZ_ID,
                    user_id=DEMO_ALICE_ID,
                    client_comment_id="demo_comment_001",
                    content="All 4 channels calibrated at 100MHz with zero jitter.",
                    created_at=now,
                    updated_at=now,
                )
            )

        await db.commit()
        print("[Seed] Successfully seeded demo tasks, work blocks, chat messages, and comments.")
        print("\n========================================================")
        print("DEMO ACCOUNTS SEEDED SUCCESSFULLY")
        print("========================================================")
        print("Workspace: USTP Innovators Lab (Plan: business, 5 seats)")
        print("Password for all accounts: Password123!")
        print("\n1. Manager / Employer Account:")
        print("   - Email: manager@lafina.ph")
        print("   - Name:  Dr. Eleanor Vance (Manager)")
        print("   - Role:  Manager")
        print("\n2. Employee Account 1:")
        print("   - Email: alice@lafina.ph")
        print("   - Name:  Alice Guo (Senior Researcher)")
        print("   - Role:  Employee")
        print("\n3. Employee Account 2:")
        print("   - Email: bob@lafina.ph")
        print("   - Name:  Bob Santos (Hardware Specialist)")
        print("   - Role:  Employee")
        print("========================================================\n")


if __name__ == "__main__":
    asyncio.run(seed_demo_accounts())

from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.account import Account
from backend.app.models.business import Business, BusinessMembership

class BusinessSessionData(BaseModel):
    business_id: str
    business_name: str
    member_role: str
    membership_status: str
    lease_expires_at: str
    capabilities: list[str]

class CapabilityResolution(BaseModel):
    system_role: str
    subscription_plan: str
    effective_subscription_plan: str
    business_session: BusinessSessionData | None
    capabilities: list[str]

BUSINESS_CAPABILITIES = [
    "business_core",
    "business_chat",
    "meeting_summary",
    "gmail",
]

async def resolve_account_capabilities(account: Account, db: AsyncSession) -> CapabilityResolution:
    """
    Evaluates account subscription plan, active company seat, and produces the
    effective subscription tier, active business session, and 24-hour lease.
    """
    now = datetime.now(timezone.utc)
    system_role = account.system_role or "user"
    base_plan = account.subscription_plan or "student"

    # Find active business membership
    stmt = (
        select(BusinessMembership, Business)
        .join(Business, Business.id == BusinessMembership.business_id)
        .where(
            BusinessMembership.user_id == account.id,
            BusinessMembership.membership_status == "active",
            Business.subscription_status.in_(["active", "trialing"]),
        )
        .limit(1)
    )
    res = await db.execute(stmt)
    membership_row = res.first()

    if membership_row:
        membership, business = membership_row
        # Check validity timestamps if set
        if business.valid_until and business.valid_until.tzinfo is None:
            valid_until = business.valid_until.replace(tzinfo=timezone.utc)
        else:
            valid_until = business.valid_until

        if valid_until is None or valid_until >= now:
            lease_expires = (now + timedelta(hours=24)).isoformat()
            capabilities = list(BUSINESS_CAPABILITIES)

            session_data = BusinessSessionData(
                business_id=str(business.id),
                business_name=business.name,
                member_role=membership.member_role,
                membership_status=membership.membership_status,
                lease_expires_at=lease_expires,
                capabilities=capabilities,
            )

            return CapabilityResolution(
                system_role=system_role,
                subscription_plan=base_plan,
                effective_subscription_plan="business",
                business_session=session_data,
                capabilities=capabilities,
            )

    # Fallback to personal subscription
    return CapabilityResolution(
        system_role=system_role,
        subscription_plan=base_plan,
        effective_subscription_plan=base_plan,
        business_session=None,
        capabilities=[],
    )

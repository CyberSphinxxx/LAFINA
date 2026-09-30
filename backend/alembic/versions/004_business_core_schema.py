"""004 Business Core Schema, Memberships, Invitations, and RLS

Revision ID: 004_business_core_schema
Revises: 003_sync_snapshot_heads
Create Date: 2026-08-25

"""
from alembic import op

revision = "004_business_core_schema"
down_revision = "003_sync_snapshot_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 0. Expand alembic_version column width
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(64)")

    # 1. Add system_role and subscription_plan columns to accounts
    op.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS system_role VARCHAR(32) NOT NULL DEFAULT 'user'")
    op.execute("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(32) NOT NULL DEFAULT 'student'")

    # 2. Create businesses table if not exists
    op.execute("""
        CREATE TABLE IF NOT EXISTS businesses (
            id UUID PRIMARY KEY,
            owner_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            name VARCHAR(128) NOT NULL,
            timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
            subscription_plan VARCHAR(32) NOT NULL DEFAULT 'business',
            subscription_status VARCHAR(32) NOT NULL DEFAULT 'active',
            seat_limit INTEGER NOT NULL DEFAULT 5,
            valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            valid_until TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_businesses_owner_id ON businesses (owner_id)")

    # 3. Create business_memberships table
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_memberships (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            member_role VARCHAR(32) NOT NULL DEFAULT 'employee',
            membership_status VARCHAR(32) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_business_membership_user UNIQUE (business_id, user_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_memberships_business_id ON business_memberships (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_memberships_user_id ON business_memberships (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_business_memberships_user_status ON business_memberships (user_id, membership_status)")

    # 4. Create business_invitations table
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_invitations (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            invited_by UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            member_role VARCHAR(32) NOT NULL DEFAULT 'employee',
            token VARCHAR(128) UNIQUE NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_invitations_business_id ON business_invitations (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_invitations_email ON business_invitations (email)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_business_invitations_email_status ON business_invitations (email, status)")

    # 5. Enable Row Level Security (RLS) on new tables
    for table in ["businesses", "business_memberships", "business_invitations"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    # Drop existing policies if any before re-creating
    op.execute("DROP POLICY IF EXISTS businesses_member_access ON businesses")
    op.execute("""
        CREATE POLICY businesses_member_access ON businesses
        FOR ALL
        USING (
            owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = businesses.id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_memberships_access ON business_memberships")
    op.execute("""
        CREATE POLICY business_memberships_access ON business_memberships
        FOR ALL
        USING (
            user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_memberships.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships AS my_membership
                WHERE my_membership.business_id = business_memberships.business_id
                AND my_membership.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND my_membership.member_role = 'manager'
                AND my_membership.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_invitations_access ON business_invitations")
    op.execute("""
        CREATE POLICY business_invitations_access ON business_invitations
        FOR ALL
        USING (
            invited_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM accounts
                WHERE accounts.id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND LOWER(accounts.email) = LOWER(business_invitations.email)
            )
            OR EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_invitations.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_invitations.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.member_role = 'manager'
                AND business_memberships.membership_status = 'active'
            )
        )
    """)


def downgrade() -> None:
    for table in ["business_invitations", "business_memberships", "businesses"]:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("business_invitations")
    op.drop_table("business_memberships")
    op.drop_table("businesses")
    op.drop_column("accounts", "subscription_plan")
    op.drop_column("accounts", "system_role")

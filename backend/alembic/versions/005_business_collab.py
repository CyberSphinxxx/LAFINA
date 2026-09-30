"""005 Business Collaboration Tasks, Assignments, Work Blocks, and Sync

Revision ID: 005_business_collab
Revises: 004_business_core_schema
Create Date: 2026-08-25

"""
from alembic import op

revision = "005_business_collab"
down_revision = "004_business_core_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create business_tasks
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_tasks (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            created_by UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            instructions TEXT NOT NULL DEFAULT '',
            priority VARCHAR(32) NOT NULL DEFAULT 'medium',
            due_date TIMESTAMP WITH TIME ZONE,
            scheduled_at TIMESTAMP WITH TIME ZONE,
            recurrence_rule VARCHAR(255),
            reminder_lead_minutes INTEGER NOT NULL DEFAULT 15,
            is_cancelled BOOLEAN NOT NULL DEFAULT false,
            version INTEGER NOT NULL DEFAULT 1,
            deleted_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_tasks_business_id ON business_tasks (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_tasks_created_by ON business_tasks (created_by)")

    # 2. Create business_task_assignments
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_task_assignments (
            id UUID PRIMARY KEY,
            business_task_id UUID NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            status VARCHAR(32) NOT NULL DEFAULT 'todo',
            manager_review_status VARCHAR(32) NOT NULL DEFAULT 'pending',
            reopened_reason TEXT,
            submitted_at TIMESTAMP WITH TIME ZONE,
            approved_at TIMESTAMP WITH TIME ZONE,
            version INTEGER NOT NULL DEFAULT 1,
            deleted_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_business_task_assignment UNIQUE (business_task_id, user_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_assignments_business_task_id ON business_task_assignments (business_task_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_assignments_business_id ON business_task_assignments (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_assignments_user_id ON business_task_assignments (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_business_task_assignment_user ON business_task_assignments (user_id, status)")

    # 3. Create business_work_blocks
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_work_blocks (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            start_time TIMESTAMP WITH TIME ZONE NOT NULL,
            end_time TIMESTAMP WITH TIME ZONE NOT NULL,
            recurrence_rule VARCHAR(255),
            created_by UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            version INTEGER NOT NULL DEFAULT 1,
            deleted_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_work_blocks_business_id ON business_work_blocks (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_work_blocks_user_id ON business_work_blocks (user_id)")

    # 4. Create business_change_feed
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_change_feed (
            id SERIAL PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            actor_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            entity_type VARCHAR(64) NOT NULL,
            entity_id UUID NOT NULL,
            operation VARCHAR(32) NOT NULL,
            version INTEGER NOT NULL,
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_change_feed_business_id ON business_change_feed (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_business_change_feed_cursor ON business_change_feed (business_id, id)")

    # 5. Create business_idempotent_mutations
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_idempotent_mutations (
            mutation_id VARCHAR(128) PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            entity_type VARCHAR(64) NOT NULL,
            entity_id UUID NOT NULL,
            processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_idempotent_mutations_business_id ON business_idempotent_mutations (business_id)")

    # 6. Enable Row Level Security (RLS) on new tables
    for table in [
        "business_tasks",
        "business_task_assignments",
        "business_work_blocks",
        "business_change_feed",
        "business_idempotent_mutations",
    ]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    # 7. RLS Policies
    op.execute("DROP POLICY IF EXISTS business_tasks_tenant_access ON business_tasks")
    op.execute("""
        CREATE POLICY business_tasks_tenant_access ON business_tasks
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_tasks.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_tasks.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_task_assignments_tenant_access ON business_task_assignments")
    op.execute("""
        CREATE POLICY business_task_assignments_tenant_access ON business_task_assignments
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_task_assignments.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_task_assignments.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_work_blocks_tenant_access ON business_work_blocks")
    op.execute("""
        CREATE POLICY business_work_blocks_tenant_access ON business_work_blocks
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_work_blocks.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_work_blocks.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_change_feed_tenant_access ON business_change_feed")
    op.execute("""
        CREATE POLICY business_change_feed_tenant_access ON business_change_feed
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_change_feed.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_change_feed.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_idempotent_mutations_tenant_access ON business_idempotent_mutations")
    op.execute("""
        CREATE POLICY business_idempotent_mutations_tenant_access ON business_idempotent_mutations
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_idempotent_mutations.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_idempotent_mutations.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)


def downgrade() -> None:
    for table in [
        "business_idempotent_mutations",
        "business_change_feed",
        "business_work_blocks",
        "business_task_assignments",
        "business_tasks",
    ]:
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_table("business_idempotent_mutations")
    op.drop_table("business_change_feed")
    op.drop_table("business_work_blocks")
    op.drop_table("business_task_assignments")
    op.drop_table("business_tasks")

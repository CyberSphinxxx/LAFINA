"""007 Business Meetings, Segments, Recipients and RLS

Revision ID: 007_business_meeting_schema
Revises: 006_business_chat_schema
Create Date: 2026-08-25

"""
from alembic import op

revision = "007_business_meeting_schema"
down_revision = "006_business_chat_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create business_meetings
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_meetings (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            created_by UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL DEFAULT 'Untitled Meeting',
            duration_seconds INTEGER NOT NULL DEFAULT 0,
            full_transcript TEXT NOT NULL DEFAULT '',
            summary_json JSONB,
            summary_status VARCHAR(32) NOT NULL DEFAULT 'not_requested',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_meetings_business_created ON business_meetings (business_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_meetings_creator ON business_meetings (created_by)")

    # 2. Create business_meeting_recipients
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_meeting_recipients (
            id UUID PRIMARY KEY,
            meeting_id UUID NOT NULL REFERENCES business_meetings(id) ON DELETE CASCADE,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_meeting_recipients_meeting_user UNIQUE (meeting_id, user_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_meeting_recipients_user_business ON business_meeting_recipients (user_id, business_id)")

    # 3. Enable RLS
    op.execute("ALTER TABLE business_meetings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_meeting_recipients ENABLE ROW LEVEL SECURITY")

    # 4. RLS Policies for business_meetings:
    # - Creator can full access
    # - Assigned recipient in business_meeting_recipients can SELECT
    # - Business manager can SELECT
    op.execute("""
        CREATE POLICY rls_business_meetings_select ON business_meetings
        FOR SELECT
        USING (
            created_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM business_meeting_recipients r
                WHERE r.meeting_id = business_meetings.id
                  AND r.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meetings.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.member_role = 'manager'
                  AND m.membership_status = 'active'
            )
        )
    """)

    op.execute("""
        CREATE POLICY rls_business_meetings_insert ON business_meetings
        FOR INSERT
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meetings.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.membership_status = 'active'
            )
        )
    """)

    op.execute("""
        CREATE POLICY rls_business_meetings_update ON business_meetings
        FOR UPDATE
        USING (
            created_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meetings.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.member_role = 'manager'
                  AND m.membership_status = 'active'
            )
        )
    """)

    op.execute("""
        CREATE POLICY rls_business_meetings_delete ON business_meetings
        FOR DELETE
        USING (
            created_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meetings.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.member_role = 'manager'
                  AND m.membership_status = 'active'
            )
        )
    """)

    # 5. RLS Policies for business_meeting_recipients
    op.execute("""
        CREATE POLICY rls_business_meeting_recipients_select ON business_meeting_recipients
        FOR SELECT
        USING (
            user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            OR EXISTS (
                SELECT 1 FROM business_meetings bm
                WHERE bm.id = business_meeting_recipients.meeting_id
                  AND bm.created_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meeting_recipients.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.member_role = 'manager'
                  AND m.membership_status = 'active'
            )
        )
    """)

    op.execute("""
        CREATE POLICY rls_business_meeting_recipients_write ON business_meeting_recipients
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM business_meetings bm
                WHERE bm.id = business_meeting_recipients.meeting_id
                  AND bm.created_by = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships m
                WHERE m.business_id = business_meeting_recipients.business_id
                  AND m.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                  AND m.member_role = 'manager'
                  AND m.membership_status = 'active'
            )
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS business_meeting_recipients CASCADE")
    op.execute("DROP TABLE IF EXISTS business_meetings CASCADE")

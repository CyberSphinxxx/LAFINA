"""006 Business Chat Channels, Messages, Task Comments and RLS

Revision ID: 006_business_chat_schema
Revises: 005_business_collab
Create Date: 2026-08-25

"""
from alembic import op

revision = "006_business_chat_schema"
down_revision = "005_business_collab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create business_chat_channels
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_chat_channels (
            id UUID PRIMARY KEY,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL DEFAULT 'general',
            channel_type VARCHAR(32) NOT NULL DEFAULT 'general',
            is_archived BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_business_channel_name UNIQUE (business_id, name)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_chat_channels_business_id ON business_chat_channels (business_id)")

    # 2. Create business_chat_messages
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_chat_messages (
            id UUID PRIMARY KEY,
            channel_id UUID NOT NULL REFERENCES business_chat_channels(id) ON DELETE CASCADE,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            sender_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            client_message_id VARCHAR(128) NOT NULL,
            content TEXT NOT NULL,
            task_link_id UUID REFERENCES business_tasks(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_business_chat_client_msg_id UNIQUE (business_id, client_message_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_chat_messages_channel_created ON business_chat_messages (channel_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_chat_messages_business_id ON business_chat_messages (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_chat_messages_sender_id ON business_chat_messages (sender_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_chat_messages_task_link_id ON business_chat_messages (task_link_id)")

    # 3. Create business_task_comments
    op.execute("""
        CREATE TABLE IF NOT EXISTS business_task_comments (
            id UUID PRIMARY KEY,
            task_id UUID NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE,
            business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            client_comment_id VARCHAR(128) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_business_task_client_comment_id UNIQUE (task_id, client_comment_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_comments_task_created ON business_task_comments (task_id, created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_comments_business_id ON business_task_comments (business_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_business_task_comments_user_id ON business_task_comments (user_id)")

    # 4. Enable Row Level Security (RLS)
    op.execute("ALTER TABLE business_chat_channels ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_chat_messages ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_task_comments ENABLE ROW LEVEL SECURITY")

    # 5. Create RLS Policies
    op.execute("DROP POLICY IF EXISTS business_chat_channels_tenant_access ON business_chat_channels")
    op.execute("""
        CREATE POLICY business_chat_channels_tenant_access ON business_chat_channels
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_chat_channels.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_chat_channels.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_chat_messages_tenant_access ON business_chat_messages")
    op.execute("""
        CREATE POLICY business_chat_messages_tenant_access ON business_chat_messages
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_chat_messages.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_chat_messages.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)

    op.execute("DROP POLICY IF EXISTS business_task_comments_tenant_access ON business_task_comments")
    op.execute("""
        CREATE POLICY business_task_comments_tenant_access ON business_task_comments
        FOR ALL
        USING (
            EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_task_comments.business_id
                AND businesses.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_task_comments.business_id
                AND business_memberships.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
                AND business_memberships.membership_status = 'active'
            )
        )
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS business_task_comments_tenant_access ON business_task_comments")
    op.execute("DROP POLICY IF EXISTS business_chat_messages_tenant_access ON business_chat_messages")
    op.execute("DROP POLICY IF EXISTS business_chat_channels_tenant_access ON business_chat_channels")
    op.execute("DROP TABLE IF EXISTS business_task_comments")
    op.execute("DROP TABLE IF EXISTS business_chat_messages")
    op.execute("DROP TABLE IF EXISTS business_chat_channels")

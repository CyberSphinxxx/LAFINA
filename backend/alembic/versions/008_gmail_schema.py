"""008 Gmail OAuth, Connections, Send Audits and RLS

Revision ID: 008_gmail_schema
Revises: 007_business_meeting_schema
Create Date: 2026-08-25

"""
from alembic import op

revision = "008_gmail_schema"
down_revision = "007_business_meeting_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create gmail_oauth_states
    op.execute("""
        CREATE TABLE IF NOT EXISTS gmail_oauth_states (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            state VARCHAR(255) NOT NULL UNIQUE,
            code_verifier VARCHAR(255) NOT NULL,
            redirect_uri VARCHAR(512) NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_oauth_states_state ON gmail_oauth_states (state)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_oauth_states_user_expires ON gmail_oauth_states (user_id, expires_at)")

    # 2. Create gmail_connections
    op.execute("""
        CREATE TABLE IF NOT EXISTS gmail_connections (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
            email_address VARCHAR(255) NOT NULL,
            encrypted_refresh_token TEXT NOT NULL,
            encrypted_access_token TEXT,
            access_token_expires_at TIMESTAMP WITH TIME ZONE,
            scopes VARCHAR(512) NOT NULL DEFAULT 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose',
            is_active BOOLEAN NOT NULL DEFAULT true,
            last_synced_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_connections_user_id ON gmail_connections (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_connections_active ON gmail_connections (user_id, is_active)")

    # 3. Create gmail_send_audits
    op.execute("""
        CREATE TABLE IF NOT EXISTS gmail_send_audits (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            idempotency_key VARCHAR(255) NOT NULL UNIQUE,
            gmail_message_id VARCHAR(255),
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_send_audits_idempotency ON gmail_send_audits (idempotency_key)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_gmail_send_audits_user_created ON gmail_send_audits (user_id, created_at)")

    # 4. Enable RLS on all three tables
    op.execute("ALTER TABLE gmail_oauth_states ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE gmail_send_audits ENABLE ROW LEVEL SECURITY")

    # 5. RLS Policies: Strict per-user isolation (managers CANNOT access employee mail/tokens)
    op.execute("""
        CREATE POLICY rls_gmail_oauth_states_user_isolation ON gmail_oauth_states
        FOR ALL
        USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    """)

    op.execute("""
        CREATE POLICY rls_gmail_connections_user_isolation ON gmail_connections
        FOR ALL
        USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    """)

    op.execute("""
        CREATE POLICY rls_gmail_send_audits_user_isolation ON gmail_send_audits
        FOR ALL
        USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
        WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS gmail_send_audits CASCADE")
    op.execute("DROP TABLE IF EXISTS gmail_connections CASCADE")
    op.execute("DROP TABLE IF EXISTS gmail_oauth_states CASCADE")

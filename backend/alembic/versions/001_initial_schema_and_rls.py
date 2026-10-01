"""001 Initial Schema and PostgreSQL Row-Level Security (RLS)

Revision ID: 001_initial_schema_and_rls
Revises:
Create Date: 2026-07-22

"""

from alembic import op

revision = "001_initial_schema_and_rls"
down_revision = None
branch_labels = None
depends_on = None

SYNC_TABLES = [
    "profile_sync",
    "tasks_sync",
    "events_sync",
    "time_blocks_sync",
    "reminders_sync",
    "notes_sync",
    "custom_categories_sync",
]


def upgrade() -> None:
    # Enable RLS on all synchronized tables and enforce default-deny ownership policies
    if op.get_bind().dialect.name != "postgresql":
        return

    for table in SYNC_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY {table}_owner_policy ON {table}
            FOR ALL
            USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
            WITH CHECK (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
        """)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return

    for table in SYNC_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_owner_policy ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")

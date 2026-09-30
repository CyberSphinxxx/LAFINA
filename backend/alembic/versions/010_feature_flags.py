"""010 Feature flags

Revision ID: 010_feature_flags
Revises: 009_fix_business_rls_recursion
Create Date: 2026-09-18

Runtime switches flipped from the admin panel, starting with `handbook_rag`,
which turns the Student Handbook answers in the online assistant on and off.

No row-level security: these rows are global configuration with no owner,
and every request needs to read them whoever is signed in.
"""
from alembic import op

revision = "010_feature_flags"
down_revision = "009_fix_business_rls_recursion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS feature_flags (
            key VARCHAR(64) PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT true,
            description VARCHAR(255) NOT NULL DEFAULT '',
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        INSERT INTO feature_flags (key, enabled, description)
        VALUES (
            'handbook_rag',
            true,
            'Online assistant answers university questions from the USTP Student Handbook (Pinecone). Turn off to answer from the model alone.'
        )
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS feature_flags")

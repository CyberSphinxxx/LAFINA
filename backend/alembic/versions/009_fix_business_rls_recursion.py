"""Fix infinite recursion in the business row-level-security policies.

Migration 004 gave ``businesses`` a policy that subqueries ``business_memberships``
while ``business_memberships`` had a policy that subqueried both ``businesses``
*and itself*. PostgreSQL re-applies a policy to any query it issues, so those
definitions form a cycle and every statement touching either table fails with::

    InvalidObjectDefinitionError: infinite recursion detected in policy
    for relation "business_memberships"

``FORCE ROW LEVEL SECURITY`` is enabled on both tables, so the table owner is
subject to the policies too and nothing could bypass the cycle. In production
this made ``/v1/auth/me`` — which resolves account capabilities by joining those
two tables — return 500 for every authenticated user, blocking cloud sign-in.
It never surfaced in CI because the backend test suite runs on SQLite, where
``set_transaction_rls_user`` is a no-op and RLS does not exist.

The fix makes exactly one table's policy *terminal*, so evaluation always
bottoms out:

* ``business_memberships`` gains a denormalized ``business_owner_id`` and its
  policy becomes a plain column comparison with **no subquery at all**. It
  cannot trigger another policy, so it terminates.
* ``businesses`` keeps its "owner or active member" rule; its subquery against
  ``business_memberships`` now reaches that terminal policy and stops.
* ``business_invitations`` keeps its rule; its subqueries reach the same
  terminal policy one level deeper.

Denormalizing the owner is what preserves behaviour. Without it the only
acyclic options were "members cannot see their own business" or "owners cannot
see their team", each of which would have broken a shipped feature.

The ``businesses`` policy also gains an explicit ``WITH CHECK (owner_id = me)``.
Migration 004 left ``WITH CHECK`` implicit, so it defaulted to the (broader)
``USING`` clause. Being explicit keeps ``business_owner_id`` from ever drifting:
reassigning ``businesses.owner_id`` to somebody else is now rejected outright,
and no application endpoint performs such a transfer.

Revision ID: 009_fix_business_rls_recursion
Revises: 008_gmail_schema
"""
from alembic import op

revision = "009_fix_business_rls_recursion"
down_revision = "008_gmail_schema"
branch_labels = None
depends_on = None

# Every policy resolves the caller from the transaction-local GUC set by
# ``set_transaction_rls_user``. ``missing_ok`` is on, so an unset GUC yields
# NULL and the policy simply matches nothing instead of erroring.
ME = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def upgrade() -> None:
    # 0. The existing policies are recursive, so *any* read of these tables
    #    during this migration would hit the very bug being fixed — including
    #    the backfill below. Drop enforcement for the rebuild and restore it at
    #    the end; alembic runs the whole migration in one transaction.
    op.execute("ALTER TABLE businesses DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_memberships DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_invitations DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS businesses_member_access ON businesses")
    op.execute("DROP POLICY IF EXISTS business_memberships_access ON business_memberships")
    op.execute("DROP POLICY IF EXISTS business_invitations_access ON business_invitations")

    # 1. Denormalize the owning account onto each membership row.
    op.execute(
        "ALTER TABLE business_memberships "
        "ADD COLUMN IF NOT EXISTS business_owner_id UUID"
    )
    op.execute(
        """
        UPDATE business_memberships AS m
        SET business_owner_id = b.owner_id
        FROM businesses AS b
        WHERE b.id = m.business_id
          AND m.business_owner_id IS DISTINCT FROM b.owner_id
        """
    )
    # A membership whose business no longer exists cannot be backfilled and
    # would block the NOT NULL below. Such rows are already orphaned.
    op.execute("DELETE FROM business_memberships WHERE business_owner_id IS NULL")
    op.execute(
        "ALTER TABLE business_memberships ALTER COLUMN business_owner_id SET NOT NULL"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'fk_business_memberships_business_owner_id'
            ) THEN
                ALTER TABLE business_memberships
                ADD CONSTRAINT fk_business_memberships_business_owner_id
                FOREIGN KEY (business_owner_id) REFERENCES accounts (id)
                ON DELETE CASCADE;
            END IF;
        END $$
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_business_memberships_business_owner_id "
        "ON business_memberships (business_owner_id)"
    )

    # 2. Terminal policy: bare column comparisons, no subquery. Evaluating it
    #    issues no query, so it cannot re-enter any policy. This breaks the cycle.
    op.execute(
        f"""
        CREATE POLICY business_memberships_access ON business_memberships
        FOR ALL
        USING (user_id = {ME} OR business_owner_id = {ME})
        WITH CHECK (user_id = {ME} OR business_owner_id = {ME})
        """
    )

    # 3. Reaches the terminal policy above, then stops.
    op.execute(
        f"""
        CREATE POLICY businesses_member_access ON businesses
        FOR ALL
        USING (
            owner_id = {ME}
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = businesses.id
                AND business_memberships.user_id = {ME}
                AND business_memberships.membership_status = 'active'
            )
        )
        WITH CHECK (owner_id = {ME})
        """
    )

    # 4. Reaches businesses and business_memberships, both of which terminate.
    op.execute(
        f"""
        CREATE POLICY business_invitations_access ON business_invitations
        FOR ALL
        USING (
            invited_by = {ME}
            OR EXISTS (
                SELECT 1 FROM accounts
                WHERE accounts.id = {ME}
                AND LOWER(accounts.email) = LOWER(business_invitations.email)
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_invitations.business_id
                AND business_memberships.user_id = {ME}
                AND business_memberships.member_role = 'manager'
                AND business_memberships.membership_status = 'active'
            )
        )
        WITH CHECK (
            invited_by = {ME}
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_invitations.business_id
                AND business_memberships.user_id = {ME}
                AND business_memberships.member_role = 'manager'
                AND business_memberships.membership_status = 'active'
            )
        )
        """
    )

    # 5. Restore enforcement.
    for table in ["businesses", "business_memberships", "business_invitations"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Restores migration 004's definitions verbatim, cycle included.
    op.execute("ALTER TABLE businesses DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_memberships DISABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE business_invitations DISABLE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS businesses_member_access ON businesses")
    op.execute("DROP POLICY IF EXISTS business_memberships_access ON business_memberships")
    op.execute("DROP POLICY IF EXISTS business_invitations_access ON business_invitations")

    op.execute("DROP INDEX IF EXISTS ix_business_memberships_business_owner_id")
    op.execute(
        "ALTER TABLE business_memberships "
        "DROP CONSTRAINT IF EXISTS fk_business_memberships_business_owner_id"
    )
    op.execute("ALTER TABLE business_memberships DROP COLUMN IF EXISTS business_owner_id")

    op.execute(
        f"""
        CREATE POLICY businesses_member_access ON businesses
        FOR ALL
        USING (
            owner_id = {ME}
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = businesses.id
                AND business_memberships.user_id = {ME}
                AND business_memberships.membership_status = 'active'
            )
        )
        """
    )
    op.execute(
        f"""
        CREATE POLICY business_memberships_access ON business_memberships
        FOR ALL
        USING (
            user_id = {ME}
            OR EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_memberships.business_id
                AND businesses.owner_id = {ME}
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships AS my_membership
                WHERE my_membership.business_id = business_memberships.business_id
                AND my_membership.user_id = {ME}
                AND my_membership.member_role = 'manager'
                AND my_membership.membership_status = 'active'
            )
        )
        """
    )
    op.execute(
        f"""
        CREATE POLICY business_invitations_access ON business_invitations
        FOR ALL
        USING (
            invited_by = {ME}
            OR EXISTS (
                SELECT 1 FROM accounts
                WHERE accounts.id = {ME}
                AND LOWER(accounts.email) = LOWER(business_invitations.email)
            )
            OR EXISTS (
                SELECT 1 FROM businesses
                WHERE businesses.id = business_invitations.business_id
                AND businesses.owner_id = {ME}
            )
            OR EXISTS (
                SELECT 1 FROM business_memberships
                WHERE business_memberships.business_id = business_invitations.business_id
                AND business_memberships.user_id = {ME}
                AND business_memberships.member_role = 'manager'
                AND business_memberships.membership_status = 'active'
            )
        )
        """
    )

    for table in ["businesses", "business_memberships", "business_invitations"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

"""Regression tests for bootstrapping a fresh PostgreSQL database."""

from importlib import import_module


def test_initial_migration_creates_sync_tables_before_enabling_rls(monkeypatch):
    """Every RLS target must exist before its first ALTER TABLE statement."""
    migration = import_module(
        "backend.alembic.versions.001_initial_schema_and_rls"
    )
    created_tables: set[str] = set()

    def record_create_table(table: str, *args, **kwargs) -> None:
        del args, kwargs
        created_tables.add(table)

    def assert_rls_target_exists(statement: str) -> None:
        normalized = " ".join(statement.split())
        if not normalized.startswith("ALTER TABLE"):
            return
        table = normalized.split()[2]
        assert table in created_tables

    monkeypatch.setattr(migration.op, "create_table", record_create_table)
    monkeypatch.setattr(migration.op, "create_index", lambda *args, **kwargs: None)
    monkeypatch.setattr(migration.op, "execute", assert_rls_target_exists)

    migration.upgrade()

    assert set(migration.SYNC_TABLES).issubset(created_tables)
    assert {
        "accounts",
        "auth_sessions",
        "recovery_codes",
        "idempotent_mutations",
        "change_feed",
        "ai_usage",
        "security_events",
    }.issubset(created_tables)

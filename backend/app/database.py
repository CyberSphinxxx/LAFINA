import uuid
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from backend.app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    pool_pre_ping=True
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

class Base(DeclarativeBase):
    pass


async def set_transaction_rls_user(
    session: AsyncSession,
    account_id: uuid.UUID | str,
) -> None:
    """Bind PostgreSQL row-level security policies to the authenticated account.

    ``set_config(..., true)`` is transaction-local, so pooled connections cannot
    leak one request's identity into another. SQLite is intentionally a no-op
    because it is used by the backend unit-test suite and does not support RLS.
    """
    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return

    await session.execute(
        text("SELECT set_config('app.current_user_id', :account_id, true)"),
        {"account_id": str(account_id)},
    )

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

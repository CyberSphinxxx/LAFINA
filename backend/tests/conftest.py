from collections.abc import AsyncGenerator

import backend.app.admin
import pytest_asyncio
from backend.app.database import Base, get_db
from backend.app.main import app
from backend.app.models.account import Account  # noqa: F401
from backend.app.models.ai_usage import AIUsage  # noqa: F401
from backend.app.models.change_feed import ChangeFeed  # noqa: F401
from backend.app.models.mutations import IdempotentMutation  # noqa: F401
from backend.app.models.recovery import RecoveryCode  # noqa: F401
from backend.app.models.session import AuthSession  # noqa: F401
from backend.app.models.synchronized_content import (  # noqa: F401
    CustomCategoriesSync,
    EventsSync,
    NotesSync,
    ProfileSync,
    RemindersSync,
    TasksSync,
    TimeBlocksSync,
)
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

# Use in-memory SQLite with aiosqlite (shared cache) for fast backend unit tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///file:memdb1?mode=memory&cache=shared&uri=true"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = async_sessionmaker(
    bind=test_engine, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False
)

backend.app.admin.AsyncSessionLocal = TestingSessionLocal


@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_test_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

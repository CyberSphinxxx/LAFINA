# ruff: noqa: RUF012
# sqladmin reads these list/dict attributes as declarative class-level view configuration.
import uuid

from backend.app.config import get_settings
from backend.app.database import AsyncSessionLocal
from backend.app.models import (
    Account,
    AIUsage,
    AuthSession,
    ChangeFeed,
    CustomCategoriesSync,
    EventsSync,
    IdempotentMutation,
    NotesSync,
    RecoveryCode,
    RemindersSync,
    SecurityEvent,
    TasksSync,
    TimeBlocksSync,
)
from backend.app.security.auth import verify_password
from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import RedirectResponse

settings = get_settings()


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = str(form.get("username", "")).lower().strip()
        password = str(form.get("password", ""))

        if not email or not password:
            return False

        async with AsyncSessionLocal() as db:
            stmt = select(Account).where(Account.email == email)
            res = await db.execute(stmt)
            account = res.scalar_one_or_none()

            # Require active account with admin role and valid password
            if not account or not account.is_active or account.role != "admin":
                return False

            if not verify_password(password, account.password_hash):
                return False

            request.session.update(
                {
                    "admin_user_id": str(account.id),
                    "admin_email": account.email,
                }
            )
            return True

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool | RedirectResponse:
        admin_user_id = request.session.get("admin_user_id")
        if not admin_user_id:
            return False

        try:
            user_uuid = uuid.UUID(admin_user_id)
        except ValueError:
            request.session.clear()
            return False

        async with AsyncSessionLocal() as db:
            stmt = select(Account).where(Account.id == user_uuid)
            res = await db.execute(stmt)
            account = res.scalar_one_or_none()

            if not account or not account.is_active or account.role != "admin":
                request.session.clear()
                return False

        return True


class AccountAdmin(ModelView, model=Account):
    column_list = ["id", "email", "role", "is_active", "created_at"]
    column_searchable_list = ["email", "role"]
    icon = "fa-solid fa-users"


class AuthSessionAdmin(ModelView, model=AuthSession):
    column_list = ["id", "owner_id", "device_info", "is_revoked", "expires_at"]
    icon = "fa-solid fa-key"


class RecoveryCodeAdmin(ModelView, model=RecoveryCode):
    column_list = ["id", "owner_id", "is_used", "used_at"]
    icon = "fa-solid fa-shield-halved"


class TasksSyncAdmin(ModelView, model=TasksSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at", "deleted_at"]
    column_searchable_list = ["client_id"]
    icon = "fa-solid fa-list-check"


class EventsSyncAdmin(ModelView, model=EventsSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at"]
    column_searchable_list = ["client_id"]
    icon = "fa-solid fa-calendar"


class TimeBlocksSyncAdmin(ModelView, model=TimeBlocksSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at"]
    column_searchable_list = ["client_id"]
    icon = "fa-solid fa-clock"


class RemindersSyncAdmin(ModelView, model=RemindersSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at"]
    column_searchable_list = ["client_id"]
    icon = "fa-solid fa-bell"


class NotesSyncAdmin(ModelView, model=NotesSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at"]
    column_searchable_list = ["client_id"]
    icon = "fa-solid fa-sticky-note"


class CustomCategoriesSyncAdmin(ModelView, model=CustomCategoriesSync):
    column_list = ["owner_id", "client_id", "version", "change_id", "updated_at"]
    icon = "fa-solid fa-tags"


class IdempotentMutationAdmin(ModelView, model=IdempotentMutation):
    column_list = ["mutation_id", "owner_id", "status", "created_at"]
    icon = "fa-solid fa-fingerprint"


class ChangeFeedAdmin(ModelView, model=ChangeFeed):
    column_list = ["change_id", "owner_id", "entity_type", "entity_id", "operation", "created_at"]
    icon = "fa-solid fa-stream"


class AIUsageAdmin(ModelView, model=AIUsage):
    column_list = [
        "id",
        "owner_id",
        "request_type",
        "prompt_tokens",
        "completion_tokens",
        "created_at",
    ]
    icon = "fa-solid fa-robot"


class SecurityEventAdmin(ModelView, model=SecurityEvent):
    column_list = ["id", "owner_id", "event_type", "ip_address", "created_at"]
    icon = "fa-solid fa-shield-virus"


authentication_backend = AdminAuth(secret_key=settings.JWT_PRIVATE_KEY[:32])


def setup_admin(app, engine):
    admin = Admin(
        app,
        engine,
        authentication_backend=authentication_backend,
        title="LAFINA Studio (Admin UI)",
        base_url="/admin",
    )
    admin.add_view(AccountAdmin)
    admin.add_view(AuthSessionAdmin)
    admin.add_view(RecoveryCodeAdmin)
    admin.add_view(TasksSyncAdmin)
    admin.add_view(EventsSyncAdmin)
    admin.add_view(TimeBlocksSyncAdmin)
    admin.add_view(RemindersSyncAdmin)
    admin.add_view(NotesSyncAdmin)
    admin.add_view(CustomCategoriesSyncAdmin)
    admin.add_view(IdempotentMutationAdmin)
    admin.add_view(ChangeFeedAdmin)
    admin.add_view(AIUsageAdmin)
    admin.add_view(SecurityEventAdmin)
    return admin

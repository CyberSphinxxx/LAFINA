from contextlib import asynccontextmanager

import backend.app.models  # noqa: F401
from backend.app.admin import setup_admin
from backend.app.api.v1 import ai, auth, sync
from backend.app.clients.deepseek import DeepSeekClient
from backend.app.clients.gemini_tts import GeminiTtsClient
from backend.app.config import get_settings
from backend.app.database import Base, engine
from fastapi import Depends, FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

settings = get_settings()
deepseek_client = DeepSeekClient(settings=settings)
gemini_tts_client = GeminiTtsClient(settings=settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize HTTP client pools
    await deepseek_client.start()
    await gemini_tts_client.start()
    app.state.deepseek_client = deepseek_client
    app.state.gemini_tts_client = gemini_tts_client

    # Auto-create tables in dev/test environment if PostgreSQL is available
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        if settings.ADMIN_EMAIL and settings.ADMIN_PASSWORD:
            from backend.scripts.create_admin import create_admin

            await create_admin(settings.ADMIN_EMAIL, settings.ADMIN_PASSWORD)
    except Exception as e:  # noqa: BLE001 - offline-first startup must warn, never crash the API
        print(f"[Warning] Startup initialization note: {e}")
    yield
    await deepseek_client.close()
    await gemini_tts_client.close()
    await engine.dispose()


app = FastAPI(
    title="LAFINA Cloud API",
    description="FastAPI Backend for LAFINA Offline-First Voice Scheduler (Sprint 7 & 8)",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url=None,
)


# Enforce 1 MiB max body size middleware
@app.middleware("http")
async def limit_body_size_middleware(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        # A malformed Content-Length must be rejected, not turned into a 500.
        try:
            declared_size = int(content_length)
        except (TypeError, ValueError):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Malformed Content-Length header."},
            )
        if declared_size > settings.MAX_BODY_SIZE_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request payload exceeds maximum allowed size of 1 MiB."},
            )
    return await call_next(request)


# Security headers middleware
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def _configure_cors(application: FastAPI) -> None:
    """Registers CORS for explicitly trusted browser origins only.

    A credentialed wildcard (`allow_origins=["*"]` with `allow_credentials=True`)
    makes Starlette echo whatever Origin the caller sent, which lets any website
    read authenticated responses for a signed-in student. Origins therefore come
    from configuration, never from a wildcard.
    """
    allowed_origins = settings.cors_allowed_origins

    if allowed_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )
        return

    if settings.ENVIRONMENT == "development":
        # Local browser tooling only. Native Android clients ignore CORS entirely.
        application.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        )


_configure_cors(app)

# Include Routers
app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(ai.router)

# Mount SQLAdmin UI (Prisma Studio equivalent)
setup_admin(app, engine)


@app.get("/v1/me", response_model=auth.UserProfileResponse, tags=["auth"])
async def get_me_top_level(
    auth_data: tuple[auth.Account, auth.AuthSession] = Depends(auth.get_current_user_and_session),
):
    account, _ = auth_data
    return auth.UserProfileResponse(
        id=str(account.id),
        email=account.email,
        role=account.role,
        is_active=account.is_active,
        created_at=account.created_at.isoformat(),
    )


@app.get("/healthz", status_code=status.HTTP_200_OK)
async def healthz():
    return {"status": "ok", "environment": settings.ENVIRONMENT, "version": "1.0.0"}

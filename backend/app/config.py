from typing import Optional
from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
import functools

# Generate default RSA key pair for development/testing if not provided via env
def _generate_dev_rsa_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode("utf-8")
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("utf-8")
    return private_pem, public_pem

_dev_priv_pem, _dev_pub_pem = _generate_dev_rsa_pair()

INVALID_PLACEHOLDER_KEYS = {
    "",
    "mock-deepseek-key-for-dev",
    "your-deepseek-api-key",
    "sk-your-deepseek-api-key",
    "placeholder",
    "your_deepseek_api_key",
    "change-me",
}

class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    API_BASE_URL: str = "http://localhost:8000"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/lafina"
    # Optional Admin Account Seeding from Environment Variables
    ADMIN_EMAIL: Optional[str] = None
    ADMIN_PASSWORD: Optional[str] = None

    # JWT RS256 Configuration
    JWT_PRIVATE_KEY: str = _dev_priv_pem
    JWT_PUBLIC_KEY: str = _dev_pub_pem
    JWT_ISSUER: str = "lafina-auth"
    JWT_AUDIENCE: str = "lafina-app"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Argon2id Configuration (NIST SP 800-63B & OWASP: >= 19MiB memory, 2 iterations, 1 parallelism)
    ARGON2_MEMORY_COST_KIB: int = 19456  # 19 MiB
    ARGON2_TIME_COST: int = 2
    ARGON2_PARALLELISM: int = 1

    # Security & Rate Limiting
    MAX_BODY_SIZE_BYTES: int = 1048576  # 1 MiB
    # A document upload is the one body that is legitimately large. It gets its
    # own ceiling so the 1 MiB rule can stay tight for everything else; the
    # flashcards endpoint checks the decoded PDF against its own limit again.
    MAX_UPLOAD_BODY_SIZE_BYTES: int = 22020096  # 21 MiB: 15 MB of PDF, base64
    MAX_LOGIN_FAILURES_PER_15MIN: int = 10
    MAX_REGISTRATIONS_PER_IP_PER_HOUR: int = 100
    MAX_AI_REQUESTS_PER_MIN: int = 10
    MAX_AI_REQUESTS_PER_DAY: int = 100
    MAX_TTS_REQUESTS_PER_MIN: int = 10
    MAX_TTS_REQUESTS_PER_DAY: int = 100

    # DeepSeek API Configuration
    DEEPSEEK_API_KEY: SecretStr | None = None
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"
    # Flashcards need a model that follows a strict output shape over a long
    # reply, which is a different job from the conversational assistant.
    DEEPSEEK_FLASHCARD_MODEL: str = "deepseek-chat"
    DEEPSEEK_TIMEOUT_SECONDS: float = 120.0

    # Gemini TTS Configuration
    GEMINI_API_KEY: SecretStr | None = None
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com"
    GEMINI_TTS_MODEL: str = "gemini-3.1-flash-tts-preview"
    GEMINI_TTS_VOICE: str = "Aoede"
    GEMINI_TTS_TIMEOUT_SECONDS: float = 20.0

    # Student Handbook RAG. The handbook lives in a Pinecone index, embedded by
    # Pinecone's own hosted model, and the online assistant quotes it when a
    # question is about the university. Switched on and off at runtime from the
    # admin panel (the `handbook_rag` feature flag) — these settings only say
    # where it lives.
    PINECONE_API_KEY: SecretStr | None = None
    PINECONE_INDEX_NAME: Optional[str] = None
    # Skips the control-plane lookup of the index host when set.
    PINECONE_INDEX_HOST: Optional[str] = None
    PINECONE_CONTROL_URL: str = "https://api.pinecone.io"
    PINECONE_API_VERSION: str = "2025-04"
    HANDBOOK_NAMESPACE: str = "ustp-handbook-2023"
    HANDBOOK_TITLE: str = "USTP Student Handbook 2023"
    # Pinecone Inference. Must match the index: `lafina-rag` is 768-dimensional,
    # cosine, and llama-text-embed-v2 can produce 768 dimensions.
    HANDBOOK_EMBED_MODEL: str = "llama-text-embed-v2"
    HANDBOOK_EMBED_DIMENSIONS: int = 768
    HANDBOOK_TOP_K: int = 5
    # Passages scoring below this are not about the question and are dropped.
    # Measured against llama-text-embed-v2 on the 2023 handbook: questions
    # about the university score 0.30-0.57, unrelated ones 0.27 at most.
    HANDBOOK_MIN_SCORE: float = 0.30
    # Passages this far below the best match are left out too: they are what
    # the index returns to fill the top-k, not what the question is about.
    HANDBOOK_RELATIVE_MARGIN: float = 0.15
    # The chat never waits longer than this for the handbook; past it the
    # reply goes ahead without handbook context.
    HANDBOOK_TIMEOUT_SECONDS: float = 8.0

    # Google OAuth & Gmail Configuration
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[SecretStr] = None
    GOOGLE_REDIRECT_URI: Optional[str] = None
    GMAIL_TOKEN_ENCRYPTION_KEY: Optional[SecretStr] = None

    # Password blocklist (common passwords to reject)
    COMMON_PASSWORDS: set[str] = {
        "password", "password123", "1234567890", "12345678", "qwertyuiop",
        "administrator", "letmein123", "welcome123", "changeme123", "lafina12345"
    }

    def get_deepseek_key_invalid_reason(self) -> str | None:
        if self.DEEPSEEK_API_KEY is None:
            return "DEEPSEEK_API_KEY environment variable is not set (None)"
        raw_key = self.DEEPSEEK_API_KEY.get_secret_value().strip().strip("'\"")
        if not raw_key:
            return "DEEPSEEK_API_KEY is blank or empty"
        if raw_key.lower() in INVALID_PLACEHOLDER_KEYS:
            return f"DEEPSEEK_API_KEY is set to a placeholder value ('{raw_key}')"
        return None

    def is_deepseek_key_valid(self) -> bool:
        return self.get_deepseek_key_invalid_reason() is None

    def get_gemini_key_invalid_reason(self) -> str | None:
        if self.GEMINI_API_KEY is None:
            return "GEMINI_API_KEY environment variable is not set (None)"
        raw_key = self.GEMINI_API_KEY.get_secret_value().strip().strip("'\"")
        if not raw_key:
            return "GEMINI_API_KEY is blank or empty"
        if raw_key.lower() in INVALID_PLACEHOLDER_KEYS:
            return f"GEMINI_API_KEY is set to a placeholder value ('{raw_key}')"
        return None

    def is_gemini_key_valid(self) -> bool:
        return self.get_gemini_key_invalid_reason() is None

    def get_pinecone_invalid_reason(self) -> str | None:
        if self.PINECONE_API_KEY is None:
            return "PINECONE_API_KEY environment variable is not set (None)"
        raw_key = self.PINECONE_API_KEY.get_secret_value().strip().strip("'\"")
        if not raw_key or raw_key.lower() in INVALID_PLACEHOLDER_KEYS:
            return "PINECONE_API_KEY is blank or a placeholder"
        if not (self.PINECONE_INDEX_NAME or "").strip():
            return "PINECONE_INDEX_NAME environment variable is not set"
        return None

    def is_handbook_configured(self) -> bool:
        """Pinecone both embeds and stores the handbook, so its key and index are all it needs."""
        return self.get_pinecone_invalid_reason() is None

    def get_google_redirect_uri(self) -> str:
        """Return the explicit Gmail callback or derive it from the public API URL."""
        if self.GOOGLE_REDIRECT_URI:
            return self.GOOGLE_REDIRECT_URI
        return f"{self.API_BASE_URL.rstrip('/')}/v1/email/gmail/connect/callback"

    @model_validator(mode="after")
    def validate_deepseek_config(self) -> "Settings":
        reason = self.get_deepseek_key_invalid_reason()
        if self.ENVIRONMENT == "production" and reason is not None:
            raise ValueError(
                f"DEEPSEEK_API_KEY secret environment variable must be configured with a valid key in production ({reason})."
            )
        return self

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

@functools.lru_cache()
def get_settings() -> Settings:
    return Settings()


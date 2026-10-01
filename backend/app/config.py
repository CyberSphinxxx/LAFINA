import functools

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Generate default RSA key pair for development/testing if not provided via env
def _generate_dev_rsa_pair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )
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
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/lafina"
    # Optional Admin Account Seeding from Environment Variables
    ADMIN_EMAIL: str | None = None
    ADMIN_PASSWORD: str | None = None

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

    # Comma-separated browser origins allowed to call this API. Native Android
    # clients are not subject to CORS, so an empty value is the safe default.
    # A wildcard is never permitted: combined with credentials it would let any
    # website read authenticated responses on behalf of a signed-in student.
    CORS_ALLOWED_ORIGINS: str = ""

    # Security & Rate Limiting
    MAX_BODY_SIZE_BYTES: int = 1048576  # 1 MiB
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
    DEEPSEEK_TIMEOUT_SECONDS: float = 120.0

    # Gemini TTS Configuration
    GEMINI_API_KEY: SecretStr | None = None
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com"
    GEMINI_TTS_MODEL: str = "gemini-3.1-flash-tts-preview"
    GEMINI_TTS_VOICE: str = "Aoede"
    GEMINI_TTS_TIMEOUT_SECONDS: float = 20.0

    # Password blocklist (common passwords to reject)
    COMMON_PASSWORDS: set[str] = {
        "password",
        "password123",
        "1234567890",
        "12345678",
        "qwertyuiop",
        "administrator",
        "letmein123",
        "welcome123",
        "changeme123",
        "lafina12345",
    }

    @property
    def cors_allowed_origins(self) -> list[str]:
        """Parses CORS_ALLOWED_ORIGINS into a clean list of explicit origins."""
        return [origin.strip() for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]

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

    @model_validator(mode="after")
    def validate_deepseek_config(self) -> "Settings":
        reason = self.get_deepseek_key_invalid_reason()
        if self.ENVIRONMENT == "production" and reason is not None:
            raise ValueError(
                f"DEEPSEEK_API_KEY secret environment variable must be configured with a valid key in production ({reason})."
            )
        return self

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )


@functools.lru_cache
def get_settings() -> Settings:
    return Settings()

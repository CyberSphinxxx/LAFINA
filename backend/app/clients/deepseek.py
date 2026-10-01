import logging
import time

import httpx
from backend.app.config import Settings
from pydantic import BaseModel, Field

logger = logging.getLogger("lafina.deepseek")


class DeepSeekError(Exception):
    """Base exception for DeepSeek client errors."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class DeepSeekConfigError(DeepSeekError):
    """Missing or invalid API key configuration (503 Service Unavailable)."""

    def __init__(self, message: str = "DeepSeek API key is not configured or invalid."):
        super().__init__(message, status_code=503)


class DeepSeekAuthenticationError(DeepSeekError):
    """Upstream 401 Authentication Error (503 Service Unavailable)."""

    def __init__(self, message: str = "DeepSeek provider authentication failed."):
        super().__init__(message, status_code=503)


class DeepSeekBillingError(DeepSeekError):
    """Upstream 402 Insufficient Balance / Billing Error (503 Service Unavailable)."""

    def __init__(self, message: str = "DeepSeek provider billing is unavailable."):
        super().__init__(message, status_code=503)


class DeepSeekRateLimitError(DeepSeekError):
    """Upstream 429 Rate Limit Error (429 Too Many Requests)."""

    def __init__(self, message: str = "DeepSeek rate limit exceeded. Please try again later."):
        super().__init__(message, status_code=429)


class DeepSeekInvalidRequestError(DeepSeekError):
    """Upstream 400 or 422 Invalid Request Error (502 Bad Gateway)."""

    def __init__(self, message: str = "Invalid request sent to DeepSeek provider."):
        super().__init__(message, status_code=502)


class DeepSeekProviderServerError(DeepSeekError):
    """Upstream 500 or 503 Server Error (503 Service Unavailable)."""

    def __init__(self, message: str = "DeepSeek provider temporary outage."):
        super().__init__(message, status_code=503)


class DeepSeekTimeoutError(DeepSeekError):
    """Request timeout (504 Gateway Timeout)."""

    def __init__(self, message: str = "DeepSeek AI assistant request timed out."):
        super().__init__(message, status_code=504)


class DeepSeekMalformedResponseError(DeepSeekError):
    """Upstream payload malformed or missing choices/content (502 Bad Gateway)."""

    def __init__(self, message: str = "Received malformed response from DeepSeek provider."):
        super().__init__(message, status_code=502)


class DeepSeekTransportError(DeepSeekError):
    """Network connection or transport failure (503 Service Unavailable)."""

    def __init__(self, message: str = "Failed to communicate with DeepSeek AI proxy."):
        super().__init__(message, status_code=503)


class DeepSeekMessage(BaseModel):
    role: str
    content: str | None = None


class DeepSeekChoice(BaseModel):
    index: int = 0
    message: DeepSeekMessage
    finish_reason: str | None = None


class DeepSeekUsage(BaseModel):
    prompt_tokens: int = Field(default=0)
    completion_tokens: int = Field(default=0)
    total_tokens: int = Field(default=0)


class DeepSeekCompletionResponse(BaseModel):
    id: str | None = None
    object: str | None = None
    created: int | None = None
    model: str | None = None
    choices: list[DeepSeekChoice]
    usage: DeepSeekUsage | None = None


class DeepSeekClient:
    """
    Production DeepSeek API client wrapping httpx.AsyncClient connection pool.
    Handles authentication, payload formatting (non-thinking mode), typed response
    parsing, sanitization, and safe error status code mapping.
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self._custom_client = client
        self._client: httpx.AsyncClient | None = client

    async def start(self) -> None:
        if self._custom_client is not None:
            self._client = self._custom_client
        elif self._client is None:
            timeout = httpx.Timeout(self.settings.DEEPSEEK_TIMEOUT_SECONDS)
            self._client = httpx.AsyncClient(timeout=timeout)

    async def close(self) -> None:
        if self._custom_client is None and self._client is not None:
            await self._client.aclose()
            self._client = None

    async def chat_completion(
        self, messages: list[dict[str, str]], user_id: str, request_id: str = ""
    ) -> tuple[str, dict[str, int]]:
        """
        Executes chat completion request to DeepSeek API with non-thinking mode disabled.
        Returns (reply_content, usage_dict).
        """
        reason = self.settings.get_deepseek_key_invalid_reason()
        if reason is not None:
            logger.warning(
                f"DeepSeek call attempted without valid API key ({reason}) [requestId={request_id}]"
            )
            raise DeepSeekConfigError("DeepSeek API key is not configured.")

        if self._client is None:
            await self.start()

        assert self._client is not None, "AsyncClient must be initialized"

        raw_key = (
            self.settings.DEEPSEEK_API_KEY.get_secret_value().strip().strip("'\"")
            if self.settings.DEEPSEEK_API_KEY
            else ""
        )
        headers = {"Authorization": f"Bearer {raw_key}", "Content-Type": "application/json"}

        payload = {
            "model": self.settings.DEEPSEEK_MODEL,
            "messages": messages,
            "stream": False,
            "thinking": {"type": "disabled"},
            "max_tokens": 1024,
            "temperature": 0.7,
            "user": user_id,
        }

        url = f"{self.settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"
        start_time = time.monotonic()

        try:
            res = await self._client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.warning(
                f"DeepSeek request timed out after {duration_ms}ms [requestId={request_id}]"
            )
            raise DeepSeekTimeoutError()
        except httpx.RequestError as exc:
            duration_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                f"DeepSeek transport failure ({type(exc).__name__}) after {duration_ms}ms [requestId={request_id}]"
            )
            raise DeepSeekTransportError()

        duration_ms = int((time.monotonic() - start_time) * 1000)

        if res.status_code != 200:
            status_code = res.status_code
            logger.warning(
                f"DeepSeek upstream error HTTP {status_code} after {duration_ms}ms [requestId={request_id}]"
            )
            if status_code == 401:
                raise DeepSeekAuthenticationError()
            elif status_code == 402:
                raise DeepSeekBillingError()
            elif status_code == 429:
                raise DeepSeekRateLimitError()
            elif status_code in (400, 422):
                raise DeepSeekInvalidRequestError()
            elif status_code in (500, 503):
                raise DeepSeekProviderServerError()
            else:
                raise DeepSeekError(
                    message=f"DeepSeek provider returned error status {status_code}",
                    status_code=502,
                )

        try:
            data = res.json()
            parsed = DeepSeekCompletionResponse.model_validate(data)
        except Exception as parse_err:  # noqa: BLE001 - JSON and schema errors both degrade to one typed error
            logger.error(
                f"DeepSeek malformed JSON response ({type(parse_err).__name__}) [requestId={request_id}]"
            )
            raise DeepSeekMalformedResponseError()

        if not parsed.choices:
            logger.error(f"DeepSeek choices array empty [requestId={request_id}]")
            raise DeepSeekMalformedResponseError(
                "Received empty choice array from DeepSeek provider."
            )

        reply_content = parsed.choices[0].message.content
        if reply_content is None or reply_content.strip() == "":
            logger.error(f"DeepSeek message content null or empty [requestId={request_id}]")
            raise DeepSeekMalformedResponseError(
                "Received null or empty content from DeepSeek provider."
            )

        usage_dict = {
            "prompt_tokens": parsed.usage.prompt_tokens if parsed.usage else 0,
            "completion_tokens": parsed.usage.completion_tokens if parsed.usage else 0,
            "total_tokens": parsed.usage.total_tokens if parsed.usage else 0,
        }

        logger.info(
            f"DeepSeek request success: status=200, duration={duration_ms}ms, "
            f"model={self.settings.DEEPSEEK_MODEL}, prompt_tokens={usage_dict['prompt_tokens']}, "
            f"completion_tokens={usage_dict['completion_tokens']} [requestId={request_id}]"
        )

        return reply_content, usage_dict

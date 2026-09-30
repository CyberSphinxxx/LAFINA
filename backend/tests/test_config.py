from backend.app.config import Settings


def test_google_redirect_uri_defaults_to_public_api_url() -> None:
    """The Gmail callback should follow the deployed public API URL by default."""
    settings = Settings(
        ENVIRONMENT="development",
        API_BASE_URL="https://lafina.onrender.com/",
        GOOGLE_REDIRECT_URI=None,
        _env_file=None,
    )

    assert settings.get_google_redirect_uri() == (
        "https://lafina.onrender.com/v1/email/gmail/connect/callback"
    )


def test_google_redirect_uri_allows_an_explicit_override() -> None:
    """An explicit OAuth callback should take precedence over API_BASE_URL."""
    settings = Settings(
        ENVIRONMENT="development",
        API_BASE_URL="https://lafina.onrender.com",
        GOOGLE_REDIRECT_URI="https://example.com/oauth/callback",
        _env_file=None,
    )

    assert settings.get_google_redirect_uri() == "https://example.com/oauth/callback"

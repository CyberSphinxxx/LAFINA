import base64
import hashlib
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from backend.app.config import get_settings


def _get_encryption_key() -> bytes:
    """
    Derives a 256-bit AES-GCM key from configured secret or server secret.
    """
    settings = get_settings()
    if settings.GMAIL_TOKEN_ENCRYPTION_KEY is not None:
        raw_secret = settings.GMAIL_TOKEN_ENCRYPTION_KEY.get_secret_value().strip()
        if raw_secret:
            return hashlib.sha256(raw_secret.encode("utf-8")).digest()
    # Fallback to server secret key
    return hashlib.sha256(settings.JWT_PRIVATE_KEY.encode("utf-8")).digest()


def encrypt_token(plain_token: str) -> str:
    """
    Encrypts a token string with AES-256-GCM and returns a base64 string
    containing the 12-byte nonce prepended to the ciphertext.
    """
    if not plain_token:
        return ""
    key = _get_encryption_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plain_token.encode("utf-8"), None)
    payload = nonce + ciphertext
    return base64.b64encode(payload).decode("utf-8")


def decrypt_token(encrypted_payload: str) -> str:
    """
    Decrypts a base64 encoded AES-256-GCM payload.
    """
    if not encrypted_payload:
        return ""
    key = _get_encryption_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(encrypted_payload.encode("utf-8"))
    if len(raw) < 13:
        raise ValueError("Invalid encrypted payload length")
    nonce = raw[:12]
    ciphertext = raw[12:]
    decrypted = aesgcm.decrypt(nonce, ciphertext, None)
    return decrypted.decode("utf-8")

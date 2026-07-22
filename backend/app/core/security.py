import base64
import hashlib
import hmac
import json
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import Settings

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except Exception:
        return False


def create_access_token(subject: str, settings: Settings, expires_minutes: int = 480) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {"sub": subject, "iat": now, "exp": now + timedelta(minutes=expires_minutes)},
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def canonical_text(value: str) -> str:
    import unicodedata

    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def prompt_digest(value: str, settings: Settings) -> str:
    return hmac.new(
        settings.prompt_hmac_key.encode(), canonical_text(value).encode(), hashlib.sha256
    ).hexdigest()


def encrypted_review_payload(payload: dict[str, Any], settings: Settings) -> str:
    key = _aes_key(settings)
    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(key).encrypt(nonce, json.dumps(payload).encode(), b"ghst-review-v1")
    return base64.urlsafe_b64encode(nonce + encrypted).decode()


def decrypt_review_payload(value: str, settings: Settings) -> dict[str, Any]:
    data = base64.urlsafe_b64decode(value.encode())
    plain = AESGCM(_aes_key(settings)).decrypt(data[:12], data[12:], b"ghst-review-v1")
    return json.loads(plain)


def _aes_key(settings: Settings) -> bytes:
    if settings.review_encryption_key:
        try:
            key = base64.urlsafe_b64decode(settings.review_encryption_key)
            if len(key) == 32:
                return key
        except Exception:
            pass
    return hashlib.sha256(settings.jwt_secret.encode()).digest()


def _grant_keys(settings: Settings) -> tuple[Ed25519PrivateKey, Ed25519PublicKey]:
    if settings.grant_ed25519_private_key:
        private_bytes = base64.urlsafe_b64decode(settings.grant_ed25519_private_key)
        private_key = Ed25519PrivateKey.from_private_bytes(private_bytes)
        return private_key, private_key.public_key()
    seed = hashlib.sha256((settings.jwt_secret + ":grant").encode()).digest()
    private_key = Ed25519PrivateKey.from_private_bytes(seed)
    return private_key, private_key.public_key()


def issue_clearance(payload: dict[str, Any], settings: Settings) -> str:
    header = {"alg": "EdDSA", "typ": "GHST-GRANT", "kid": "ghst-demo-ed25519-v1"}
    encoded_header = _b64json(header)
    encoded_payload = _b64json(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode()
    signature = _grant_keys(settings)[0].sign(signing_input)
    return f"{encoded_header}.{encoded_payload}.{_b64(signature)}"


def verify_clearance(token: str, settings: Settings) -> dict[str, Any]:
    header, payload, signature = token.split(".")
    signing_input = f"{header}.{payload}".encode()
    _grant_keys(settings)[1].verify(_unb64(signature), signing_input)
    claims = json.loads(_unb64(payload))
    if claims["exp"] < int(datetime.now(UTC).timestamp()):
        raise ValueError("clearance grant has expired")
    return claims


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64json(value: dict[str, Any]) -> str:
    return _b64(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


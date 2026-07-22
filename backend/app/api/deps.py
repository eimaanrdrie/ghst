from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import decode_access_token
from app.db.models import User
from app.db.session import get_db

bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication is required.")
    try:
        claims = decode_access_token(credentials.credentials, settings)
        user = db.scalar(select(User).where(User.id == claims["sub"], User.status == "ACTIVE"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token.") from exc
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The signed identity is not active.")
    if not user.organisation_id or not user.department:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Trusted organisation and department claims are required.")
    return user


def require_roles(*allowed: str) -> Callable:
    def dependency(user: User = Depends(current_user)) -> User:
        if not set(user.roles).intersection(allowed):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This role is not authorised for the operation.")
        return user
    return dependency


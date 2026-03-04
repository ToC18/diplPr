from fastapi import Header, HTTPException
import jwt

from ...config import settings


def verify_token(authorization: str | None = Header(default=None)) -> None:
    if settings.auth_disabled:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        jwt.decode(token, settings.auth_jwt_secret, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

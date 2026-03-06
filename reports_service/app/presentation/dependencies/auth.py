from fastapi import Depends, Header, HTTPException
import jwt

from ...config import settings


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if settings.auth_disabled:
        return {"sub": "system", "role": "admin"}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.auth_jwt_secret, algorithms=["HS256"])
        return {"sub": payload.get("sub"), "role": payload.get("role", "operator")}
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def verify_token(authorization: str | None = Header(default=None)) -> None:
    get_current_user(authorization)


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user

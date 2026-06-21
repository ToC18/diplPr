from fastapi import Depends, Header, HTTPException
import jwt

from ...config import settings


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if settings.auth_disabled:
        return {"sub": "system", "role": "admin", "permissions": ["*"]}
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, settings.auth_jwt_secret, algorithms=["HS256"])
        permissions = payload.get("permissions", [])
        if isinstance(permissions, str):
            permissions = [x.strip() for x in permissions.split(",") if x.strip()]
        elif not isinstance(permissions, list):
            permissions = []
        return {"sub": payload.get("sub"), "role": payload.get("role", "operator"), "permissions": permissions}
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc


def verify_token(authorization: str | None = Header(default=None)) -> None:
    get_current_user(authorization)


def require_permission(permission: str):
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        permissions = user.get("permissions", [])
        if "*" not in permissions and permission not in permissions and "admin.panel" not in permissions:
            raise HTTPException(status_code=403, detail=f"Permission {permission} required")
        return user

    return dependency


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    permissions = user.get("permissions", [])
    if "*" not in permissions and "admin.panel" not in permissions:
        raise HTTPException(status_code=403, detail="Permission admin.panel required")
    return user

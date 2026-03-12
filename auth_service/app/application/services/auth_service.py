from datetime import datetime, timedelta
import hashlib

from fastapi import HTTPException
import jwt

from ...config import settings
from ...infrastructure.redis_client import redis_client

PERMISSION_CATALOG = [
    "dashboard.view",
    "events.view",
    "downtime.view",
    "reports.view",
    "admin.panel",
    "users.manage",
    "roles.manage",
    "equipment.manage",
]
PERMISSION_LABELS = {
    "dashboard.view": "Просмотр дашборда",
    "events.view": "Просмотр событий",
    "downtime.view": "Просмотр простоев",
    "reports.view": "Просмотр отчетов",
    "admin.panel": "Доступ в админку",
    "users.manage": "Управление пользователями",
    "roles.manage": "Управление ролями",
    "equipment.manage": "Управление оборудованием",
}


def _normalize_permissions(raw: str | list[str] | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        values = [x.strip() for x in raw.split(",") if x.strip()]
    else:
        values = [str(x).strip() for x in raw if str(x).strip()]
    seen = set()
    out: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _permissions_to_str(permissions: list[str]) -> str:
    return ",".join(_normalize_permissions(permissions))


def _role_key(role_name: str) -> str:
    return f"role:{role_name.strip().lower()}"


def _role_info(role_name: str) -> dict:
    ensure_default_roles()
    role = redis_client.hgetall(_role_key(role_name))
    if not role:
        return {"name": role_name.strip().lower(), "description": "", "permissions": []}
    return {
        "name": role.get("name", role_name.strip().lower()),
        "description": role.get("description", ""),
        "permissions": _normalize_permissions(role.get("permissions", "")),
    }


def _has_permission(actor: dict, permission: str) -> bool:
    permissions = _normalize_permissions(actor.get("permissions", []))
    return "*" in permissions or permission in permissions


def require_permission(authorization: str | None, permission: str) -> dict:
    actor = me_from_bearer(authorization)
    if not _has_permission(actor, permission):
        raise HTTPException(status_code=403, detail=f"Permission {permission} required")
    return actor


def make_access_token(username: str, role: str = "admin", permissions: list[str] | None = None) -> str:
    now = datetime.utcnow()
    normalized_permissions = _normalize_permissions(permissions or [])
    payload = {
        "sub": username,
        "role": role,
        "permissions": normalized_permissions,
        "iss": settings.auth_jwt_issuer,
        "aud": settings.auth_jwt_audience,
        "exp": now + timedelta(hours=8),
        "iat": now,
    }
    return jwt.encode(payload, settings.auth_jwt_secret, algorithm="HS256")


def make_refresh_token(username: str) -> str:
    now = datetime.utcnow()
    token = jwt.encode(
        {"sub": username, "exp": now + timedelta(days=7)},
        settings.auth_jwt_secret,
        algorithm="HS256",
    )
    redis_client.setex(f"refresh:{token}", timedelta(days=7), username)
    return token


def _password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _user_key(username: str) -> str:
    return f"user:{username.strip().lower()}"


def _get_user(username: str) -> dict:
    return redis_client.hgetall(_user_key(username))


def _save_user(username: str, password: str, role: str) -> None:
    redis_client.hset(
        _user_key(username),
        mapping={
            "username": username.strip().lower(),
            "password_hash": _password_hash(password),
            "role": role,
            "created_at": datetime.utcnow().isoformat(),
        },
    )


def ensure_default_roles() -> None:
    if redis_client.scard("roles") == 0:
        redis_client.sadd("roles", "admin", "operator")
        redis_client.hset(
            "role:admin",
            mapping={
                "name": "admin",
                "description": "Full access",
                "permissions": "*",
            },
        )
        redis_client.hset(
            "role:operator",
            mapping={
                "name": "operator",
                "description": "Dashboard access",
                "permissions": _permissions_to_str(
                    ["dashboard.view", "events.view", "downtime.view", "reports.view"]
                ),
            },
        )
    else:
        for name in redis_client.smembers("roles"):
            role_key = _role_key(name)
            if not redis_client.hget(role_key, "permissions"):
                default_permissions = "*" if name == "admin" else _permissions_to_str(
                    ["dashboard.view", "events.view", "downtime.view", "reports.view"]
                )
                redis_client.hset(role_key, "permissions", default_permissions)
    if not _get_user("admin"):
        _save_user("admin", "admin", "admin")


def login(username: str, password: str) -> dict:
    user = _get_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("password_hash") != _password_hash(password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    role = user.get("role", "operator")
    role_info = _role_info(role)
    permissions = role_info.get("permissions", [])
    return {
        "access_token": make_access_token(user.get("username", username), role=role, permissions=permissions),
        "refresh_token": make_refresh_token(user.get("username", username)),
        "token_type": "bearer",
        "role": role,
        "permissions": permissions,
    }


def register(username: str, password: str, role: str = "operator") -> dict:
    normalized = username.strip().lower()
    if len(normalized) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if _get_user(normalized):
        raise HTTPException(status_code=409, detail="User already exists")
    if role not in redis_client.smembers("roles"):
        raise HTTPException(status_code=400, detail="Unknown role")
    _save_user(normalized, password, role)
    return {"status": "ok", "username": normalized, "role": role}


def verify(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.auth_jwt_secret,
            algorithms=["HS256"],
            audience=settings.auth_jwt_audience,
            issuer=settings.auth_jwt_issuer,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    return {
        "valid": True,
        "sub": payload.get("sub"),
        "role": payload.get("role"),
        "permissions": _normalize_permissions(payload.get("permissions", [])),
    }


def me_from_bearer(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    return verify(token)


def list_users_for_admin(authorization: str | None) -> list[dict]:
    actor = me_from_bearer(authorization)
    if not _has_permission(actor, "users.manage"):
        raise HTTPException(status_code=403, detail="Permission users.manage required")

    users: list[dict] = []
    for key in redis_client.scan_iter(match="user:*"):
        row = redis_client.hgetall(key)
        if not row:
            continue
        users.append(
            {
                "username": row.get("username", key.replace("user:", "")),
                "role": row.get("role", "operator"),
                "created_at": row.get("created_at", ""),
            }
        )
    users.sort(key=lambda x: x.get("username", ""))
    return users


def refresh(refresh_token: str) -> dict:
    try:
        payload = jwt.decode(refresh_token, settings.auth_jwt_secret, algorithms=["HS256"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    key = f"refresh:{refresh_token}"
    if not redis_client.get(key):
        raise HTTPException(status_code=401, detail="Refresh token expired or revoked")

    user = _get_user(username)
    role = user.get("role", "operator") if user else "operator"
    role_info = _role_info(role)
    permissions = role_info.get("permissions", [])
    return {
        "access_token": make_access_token(username, role=role, permissions=permissions),
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": role,
        "permissions": permissions,
    }


def logout(refresh_token: str) -> dict:
    redis_client.delete(f"refresh:{refresh_token}")
    return {"status": "ok"}


def list_roles() -> list[dict]:
    ensure_default_roles()
    roles = []
    for name in sorted(redis_client.smembers("roles")):
        role = redis_client.hgetall(f"role:{name}")
        roles.append(
            {
                "name": role.get("name", name),
                "description": role.get("description", ""),
                "permissions": _normalize_permissions(role.get("permissions", "")),
            }
        )
    return roles


def create_role(name: str, description: str | None, permissions: list[str] | None = None) -> dict:
    role_name = name.strip().lower()
    if not role_name:
        raise HTTPException(status_code=400, detail="Role name is required")
    normalized_permissions = _normalize_permissions(permissions or [])
    invalid_permissions = [x for x in normalized_permissions if x != "*" and x not in PERMISSION_CATALOG]
    if invalid_permissions:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid_permissions)}")
    redis_client.sadd("roles", role_name)
    redis_client.hset(
        f"role:{role_name}",
        mapping={
            "name": role_name,
            "description": description or "",
            "permissions": _permissions_to_str(normalized_permissions),
        },
    )
    return {"status": "ok", "name": role_name, "permissions": normalized_permissions}


def update_role(role_name: str, description: str | None, permissions: list[str] | None = None) -> dict:
    normalized_role = role_name.strip().lower()
    if normalized_role == "admin":
        raise HTTPException(status_code=400, detail="Built-in role 'admin' cannot be changed")
    if normalized_role == "operator":
        raise HTTPException(status_code=400, detail="Built-in role 'operator' cannot be changed")
    if normalized_role not in redis_client.smembers("roles"):
        raise HTTPException(status_code=404, detail="Role not found")
    normalized_permissions = _normalize_permissions(permissions or [])
    invalid_permissions = [x for x in normalized_permissions if x != "*" and x not in PERMISSION_CATALOG]
    if invalid_permissions:
        raise HTTPException(status_code=400, detail=f"Unknown permissions: {', '.join(invalid_permissions)}")
    redis_client.hset(
        _role_key(normalized_role),
        mapping={
            "name": normalized_role,
            "description": description or "",
            "permissions": _permissions_to_str(normalized_permissions),
        },
    )
    return {"status": "ok", "name": normalized_role, "permissions": normalized_permissions}


def create_user_for_admin(authorization: str | None, username: str, password: str, role: str = "operator") -> dict:
    actor = me_from_bearer(authorization)
    if not _has_permission(actor, "users.manage"):
        raise HTTPException(status_code=403, detail="Permission users.manage required")
    return register(username, password, role)


def delete_user_for_admin(authorization: str | None, username: str) -> dict:
    actor = me_from_bearer(authorization)
    if not _has_permission(actor, "users.manage"):
        raise HTTPException(status_code=403, detail="Permission users.manage required")
    normalized = username.strip().lower()
    if normalized == "admin":
        raise HTTPException(status_code=400, detail="Built-in user 'admin' cannot be deleted")
    key = _user_key(normalized)
    if not redis_client.exists(key):
        raise HTTPException(status_code=404, detail="User not found")
    redis_client.delete(key)
    return {"status": "ok", "username": normalized}


def delete_role(role_name: str, authorization: str | None) -> dict:
    actor = me_from_bearer(authorization)
    if not _has_permission(actor, "roles.manage"):
        raise HTTPException(status_code=403, detail="Permission roles.manage required")
    normalized_role = role_name.strip().lower()
    if normalized_role in {"admin", "operator"}:
        raise HTTPException(status_code=400, detail="Built-in roles cannot be deleted")
    if normalized_role not in redis_client.smembers("roles"):
        raise HTTPException(status_code=404, detail="Role not found")
    for key in redis_client.scan_iter(match="user:*"):
        row = redis_client.hgetall(key)
        if row and row.get("role", "") == normalized_role:
            raise HTTPException(status_code=400, detail="Role is assigned to users")
    redis_client.srem("roles", normalized_role)
    redis_client.delete(_role_key(normalized_role))
    return {"status": "ok", "name": normalized_role}


def permission_catalog() -> list[dict]:
    return [{"code": code, "label": PERMISSION_LABELS.get(code, code)} for code in PERMISSION_CATALOG]

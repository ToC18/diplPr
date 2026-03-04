from datetime import datetime, timedelta
import hashlib

from fastapi import HTTPException
import jwt

from ...config import settings
from ...infrastructure.redis_client import redis_client


def make_access_token(username: str, role: str = "admin") -> str:
    now = datetime.utcnow()
    payload = {
        "sub": username,
        "role": role,
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
        redis_client.hset("role:admin", mapping={"name": "admin", "description": "Full access"})
        redis_client.hset("role:operator", mapping={"name": "operator", "description": "Dashboard access"})
    if not _get_user("admin"):
        _save_user("admin", "admin", "admin")


def login(username: str, password: str) -> dict:
    user = _get_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("password_hash") != _password_hash(password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    role = user.get("role", "operator")
    return {
        "access_token": make_access_token(user.get("username", username), role=role),
        "refresh_token": make_refresh_token(user.get("username", username)),
        "token_type": "bearer",
        "role": role,
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
    return {"valid": True, "sub": payload.get("sub"), "role": payload.get("role")}


def me_from_bearer(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    return verify(token)


def list_users_for_admin(authorization: str | None) -> list[dict]:
    actor = me_from_bearer(authorization)
    if actor.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

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
    return {
        "access_token": make_access_token(username, role=role),
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": role,
    }


def logout(refresh_token: str) -> dict:
    redis_client.delete(f"refresh:{refresh_token}")
    return {"status": "ok"}


def list_roles() -> list[dict]:
    ensure_default_roles()
    roles = []
    for name in sorted(redis_client.smembers("roles")):
        role = redis_client.hgetall(f"role:{name}")
        roles.append({"name": role.get("name", name), "description": role.get("description", "")})
    return roles


def create_role(name: str, description: str | None) -> dict:
    role_name = name.strip().lower()
    if not role_name:
        raise HTTPException(status_code=400, detail="Role name is required")
    redis_client.sadd("roles", role_name)
    redis_client.hset(
        f"role:{role_name}",
        mapping={"name": role_name, "description": description or ""},
    )
    return {"status": "ok", "name": role_name}

from datetime import datetime

from fastapi import APIRouter, Header

from ...application.services import auth_service
from ...domain.schemas import LoginIn, LogoutIn, RefreshIn, RegisterIn, RoleIn

router = APIRouter()


@router.on_event("startup")
def startup() -> None:
    auth_service.ensure_default_roles()


@router.post("/auth/login")
def login(data: LoginIn):
    return auth_service.login(data.username, data.password)


@router.post("/auth/register")
def register(data: RegisterIn):
    return auth_service.register(data.username, data.password, data.role)


@router.post("/auth/verify")
def verify(token: str):
    return auth_service.verify(token)


@router.post("/auth/refresh")
def refresh(data: RefreshIn):
    return auth_service.refresh(data.refresh_token)


@router.post("/auth/logout")
def logout(data: LogoutIn):
    return auth_service.logout(data.refresh_token)


@router.get("/auth/roles")
def list_roles():
    return auth_service.list_roles()


@router.post("/auth/roles")
def create_role(data: RoleIn):
    return auth_service.create_role(data.name, data.description)


@router.get("/auth/me")
def me(authorization: str | None = Header(default=None)):
    return auth_service.me_from_bearer(authorization)


@router.get("/auth/users")
def users(authorization: str | None = Header(default=None)):
    return auth_service.list_users_for_admin(authorization)


@router.get("/health")
def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}

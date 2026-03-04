from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class LogoutIn(BaseModel):
    refresh_token: str


class RoleIn(BaseModel):
    name: str
    description: str | None = None


class RegisterIn(BaseModel):
    username: str
    password: str
    role: str = "operator"

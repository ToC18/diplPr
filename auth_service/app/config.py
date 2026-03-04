from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    auth_jwt_secret: str = "devsecret"
    auth_jwt_issuer: str = "asmon"
    auth_jwt_audience: str = "asmon"
    redis_url: str = "redis://localhost:6379/0"


settings = Settings()

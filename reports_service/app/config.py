from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    events_db_url: str = "postgresql+psycopg2://events:events@localhost:5432/events"
    admin_db_url: str = "postgresql+psycopg2://admin:admin@localhost:5432/admin"
    downtime_db_url: str = "postgresql+psycopg2://downtime:downtime@localhost:5432/downtime"
    auth_jwt_secret: str = "devsecret"
    auth_disabled: bool = True


settings = Settings()

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://events:events@localhost:5432/events"
    rabbit_url: str = "amqp://guest:guest@localhost:5672/"
    auth_jwt_secret: str = "devsecret"
    auth_disabled: bool = True


settings = Settings()

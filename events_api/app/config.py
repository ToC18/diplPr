from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://events:events@localhost:5432/events"
    rabbit_url: str = "amqp://guest:guest@localhost:5672/"
    writer_queue_name: str = "equipment_events_writer"
    telegram_queue_name: str = "equipment_events_telegram"
    auth_jwt_secret: str = "devsecret"
    auth_disabled: bool = True


settings = Settings()

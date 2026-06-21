import os


class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://events:events@localhost:5432/events",
    )
    rabbit_url: str = os.getenv("RABBIT_URL", "amqp://guest:guest@localhost:5672/")
    queue_name: str = os.getenv("EVENT_WRITER_QUEUE_NAME", "equipment_events_writer")


settings = Settings()

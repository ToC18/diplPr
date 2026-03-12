import os


def env_or_default(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value and value.strip() else default


class Settings:
    rabbit_url = env_or_default("RABBIT_URL", "amqp://guest:guest@rabbitmq:5672/")
    telegram_bot_token = env_or_default("TELEGRAM_BOT_TOKEN", "")
    telegram_chat_id = env_or_default("TELEGRAM_CHAT_ID", "")
    alert_statuses = {
        s.strip().upper()
        for s in env_or_default("TELEGRAM_ALERT_STATUSES", "ALARM,STOP").split(",")
        if s.strip()
    }
    queue_name = env_or_default("TELEGRAM_QUEUE_NAME", "equipment_events")


settings = Settings()

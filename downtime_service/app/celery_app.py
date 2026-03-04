from celery import Celery
from .config import settings

celery_app = Celery(
    "downtime_service",
    broker=settings.rabbit_url,
    backend="rpc://",
)

celery_app.conf.imports = ("app.tasks",)

celery_app.conf.beat_schedule = {
    "process-events": {
        "task": "app.tasks.process_events",
        "schedule": 5.0,
    },
    "availability-check": {
        "task": "app.tasks.availability_check",
        "schedule": 30.0,
    },
}

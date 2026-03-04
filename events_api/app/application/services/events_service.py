from ...infrastructure.messaging.publisher import publish_event
from ...infrastructure.repositories import events_repository
from ...schemas import EventIn


def receive_event(event: EventIn) -> dict:
    publish_event(event)
    return {"status": "ok"}


def recent_events(limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    return events_repository.list_recent(safe_limit)


def events_by_equipment(equipment_id: str, limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 1000))
    return events_repository.list_by_equipment(equipment_id, safe_limit)


def event_stats() -> dict:
    return events_repository.get_stats()

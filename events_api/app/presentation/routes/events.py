from datetime import datetime

from fastapi import APIRouter, Depends

from ...application.services import events_service
from ..dependencies.auth import verify_token
from ...schemas import EventIn

router = APIRouter()


@router.post("/events/")
def receive_event(event: EventIn, _=Depends(verify_token)):
    return events_service.receive_event(event)


@router.get("/events/recent")
def recent_events(limit: int = 50, _=Depends(verify_token)):
    return events_service.recent_events(limit)


@router.get("/events/by-equipment/{equipment_id}")
def events_by_equipment(equipment_id: str, limit: int = 200, _=Depends(verify_token)):
    return events_service.events_by_equipment(equipment_id, limit)


@router.get("/events/stats")
def event_stats(_=Depends(verify_token)):
    return events_service.event_stats()


@router.get("/health")
def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}

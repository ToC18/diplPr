from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ...application.services import downtime_service
from ...database import engine_admin, engine_downtime, engine_events
from ..dependencies.auth import verify_token

router = APIRouter()


@router.post("/downtime/recompute")
def recompute(_=Depends(verify_token)):
    return downtime_service.recompute()


@router.post("/downtime/check-availability")
def check_availability(_=Depends(verify_token)):
    return downtime_service.check_availability()


@router.get("/downtime/state/{equipment_id}")
def equipment_state(equipment_id: str, _=Depends(verify_token)):
    return downtime_service.equipment_state(equipment_id)


@router.get("/health")
def health():
    with engine_events.begin() as conn:
        conn.execute(text("SELECT 1"))
    with engine_admin.begin() as conn:
        conn.execute(text("SELECT 1"))
    with engine_downtime.begin() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}

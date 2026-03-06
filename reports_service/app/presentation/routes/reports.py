from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from fastapi.responses import PlainTextResponse, StreamingResponse

from ...application.services import reports_service
from ..dependencies.auth import require_admin, verify_token

router = APIRouter()


class ManualDowntimeIn(BaseModel):
    equipment_id: str
    status: str = "STOP"
    start_ts: datetime
    end_ts: datetime | None = None
    note: str | None = None


class ResolveManualDowntimeIn(BaseModel):
    equipment_id: str
    note: str | None = None


@router.get("/reports/downtime")
def get_downtime(
    equipment_id: str | None = None,
    status: str | None = None,
    limit: int | None = None,
    _=Depends(verify_token),
):
    return reports_service.get_downtime(equipment_id, status, limit)


@router.get("/reports/events")
def get_events(
    equipment_id: str | None = None,
    status: str | None = None,
    limit: int | None = None,
    _=Depends(verify_token),
):
    return reports_service.get_events(equipment_id, status, limit)


@router.get("/reports/equipment")
def get_equipment(
    search: str | None = None,
    eq_type: str | None = Query(default=None, alias="type"),
    protocol: str | None = None,
    _=Depends(verify_token),
):
    return reports_service.get_equipment(search, eq_type, protocol)


@router.get("/reports/summary")
def report_summary(_=Depends(verify_token)):
    return reports_service.get_summary()


@router.get("/reports/status-distribution")
def status_distribution(_=Depends(verify_token)):
    return reports_service.get_status_distribution()


@router.get("/reports/timeline/{equipment_id}")
def equipment_timeline(equipment_id: str, limit: int | None = None, _=Depends(verify_token)):
    return reports_service.get_timeline(equipment_id, limit)


@router.get("/reports/shift-summary")
def shift_summary(_=Depends(verify_token)):
    return reports_service.get_shift_summary()


@router.get("/reports/events/export")
def export_events(_=Depends(verify_token)):
    return PlainTextResponse(reports_service.export_events_csv(), media_type="text/csv")


@router.get("/reports/downtime/export")
def export_downtime(_=Depends(verify_token)):
    return PlainTextResponse(reports_service.export_downtime_csv(), media_type="text/csv")


@router.get("/reports/events/stream")
async def stream_events(limit: int = 25, _=Depends(verify_token)):
    return StreamingResponse(reports_service.stream_events_payload(limit), media_type="text/event-stream")


@router.get("/reports/equipment-state")
def equipment_state(_=Depends(verify_token)):
    return reports_service.get_equipment_state()


@router.get("/reports/equipment-live")
def equipment_live(online_threshold_sec: int | None = None, _=Depends(verify_token)):
    return reports_service.get_equipment_live(online_threshold_sec)


@router.get("/reports/downtime/current")
def current_downtime(limit: int | None = None, _=Depends(verify_token)):
    return reports_service.get_current_downtime(limit)


@router.post("/reports/downtime/manual")
def create_manual_downtime(
    payload: ManualDowntimeIn,
    user=Depends(require_admin),
):
    return reports_service.create_manual_downtime(
        equipment_id=payload.equipment_id,
        status=payload.status,
        start_ts=payload.start_ts,
        end_ts=payload.end_ts,
        note=payload.note,
        created_by=user.get("sub"),
    )


@router.post("/reports/downtime/manual/resolve")
def resolve_manual_downtime(
    payload: ResolveManualDowntimeIn,
    user=Depends(require_admin),
):
    return reports_service.resolve_manual_downtime(
        equipment_id=payload.equipment_id,
        note=payload.note,
        created_by=user.get("sub"),
    )


@router.get("/health")
def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}

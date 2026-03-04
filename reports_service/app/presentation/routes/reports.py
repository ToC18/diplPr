from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse, StreamingResponse

from ...application.services import reports_service
from ..dependencies.auth import verify_token

router = APIRouter()


@router.get("/reports/downtime")
def get_downtime(
    equipment_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
    _=Depends(verify_token),
):
    return reports_service.get_downtime(equipment_id, status, limit)


@router.get("/reports/events")
def get_events(
    equipment_id: str | None = None,
    status: str | None = None,
    limit: int = 200,
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
def equipment_timeline(equipment_id: str, limit: int = 100, _=Depends(verify_token)):
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


@router.get("/health")
def health():
    return {"status": "ok", "ts": datetime.utcnow().isoformat()}

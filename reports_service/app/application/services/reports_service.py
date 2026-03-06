import asyncio
import json
from datetime import datetime

from ...infrastructure.repositories import reports_repository


def _normalize_limit(limit: int | None) -> int | None:
    if limit is None:
        return None
    return None if limit <= 0 else limit


def get_downtime(equipment_id: str | None, status: str | None, limit: int | None) -> list[dict]:
    return reports_repository.get_downtime(equipment_id, status, _normalize_limit(limit))


def get_events(equipment_id: str | None, status: str | None, limit: int | None) -> list[dict]:
    return reports_repository.get_events(equipment_id, status, _normalize_limit(limit))


def get_equipment(search: str | None, eq_type: str | None, protocol: str | None) -> list[dict]:
    return reports_repository.get_equipment(search, eq_type, protocol)


def get_summary() -> dict:
    total_events, total_equipment, open_intervals = reports_repository.get_summary()
    return {
        "total_events": total_events,
        "total_equipment": total_equipment,
        "open_intervals": open_intervals,
        "ts": datetime.utcnow().isoformat(),
    }


def get_status_distribution() -> list[dict]:
    return reports_repository.get_status_distribution()


def get_timeline(equipment_id: str, limit: int | None) -> list[dict]:
    return reports_repository.get_timeline(equipment_id, _normalize_limit(limit))


def get_shift_summary() -> list[dict]:
    return reports_repository.get_shift_summary()


def export_events_csv() -> str:
    rows = reports_repository.get_events_export_rows()
    csv = ["equipment_id,status,ts"]
    for row in rows:
        csv.append(f"{row['equipment_id']},{row['status']},{row['ts']}")
    return "\n".join(csv)


def export_downtime_csv() -> str:
    rows = reports_repository.get_downtime_export_rows()
    csv = ["equipment_id,status,start_ts,end_ts,source,note,created_by"]
    for row in rows:
        csv.append(
            f"{row['equipment_id']},{row['status']},{row['start_ts']},{row['end_ts']},"
            f"{row.get('source','')},{row.get('note','')},{row.get('created_by','')}"
        )
    return "\n".join(csv)


async def stream_events_payload(limit: int):
    safe_limit = max(1, min(limit, 100))
    last_key = ""
    while True:
        try:
            payload = reports_repository.get_stream_events(safe_limit)

            newest_key = ""
            if payload:
                newest = payload[0]
                newest_key = f"{newest.get('equipment_id','')}|{newest.get('status','')}|{newest.get('ts','')}"
            if newest_key and newest_key != last_key:
                last_key = newest_key
                yield "event: events\n"
                yield f"data: {json.dumps(payload, default=str)}\n\n"
        except Exception:
            yield "event: error\ndata: stream_error\n\n"

        await asyncio.sleep(2)


def get_equipment_state() -> list[dict]:
    return reports_repository.get_equipment_state()


def get_equipment_live(online_threshold_sec: int | None) -> list[dict]:
    threshold = 120 if online_threshold_sec is None else max(10, int(online_threshold_sec))
    return reports_repository.get_equipment_live(threshold)


def get_current_downtime(limit: int | None) -> list[dict]:
    return reports_repository.get_current_downtime(_normalize_limit(limit))


def create_manual_downtime(
    equipment_id: str,
    status: str,
    start_ts: datetime,
    end_ts: datetime | None,
    note: str | None,
    created_by: str | None,
) -> dict:
    safe_status = (status or "").strip().upper()
    if safe_status not in {"STOP", "ALARM", "OFFLINE", "IDLE", "RUN"}:
        safe_status = "STOP"
    return reports_repository.create_manual_downtime(
        equipment_id=equipment_id.strip(),
        status=safe_status,
        start_ts=start_ts,
        end_ts=end_ts,
        note=(note or "").strip() or None,
        created_by=(created_by or "").strip() or None,
    )


def resolve_manual_downtime(
    equipment_id: str,
    note: str | None,
    created_by: str | None,
) -> dict:
    return reports_repository.resolve_manual_downtime(
        equipment_id=equipment_id.strip(),
        note=(note or "").strip() or None,
        created_by=(created_by or "").strip() or None,
    )

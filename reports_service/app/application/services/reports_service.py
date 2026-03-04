import asyncio
import json
from datetime import datetime

from ...infrastructure.repositories import reports_repository


def get_downtime(equipment_id: str | None, status: str | None, limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 1000))
    return reports_repository.get_downtime(equipment_id, status, safe_limit)


def get_events(equipment_id: str | None, status: str | None, limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 1000))
    return reports_repository.get_events(equipment_id, status, safe_limit)


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


def get_timeline(equipment_id: str, limit: int) -> list[dict]:
    safe_limit = max(1, min(limit, 500))
    return reports_repository.get_timeline(equipment_id, safe_limit)


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
    csv = ["equipment_id,status,start_ts,end_ts"]
    for row in rows:
        csv.append(f"{row['equipment_id']},{row['status']},{row['start_ts']},{row['end_ts']}")
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

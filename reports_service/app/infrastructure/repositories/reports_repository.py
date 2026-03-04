from sqlalchemy import text

from ...database import engine_admin, engine_downtime, engine_events


def get_downtime(equipment_id: str | None, status: str | None, limit: int) -> list[dict]:
    query = """
        SELECT equipment_id, status, start_ts, end_ts
        FROM downtime_intervals
        WHERE (:equipment_id IS NULL OR equipment_id = :equipment_id)
          AND (:status IS NULL OR status = :status)
        ORDER BY start_ts DESC
        LIMIT :limit
    """
    with engine_downtime.begin() as conn:
        rows = conn.execute(
            text(query),
            {"equipment_id": equipment_id, "status": status, "limit": limit},
        )
        return [dict(row._mapping) for row in rows]


def get_events(equipment_id: str | None, status: str | None, limit: int) -> list[dict]:
    query = """
        SELECT equipment_id, status, ts
        FROM events
        WHERE (:equipment_id IS NULL OR equipment_id = :equipment_id)
          AND (:status IS NULL OR status = :status)
        ORDER BY ts DESC
        LIMIT :limit
    """
    with engine_events.begin() as conn:
        rows = conn.execute(
            text(query),
            {"equipment_id": equipment_id, "status": status, "limit": limit},
        )
        return [dict(row._mapping) for row in rows]


def get_equipment(search: str | None, eq_type: str | None, protocol: str | None) -> list[dict]:
    query = """
        SELECT equipment_id, name, type, protocol
        FROM admin_app_equipment
        WHERE (:search IS NULL OR equipment_id ILIKE :search_like OR name ILIKE :search_like)
          AND (:eq_type IS NULL OR type = :eq_type)
          AND (:protocol IS NULL OR protocol = :protocol)
        ORDER BY equipment_id
    """
    with engine_admin.begin() as conn:
        rows = conn.execute(
            text(query),
            {
                "search": search,
                "search_like": f"%{search}%" if search else None,
                "eq_type": eq_type,
                "protocol": protocol,
            },
        )
        return [dict(row._mapping) for row in rows]


def get_summary() -> tuple[int, int, int]:
    with engine_events.begin() as ev, engine_downtime.begin() as dt, engine_admin.begin() as ad:
        total_events = ev.execute(text("SELECT COUNT(*) FROM events")).scalar_one()
        total_equipment = ad.execute(text("SELECT COUNT(*) FROM admin_app_equipment")).scalar_one()
        open_intervals = dt.execute(
            text("SELECT COUNT(*) FROM downtime_intervals WHERE end_ts IS NULL")
        ).scalar_one()
        return total_events, total_equipment, open_intervals


def get_status_distribution() -> list[dict]:
    with engine_events.begin() as conn:
        rows = conn.execute(
            text("SELECT status, COUNT(*) AS count FROM events GROUP BY status ORDER BY count DESC")
        )
        return [dict(row._mapping) for row in rows]


def get_timeline(equipment_id: str, limit: int) -> list[dict]:
    with engine_downtime.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT equipment_id, status, start_ts, end_ts
                FROM downtime_intervals
                WHERE equipment_id = :equipment_id
                ORDER BY start_ts DESC
                LIMIT :limit
                """
            ),
            {"equipment_id": equipment_id, "limit": limit},
        )
        return [dict(row._mapping) for row in rows]


def get_shift_summary() -> list[dict]:
    with engine_events.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                  CASE
                    WHEN EXTRACT(HOUR FROM ts) >= 8 AND EXTRACT(HOUR FROM ts) < 16 THEN 'Shift A (08:00-16:00)'
                    WHEN EXTRACT(HOUR FROM ts) >= 16 AND EXTRACT(HOUR FROM ts) < 24 THEN 'Shift B (16:00-00:00)'
                    ELSE 'Shift C (00:00-08:00)'
                  END AS shift_name,
                  COUNT(*) AS events_count
                FROM events
                GROUP BY shift_name
                ORDER BY shift_name
                """
            )
        )
        return [dict(row._mapping) for row in rows]


def get_events_export_rows() -> list[dict]:
    with engine_events.begin() as conn:
        rows = conn.execute(
            text("SELECT equipment_id, status, ts FROM events ORDER BY ts DESC LIMIT 1000")
        )
        return [dict(row._mapping) for row in rows]


def get_downtime_export_rows() -> list[dict]:
    with engine_downtime.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT equipment_id, status, start_ts, end_ts
                FROM downtime_intervals
                ORDER BY start_ts DESC
                LIMIT 1000
                """
            )
        )
        return [dict(row._mapping) for row in rows]


def get_stream_events(limit: int) -> list[dict]:
    with engine_events.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT equipment_id, status, ts
                FROM events
                ORDER BY ts DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        )
        return [dict(row._mapping) for row in rows]

from datetime import datetime

from sqlalchemy import text

from ...database import engine_admin, engine_downtime, engine_events


def ensure_downtime_schema() -> None:
    with engine_downtime.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS downtime_intervals (
                    id SERIAL PRIMARY KEY,
                    equipment_id VARCHAR(64) NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    start_ts TIMESTAMP NOT NULL,
                    end_ts TIMESTAMP,
                    source VARCHAR(16) NOT NULL DEFAULT 'auto',
                    note TEXT,
                    created_by VARCHAR(64)
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS equipment_state (
                    id SERIAL PRIMARY KEY,
                    equipment_id VARCHAR(64) UNIQUE NOT NULL,
                    last_status VARCHAR(32) NOT NULL,
                    last_ts TIMESTAMP NOT NULL
                )
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE IF EXISTS downtime_intervals
                ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'auto'
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE IF EXISTS downtime_intervals
                ADD COLUMN IF NOT EXISTS note TEXT
                """
            )
        )
        conn.execute(
            text(
                """
                ALTER TABLE IF EXISTS downtime_intervals
                ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)
                """
            )
        )


def get_downtime(equipment_id: str | None, status: str | None, limit: int | None) -> list[dict]:
    ensure_downtime_schema()
    query = """
        SELECT equipment_id, status, start_ts, end_ts, source, note, created_by
        FROM downtime_intervals
        WHERE (:equipment_id IS NULL OR equipment_id = :equipment_id)
          AND (:status IS NULL OR status = :status)
        ORDER BY start_ts DESC
    """
    params = {"equipment_id": equipment_id, "status": status}
    if limit is not None:
        query += "\nLIMIT :limit"
        params["limit"] = limit
    with engine_downtime.begin() as conn:
        rows = conn.execute(text(query), params)
        return [dict(row._mapping) for row in rows]


def get_events(equipment_id: str | None, status: str | None, limit: int | None) -> list[dict]:
    ensure_downtime_schema()
    query = """
        SELECT
            equipment_id,
            status,
            start_ts AS ts,
            start_ts,
            end_ts,
            GREATEST(
                0,
                ROUND(EXTRACT(EPOCH FROM (COALESCE(end_ts, NOW()) - start_ts)) / 60.0)
            )::INT AS downtime_minutes,
            source,
            note,
            created_by
        FROM downtime_intervals
        WHERE (:equipment_id IS NULL OR equipment_id = :equipment_id)
          AND (:status IS NULL OR status = :status)
        ORDER BY start_ts DESC
    """
    params = {"equipment_id": equipment_id, "status": status}
    if limit is not None:
        query += "\nLIMIT :limit"
        params["limit"] = limit
    with engine_downtime.begin() as conn:
        rows = conn.execute(text(query), params)
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


def get_timeline(equipment_id: str, limit: int | None) -> list[dict]:
    ensure_downtime_schema()
    query = """
        SELECT equipment_id, status, start_ts, end_ts, source, note, created_by
        FROM downtime_intervals
        WHERE equipment_id = :equipment_id
        ORDER BY start_ts DESC
    """
    params = {"equipment_id": equipment_id}
    if limit is not None:
        query += "\nLIMIT :limit"
        params["limit"] = limit
    with engine_downtime.begin() as conn:
        rows = conn.execute(text(query), params)
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
    ensure_downtime_schema()
    with engine_downtime.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT equipment_id, status, start_ts, end_ts, source, note, created_by
                FROM downtime_intervals
                ORDER BY start_ts DESC
                LIMIT 1000
                """
            )
        )
        return [dict(row._mapping) for row in rows]


def get_equipment_state() -> list[dict]:
    with engine_downtime.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT equipment_id, last_status, last_ts
                FROM equipment_state
                ORDER BY equipment_id
                """
            )
        )
        return [dict(row._mapping) for row in rows]


def get_equipment_live(online_threshold_sec: int = 120) -> list[dict]:
    with engine_admin.begin() as ad_conn, engine_events.begin() as ev_conn:
        equipment_rows = ad_conn.execute(
            text(
                """
                SELECT equipment_id, name
                FROM admin_app_equipment
                ORDER BY equipment_id
                """
            )
        ).mappings().all()

        last_rows = ev_conn.execute(
            text(
                """
                SELECT equipment_id, MAX(ts) AS last_seen
                FROM events
                GROUP BY equipment_id
                """
            )
        ).mappings().all()

    last_map = {row["equipment_id"]: row["last_seen"] for row in last_rows}
    result: list[dict] = []
    for eq in equipment_rows:
        eq_id = eq["equipment_id"]
        last_seen = last_map.get(eq_id)
        if last_seen is None:
            age_sec = None
            live = "NO_DATA"
        else:
            age_sec = max(0, int((datetime.utcnow() - last_seen).total_seconds()))
            live = "ONLINE" if age_sec <= online_threshold_sec else "STALE"
        result.append(
            {
                "equipment_id": eq_id,
                "name": eq["name"],
                "last_seen": last_seen,
                "age_sec": age_sec,
                "live": live,
            }
        )
    return result


def get_current_downtime(limit: int | None) -> list[dict]:
    ensure_downtime_schema()
    query = """
        SELECT equipment_id, status, start_ts, end_ts, source, note, created_by
        FROM downtime_intervals
        WHERE end_ts IS NULL
          AND status IN ('STOP', 'ALARM', 'OFFLINE', 'IDLE')
        ORDER BY start_ts DESC
    """
    params = {}
    if limit is not None:
        query += "\nLIMIT :limit"
        params["limit"] = limit
    with engine_downtime.begin() as conn:
        rows = conn.execute(text(query), params)
        return [dict(row._mapping) for row in rows]


def create_manual_downtime(
    equipment_id: str,
    status: str,
    start_ts,
    end_ts,
    note: str | None,
    created_by: str | None,
) -> dict:
    ensure_downtime_schema()
    with engine_downtime.begin() as conn:
        conn.execute(
            text(
                """
                UPDATE downtime_intervals
                SET end_ts = :start_ts
                WHERE equipment_id = :eid AND end_ts IS NULL
                """
            ),
            {"start_ts": start_ts, "eid": equipment_id},
        )
        row = conn.execute(
            text(
                """
                INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source, note, created_by)
                VALUES (:eid, :st, :start_ts, :end_ts, 'manual', :note, :created_by)
                RETURNING id, equipment_id, status, start_ts, end_ts, source, note, created_by
                """
            ),
            {
                "eid": equipment_id,
                "st": status,
                "start_ts": start_ts,
                "end_ts": end_ts,
                "note": note,
                "created_by": created_by,
            },
        ).mappings().one()
        conn.execute(
            text(
                """
                INSERT INTO equipment_state (equipment_id, last_status, last_ts)
                VALUES (:eid, :st, :ts)
                ON CONFLICT (equipment_id)
                DO UPDATE SET last_status = EXCLUDED.last_status, last_ts = EXCLUDED.last_ts
                """
            ),
            {"eid": equipment_id, "st": status, "ts": end_ts or start_ts},
        )
        return dict(row)


def resolve_manual_downtime(
    equipment_id: str,
    note: str | None,
    created_by: str | None,
) -> dict:
    ensure_downtime_schema()
    with engine_downtime.begin() as conn:
        now_row = conn.execute(text("SELECT NOW() AS now_ts")).mappings().one()
        now_ts = now_row["now_ts"]

        closed_count = conn.execute(
            text(
                """
                UPDATE downtime_intervals
                SET end_ts = :now_ts
                WHERE equipment_id = :eid
                  AND end_ts IS NULL
                  AND source = 'manual'
                """
            ),
            {"now_ts": now_ts, "eid": equipment_id},
        ).rowcount

        run_row = conn.execute(
            text(
                """
                INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source, note, created_by)
                VALUES (:eid, 'RUN', :now_ts, NULL, 'manual', :note, :created_by)
                RETURNING id, equipment_id, status, start_ts, end_ts, source, note, created_by
                """
            ),
            {
                "eid": equipment_id,
                "now_ts": now_ts,
                "note": note,
                "created_by": created_by,
            },
        ).mappings().one()

        conn.execute(
            text(
                """
                INSERT INTO equipment_state (equipment_id, last_status, last_ts)
                VALUES (:eid, 'RUN', :now_ts)
                ON CONFLICT (equipment_id)
                DO UPDATE SET last_status = EXCLUDED.last_status, last_ts = EXCLUDED.last_ts
                """
            ),
            {"eid": equipment_id, "now_ts": now_ts},
        )
        return {"closed_manual_count": int(closed_count or 0), "run_interval": dict(run_row)}


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

from datetime import datetime, time, timedelta

from sqlalchemy import text

from .celery_app import celery_app
from .config import settings
from .database import engine_admin, engine_downtime, engine_events
from .schema import ensure_runtime_schema


def split_interval_by_day(start_ts: datetime, end_ts: datetime) -> list[tuple[datetime, datetime]]:
    if end_ts <= start_ts:
        return [(start_ts, start_ts)]

    segments: list[tuple[datetime, datetime]] = []
    cursor = start_ts
    while cursor.date() < end_ts.date():
        next_midnight = datetime.combine(cursor.date() + timedelta(days=1), time.min)
        day_end = next_midnight - timedelta(microseconds=1)
        segments.append((cursor, day_end))
        cursor = next_midnight
    segments.append((cursor, end_ts))
    return segments


def plan_gap_transition(
    last_status: str | None,
    last_ts: datetime | None,
    next_ts: datetime,
    timeout_sec: int,
) -> dict[str, datetime] | None:
    if not last_status or last_ts is None:
        return None

    offline_start = last_ts + timedelta(seconds=max(1, int(timeout_sec)))
    if next_ts <= offline_start:
        return None

    return {
        "close_previous_at": offline_start,
        "offline_start": offline_start,
        "offline_end": next_ts,
    }


def _load_timeout_map() -> dict[str, int]:
    with engine_admin.begin() as admin_conn:
        rows = admin_conn.execute(
            text("SELECT equipment_id, COALESCE(timeout_sec, 60) FROM admin_app_equipment")
        )
        return {equipment_id: int(timeout_sec) for equipment_id, timeout_sec in rows}


def _upsert_equipment_state(dt_conn, equipment_id: str, status: str, ts: datetime) -> None:
    dt_conn.execute(
        text(
            """
            INSERT INTO equipment_state (equipment_id, last_status, last_ts)
            VALUES (:eid, :st, :ts)
            ON CONFLICT (equipment_id)
            DO UPDATE SET last_status = EXCLUDED.last_status, last_ts = EXCLUDED.last_ts
            """
        ),
        {"eid": equipment_id, "st": status, "ts": ts},
    )


def _insert_interval(
    dt_conn,
    equipment_id: str,
    status: str,
    start_ts: datetime,
    end_ts: datetime | None,
    source: str = "auto",
    note: str | None = None,
    created_by: str | None = None,
) -> None:
    dt_conn.execute(
        text(
            """
            INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source, note, created_by)
            VALUES (:eid, :st, :start_ts, :end_ts, :source, :note, :created_by)
            """
        ),
        {
            "eid": equipment_id,
            "st": status,
            "start_ts": start_ts,
            "end_ts": end_ts,
            "source": source,
            "note": note,
            "created_by": created_by,
        },
    )


def _insert_closed_interval_segments(
    dt_conn,
    equipment_id: str,
    status: str,
    start_ts: datetime,
    end_ts: datetime,
    source: str = "auto",
    note: str | None = None,
    created_by: str | None = None,
) -> None:
    for segment_start, segment_end in split_interval_by_day(start_ts, end_ts):
        _insert_interval(
            dt_conn,
            equipment_id=equipment_id,
            status=status,
            start_ts=segment_start,
            end_ts=segment_end,
            source=source,
            note=note,
            created_by=created_by,
        )


def _close_open_interval(dt_conn, equipment_id: str, close_ts: datetime) -> None:
    open_interval = dt_conn.execute(
        text(
            """
            SELECT id, equipment_id, status, start_ts, source, note, created_by
            FROM downtime_intervals
            WHERE equipment_id = :eid AND end_ts IS NULL
            ORDER BY start_ts DESC
            LIMIT 1
            """
        ),
        {"eid": equipment_id},
    ).mappings().fetchone()

    if open_interval is None:
        return

    safe_close_ts = max(close_ts, open_interval["start_ts"])
    segments = split_interval_by_day(open_interval["start_ts"], safe_close_ts)
    first_start, first_end = segments[0]
    dt_conn.execute(
        text("UPDATE downtime_intervals SET start_ts = :start_ts, end_ts = :end_ts WHERE id = :id"),
        {"id": open_interval["id"], "start_ts": first_start, "end_ts": first_end},
    )

    for segment_start, segment_end in segments[1:]:
        _insert_interval(
            dt_conn,
            equipment_id=open_interval["equipment_id"],
            status=open_interval["status"],
            start_ts=segment_start,
            end_ts=segment_end,
            source=open_interval["source"],
            note=open_interval["note"],
            created_by=open_interval["created_by"],
        )


@celery_app.task(name="app.tasks.process_events")
def process_events():
    ensure_runtime_schema()
    with engine_downtime.begin() as dt_conn:
        last_event_id = dt_conn.execute(
            text("SELECT last_event_id FROM processing_state WHERE id = 1")
        ).scalar_one()

    # Self-heal when source events were truncated/reset and ids restarted.
    with engine_events.begin() as ev_conn, engine_downtime.begin() as dt_conn:
        max_source_event_id = ev_conn.execute(
            text("SELECT COALESCE(MAX(id), 0) FROM events")
        ).scalar_one()
        if last_event_id > max_source_event_id:
            dt_conn.execute(text("TRUNCATE TABLE downtime_intervals RESTART IDENTITY"))
            dt_conn.execute(text("TRUNCATE TABLE equipment_state RESTART IDENTITY"))
            dt_conn.execute(
                text("UPDATE processing_state SET last_event_id = 0 WHERE id = 1")
            )
            last_event_id = 0

    max_event_id = last_event_id
    timeout_by_equipment = _load_timeout_map()
    with engine_events.begin() as ev_conn, engine_downtime.begin() as dt_conn:
        rows = ev_conn.execute(
            text(
                """
                SELECT id, equipment_id, status, ts
                FROM events
                WHERE id > :last_event_id
                ORDER BY id ASC
                """
            ),
            {"last_event_id": last_event_id},
        )

        for event_id, equipment_id, status, ts in rows:
            max_event_id = event_id
            manual_open = dt_conn.execute(
                text(
                    """
                    SELECT 1
                    FROM downtime_intervals
                    WHERE equipment_id = :eid AND end_ts IS NULL AND source = 'manual'
                    LIMIT 1
                    """
                ),
                {"eid": equipment_id},
            ).fetchone()

            # While manual downtime is open:
            # - ignore non-RUN auto events
            # - on RUN, close open intervals and write explicit RUN transition
            if manual_open:
                if status != "RUN":
                    continue
                _close_open_interval(dt_conn, equipment_id, ts)
                _insert_interval(dt_conn, equipment_id, "RUN", ts, None, "auto")
                _upsert_equipment_state(dt_conn, equipment_id, "RUN", ts)
                continue

            state = dt_conn.execute(
                text("SELECT last_status, last_ts FROM equipment_state WHERE equipment_id = :eid"),
                {"eid": equipment_id},
            ).fetchone()
            timeout_sec = timeout_by_equipment.get(equipment_id, 60)
            force_insert = False

            if state is not None:
                last_status, last_ts = state
                gap_plan = plan_gap_transition(last_status, last_ts, ts, timeout_sec)
                if gap_plan is not None:
                    if last_status != "OFFLINE":
                        _close_open_interval(dt_conn, equipment_id, gap_plan["close_previous_at"])
                        _insert_closed_interval_segments(
                            dt_conn,
                            equipment_id=equipment_id,
                            status="OFFLINE",
                            start_ts=gap_plan["offline_start"],
                            end_ts=gap_plan["offline_end"],
                            source="auto",
                        )
                    else:
                        _close_open_interval(dt_conn, equipment_id, gap_plan["offline_end"])
                    state = ("OFFLINE", gap_plan["offline_end"])
                    force_insert = True

            if state is None:
                _upsert_equipment_state(dt_conn, equipment_id, status, ts)
                _insert_interval(dt_conn, equipment_id, status, ts, None, "auto")
                continue

            last_status, _ = state
            if force_insert or status != last_status:
                _close_open_interval(dt_conn, equipment_id, ts)
                _insert_interval(dt_conn, equipment_id, status, ts, None, "auto")

            _upsert_equipment_state(dt_conn, equipment_id, status, ts)

        if max_event_id > last_event_id:
            dt_conn.execute(
                text("UPDATE processing_state SET last_event_id = :eid WHERE id = 1"),
                {"eid": max_event_id},
            )


@celery_app.task(name="app.tasks.availability_check")
def availability_check():
    if not settings.enable_offline_check:
        return

    with engine_admin.begin() as admin_conn, engine_downtime.begin() as dt_conn:
        equipment_rows = admin_conn.execute(text("SELECT equipment_id, COALESCE(timeout_sec, 60) FROM admin_app_equipment"))
        now = datetime.utcnow()
        for equipment_id, timeout_sec in equipment_rows:
            state = dt_conn.execute(
                text("SELECT last_status, last_ts FROM equipment_state WHERE equipment_id = :eid"),
                {"eid": equipment_id},
            ).fetchone()
            if state is None:
                continue
            last_status, last_ts = state
            if last_ts is None:
                continue
            gap_plan = plan_gap_transition(last_status, last_ts, now, timeout_sec)
            if gap_plan is None or last_status == "OFFLINE":
                continue
            _close_open_interval(dt_conn, equipment_id, gap_plan["close_previous_at"])
            _insert_interval(dt_conn, equipment_id, "OFFLINE", gap_plan["offline_start"], None, "auto")
            _upsert_equipment_state(dt_conn, equipment_id, "OFFLINE", gap_plan["offline_start"])

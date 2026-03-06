from datetime import datetime, timedelta

from sqlalchemy import text

from .celery_app import celery_app
from .config import settings
from .database import engine_admin, engine_downtime, engine_events


@celery_app.task(name="app.tasks.process_events")
def process_events():
    with engine_downtime.begin() as dt_conn:
        dt_conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS equipment_state (
                id SERIAL PRIMARY KEY,
                equipment_id VARCHAR(64) UNIQUE NOT NULL,
                last_status VARCHAR(32) NOT NULL,
                last_ts TIMESTAMP NOT NULL
            )
            """
        )
        dt_conn.exec_driver_sql(
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
        dt_conn.exec_driver_sql(
            """
            ALTER TABLE IF EXISTS downtime_intervals
            ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'auto'
            """
        )
        dt_conn.exec_driver_sql(
            """
            ALTER TABLE IF EXISTS downtime_intervals
            ADD COLUMN IF NOT EXISTS note TEXT
            """
        )
        dt_conn.exec_driver_sql(
            """
            ALTER TABLE IF EXISTS downtime_intervals
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)
            """
        )
        dt_conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS processing_state (
                id INTEGER PRIMARY KEY,
                last_event_id BIGINT NOT NULL DEFAULT 0
            )
            """
        )
        dt_conn.exec_driver_sql(
            """
            INSERT INTO processing_state (id, last_event_id)
            VALUES (1, 0)
            ON CONFLICT (id) DO NOTHING
            """
        )

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
                dt_conn.execute(
                    text(
                        """
                        UPDATE downtime_intervals
                        SET end_ts = :ts
                        WHERE equipment_id = :eid AND end_ts IS NULL
                        """
                    ),
                    {"ts": ts, "eid": equipment_id},
                )
                dt_conn.execute(
                    text(
                        """
                        INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source)
                        VALUES (:eid, 'RUN', :ts, NULL, 'auto')
                        """
                    ),
                    {"eid": equipment_id, "ts": ts},
                )
                dt_conn.execute(
                    text(
                        """
                        INSERT INTO equipment_state (equipment_id, last_status, last_ts)
                        VALUES (:eid, 'RUN', :ts)
                        ON CONFLICT (equipment_id)
                        DO UPDATE SET last_status = EXCLUDED.last_status, last_ts = EXCLUDED.last_ts
                        """
                    ),
                    {"eid": equipment_id, "ts": ts},
                )
                continue

            state = dt_conn.execute(
                text("SELECT last_status, last_ts FROM equipment_state WHERE equipment_id = :eid"),
                {"eid": equipment_id},
            ).fetchone()

            if state is None:
                dt_conn.execute(
                    text(
                        """
                        INSERT INTO equipment_state (equipment_id, last_status, last_ts)
                        VALUES (:eid, :st, :ts)
                        """
                    ),
                    {"eid": equipment_id, "st": status, "ts": ts},
                )
                dt_conn.execute(
                    text(
                        """
                        INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source)
                        VALUES (:eid, :st, :ts, NULL, 'auto')
                        """
                    ),
                    {"eid": equipment_id, "st": status, "ts": ts},
                )
                continue

            last_status, _ = state
            if status != last_status:
                dt_conn.execute(
                    text(
                        """
                        UPDATE downtime_intervals
                        SET end_ts = :ts
                        WHERE equipment_id = :eid AND end_ts IS NULL
                        """
                    ),
                    {"ts": ts, "eid": equipment_id},
                )
                dt_conn.execute(
                    text(
                        """
                        INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source)
                        VALUES (:eid, :st, :ts, NULL, 'auto')
                        """
                    ),
                    {"eid": equipment_id, "st": status, "ts": ts},
                )

            dt_conn.execute(
                text(
                    """
                    UPDATE equipment_state
                    SET last_status = :st, last_ts = :ts
                    WHERE equipment_id = :eid
                    """
                ),
                {"eid": equipment_id, "st": status, "ts": ts},
            )

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
            if now - last_ts > timedelta(seconds=timeout_sec):
                if last_status != "OFFLINE":
                    dt_conn.execute(
                        text("UPDATE downtime_intervals SET end_ts = :ts WHERE equipment_id = :eid AND end_ts IS NULL"),
                        {"ts": now, "eid": equipment_id},
                    )
                    dt_conn.execute(
                        text("INSERT INTO downtime_intervals (equipment_id, status, start_ts, end_ts, source) VALUES (:eid, 'OFFLINE', :ts, NULL, 'auto')"),
                        {"eid": equipment_id, "ts": now},
                    )
                    dt_conn.execute(
                        text("UPDATE equipment_state SET last_status = 'OFFLINE', last_ts = :ts WHERE equipment_id = :eid"),
                        {"ts": now, "eid": equipment_id},
                    )

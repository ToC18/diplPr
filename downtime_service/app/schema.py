from sqlalchemy import text

from . import models  # noqa: F401
from .database import BaseDowntime, engine_downtime


def ensure_runtime_schema() -> None:
    with engine_downtime.begin() as conn:
        BaseDowntime.metadata.create_all(bind=conn)
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
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS processing_state (
                    id INTEGER PRIMARY KEY,
                    last_event_id BIGINT NOT NULL DEFAULT 0
                )
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO processing_state (id, last_event_id)
                VALUES (1, 0)
                ON CONFLICT (id) DO NOTHING
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE INDEX IF NOT EXISTS ix_dt_equipment_start
                ON downtime_intervals (equipment_id, start_ts)
                """
            )
        )

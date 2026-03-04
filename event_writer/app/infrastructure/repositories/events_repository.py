import json
from datetime import datetime

from sqlalchemy import create_engine

from ...config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)


def insert_event(payload: dict) -> None:
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            INSERT INTO events (equipment_id, status, ts, payload)
            VALUES (%s, %s, %s, %s)
            """,
            (
                payload.get("equipment_id"),
                payload.get("status"),
                payload.get("ts", datetime.utcnow().isoformat()),
                json.dumps(payload.get("payload")),
            ),
        )

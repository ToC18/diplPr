from sqlalchemy import text

from ...database import engine_downtime


def get_equipment_state(equipment_id: str):
    with engine_downtime.begin() as conn:
        return conn.execute(
            text("SELECT equipment_id, last_status, last_ts FROM equipment_state WHERE equipment_id = :eid"),
            {"eid": equipment_id},
        ).fetchone()

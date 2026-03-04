from sqlalchemy import text

from ...database import engine


def list_recent(limit: int) -> list[dict]:
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, equipment_id, status, ts, payload FROM events ORDER BY id DESC LIMIT :limit"),
            {"limit": limit},
        )
        return [dict(row._mapping) for row in rows]


def list_by_equipment(equipment_id: str, limit: int) -> list[dict]:
    with engine.begin() as conn:
        rows = conn.execute(
            text(
                """
                SELECT id, equipment_id, status, ts, payload
                FROM events
                WHERE equipment_id = :equipment_id
                ORDER BY id DESC
                LIMIT :limit
                """
            ),
            {"equipment_id": equipment_id, "limit": limit},
        )
        return [dict(row._mapping) for row in rows]


def get_stats() -> dict:
    with engine.begin() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM events")).scalar_one()
        by_status = conn.execute(
            text("SELECT status, COUNT(*) AS cnt FROM events GROUP BY status ORDER BY cnt DESC")
        )
        by_equipment = conn.execute(
            text(
                """
                SELECT equipment_id, COUNT(*) AS cnt
                FROM events
                GROUP BY equipment_id
                ORDER BY cnt DESC
                LIMIT 20
                """
            )
        )
        return {
            "total": total,
            "by_status": [dict(row._mapping) for row in by_status],
            "top_equipment": [dict(row._mapping) for row in by_equipment],
        }

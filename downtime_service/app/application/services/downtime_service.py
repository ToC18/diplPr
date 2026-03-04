from fastapi import HTTPException

from ...celery_app import celery_app
from ...infrastructure.repositories.state_repository import get_equipment_state


def recompute() -> dict:
    task = celery_app.send_task("app.tasks.process_events")
    return {"status": "queued", "task_id": task.id}


def check_availability() -> dict:
    task = celery_app.send_task("app.tasks.availability_check")
    return {"status": "queued", "task_id": task.id}


def equipment_state(equipment_id: str) -> dict:
    row = get_equipment_state(equipment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Equipment state not found")
    return dict(row._mapping)

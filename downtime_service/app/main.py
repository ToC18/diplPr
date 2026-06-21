import time

from fastapi import FastAPI
from sqlalchemy import text

from .database import engine_admin, engine_downtime, engine_events
from .presentation.routes.downtime import router as downtime_router
from .schema import ensure_runtime_schema

app = FastAPI(title="Downtime Service")
app.include_router(downtime_router)


def init_runtime_with_retry(retries: int = 30, delay_sec: int = 2) -> None:
    for attempt in range(1, retries + 1):
        try:
            with engine_events.begin() as conn:
                conn.execute(text("SELECT 1"))
            with engine_admin.begin() as conn:
                conn.execute(text("SELECT 1"))
            with engine_downtime.begin() as conn:
                conn.execute(text("SELECT 1"))
            ensure_runtime_schema()
            return
        except Exception as exc:
            if attempt == retries:
                raise
            print(f"downtime_service: init failed (attempt {attempt}/{retries}): {exc}")
            time.sleep(delay_sec)


@app.on_event("startup")
def startup() -> None:
    init_runtime_with_retry()

import time

from fastapi import FastAPI

from .database import engine
from .models import Base
from .presentation.routes.events import router as events_router

app = FastAPI(title='Events API')
app.include_router(events_router)


def init_db_with_retry(retries: int = 30, delay_sec: int = 2) -> None:
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except Exception as exc:
            if attempt == retries:
                raise
            print(f'events_api: db init failed (attempt {attempt}/{retries}): {exc}')
            time.sleep(delay_sec)


@app.on_event('startup')
def startup() -> None:
    init_db_with_retry()

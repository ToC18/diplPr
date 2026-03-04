from fastapi import FastAPI

from .presentation.routes.downtime import router as downtime_router

app = FastAPI(title='Downtime Service')
app.include_router(downtime_router)

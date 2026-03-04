from fastapi import FastAPI

from .presentation.routes.reports import router as reports_router

app = FastAPI(title='Reports API')
app.include_router(reports_router)

from pydantic import BaseModel
from datetime import datetime
from typing import Any, Optional


class EventIn(BaseModel):
    equipment_id: str
    status: str
    ts: datetime
    payload: Optional[Any] = None

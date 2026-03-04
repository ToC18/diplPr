from sqlalchemy import Column, Integer, String, DateTime, JSON, Index
from .database import Base


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True)
    equipment_id = Column(String(64), index=True, nullable=False)
    status = Column(String(32), nullable=False)
    ts = Column(DateTime, nullable=False)
    payload = Column(JSON, nullable=True)


Index("ix_events_equipment_ts", Event.equipment_id, Event.ts)

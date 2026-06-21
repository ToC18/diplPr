from sqlalchemy import Column, DateTime, Index, Integer, String, Text

from .database import BaseDowntime


class DowntimeInterval(BaseDowntime):
    __tablename__ = "downtime_intervals"

    id = Column(Integer, primary_key=True)
    equipment_id = Column(String(64), index=True, nullable=False)
    status = Column(String(32), nullable=False)
    start_ts = Column(DateTime, nullable=False)
    end_ts = Column(DateTime, nullable=True)
    source = Column(String(16), nullable=False, default="auto")
    note = Column(Text, nullable=True)
    created_by = Column(String(64), nullable=True)


class EquipmentState(BaseDowntime):
    __tablename__ = "equipment_state"

    id = Column(Integer, primary_key=True)
    equipment_id = Column(String(64), unique=True, nullable=False)
    last_status = Column(String(32), nullable=False)
    last_ts = Column(DateTime, nullable=False)


class ProcessingState(BaseDowntime):
    __tablename__ = "processing_state"

    id = Column(Integer, primary_key=True)
    last_event_id = Column(Integer, nullable=False, default=0)


Index("ix_dt_equipment_start", DowntimeInterval.equipment_id, DowntimeInterval.start_ts)

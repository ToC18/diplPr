from sqlalchemy import Column, Integer, String, DateTime, Index
from .database import BaseDowntime


class DowntimeInterval(BaseDowntime):
    __tablename__ = "downtime_intervals"

    id = Column(Integer, primary_key=True)
    equipment_id = Column(String(64), index=True, nullable=False)
    status = Column(String(32), nullable=False)
    start_ts = Column(DateTime, nullable=False)
    end_ts = Column(DateTime, nullable=True)


class EquipmentState(BaseDowntime):
    __tablename__ = "equipment_state"

    id = Column(Integer, primary_key=True)
    equipment_id = Column(String(64), unique=True, nullable=False)
    last_status = Column(String(32), nullable=False)
    last_ts = Column(DateTime, nullable=False)


Index("ix_dt_equipment_start", DowntimeInterval.equipment_id, DowntimeInterval.start_ts)

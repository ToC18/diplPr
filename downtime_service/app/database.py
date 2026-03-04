from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .config import settings

engine_events = create_engine(settings.events_db_url, pool_pre_ping=True)
engine_admin = create_engine(settings.admin_db_url, pool_pre_ping=True)
engine_downtime = create_engine(settings.downtime_db_url, pool_pre_ping=True)

SessionEvents = sessionmaker(bind=engine_events)
SessionAdmin = sessionmaker(bind=engine_admin)
SessionDowntime = sessionmaker(bind=engine_downtime)

BaseDowntime = declarative_base()

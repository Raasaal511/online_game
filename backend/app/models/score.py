from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Float, DateTime

from app.database import Base


class Score(Base):
    __tablename__ = "scores"

    id = Column(Integer, primary_key=True, index=True)
    nickname = Column(String(32), nullable=False)
    lifetime_seconds = Column(Float, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

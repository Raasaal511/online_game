from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ScoreOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    nickname: str
    lifetime_seconds: float
    created_at: datetime

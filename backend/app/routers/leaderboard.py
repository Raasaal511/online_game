from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.score import Score
from app.schemas.score import ScoreOut

router = APIRouter(prefix="/api", tags=["leaderboard"])


@router.get("/leaderboard", response_model=list[ScoreOut])
def get_leaderboard(db: Session = Depends(get_db)):
    return (
        db.query(Score)
        .order_by(Score.lifetime_seconds.desc())
        .limit(3)
        .all()
    )

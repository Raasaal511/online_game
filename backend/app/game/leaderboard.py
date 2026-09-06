from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.score import Score

TOP_N = 3


def query_leaderboard(db: Session) -> list[dict]:
    # топ-3 по УНИКАЛЬНЫМ никам (лучший заход каждого игрока), а не по
    # отдельным строкам "scores" — иначе один игрок, сыгравший несколько
    # раз подряд, мог занять сразу все 3 места в таблице лидеров
    best_per_nick = (
        db.query(
            Score.nickname,
            func.max(Score.kills).label("best_kills"),
        )
        .group_by(Score.nickname)
        .subquery()
    )
    # для одинакового best_kills берём заход с наибольшим lifetime как тай-брейк
    rows = (
        db.query(Score)
        .join(
            best_per_nick,
            (Score.nickname == best_per_nick.c.nickname)
            & (Score.kills == best_per_nick.c.best_kills),
        )
        .order_by(Score.kills.desc(), Score.lifetime_seconds.desc())
        .all()
    )
    seen: set[str] = set()
    top: list[dict] = []
    for s in rows:
        if s.nickname in seen:
            continue
        seen.add(s.nickname)
        top.append(
            {"nickname": s.nickname, "kills": s.kills, "lifetime_seconds": s.lifetime_seconds}
        )
        if len(top) >= TOP_N:
            break
    return top


def save_score(nickname: str, kills: int, lifetime: float) -> bool:
    db: Session = SessionLocal()
    try:
        db.add(Score(nickname=nickname, kills=kills, lifetime_seconds=lifetime))
        db.commit()
        top = query_leaderboard(db)
        return any(s["nickname"] == nickname and s["kills"] == kills for s in top)
    finally:
        db.close()


def get_leaderboard() -> list[dict]:
    db: Session = SessionLocal()
    try:
        return query_leaderboard(db)
    finally:
        db.close()

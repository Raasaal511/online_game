import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import score  # noqa: F401 — регистрирует модель перед create_all
from app.routers import leaderboard, ws

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Dodge Game API")

origins = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leaderboard.router)
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}

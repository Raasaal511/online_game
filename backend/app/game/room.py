import asyncio
import math
import random
import time

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.score import Score
from app.game.entities import Player, Projectile

FIELD_WIDTH = 900
FIELD_HEIGHT = 600
TICK_RATE = 30
DT = 1.0 / TICK_RATE

PROJECTILE_SIZE = 22
INITIAL_PROJECTILE_SPEED = 120.0
MAX_PROJECTILE_SPEED = 420.0
SPEED_RAMP_PER_SEC = 4.0  # скорость снарядов растёт со временем игры комнаты

SPAWN_INTERVAL_START = 2.5  # сек между спавнами в начале
SPAWN_INTERVAL_MIN = 0.6
SPAWN_RAMP_PER_SEC = 0.01  # насколько быстрее спавн со временем

MAX_PROJECTILES = 10
PROJECTILES_PER_PLAYER = 2  # лимит также растёт с числом живых игроков, но не выше MAX_PROJECTILES

TOP_N = 3


class GameRoom:
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}
        self.projectiles: dict[str, Projectile] = {}
        self.connections: dict[str, WebSocket] = {}
        self.started_at = time.monotonic()
        self._last_spawn = 0.0
        self._spawn_interval = SPAWN_INTERVAL_START
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run_loop())

    async def _run_loop(self) -> None:
        while True:
            await asyncio.sleep(DT)
            async with self._lock:
                self._tick()
            await self._broadcast_state()

    def _elapsed(self) -> float:
        return time.monotonic() - self.started_at

    def _tick(self) -> None:
        elapsed = self._elapsed()

        # спавн снарядов (лимит зависит от числа живых игроков, но не больше MAX_PROJECTILES)
        self._spawn_interval = max(
            SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_START - elapsed * SPAWN_RAMP_PER_SEC
        )
        live_players = sum(1 for p in self.players.values() if p.alive) or 1
        projectile_limit = min(MAX_PROJECTILES, live_players * PROJECTILES_PER_PLAYER)

        # если игроков стало меньше, лишние снаряды постепенно убираем
        while len(self.projectiles) > projectile_limit:
            oldest_id = next(iter(self.projectiles))
            del self.projectiles[oldest_id]

        if (
            elapsed - self._last_spawn >= self._spawn_interval
            and len(self.projectiles) < projectile_limit
        ):
            self._last_spawn = elapsed
            self._spawn_projectile(elapsed)

        # движение игроков
        for player in self.players.values():
            if not player.alive:
                continue
            norm = math.hypot(player.dir_x, player.dir_y) or 1.0
            dx = player.dir_x / norm
            dy = player.dir_y / norm
            player.x = clamp(
                player.x + dx * player.speed * DT, player.size / 2, FIELD_WIDTH - player.size / 2
            )
            player.y = clamp(
                player.y + dy * player.speed * DT, player.size / 2, FIELD_HEIGHT - player.size / 2
            )

        # движение и отскок снарядов
        for proj in self.projectiles.values():
            proj.x += proj.vx * DT
            proj.y += proj.vy * DT

            half = proj.size / 2
            if proj.x - half <= 0:
                proj.x = half
                proj.vx *= -1
            elif proj.x + half >= FIELD_WIDTH:
                proj.x = FIELD_WIDTH - half
                proj.vx *= -1

            if proj.y - half <= 0:
                proj.y = half
                proj.vy *= -1
            elif proj.y + half >= FIELD_HEIGHT:
                proj.y = FIELD_HEIGHT - half
                proj.vy *= -1

        # коллизии игрок-снаряд
        for player in self.players.values():
            if not player.alive:
                continue
            for proj in self.projectiles.values():
                if aabb_collides(player, proj):
                    self._kill_player(player)
                    break

    def _spawn_projectile(self, elapsed: float) -> None:
        speed = min(MAX_PROJECTILE_SPEED, INITIAL_PROJECTILE_SPEED + elapsed * SPEED_RAMP_PER_SEC)
        angle = random.uniform(0, 2 * math.pi)
        vx = math.cos(angle) * speed
        vy = math.sin(angle) * speed

        # спавним по краю поля, чтобы не появляться прямо на игроке
        edge = random.choice(["top", "bottom", "left", "right"])
        if edge == "top":
            x, y = random.uniform(0, FIELD_WIDTH), PROJECTILE_SIZE
        elif edge == "bottom":
            x, y = random.uniform(0, FIELD_WIDTH), FIELD_HEIGHT - PROJECTILE_SIZE
        elif edge == "left":
            x, y = PROJECTILE_SIZE, random.uniform(0, FIELD_HEIGHT)
        else:
            x, y = FIELD_WIDTH - PROJECTILE_SIZE, random.uniform(0, FIELD_HEIGHT)

        proj = Projectile.new(x, y, vx, vy, PROJECTILE_SIZE)
        self.projectiles[proj.id] = proj

    def _kill_player(self, player: Player) -> None:
        player.alive = False
        player.died_at = time.monotonic()
        asyncio.create_task(self._handle_death(player))

    async def _handle_death(self, player: Player) -> None:
        lifetime = player.lifetime()
        is_new_record = self._save_score(player.nickname, lifetime)
        leaderboard = self.get_leaderboard()
        ws = self.connections.get(player.id)
        if ws is not None:
            try:
                await ws.send_json(
                    {
                        "type": "death",
                        "lifetime_seconds": lifetime,
                        "is_new_record": is_new_record,
                        "leaderboard": leaderboard,
                    }
                )
            except Exception:
                pass

    def _save_score(self, nickname: str, lifetime: float) -> bool:
        db: Session = SessionLocal()
        try:
            db.add(Score(nickname=nickname, lifetime_seconds=lifetime))
            db.commit()
            top = (
                db.query(Score)
                .order_by(Score.lifetime_seconds.desc())
                .limit(TOP_N)
                .all()
            )
            return any(s.nickname == nickname and s.lifetime_seconds == lifetime for s in top)
        finally:
            db.close()

    def get_leaderboard(self) -> list[dict]:
        db: Session = SessionLocal()
        try:
            top = (
                db.query(Score)
                .order_by(Score.lifetime_seconds.desc())
                .limit(TOP_N)
                .all()
            )
            return [
                {"nickname": s.nickname, "lifetime_seconds": s.lifetime_seconds}
                for s in top
            ]
        finally:
            db.close()

    async def _broadcast_state(self) -> None:
        if not self.connections:
            return
        payload = {
            "type": "state",
            "players": [
                {
                    "id": p.id,
                    "nickname": p.nickname,
                    "x": round(p.x, 1),
                    "y": round(p.y, 1),
                    "alive": p.alive,
                    "lifetime": p.lifetime(),
                }
                for p in self.players.values()
            ],
            "projectiles": [
                {"id": pr.id, "x": round(pr.x, 1), "y": round(pr.y, 1), "size": pr.size}
                for pr in self.projectiles.values()
            ],
            "field": {"width": FIELD_WIDTH, "height": FIELD_HEIGHT},
        }
        dead_connections = []
        for pid, ws in self.connections.items():
            try:
                await ws.send_json(payload)
            except Exception:
                dead_connections.append(pid)
        for pid in dead_connections:
            self.remove_player(pid)

    async def add_player(self, nickname: str, ws: WebSocket) -> Player:
        async with self._lock:
            x = random.uniform(50, FIELD_WIDTH - 50)
            y = random.uniform(50, FIELD_HEIGHT - 50)
            player = Player.new(nickname[:16] or "Player", x, y)
            self.players[player.id] = player
            self.connections[player.id] = ws
            return player

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        self.connections.pop(player_id, None)

    def set_input(self, player_id: str, dir_x: float, dir_y: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.dir_x = clamp(dir_x, -1, 1)
            player.dir_y = clamp(dir_y, -1, 1)

    def respawn_player(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None:
            return
        x = random.uniform(50, FIELD_WIDTH - 50)
        y = random.uniform(50, FIELD_HEIGHT - 50)
        player.x, player.y = x, y
        player.dir_x, player.dir_y = 0.0, 0.0
        player.alive = True
        player.died_at = None
        player.joined_at = time.monotonic()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def aabb_collides(player: Player, proj: Projectile) -> bool:
    return (
        abs(player.x - proj.x) < (player.size + proj.size) / 2
        and abs(player.y - proj.y) < (player.size + proj.size) / 2
    )


game_room = GameRoom()

import asyncio
import math
import random
import time

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.score import Score
from app.game.entities import Player, Bullet, Pickup, FIRE_COOLDOWN
from app.game.map import FIELD_WIDTH, FIELD_HEIGHT, WALLS, SPAWN_POINTS

TICK_RATE = 30
DT = 1.0 / TICK_RATE

MAX_PLAYERS = 10

PICKUP_MAX_COUNT = 5
PICKUP_SPAWN_INTERVAL = 8.0
PICKUP_KINDS = ["heal", "armor", "damage"]
ARMOR_DURATION = 12.0
ARMOR_REDUCTION = 0.5  # снижение получаемого урона на 50%
DAMAGE_BOOST_DURATION = 12.0
DAMAGE_BOOST_MULT = 1.5

RESPAWN_DELAY = 2.0  # сек до респавна после смерти

TOP_N = 3


class GameRoom:
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}
        self.bullets: dict[str, Bullet] = {}
        self.pickups: dict[str, Pickup] = {}
        self.connections: dict[str, WebSocket] = {}
        self.started_at = time.monotonic()
        self._last_pickup_spawn = 0.0
        self._pending_respawns: dict[str, float] = {}  # player_id -> respawn_at
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

    def is_full(self) -> bool:
        return len(self.players) >= MAX_PLAYERS

    def _tick(self) -> None:
        now = time.monotonic()
        elapsed = self._elapsed()

        self._spawn_pickups(elapsed)
        self._process_respawns(now)
        self._move_players()
        self._move_bullets()
        self._check_bullet_collisions()
        self._check_pickup_collisions()

    def _move_players(self) -> None:
        for player in self.players.values():
            if not player.alive:
                continue
            norm = math.hypot(player.dir_x, player.dir_y) or 1.0
            dx = player.dir_x / norm
            dy = player.dir_y / norm
            new_x = player.x + dx * player.speed * DT
            new_y = player.y + dy * player.speed * DT

            half = player.size / 2
            new_x = clamp(new_x, half, FIELD_WIDTH - half)
            new_y = clamp(new_y, half, FIELD_HEIGHT - half)

            if not rect_intersects_walls(new_x, player.y, player.size):
                player.x = new_x
            if not rect_intersects_walls(player.x, new_y, player.size):
                player.y = new_y

    def _move_bullets(self) -> None:
        dead_bullets = []
        for bullet in self.bullets.values():
            bullet.x += bullet.vx * DT
            bullet.y += bullet.vy * DT

            if (
                bullet.x < 0
                or bullet.x > FIELD_WIDTH
                or bullet.y < 0
                or bullet.y > FIELD_HEIGHT
            ):
                dead_bullets.append(bullet.id)
                continue

            if rect_intersects_walls(bullet.x, bullet.y, bullet.size):
                dead_bullets.append(bullet.id)

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _check_bullet_collisions(self) -> None:
        dead_bullets = []
        for bullet in self.bullets.values():
            for player in self.players.values():
                if not player.alive or player.id == bullet.owner_id:
                    continue
                if aabb_collides_point(player, bullet):
                    self._apply_damage(player, bullet)
                    dead_bullets.append(bullet.id)
                    break

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _apply_damage(self, player: Player, bullet: Bullet) -> None:
        now = time.monotonic()
        dmg = bullet.damage
        if now < player.armor_until:
            dmg = round(dmg * (1 - ARMOR_REDUCTION))
        player.hp -= dmg

        if player.hp <= 0:
            player.hp = 0
            self._kill_player(player, bullet.owner_id)

    def _kill_player(self, player: Player, killer_id: str) -> None:
        player.alive = False
        player.died_at = time.monotonic()
        player.deaths += 1
        killer = self.players.get(killer_id)
        if killer is not None and killer.id != player.id:
            killer.kills += 1
        self._pending_respawns[player.id] = time.monotonic() + RESPAWN_DELAY
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
                        "respawn_in": RESPAWN_DELAY,
                    }
                )
            except Exception:
                pass

    def _process_respawns(self, now: float) -> None:
        ready = [pid for pid, at in self._pending_respawns.items() if now >= at]
        for pid in ready:
            del self._pending_respawns[pid]
            self._respawn(pid)

    def _respawn(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None:
            return
        x, y = random.choice(SPAWN_POINTS)
        player.x, player.y = x, y
        player.dir_x, player.dir_y = 0.0, 0.0
        player.hp = player.max_hp
        player.alive = True
        player.died_at = None
        player.joined_at = time.monotonic()
        player.armor_until = 0.0
        player.damage_until = 0.0
        player.damage = 20

    def _spawn_pickups(self, elapsed: float) -> None:
        if len(self.pickups) >= PICKUP_MAX_COUNT:
            return
        if elapsed - self._last_pickup_spawn < PICKUP_SPAWN_INTERVAL:
            return
        self._last_pickup_spawn = elapsed

        for _ in range(20):
            x = random.uniform(60, FIELD_WIDTH - 60)
            y = random.uniform(60, FIELD_HEIGHT - 60)
            if not rect_intersects_walls(x, y, 24):
                kind = random.choice(PICKUP_KINDS)
                pickup = Pickup.new(x, y, kind)
                self.pickups[pickup.id] = pickup
                break

    def _check_pickup_collisions(self) -> None:
        consumed = []
        for pickup in self.pickups.values():
            for player in self.players.values():
                if not player.alive:
                    continue
                if abs(player.x - pickup.x) < (player.size + pickup.size) / 2 and abs(
                    player.y - pickup.y
                ) < (player.size + pickup.size) / 2:
                    self._apply_pickup(player, pickup)
                    consumed.append(pickup.id)
                    break

        for pid in consumed:
            self.pickups.pop(pid, None)

    def _apply_pickup(self, player: Player, pickup: Pickup) -> None:
        now = time.monotonic()
        if pickup.kind == "heal":
            player.hp = min(player.max_hp, player.hp + 40)
        elif pickup.kind == "armor":
            player.armor_until = now + ARMOR_DURATION
        elif pickup.kind == "damage":
            player.damage_until = now + DAMAGE_BOOST_DURATION
            player.damage = round(20 * DAMAGE_BOOST_MULT)

    def try_shoot(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None or not player.alive:
            return
        now = time.monotonic()
        if now - player.last_shot_at < FIRE_COOLDOWN:
            return
        player.last_shot_at = now

        if now >= player.damage_until:
            player.damage = 20

        muzzle_x = player.x + math.cos(player.turret_angle) * (player.size / 2 + 6)
        muzzle_y = player.y + math.sin(player.turret_angle) * (player.size / 2 + 6)
        bullet = Bullet.new(player.id, muzzle_x, muzzle_y, player.turret_angle, player.damage)
        self.bullets[bullet.id] = bullet

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

    def get_map_info(self) -> dict:
        return {
            "field": {"width": FIELD_WIDTH, "height": FIELD_HEIGHT},
            "walls": [
                {"x": w.x, "y": w.y, "width": w.width, "height": w.height} for w in WALLS
            ],
        }

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
        now = time.monotonic()
        payload = {
            "type": "state",
            "players": [
                {
                    "id": p.id,
                    "nickname": p.nickname,
                    "x": round(p.x, 1),
                    "y": round(p.y, 1),
                    "turret_angle": round(p.turret_angle, 3),
                    "alive": p.alive,
                    "hp": p.hp,
                    "max_hp": p.max_hp,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "lifetime": p.lifetime(),
                    "has_armor": now < p.armor_until,
                    "has_damage_boost": now < p.damage_until,
                }
                for p in self.players.values()
            ],
            "bullets": [
                {"id": b.id, "x": round(b.x, 1), "y": round(b.y, 1), "size": b.size}
                for b in self.bullets.values()
            ],
            "pickups": [
                {"id": pu.id, "x": pu.x, "y": pu.y, "kind": pu.kind}
                for pu in self.pickups.values()
            ],
        }

        async def send_one(pid: str, ws: WebSocket) -> str | None:
            try:
                await asyncio.wait_for(ws.send_json(payload), timeout=1.0)
                return None
            except Exception:
                return pid

        results = await asyncio.gather(
            *(send_one(pid, ws) for pid, ws in self.connections.items())
        )
        for pid in results:
            if pid is not None:
                self.remove_player(pid)

    async def add_player(self, nickname: str, ws: WebSocket) -> Player | None:
        async with self._lock:
            if self.is_full():
                return None
            x, y = random.choice(SPAWN_POINTS)
            player = Player.new(nickname[:16] or "Player", x, y)
            self.players[player.id] = player
            self.connections[player.id] = ws
            return player

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        self.connections.pop(player_id, None)
        self._pending_respawns.pop(player_id, None)

    def set_input(self, player_id: str, dir_x: float, dir_y: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.dir_x = clamp(dir_x, -1, 1)
            player.dir_y = clamp(dir_y, -1, 1)

    def set_aim(self, player_id: str, angle: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.turret_angle = angle


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rect_intersects_walls(cx: float, cy: float, size: float) -> bool:
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    for wall in WALLS:
        if (
            left < wall.x + wall.width
            and right > wall.x
            and top < wall.y + wall.height
            and bottom > wall.y
        ):
            return True
    return False


def aabb_collides_point(player: Player, bullet: Bullet) -> bool:
    return (
        abs(player.x - bullet.x) < player.size / 2 + bullet.size
        and abs(player.y - bullet.y) < player.size / 2 + bullet.size
    )


game_room = GameRoom()

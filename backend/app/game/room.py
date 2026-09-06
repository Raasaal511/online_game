import asyncio
import math
import random
import time

import orjson
from fastapi import WebSocket
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.score import Score
from app.game.entities import (
    Player,
    Bullet,
    Pickup,
    Trap,
    FIRE_COOLDOWN,
    BULLET_SPEED,
    TANK_ACCEL,
    TANK_FRICTION,
    TRAP_DAMAGE,
    TRAP_SLOW_DURATION,
    TRAP_TRIGGER_COOLDOWN,
    COLLISION_DAMAGE,
    COLLISION_PUSHBACK,
    SPEED_BOOST_DURATION,
)
from app.game.map import (
    FIELD_WIDTH,
    FIELD_HEIGHT,
    WALLS,
    WALL_THICKNESS,
    SPAWN_POINTS,
    TRAP_POINTS,
    SUPER_PICKUP_POINT,
)

# самая тонкая стена на карте — используется для расчёта под-шагов движения
# пуль, чтобы быстрая пуля не "проскакивала" стену насквозь за один тик
MIN_WALL_THICKNESS = WALL_THICKNESS

TICK_RATE = 30
DT = 1.0 / TICK_RATE

MAX_PLAYERS = 10

PICKUP_MAX_COUNT = 5
PICKUP_SPAWN_INTERVAL = 8.0
PICKUP_KINDS = ["heal", "armor", "damage", "speed"]
ARMOR_DURATION = 12.0
ARMOR_REDUCTION = 0.5  # снижение получаемого урона на 50%
DAMAGE_BOOST_DURATION = 12.0
DAMAGE_BOOST_MULT = 1.5

SUPER_PICKUP_RESPAWN_DELAY = 45.0  # сек до повторного появления супер-баста в центре
SUPER_ARMOR_REDUCTION = 0.8
SUPER_DAMAGE_MULT = 2.5
SUPER_DURATION = 15.0

RESPAWN_DELAY = 2.0  # сек до респавна после смерти

TOP_N = 3


class GameRoom:
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}
        self.bullets: dict[str, Bullet] = {}
        self.pickups: dict[str, Pickup] = {}
        self.traps: dict[str, Trap] = {
            trap.id: trap for trap in (Trap.new(x, y) for x, y in TRAP_POINTS)
        }
        self.connections: dict[str, WebSocket] = {}
        self.started_at = time.monotonic()
        self._last_pickup_spawn = 0.0
        self._super_pickup_id: str | None = None
        self._super_pickup_respawn_at = 5.0  # первый спавн вскоре после старта комнаты
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
        self._spawn_super_pickup(now)
        self._process_respawns(now)
        self._move_players(now)
        self._move_bullets()
        self._check_bullet_collisions()
        self._check_pickup_collisions(now)
        self._check_trap_collisions(now)
        self._check_tank_collisions(now)

    def _move_players(self, now: float) -> None:
        for player in self.players.values():
            if not player.alive:
                continue

            # инерционное движение: разгон к целевой скорости по вводу и
            # торможение трением при отпущенных клавишах — вместо мгновенной
            # телепортации на полную скорость танк чувствуется как танк
            norm = math.hypot(player.dir_x, player.dir_y)
            speed_mult = player.current_speed_mult(now)
            max_speed = player.speed * speed_mult

            if norm > 1e-6:
                target_vx = (player.dir_x / norm) * max_speed
                target_vy = (player.dir_y / norm) * max_speed
            else:
                target_vx = 0.0
                target_vy = 0.0

            player.vx = _approach(player.vx, target_vx, TANK_ACCEL * DT, TANK_FRICTION * DT)
            player.vy = _approach(player.vy, target_vy, TANK_ACCEL * DT, TANK_FRICTION * DT)

            new_x = player.x + player.vx * DT
            new_y = player.y + player.vy * DT

            half = player.size / 2
            new_x = clamp(new_x, half, FIELD_WIDTH - half)
            new_y = clamp(new_y, half, FIELD_HEIGHT - half)

            if not rect_intersects_walls(new_x, player.y, player.size):
                player.x = new_x
            else:
                player.vx = 0.0
            if not rect_intersects_walls(player.x, new_y, player.size):
                player.y = new_y
            else:
                player.vy = 0.0

    def _move_bullets(self) -> None:
        # внешние границы поля уже покрыты периметровыми стенами в WALLS
        # (толщина 24px), а пуля на полной скорости проходит ~23px за тик —
        # проверка коллизии только в конечной точке шага может "проскочить"
        # стену насквозь (туннелирование). Поэтому шаг тика бьём на под-шаги
        # короче толщины самой тонкой стены, с проверкой после каждого.
        dead_bullets = []
        # запас x2: шаг под-тика должен быть заметно меньше толщины стены,
        # иначе пуля, стартующая уже внутри тонкой стены, может перепрыгнуть
        # её целиком за один под-шаг (не только "перед" стеной, а "из" неё)
        substeps = max(1, math.ceil(2 * BULLET_SPEED * DT / MIN_WALL_THICKNESS))
        sub_dt = DT / substeps

        for bullet in self.bullets.values():
            half = bullet.size / 2
            bounced_this_tick = False
            for _ in range(substeps):
                bullet.x += bullet.vx * sub_dt
                bullet.y += bullet.vy * sub_dt

                wall = _find_intersecting_wall(bullet.x, bullet.y, bullet.size)
                if wall is None:
                    continue

                # определяем сторону удара по глубине проникновения в каждую
                # ось и отражаем только соответствующую компоненту скорости
                overlap_left = (bullet.x + half) - wall.x
                overlap_right = wall.right - (bullet.x - half)
                overlap_top = (bullet.y + half) - wall.y
                overlap_bottom = wall.bottom - (bullet.y - half)
                min_x_overlap = min(overlap_left, overlap_right)
                min_y_overlap = min(overlap_top, overlap_bottom)

                if min_x_overlap < min_y_overlap:
                    bullet.x = wall.x - half if overlap_left < overlap_right else wall.right + half
                    bullet.vx = -bullet.vx
                else:
                    bullet.y = wall.y - half if overlap_top < overlap_bottom else wall.bottom + half
                    bullet.vy = -bullet.vy

                # не более одного потраченного отскока за тик — на стыке двух
                # смежных стен (напр. угол L-образного укрытия) пуля может
                # задеть обе за разные под-шаги одного тика; это не должно
                # тратить два отскока разом, иначе исчезает раньше времени
                if not bounced_this_tick:
                    bounced_this_tick = True
                    if bullet.bounces_left <= 0:
                        dead_bullets.append(bullet.id)
                        break
                    bullet.bounces_left -= 1

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
        if now < player.super_until:
            dmg = round(dmg * (1 - SUPER_ARMOR_REDUCTION))
        elif now < player.armor_until:
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
        kills = player.kills
        is_new_record = await asyncio.to_thread(self._save_score, player.nickname, kills, lifetime)
        leaderboard = await asyncio.to_thread(self.get_leaderboard)
        ws = self.connections.get(player.id)
        if ws is not None:
            try:
                await ws.send_json(
                    {
                        "type": "death",
                        "lifetime_seconds": lifetime,
                        "kills": kills,
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

    def _pick_spawn_point(self) -> tuple[float, float]:
        occupied = [
            (p.x, p.y) for p in self.players.values() if p.alive
        ]
        free_points = [
            pt for pt in SPAWN_POINTS
            if all(math.hypot(pt[0] - ox, pt[1] - oy) > 80 for ox, oy in occupied)
        ]
        return random.choice(free_points or SPAWN_POINTS)

    def _respawn(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None:
            return
        x, y = self._pick_spawn_point()
        player.x, player.y = x, y
        player.dir_x, player.dir_y = 0.0, 0.0
        player.vx, player.vy = 0.0, 0.0
        player.hp = player.max_hp
        player.alive = True
        player.died_at = None
        player.joined_at = time.monotonic()
        player.armor_until = 0.0
        player.damage_until = 0.0
        player.speed_boost_until = 0.0
        player.slow_until = 0.0
        player.super_until = 0.0
        player.damage = 20
        # kills НЕ обнуляем: это счётчик за всю сессию соединения, а не за
        # одну жизнь — раньше сбрасывался на респавне, из-за чего ScoreBoard
        # и запись в топ-3 при повторной смерти теряли уже накопленные фраги

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

    def _spawn_super_pickup(self, now: float) -> None:
        # редкий мощный power-up с фиксированным спавном строго в центре
        # крепости — единственная копия одновременно, долгий кулдаун
        if self._super_pickup_id is not None:
            return
        if now < self._super_pickup_respawn_at:
            return
        x, y = SUPER_PICKUP_POINT
        pickup = Pickup.new(x, y, "super")
        self.pickups[pickup.id] = pickup
        self._super_pickup_id = pickup.id

    def _check_pickup_collisions(self, now: float) -> None:
        consumed = []
        for pickup in self.pickups.values():
            for player in self.players.values():
                if not player.alive:
                    continue
                if abs(player.x - pickup.x) < (player.size + pickup.size) / 2 and abs(
                    player.y - pickup.y
                ) < (player.size + pickup.size) / 2:
                    self._apply_pickup(player, pickup, now)
                    consumed.append(pickup.id)
                    break

        for pid in consumed:
            self.pickups.pop(pid, None)
            if pid == self._super_pickup_id:
                self._super_pickup_id = None
                self._super_pickup_respawn_at = now + SUPER_PICKUP_RESPAWN_DELAY

    def _apply_pickup(self, player: Player, pickup: Pickup, now: float) -> None:
        if pickup.kind == "heal":
            player.hp = min(player.max_hp, player.hp + 40)
        elif pickup.kind == "armor":
            player.armor_until = now + ARMOR_DURATION
        elif pickup.kind == "damage":
            player.damage_until = now + DAMAGE_BOOST_DURATION
            player.damage = round(20 * DAMAGE_BOOST_MULT)
        elif pickup.kind == "speed":
            player.speed_boost_until = now + SPEED_BOOST_DURATION
        elif pickup.kind == "super":
            # мощный комбинированный баф: урон, броня, скорость и полный хил разом
            player.super_until = now + SUPER_DURATION
            player.speed_boost_until = now + SUPER_DURATION
            player.damage_until = now + SUPER_DURATION
            player.damage = round(20 * SUPER_DAMAGE_MULT)
            player.hp = player.max_hp

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

    def _check_trap_collisions(self, now: float) -> None:
        for trap in self.traps.values():
            for player in self.players.values():
                if not player.alive or now < player.trap_cooldown_until:
                    continue
                if abs(player.x - trap.x) < (player.size + trap.size) / 2 and abs(
                    player.y - trap.y
                ) < (player.size + trap.size) / 2:
                    player.trap_cooldown_until = now + TRAP_TRIGGER_COOLDOWN
                    player.slow_until = now + TRAP_SLOW_DURATION
                    player.hp -= TRAP_DAMAGE
                    if player.hp <= 0:
                        player.hp = 0
                        self._kill_player(player, player.id)  # ловушка = самоурон, не чужое убийство

    def _check_tank_collisions(self, now: float) -> None:
        # взаимное отталкивание + небольшой урон при "тарáне" двух танков —
        # O(n^2), но n <= MAX_PLAYERS (10), так что пренебрежимо дёшево
        players = [p for p in self.players.values() if p.alive]
        for i in range(len(players)):
            a = players[i]
            for j in range(i + 1, len(players)):
                b = players[j]
                dx = b.x - a.x
                dy = b.y - a.y
                dist = math.hypot(dx, dy)
                min_dist = (a.size + b.size) / 2
                if dist >= min_dist or dist < 1e-6:
                    continue

                nx, ny = dx / dist, dy / dist
                overlap = min_dist - dist

                # раздвигаем поровну, чтобы не залипали друг в друге
                a.x -= nx * overlap / 2
                a.y -= ny * overlap / 2
                b.x += nx * overlap / 2
                b.y += ny * overlap / 2

                a.vx -= nx * COLLISION_PUSHBACK
                a.vy -= ny * COLLISION_PUSHBACK
                b.vx += nx * COLLISION_PUSHBACK
                b.vy += ny * COLLISION_PUSHBACK

                if now - a.last_collision_at > 0.5 and now - b.last_collision_at > 0.5:
                    a.last_collision_at = now
                    b.last_collision_at = now
                    a.hp = max(0, a.hp - COLLISION_DAMAGE)
                    b.hp = max(0, b.hp - COLLISION_DAMAGE)
                    if a.hp <= 0:
                        self._kill_player(a, b.id)
                    if b.hp <= 0:
                        self._kill_player(b, a.id)

    def _save_score(self, nickname: str, kills: int, lifetime: float) -> bool:
        db: Session = SessionLocal()
        try:
            db.add(Score(nickname=nickname, kills=kills, lifetime_seconds=lifetime))
            db.commit()
            top = self._query_leaderboard(db)
            return any(s["nickname"] == nickname and s["kills"] == kills for s in top)
        finally:
            db.close()

    def get_map_info(self) -> dict:
        return {
            "field": {"width": FIELD_WIDTH, "height": FIELD_HEIGHT},
            "walls": [
                {"x": w.x, "y": w.y, "width": w.width, "height": w.height} for w in WALLS
            ],
            "traps": [
                {"x": t.x, "y": t.y, "size": t.size} for t in self.traps.values()
            ],
        }

    def get_leaderboard(self) -> list[dict]:
        db: Session = SessionLocal()
        try:
            return self._query_leaderboard(db)
        finally:
            db.close()

    @staticmethod
    def _query_leaderboard(db: Session) -> list[dict]:
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
                    "speed": round(math.hypot(p.vx, p.vy), 1),
                    "alive": p.alive,
                    "hp": p.hp,
                    "max_hp": p.max_hp,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "lifetime": p.lifetime(),
                    "has_armor": now < p.armor_until,
                    "has_damage_boost": now < p.damage_until,
                    "has_speed_boost": now < p.speed_boost_until,
                    "has_slow": now < p.slow_until,
                    "has_super": now < p.super_until,
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

        # сериализуем payload один раз за тик (не по разу на каждого клиента) —
        # orjson быстрее stdlib json и отдаёт сразу bytes
        message = {"type": "websocket.send", "bytes": orjson.dumps(payload)}

        async def send_one(pid: str, ws: WebSocket) -> str | None:
            try:
                await asyncio.wait_for(ws.send(message), timeout=0.4)
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
            x, y = self._pick_spawn_point()
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
        if left < wall.right and right > wall.x and top < wall.bottom and bottom > wall.y:
            return True
    return False


def _find_intersecting_wall(cx: float, cy: float, size: float):
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    for wall in WALLS:
        if left < wall.right and right > wall.x and top < wall.bottom and bottom > wall.y:
            return wall
    return None


def _approach(current: float, target: float, accel_step: float, friction_step: float) -> float:
    # разгон к target ограничен accel_step за тик; если target — 0 (ввод
    # отпущен), тормозим к нему чуть резче через friction_step
    step = accel_step if abs(target) > abs(current) or target * current < 0 else friction_step
    if current < target:
        return min(current + step, target)
    if current > target:
        return max(current - step, target)
    return current


def aabb_collides_point(player: Player, bullet: Bullet) -> bool:
    return (
        abs(player.x - bullet.x) < player.size / 2 + bullet.size
        and abs(player.y - bullet.y) < player.size / 2 + bullet.size
    )


game_room = GameRoom()

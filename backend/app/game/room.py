import asyncio
import random
import time

from fastapi import WebSocket

from app.game.weapons import WeaponMixin
from app.game.miniboss import MinibossMixin
from app.game.nuke import NukeMixin
from app.game.portals import PortalMixin
from app.game.combat import (
    CombatMixin,
    clamp,  # noqa: F401 — re-exported, историческая публичная точка входа (app.game.room)
    rect_intersects_walls,  # noqa: F401 — re-exported, используется в tests/test_walls.py
    _find_intersecting_wall,  # noqa: F401 — re-exported, используется в tests/test_bullets.py, tests/test_walls.py
    aabb_collides_point,  # noqa: F401 — re-exported, историческая публичная точка входа (app.game.room)
    ARMOR_REDUCTION,
)
from app.game.respawn import RespawnMixin
from app.game.pickups import PickupMixin
from app.game.hazards import HazardMixin
from app.game.round import RoundMixin
from app.game.broadcast import BroadcastMixin
from app.game.connection import ConnectionMixin
from app.game.entities import (
    Player,
    Bullet,
    Pickup,
    Trap,
    Bomb,
    TRAP_COUNT,
    TRAP_ROTATION_INTERVAL,
    BOMB_MIN_INTERVAL,
    BOMB_MAX_INTERVAL,
    NUKE_MIN_INTERVAL,
    NUKE_MAX_INTERVAL,
)

TICK_RATE = 30
DT = 1.0 / TICK_RATE

MAX_PLAYERS = 10

RESPAWN_DELAY = 3.5  # сек до респавна после смерти — модалка смерти держится ровно столько же

ROUND_DURATION = 600.0  # 10 минут — по истечении объявляется победитель раунда


class GameRoom(
    WeaponMixin,
    MinibossMixin,
    NukeMixin,
    PortalMixin,
    CombatMixin,
    RespawnMixin,
    PickupMixin,
    HazardMixin,
    RoundMixin,
    BroadcastMixin,
    ConnectionMixin,
):
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}
        self.bullets: dict[str, Bullet] = {}
        self.pickups: dict[str, Pickup] = {}
        # ловушки больше не стоят в фиксированных точках (TRAP_POINTS) — теперь
        # TRAP_COUNT штук случайно расставлены при старте и по одной ротируются
        # в новое случайное место каждые TRAP_ROTATION_INTERVAL сек, см. _rotate_traps
        self.traps: dict[str, Trap] = {}
        self._next_trap_rotation_at = time.monotonic() + TRAP_ROTATION_INTERVAL
        for _ in range(TRAP_COUNT):
            trap = self._new_random_trap()
            if trap is not None:
                self.traps[trap.id] = trap
        self.bombs: dict[str, Bomb] = {}
        self.connections: dict[str, WebSocket] = {}
        self.started_at = time.monotonic()
        self._last_pickup_spawn = 0.0
        self._super_pickup_id: str | None = None
        self._super_pickup_respawn_at = 5.0  # первый спавн вскоре после старта комнаты
        self._next_bomb_at = time.monotonic() + random.uniform(BOMB_MIN_INTERVAL, BOMB_MAX_INTERVAL)
        self._next_nuke_at = time.monotonic() + random.uniform(NUKE_MIN_INTERVAL, NUKE_MAX_INTERVAL)
        self._active_nuke = None
        self._explosions: list[dict] = []  # разовые события взрыва для текущего тика (визуал на клиенте)
        self._wall_hits: list[dict] = []  # стена получила урон, но не разрушена
        self._wall_breaks: list[dict] = []  # стена разрушена в этот тик
        self._wall_restores: list[dict] = []  # стена восстановилась в этот тик
        self._hit_sparks: list[dict] = []  # сквозная пуля снайпера пробила цель, но летит дальше (см. _check_bullet_collisions)
        self._miniboss_spawns: list[dict] = []  # мини-босс появился в этот тик (событие для клиента)
        self._level_ups: list[dict] = []  # игрок поднял уровень в этот тик
        self._laser_shots: list[dict] = []  # лазер мини-босса фактически выстрелил в этот тик
        self._pending_respawns: dict[str, float] = {}  # player_id -> respawn_at
        self._pending_respawn_class: dict[str, str] = {}  # player_id -> tank_class выбранный на следующий респавн
        self._teleports: list[dict] = []  # телепорт игрока сработал в этот тик (визуал на клиенте)
        self._chat_log: list[dict] = []  # последние сообщения чата (для истории новым игрокам)
        self._msg_buckets: dict[str, tuple[float, float]] = {}  # player_id -> (tokens, last_refill_at)
        self._round_started_at = time.monotonic()
        self._round_end_banner_until: float | None = None  # пока не None — идёт показ баннера победителя
        self._round_winner: dict | None = None  # {"nickname", "kills"} — последний объявленный победитель
        self._round_ended_event: dict | None = None  # разовое событие конца раунда для текущего тика
        self._init_portals()
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
        # мини-боссы не считаются игроками для лимита комнаты — иначе они
        # могли бы вытеснить реальных игроков из доступных 10 слотов
        real_players = sum(1 for p in self.players.values() if not p.is_miniboss)
        return real_players >= MAX_PLAYERS

    def _tick(self) -> None:
        now = time.monotonic()
        elapsed = self._elapsed()
        # разовые события этого тика, не накапливаются между тиками
        self._explosions = []
        self._wall_hits = []
        self._wall_breaks = []
        self._wall_restores = []
        self._hit_sparks = []
        self._miniboss_spawns = []
        self._level_ups = []
        self._laser_shots = []
        self._teleports = []
        self._round_ended_event = None
        self._portal_events = []

        self._process_round(now)
        self._spawn_pickups(elapsed)
        self._spawn_super_pickup(now)
        self._spawn_bombs(now)
        self._process_bombs(now)
        self._rotate_traps(now)
        self._spawn_nuke(now)
        self._process_nuke(now)
        self._spawn_portals(now)
        self._process_wall_respawns(now)
        self._process_respawns(now)
        self._process_gunner_reload(now)
        self._drive_all_minibosses(now)
        self._move_players(now)
        self._move_bullets()
        self._check_bullet_collisions()
        self._process_flamethrower(now)
        self._process_burning(now)
        self._process_laser_star(now)
        self._check_pickup_collisions(now)
        self._check_trap_collisions(now)
        self._check_tank_collisions(now)
        self._process_pits(now)
        self._process_portals(now)


game_room = GameRoom()

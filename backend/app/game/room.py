import asyncio
import math
import random
import time

import orjson
from fastapi import WebSocket

from app.game.weapons import WeaponMixin
from app.game.miniboss import MinibossMixin, apply_miniboss_kill_reward
from app.game.nuke import NukeMixin
from app.game.portals import PortalMixin
from app.game.entities import (
    Player,
    Bullet,
    Pickup,
    Trap,
    Bomb,
    Nuke,
    BULLET_SPEED,
    TANK_ACCEL,
    TANK_FRICTION,
    TANK_MAX_HP,
    TRAP_DAMAGE,
    TRAP_SLOW_DURATION,
    TRAP_SLOW_MULT,
    TRAP_TRIGGER_COOLDOWN,
    COLLISION_DAMAGE,
    COLLISION_PUSHBACK,
    SPAWN_PROTECTION_DURATION,
    SPEED_BOOST_DURATION,
    WEAPON_PICKUP_DURATION,
    BOMB_MIN_INTERVAL,
    BOMB_MAX_INTERVAL,
    BOMB_DAMAGE,
    BOMB_RADIUS,
    WALL_MAX_HP,
    WALL_RESPAWN_DELAY,
    XP_PER_KILL,
    MINIBOSS_SPAWN_CHANCE,
    MINIBOSS_HP_MULT,
    MINIBOSS_DAMAGE_MULT,
    MINIBOSS_SPEED_MULT,
    MINIBOSS_REWARD_DURATION,
    MINIBOSS_REWARD_ARMOR_REDUCTION,
    MINIBOSS_REWARD_DAMAGE_MULT,
    NUKE_MIN_INTERVAL,
    NUKE_MAX_INTERVAL,
    NUKE_WARNING_DURATION,
    NUKE_DAMAGE,
    NUKE_RADIUS_FRACTION,
    TANK_CLASSES,
    DEFAULT_TANK_CLASS,
    GUNNER_MAG_SIZE,
    GUNNER_RELOAD_TIME,
    ULTIMATE_KILLS_REQUIRED,
    GUN_SKINS,
    DEFAULT_GUN_SKIN,
    LASER_STAR_DURATION,
    LASER_STAR_BEAM_COUNT,
    PIT_FALL_TIME,
    ICE_SLOW_DURATION,
    ICE_SLOW_MULT,
)
from app.game.map import (
    FIELD_WIDTH,
    FIELD_HEIGHT,
    WALLS,
    WALL_THICKNESS,
    SPAWN_POINTS,
    TRAP_POINTS,
    SUPER_PICKUP_POINT,
    PIT_ZONES,
)

# самая тонкая стена на карте — используется для расчёта под-шагов движения
# пуль, чтобы быстрая пуля не "проскакивала" стену насквозь за один тик
MIN_WALL_THICKNESS = WALL_THICKNESS

TICK_RATE = 30
DT = 1.0 / TICK_RATE

MAX_PLAYERS = 10

PICKUP_MAX_COUNT = 7  # больше предметов на карте одновременно — раньше жаловались, что пикапы (особенно оружие) появляются редко
PICKUP_SPAWN_INTERVAL = 5.0
# "minigun" убран из пула — у gunner-класса уже есть постоянное аналогичное
# оружие, пикап с тем же ощущением на карте дублировал класс, а не добавлял
# разнообразия; "ice" занял освободившееся место в пуле
PICKUP_KINDS = ["heal", "armor", "damage", "speed", "flamethrower", "rocket", "ice"]
ARMOR_DURATION = 12.0
ARMOR_REDUCTION = 0.5  # снижение получаемого урона на 50%
DAMAGE_BOOST_DURATION = 12.0
DAMAGE_BOOST_MULT = 1.5

# доля фоновых бомб, намеренно приземляемых у ямы/супер-пикапа (см. _spawn_bombs) —
# при площади "круга у центра" примерно вчетверо меньше площади всей карты,
# 0.5 шанс даёт эффективную плотность там ~2-3x выше среднекарточной
BOMB_NEAR_SUPER_CHANCE = 0.5

SUPER_PICKUP_RESPAWN_DELAY = 45.0  # сек до повторного появления супер-пикапа в центре
# SUPER_ARMOR_REDUCTION всё ещё используется наградой за мини-босса (super_until
# остался как поле для этой отдельной механики) — сам пикап "super" на карте
# больше НЕ выдаёт этот бафф, см. _apply_pickup: теперь это лазерная звезда
SUPER_ARMOR_REDUCTION = 0.8

RESPAWN_DELAY = 2.0  # сек до респавна после смерти

ROUND_DURATION = 600.0  # 10 минут — по истечении объявляется победитель раунда
ROUND_END_BANNER_DURATION = 6.0  # сек показа баннера победителя перед реваншем

# токен-бакет на входящие WS-сообщения одного игрока: не даёт клиенту (или
# бажным/вредоносным скриптом) заливать сервер сообщениями быстрее, чем
# сервер способен разумно обработать — независимо от игровых кулдаунов
# оружия (те защищают баланс, а не нагрузку на broadcast/lock)
MSG_BUCKET_CAPACITY = 60.0  # максимум "сообщений про запас"
# клиент реально шлёт: aim до 20/сек (throttle 50мс) + shoot до ~11/сек при
# автооружии (throttle 90мс) + input по событию нажатия клавиш — суммарно
# может доходить до ~35-40/сек в пике; лимит выше с запасом, чтобы резать
# только настоящий флуд (десятки сообщений за один тик), а не игру
MSG_BUCKET_REFILL_RATE = 60.0  # сообщений/сек восстановления

CHAT_MAX_LEN = 200
CHAT_HISTORY_SIZE = 30
CHAT_MIN_INTERVAL = 0.5  # сек между сообщениями чата от одного игрока


class GameRoom(WeaponMixin, MinibossMixin, NukeMixin, PortalMixin):
    def __init__(self) -> None:
        self.players: dict[str, Player] = {}
        self.bullets: dict[str, Bullet] = {}
        self.pickups: dict[str, Pickup] = {}
        self.traps: dict[str, Trap] = {
            trap.id: trap for trap in (Trap.new(x, y) for x, y in TRAP_POINTS)
        }
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

    def _process_round(self, now: float) -> None:
        # пока показывается баннер победителя — ждём ROUND_END_BANNER_DURATION,
        # затем полный реванш: респавн всех + сброс kills/deaths/level/xp
        if self._round_end_banner_until is not None:
            if now >= self._round_end_banner_until:
                self._round_end_banner_until = None
                self._start_new_round(now)
            return

        if now - self._round_started_at < ROUND_DURATION:
            return

        # раунд закончился — определяем победителя по числу убийств среди
        # реальных игроков (мини-боссы не участвуют, это NPC)
        real_players = [p for p in self.players.values() if not p.is_miniboss]
        winner = max(real_players, key=lambda p: p.kills, default=None)
        self._round_winner = (
            {"nickname": winner.nickname, "kills": winner.kills} if winner is not None else None
        )
        self._round_ended_event = self._round_winner
        self._round_end_banner_until = now + ROUND_END_BANNER_DURATION

    def _start_new_round(self, now: float) -> None:
        # полный реванш: все живые и мёртвые игроки возрождаются на новых
        # точках спавна, счёт (kills/deaths/level/xp) сбрасывается у всех —
        # мини-боссы (NPC) просто удаляются, а не респавнятся как игроки
        self._round_started_at = now
        for player_id in list(self.players.keys()):
            player = self.players.get(player_id)
            if player is None:
                continue
            if player.is_miniboss:
                self.players.pop(player_id, None)
                continue
            player.kills = 0
            player.deaths = 0
            player.level = 1
            player.xp = 0
            player.ultimate_kills = 0
            player.max_hp = TANK_MAX_HP
            self._pending_respawns.pop(player_id, None)
            # если игрок мёртвым выбрал класс через select_class прямо перед
            # концом раунда — реванш должен уважать этот выбор, а не молча
            # проигнорировать его и оставить "зависшим" на следующую обычную
            # смерть уже в новом раунде
            tank_class = self._pending_respawn_class.pop(player_id, None)
            self._respawn(player_id, tank_class)

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

            # НЕ клампим к границам поля здесь: периметр уже полностью закрыт
            # стенами-границами (WALLS), и коллизия с ними ниже — единственный
            # источник истины. Раньше clamp() подгонял позицию вплотную к
            # границе поля, которая физически лежит ВНУТРИ толщины стены
            # (WALL_THICKNESS=24px) — из-за этого rect_intersects_walls всегда
            # возвращала True на границе, движение блокировалось навсегда, и
            # игрок застревал у края карты без возможности отъехать назад.

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
            if bullet.kind == "flamethrower":
                continue  # огнемёт не создаёт снарядов, обрабатывается отдельно

            hit_wall = False
            for _ in range(substeps):
                bullet.x += bullet.vx * sub_dt
                bullet.y += bullet.vy * sub_dt

                wall = _find_intersecting_wall(bullet.x, bullet.y, bullet.size)
                if wall is None:
                    continue

                # без рикошета: любая стена (внешняя граница или внутреннее
                # укрытие) гасит пулю при первом касании — предсказуемее и
                # понятнее, чем отскок, который сложно предугадать в бою
                hit_wall = True
                if not wall.is_border:
                    self._damage_wall(wall)
                if bullet.kind == "rocket":
                    self._explode_rocket(bullet)
                elif bullet.kind == "ultimate":
                    self._explode_ultimate(bullet)
                break

            if hit_wall:
                dead_bullets.append(bullet.id)

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _check_bullet_collisions(self) -> None:
        dead_bullets = []
        for bullet in self.bullets.values():
            if bullet.kind == "flamethrower":
                continue
            # снимок списка игроков: _apply_damage ниже может убить игрока и
            # через _maybe_spawn_miniboss добавить нового NPC в self.players,
            # мутируя словарь прямо во время итерации по нему (RuntimeError)
            for player in list(self.players.values()):
                if not player.alive or player.id == bullet.owner_id:
                    continue
                if bullet.pierce and player.id in bullet.hit_ids:
                    continue  # сквозная пуля уже нанесла урон этой цели — не бьёт дважды
                if aabb_collides_point(player, bullet):
                    dmg = bullet.damage
                    if bullet.falloff_range > 0:
                        traveled = math.hypot(bullet.x - bullet.spawn_x, bullet.y - bullet.spawn_y)
                        frac = min(1.0, traveled / bullet.falloff_range)
                        mult = 1.0 - frac * (1.0 - bullet.falloff_min_mult)
                        dmg = round(dmg * mult)
                    if bullet.kind == "rocket":
                        self._explode_rocket(bullet)
                    elif bullet.kind == "ultimate":
                        self._explode_ultimate(bullet)
                    else:
                        self._apply_damage(player, dmg, bullet.owner_id)
                    if bullet.kind == "ice":
                        # лёгкое, короткое замедление — отдельные константы от
                        # ловушки (TRAP_SLOW_*), та тюнингована жёстче
                        player.slow_until = max(player.slow_until, time.monotonic() + ICE_SLOW_DURATION)
                        player.slow_mult = ICE_SLOW_MULT
                    if bullet.pierce:
                        bullet.hit_ids.add(player.id)
                        # сквозная пуля (снайпер) не гаснет при попадании — без
                        # видимого эффекта в момент удара выглядело как промах,
                        # хотя урон реально прошёл; лёгкая искра НЕ останавливает полёт
                        self._hit_sparks.append({"x": bullet.x, "y": bullet.y})
                    else:
                        dead_bullets.append(bullet.id)
                        break

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _damage_wall(self, wall) -> None:
        if not wall.destructible or not wall.is_active:
            return
        wall.hp -= 1
        if wall.hp <= 0:
            wall.destroyed_at = time.monotonic()
            self._wall_breaks.append({"id": wall.id, "x": wall.x, "y": wall.y})
        else:
            self._wall_hits.append({"id": wall.id, "x": wall.x, "y": wall.y})

    def _process_wall_respawns(self, now: float) -> None:
        for wall in WALLS:
            if wall.destroyed_at is None:
                continue
            if now - wall.destroyed_at < WALL_RESPAWN_DELAY:
                continue
            # не восстанавливаем стену прямо под танком: игрок физически
            # застрявший внутри геометрии активной стены оказывался в
            # сломанном состоянии — исходящие пули покидали стену раньше,
            # чем срабатывала проверка коллизии (стреляет нормально), а
            # входящие пули соперников гасли об эту же стену РАНЬШЕ, чем
            # долетали до игрока внутри неё (в него невозможно попасть).
            # Просто откладываем восстановление до следующего тика, пока
            # зона не освободится — не телепортируем и не убиваем игрока.
            if self._wall_zone_occupied(wall):
                continue
            wall.destroyed_at = None
            wall.hp = WALL_MAX_HP
            self._wall_restores.append({"id": wall.id, "x": wall.x, "y": wall.y})

    def _wall_zone_occupied(self, wall) -> bool:
        for player in self.players.values():
            if not player.alive:
                continue
            half = player.size / 2
            if (
                player.x - half < wall.right
                and player.x + half > wall.x
                and player.y - half < wall.bottom
                and player.y + half > wall.y
            ):
                return True
        return False

    def _apply_damage(self, player: Player, damage: int, killer_id: str) -> None:
        now = time.monotonic()
        if now < player.spawn_protected_until:
            return  # неуязвимость сразу после респавна
        dmg = damage
        if now < player.super_until:
            dmg = round(dmg * (1 - SUPER_ARMOR_REDUCTION))
        elif now < player.armor_until:
            dmg = round(dmg * (1 - ARMOR_REDUCTION))
        player.hp -= dmg

        if player.hp <= 0:
            player.hp = 0
            self._kill_player(player, killer_id)

    def _kill_player(self, player: Player, killer_id: str) -> None:
        now = time.monotonic()
        player.alive = False
        player.died_at = now
        player.deaths += 1
        killer = self.players.get(killer_id)
        if killer is not None and killer.id != player.id:
            killer.kills += 1
            if not killer.is_miniboss:
                if player.is_miniboss:
                    # награда за мини-босса намного мощнее обычного XP/пикапа
                    apply_miniboss_kill_reward(killer, now)
                else:
                    if killer.add_xp(XP_PER_KILL):
                        self._level_ups.append({"player_id": killer.id, "level": killer.level})
                    from app.game.entities import ULTIMATE_KILLS_REQUIRED

                    killer.ultimate_kills = min(ULTIMATE_KILLS_REQUIRED, killer.ultimate_kills + 1)

        if player.is_miniboss:
            # мини-босс — NPC, не участвует в респавне/leaderboard/уровнях
            self.players.pop(player.id, None)
            return

        # прокачка уровня сбрасывается на смерти (риск/фарм-петля) — весь
        # накопленный опыт теряется, max_hp возвращается к базовому
        player.level = 1
        player.xp = 0
        player.max_hp = TANK_MAX_HP

        self._maybe_spawn_miniboss(player.x, player.y, player.nickname)

        self._pending_respawns[player.id] = now + RESPAWN_DELAY
        asyncio.create_task(self._handle_death(player))

    def _live_leaderboard(self) -> list[dict]:
        # топ-3 текущей игровой сессии по убийствам — живёт только в памяти
        # процесса (по нику+соединению текущего захода), без БД/истории между
        # перезапусками сервера или разных игровых сессий одного и того же ника
        real_players = [p for p in self.players.values() if not p.is_miniboss]
        top = sorted(real_players, key=lambda p: p.kills, reverse=True)[:3]
        return [{"nickname": p.nickname, "kills": p.kills} for p in top if p.kills > 0]

    async def _handle_death(self, player: Player) -> None:
        lifetime = player.lifetime()
        kills = player.kills
        ws = self.connections.get(player.id)
        if ws is not None:
            try:
                await ws.send_json(
                    {
                        "type": "death",
                        "lifetime_seconds": lifetime,
                        "kills": kills,
                        "respawn_in": RESPAWN_DELAY,
                    }
                )
            except Exception:
                pass

    def _process_respawns(self, now: float) -> None:
        ready = [pid for pid, at in self._pending_respawns.items() if now >= at]
        for pid in ready:
            del self._pending_respawns[pid]
            tank_class = self._pending_respawn_class.pop(pid, None)
            self._respawn(pid, tank_class)

    def set_respawn_class(self, player_id: str, tank_class: str) -> None:
        # игрок выбирает класс на следующее возрождение (пока он мёртв) —
        # применяется в _respawn, не мгновенно, т.к. живой танк не меняет класс
        if tank_class in TANK_CLASSES:
            self._pending_respawn_class[player_id] = tank_class

    def set_gun_skin(self, player_id: str, gun_skin: str) -> None:
        # чисто косметическое — можно менять в любой момент, не только на респавне
        if gun_skin not in GUN_SKINS:
            return
        player = self.players.get(player_id)
        if player is not None:
            player.gun_skin = gun_skin

    def _pick_spawn_point(self) -> tuple[float, float]:
        # избегаем не только других игроков, но и активных угроз рядом с
        # точкой спавна — иначе респавн может высадить танк прямо под
        # пулей/на грани взрыва бомбы, что убивает его почти сразу
        danger_zones = [(p.x, p.y, 80.0) for p in self.players.values() if p.alive]
        danger_zones += [(b.x, b.y, 120.0) for b in self.bullets.values()]
        danger_zones += [(bomb.x, bomb.y, bomb.radius + 40.0) for bomb in self.bombs.values()]

        free_points = [
            pt for pt in SPAWN_POINTS
            if all(math.hypot(pt[0] - zx, pt[1] - zy) > radius for zx, zy, radius in danger_zones)
        ]
        if free_points:
            return random.choice(free_points)

        # если все точки "опасны" (маловероятно, но возможно при полной
        # комнате), лучше вернуть точку подальше от игроков, чем от пуль —
        # столкновение с танком в момент спавна не смертельно само по себе
        safer_points = [
            pt for pt in SPAWN_POINTS
            if all(
                math.hypot(pt[0] - p.x, pt[1] - p.y) > 80
                for p in self.players.values()
                if p.alive
            )
        ]
        return random.choice(safer_points or SPAWN_POINTS)

    def _respawn(self, player_id: str, tank_class: str | None = None) -> None:
        player = self.players.get(player_id)
        if player is None:
            return
        now = time.monotonic()
        x, y = self._pick_spawn_point()
        player.x, player.y = x, y
        player.dir_x, player.dir_y = 0.0, 0.0
        player.vx, player.vy = 0.0, 0.0
        player.hp = player.max_hp
        player.alive = True
        player.died_at = None
        player.joined_at = now
        player.armor_until = 0.0
        player.damage_until = 0.0
        player.speed_boost_until = 0.0
        player.slow_until = 0.0
        player.super_until = 0.0
        player.damage = 20
        player.weapon = "cannon"
        player.weapon_until = 0.0
        player.flame_active_until = 0.0
        player.burn_until = 0.0
        player.laser_star_until = 0.0
        player.laser_star_angles = []
        player.falling_since = 0.0
        if tank_class in TANK_CLASSES:
            player.tank_class = tank_class
        player.ammo = GUNNER_MAG_SIZE
        player.reload_until = 0.0
        player.portal_cooldown_until = 0.0
        # ultimate_kills НЕ обнуляем: копится за всю сессию так же, как kills —
        # риск/фарм-петля уровня намеренно жёстче (сбрасывается на смерти),
        # но ульта — награда за суммарный вклад в игру, а не за одну жизнь
        # короткая неуязвимость сразу после спавна — подстраховка сверх
        # безопасного выбора точки: пуля может долететь уже после спавна,
        # или несколько игроков заспавниться близко друг к другу одновременно
        player.spawn_protected_until = now + SPAWN_PROTECTION_DURATION
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
        # баффы одного типа стакаются аддитивно по времени: если armor/damage/
        # speed/super ещё действует, новый пикап ПРОДЛЕВАЕТ оставшееся время
        # (не перезаписывает его заново) — подобрал два подряд, действует дольше,
        # а не просто "обновил" тот же таймер. Сила эффекта не растёт (не стакается
        # мультипликативно) — только длительность, чтобы не сломать баланс.
        if pickup.kind == "heal":
            player.hp = min(player.max_hp, player.hp + 40)
        elif pickup.kind == "armor":
            base = max(now, player.armor_until)
            player.armor_until = base + ARMOR_DURATION
        elif pickup.kind == "damage":
            base = max(now, player.damage_until)
            player.damage_until = base + DAMAGE_BOOST_DURATION
            player.damage = round(20 * DAMAGE_BOOST_MULT)
        elif pickup.kind == "speed":
            base = max(now, player.speed_boost_until)
            player.speed_boost_until = base + SPEED_BOOST_DURATION
        elif pickup.kind == "super":
            # больше не пассивный статовый бафф — превращает танк в лазерную
            # турель на LASER_STAR_DURATION секунд: 8 лучей фиксированы под
            # углом ОТНОСИТЕЛЬНО ТЕКУЩЕЙ БАШНИ в момент подбора (не переприцеливаются
            # игроком) и тикают урон сами, без удержания кнопки — см. _process_laser_star.
            # Полный хил оставлен как "power fantasy" — не усложняет механику,
            # но подчёркивает, что подбор супер-пикапа — момент силы.
            player.laser_star_until = now + LASER_STAR_DURATION
            player.laser_star_angles = [
                player.turret_angle + i * (2 * math.pi / LASER_STAR_BEAM_COUNT)
                for i in range(LASER_STAR_BEAM_COUNT)
            ]
            player.hp = player.max_hp
        elif pickup.kind in ("flamethrower", "rocket", "ice"):
            player.weapon = pickup.kind
            player.weapon_until = now + WEAPON_PICKUP_DURATION
            player.last_shot_at = -999.0  # можно стрелять новым оружием сразу, без остатка кулдауна

    def _spawn_bombs(self, now: float) -> None:
        if now < self._next_bomb_at:
            return
        self._next_bomb_at = now + random.uniform(BOMB_MIN_INTERVAL, BOMB_MAX_INTERVAL)

        # BOMB_NEAR_SUPER_CHANCE смещает выбор точки, а не глобальный интервал —
        # так бомбы у ямы/супер-пикапа появляются заметно (2-3x) чаще НЕ ценой
        # затопления бомбами всей остальной карты (что дал бы просто более
        # короткий BOMB_MIN/MAX_INTERVAL)
        near_super = random.random() < BOMB_NEAR_SUPER_CHANCE
        cx, cy = SUPER_PICKUP_POINT
        for _ in range(20):
            if near_super:
                # круг вокруг центра, за пределами ямы (радиус ямы ~205px) —
                # бомба должна упасть там, где до неё реально можно дойти
                angle = random.uniform(0, math.pi * 2)
                dist = random.uniform(220.0, 340.0)
                x = cx + math.cos(angle) * dist
                y = cy + math.sin(angle) * dist
                x = max(80, min(FIELD_WIDTH - 80, x))
                y = max(80, min(FIELD_HEIGHT - 80, y))
            else:
                x = random.uniform(80, FIELD_WIDTH - 80)
                y = random.uniform(80, FIELD_HEIGHT - 80)
            if not rect_intersects_walls(x, y, BOMB_RADIUS * 0.5) and not self._in_pit_zone(x, y):
                bomb = Bomb.new(x, y, now)
                self.bombs[bomb.id] = bomb
                break

    def _process_bombs(self, now: float) -> None:
        exploded = []
        for bomb in self.bombs.values():
            if now - bomb.spawned_at < bomb.fuse_time:
                continue
            exploded.append(bomb.id)
            # снимок списка — см. комментарий в _check_bullet_collisions
            for player in list(self.players.values()):
                if not player.alive:
                    continue
                dist = math.hypot(player.x - bomb.x, player.y - bomb.y)
                if dist > bomb.radius:
                    continue
                falloff = 1 - dist / bomb.radius
                dmg = round(bomb.damage * falloff)
                if dmg > 0:
                    # владелец (мини-босс, артиллерия) засчитывает фраг; обычная
                    # фоновая бомба без владельца — самоурон, фраг никому
                    killer_id = bomb.owner_id or player.id
                    self._apply_damage(player, dmg, killer_id)
            self._explosions.append({"x": bomb.x, "y": bomb.y, "radius": bomb.radius})

        for bid in exploded:
            self.bombs.pop(bid, None)

    def _check_trap_collisions(self, now: float) -> None:
        for trap in self.traps.values():
            # снимок списка — см. комментарий в _check_bullet_collisions
            for player in list(self.players.values()):
                if (
                    not player.alive
                    or now < player.trap_cooldown_until
                    or now < player.spawn_protected_until
                ):
                    continue
                if abs(player.x - trap.x) < (player.size + trap.size) / 2 and abs(
                    player.y - trap.y
                ) < (player.size + trap.size) / 2:
                    player.trap_cooldown_until = now + TRAP_TRIGGER_COOLDOWN
                    player.slow_until = now + TRAP_SLOW_DURATION
                    player.slow_mult = TRAP_SLOW_MULT
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
                    # позиционное разведение выше применяется всегда (даже под
                    # защитой) — иначе танки слипаются при одновременном
                    # спавне рядом; сам урон таранa под защитой не проходит
                    if now >= a.spawn_protected_until:
                        a.hp = max(0, a.hp - COLLISION_DAMAGE)
                        if a.hp <= 0:
                            self._kill_player(a, b.id)
                    if now >= b.spawn_protected_until:
                        b.hp = max(0, b.hp - COLLISION_DAMAGE)
                        if b.hp <= 0:
                            self._kill_player(b, a.id)

    def _in_pit_zone(self, x: float, y: float) -> bool:
        for zx, zy, zw, zh in PIT_ZONES:
            if zx <= x <= zx + zw and zy <= y <= zy + zh:
                return True
        return False

    def _process_pits(self, now: float) -> None:
        # яма вокруг супер-пикапа: заезд в зону запускает короткий отсчёт
        # падения (falling_since), а не мгновенную смерть — если игрок успел
        # выехать до истечения PIT_FALL_TIME, отсчёт сбрасывается (можно
        # "спастись" резким манёвром, а не гарантированно терять танк при
        # касании края ямы). Смерть проведена через _kill_player напрямую
        # (не _apply_damage — та учитывает spawn-неуязвимость/броню, а яма
        # должна убивать безусловно, как и урон от ловушек-самоубийц).
        for player in list(self.players.values()):
            if not player.alive or player.is_miniboss:
                continue
            if self._in_pit_zone(player.x, player.y):
                if player.falling_since <= 0:
                    player.falling_since = now
                elif now - player.falling_since >= PIT_FALL_TIME:
                    player.falling_since = 0.0
                    player.hp = 0
                    self._kill_player(player, player.id)  # яма = самоурон, не чужое убийство
            else:
                player.falling_since = 0.0

    def get_map_info(self) -> dict:
        return {
            "field": {"width": FIELD_WIDTH, "height": FIELD_HEIGHT},
            "walls": [
                {
                    "id": w.id,
                    "x": w.x,
                    "y": w.y,
                    "width": w.width,
                    "height": w.height,
                    "destructible": w.destructible,
                    "is_ramp": w.is_ramp,
                }
                for w in WALLS
            ],
            "traps": [
                {"x": t.x, "y": t.y, "size": t.size} for t in self.traps.values()
            ],
            # яма — статичная геометрия карты (как стены/ловушки), шлётся один
            # раз при welcome, а не каждый тик в _broadcast_state
            "pit_zones": [
                {"x": zx, "y": zy, "width": zw, "height": zh} for zx, zy, zw, zh in PIT_ZONES
            ],
        }

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
                    "vx": round(p.vx, 1),
                    "vy": round(p.vy, 1),
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
                    # has_super сохранён для награды за мини-босса (apply_miniboss_kill_reward
                    # всё ещё пишет в super_until — это ДРУГОЙ бафф, статовый, не связан с
                    # пикапом "super" на карте, который теперь превратился в laser_star)
                    "has_super": now < p.super_until,
                    "has_spawn_protection": now < p.spawn_protected_until,
                    "weapon": p.weapon if now < p.weapon_until else "cannon",
                    "is_flaming": now < p.flame_active_until,
                    "is_burning": now < p.burn_until,
                    "laser_star_active": now < p.laser_star_until,
                    "laser_star_angles": p.laser_star_angles if now < p.laser_star_until else [],
                    "is_falling": p.falling_since > 0,
                    "fall_progress": (
                        max(0.0, min(1.0, (now - p.falling_since) / PIT_FALL_TIME))
                        if p.falling_since > 0
                        else 0.0
                    ),
                    "level": p.level,
                    "xp": p.xp,
                    "is_miniboss": p.is_miniboss,
                    "has_miniboss_reward": now < p.miniboss_reward_until,
                    "tank_class": p.tank_class,
                    "gun_skin": p.gun_skin,
                    "ammo": p.ammo,
                    "ammo_max": GUNNER_MAG_SIZE,
                    "reloading": p.tank_class == "gunner" and now < p.reload_until,
                    "reload_progress": (
                        max(0.0, min(1.0, 1 - (p.reload_until - now) / GUNNER_RELOAD_TIME))
                        if p.tank_class == "gunner" and now < p.reload_until
                        else 1.0
                    ),
                    "ultimate_kills": p.ultimate_kills,
                    "ultimate_ready": p.ultimate_kills >= ULTIMATE_KILLS_REQUIRED,
                    "laser_charging": (
                        {
                            "angle": p.laser_angle,
                            "progress": min(
                                1.0,
                                (now - p.laser_started_at)
                                / max(1e-6, p.laser_fire_at - p.laser_started_at),
                            ),
                        }
                        if p.laser_charging_until > now
                        else None
                    ),
                }
                for p in self.players.values()
            ],
            "bullets": [
                {
                    "id": b.id,
                    "owner_id": b.owner_id,
                    "x": round(b.x, 1),
                    "y": round(b.y, 1),
                    "vx": round(b.vx, 1),
                    "vy": round(b.vy, 1),
                    "size": b.size,
                    "kind": b.kind,
                }
                for b in self.bullets.values()
            ],
            "pickups": [
                {"id": pu.id, "x": pu.x, "y": pu.y, "kind": pu.kind}
                for pu in self.pickups.values()
            ],
            "bombs": [
                {
                    "id": bomb.id,
                    "x": bomb.x,
                    "y": bomb.y,
                    "fuse_progress": min(1.0, (now - bomb.spawned_at) / bomb.fuse_time),
                    "radius": bomb.radius,
                    "is_artillery": bool(bomb.owner_id),
                }
                for bomb in self.bombs.values()
            ],
            "explosions": self._explosions,
            # только разрушаемые стены, у которых состояние может меняться —
            # не гоняем все 30 стен каждый тик, только те, что имеют HP
            "wall_states": [
                {"id": w.id, "active": w.is_active, "hp": w.hp}
                for w in WALLS
                if w.destructible
            ],
            "wall_hits": self._wall_hits,
            "wall_breaks": self._wall_breaks,
            "wall_restores": self._wall_restores,
            "hit_sparks": self._hit_sparks,
            "nuke": (
                {
                    "x": self._active_nuke.x,
                    "y": self._active_nuke.y,
                    "radius": self._active_nuke.radius,
                    "warning_progress": min(
                        1.0, (now - self._active_nuke.spawned_at) / NUKE_WARNING_DURATION
                    ),
                }
                if self._active_nuke is not None
                else None
            ),
            "miniboss_spawns": self._miniboss_spawns,
            "level_ups": self._level_ups,
            "laser_shots": self._laser_shots,
            "teleports": self._teleports,
            "round_time_left": (
                0.0
                if self._round_end_banner_until is not None
                else max(0.0, round(ROUND_DURATION - (now - self._round_started_at), 1))
            ),
            "round_end": self._round_ended_event,
            "leaderboard": self._live_leaderboard(),
            "portals": [
                {"id": p.id, "x": p.x, "y": p.y, "link_id": p.link_id}
                for p in self.portals.values()
            ],
            "portal_events": self._portal_events,
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

    async def broadcast_chat(self, entry: dict) -> None:
        # чат — редкое событие, шлём сразу текстом (не ждём следующего
        # тикового бинарного state), в отличие от высокочастотных полей
        payload = {"type": "chat", **entry}
        dead = []
        for pid, ws in list(self.connections.items()):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.remove_player(pid)

    async def add_player(
        self,
        nickname: str,
        ws: WebSocket,
        tank_class: str = DEFAULT_TANK_CLASS,
        gun_skin: str = DEFAULT_GUN_SKIN,
    ) -> Player | None:
        async with self._lock:
            if self.is_full():
                return None
            x, y = self._pick_spawn_point()
            player = Player.new(nickname[:16] or "Player", x, y)
            if tank_class in TANK_CLASSES:
                player.tank_class = tank_class
            if gun_skin in GUN_SKINS:
                player.gun_skin = gun_skin
            self.players[player.id] = player
            self.connections[player.id] = ws
            return player

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        self.connections.pop(player_id, None)
        self._pending_respawns.pop(player_id, None)
        self._pending_respawn_class.pop(player_id, None)
        self._msg_buckets.pop(player_id, None)

    def set_input(self, player_id: str, dir_x: float, dir_y: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.dir_x = clamp(dir_x, -1, 1)
            player.dir_y = clamp(dir_y, -1, 1)

    def set_aim(self, player_id: str, angle: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.turret_angle = angle

    def allow_message(self, player_id: str) -> bool:
        # токен-бакет: каждому входящему WS-сообщению (input/aim/shoot/chat)
        # нужен токен; бакет пополняется со временем, но не может копиться
        # бесконечно — режет как устойчивый флуд, так и короткие всплески
        now = time.monotonic()
        tokens, last_refill = self._msg_buckets.get(player_id, (MSG_BUCKET_CAPACITY, now))
        tokens = min(MSG_BUCKET_CAPACITY, tokens + (now - last_refill) * MSG_BUCKET_REFILL_RATE)
        if tokens < 1.0:
            self._msg_buckets[player_id] = (tokens, now)
            return False
        self._msg_buckets[player_id] = (tokens - 1.0, now)
        return True

    def add_chat_message(self, player_id: str, text: str) -> dict | None:
        player = self.players.get(player_id)
        if player is None:
            return None
        now = time.monotonic()
        if now - player.chat_last_at < CHAT_MIN_INTERVAL:
            return None
        text = text.strip()[:CHAT_MAX_LEN]
        if not text:
            return None
        player.chat_last_at = now
        entry = {"nickname": player.nickname, "text": text, "at": now}
        self._chat_log.append(entry)
        if len(self._chat_log) > CHAT_HISTORY_SIZE:
            self._chat_log = self._chat_log[-CHAT_HISTORY_SIZE:]
        return entry

    def get_chat_history(self) -> list[dict]:
        return self._chat_log[-CHAT_HISTORY_SIZE:]


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rect_intersects_walls(cx: float, cy: float, size: float) -> bool:
    # используется для коллизий игроков: разрушенные стены не блокируют
    # (is_active=False), а рампы дают проехать поверх стены без столкновения
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    on_ramp = False
    hit_solid = False
    for wall in WALLS:
        if not (left < wall.right and right > wall.x and top < wall.bottom and bottom > wall.y):
            continue
        if wall.is_ramp:
            on_ramp = True
            continue
        if wall.is_active:
            hit_solid = True
    return hit_solid and not on_ramp


def _find_intersecting_wall(cx: float, cy: float, size: float):
    # используется для коллизий пуль: рампы игнорируются (пуля бьётся об
    # обычную стену под рампой), разрушенные стены пропускают снаряд насквозь
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    for wall in WALLS:
        if wall.is_ramp or not wall.is_active:
            continue
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

import time
import uuid
from dataclasses import dataclass, field


TANK_SIZE = 32
TANK_SPEED = 160.0  # px/sec, максимальная скорость танка
TANK_ACCEL = 480.0  # px/sec^2, разгон — за 1/3 сек танк набирает полную скорость
TANK_FRICTION = 560.0  # px/sec^2, торможение при отсутствии ввода — чуть резче разгона
TANK_MAX_HP = 100

BULLET_SPEED = 700.0
BULLET_SIZE = 10
BULLET_DAMAGE = 20
FIRE_COOLDOWN = 0.80  # сек между выстрелами
BULLET_MAX_BOUNCES = 1  # рикошет только от внешних границ поля, не от внутренних стен

# Пулемёт: быстрый и слабый, без рикошета — чистый DPS-race на реакции
MINIGUN_COOLDOWN = 0.12
MINIGUN_DAMAGE = 6
MINIGUN_SPEED = 820.0
MINIGUN_SIZE = 6

# Огнемёт: короткий конус, тикающий урон, без баллистики — попадание мгновенное
FLAMETHROWER_COOLDOWN = 0.15
FLAMETHROWER_RANGE = 130.0
FLAMETHROWER_CONE_HALF_ANGLE = 0.45  # радианы (~26°) в каждую сторону от прицела
FLAMETHROWER_TICK_DAMAGE = 4  # урон за один "тик" контакта с конусом
FLAMETHROWER_BURN_DURATION = 2.0  # горение продолжается и после выхода из конуса
FLAMETHROWER_BURN_TICK_DAMAGE = 3
FLAMETHROWER_BURN_INTERVAL = 0.5

# Ракетница: медленный тяжёлый снаряд, взрывается сплэшем при попадании/выключении рикошета
ROCKET_COOLDOWN = 1.6
ROCKET_SPEED = 320.0
ROCKET_SIZE = 14
ROCKET_DIRECT_DAMAGE = 55
ROCKET_SPLASH_RADIUS = 90.0
ROCKET_SPLASH_DAMAGE = 30

WEAPON_KINDS = ("cannon", "minigun", "flamethrower", "rocket")
WEAPON_PICKUP_DURATION = 20.0  # сек, на которые оружие подобрано с карты

PICKUP_SIZE = 20
SPEED_BOOST_DURATION = 8.0
SPEED_BOOST_MULT = 1.6
SLOW_DEBUFF_DURATION = 5.0
SLOW_DEBUFF_MULT = 0.5

TRAP_SIZE = 26
TRAP_DAMAGE = 15
TRAP_SLOW_DURATION = 2.5
TRAP_SLOW_MULT = 0.4
TRAP_TRIGGER_COOLDOWN = 3.0  # сек до повторного срабатывания для того же игрока

COLLISION_DAMAGE = 6  # урон каждому танку при столкновении друг с другом
COLLISION_PUSHBACK = 90.0  # px/sec импульс взаимного отталкивания


@dataclass
class Player:
    id: str
    nickname: str
    x: float
    y: float
    dir_x: float = 0.0
    dir_y: float = 0.0
    vx: float = 0.0  # текущая скорость (инерция: разгон/торможение, не мгновенная)
    vy: float = 0.0
    turret_angle: float = 0.0  # радианы, направление башни (к курсору)
    hp: int = TANK_MAX_HP
    max_hp: int = TANK_MAX_HP
    damage: int = BULLET_DAMAGE
    alive: bool = True
    size: float = TANK_SIZE
    speed: float = TANK_SPEED
    kills: int = 0
    deaths: int = 0
    joined_at: float = field(default_factory=time.monotonic)
    died_at: float | None = None
    last_shot_at: float = -999.0
    armor_until: float = 0.0  # timestamp, до которого действует бонус брони
    damage_until: float = 0.0  # timestamp, до которого действует бонус урона
    speed_boost_until: float = 0.0
    slow_until: float = 0.0
    super_until: float = 0.0  # действие супер-power-up из центра карты
    trap_cooldown_until: float = 0.0  # чтобы одна и та же ловушка не тикала каждый тик
    last_collision_at: float = -999.0  # антиспам урона при затяжном контакте танк-танк
    weapon: str = "cannon"
    weapon_until: float = 0.0  # timestamp, до которого действует подобранное оружие
    flame_active_until: float = 0.0  # окно, в течение которого конус огнемёта активен
    burn_until: float = 0.0  # DoT от огнемёта продолжает тикать после выхода из конуса
    burn_owner_id: str = ""
    last_burn_tick_at: float = -999.0

    def lifetime(self) -> float:
        end = self.died_at if self.died_at is not None else time.monotonic()
        return round(end - self.joined_at, 2)

    def current_speed_mult(self, now: float) -> float:
        mult = 1.0
        if now < self.speed_boost_until:
            mult *= SPEED_BOOST_MULT
        if now < self.slow_until:
            mult *= SLOW_DEBUFF_MULT
        return mult

    @staticmethod
    def new(nickname: str, x: float, y: float) -> "Player":
        return Player(id=str(uuid.uuid4())[:8], nickname=nickname, x=x, y=y)


@dataclass
class Bullet:
    id: str
    owner_id: str
    x: float
    y: float
    vx: float
    vy: float
    damage: int
    size: float = BULLET_SIZE
    bounces_left: int = BULLET_MAX_BOUNCES
    kind: str = "cannon"  # "cannon" | "minigun" | "rocket" — влияет на визуал и на splash при попадании

    @staticmethod
    def new(
        owner_id: str,
        x: float,
        y: float,
        angle: float,
        damage: int,
        speed: float = BULLET_SPEED,
        size: float = BULLET_SIZE,
        bounces: int = BULLET_MAX_BOUNCES,
        kind: str = "cannon",
    ) -> "Bullet":
        import math

        vx = math.cos(angle) * speed
        vy = math.sin(angle) * speed
        return Bullet(
            id=str(uuid.uuid4())[:8],
            owner_id=owner_id,
            x=x,
            y=y,
            vx=vx,
            vy=vy,
            damage=damage,
            size=size,
            bounces_left=bounces,
            kind=kind,
        )


@dataclass
class Wall:
    x: float
    y: float
    width: float
    height: float
    is_border: bool = False  # внешняя граница поля vs внутреннее укрытие
    right: float = field(init=False)
    bottom: float = field(init=False)

    def __post_init__(self) -> None:
        # предвычислено один раз при создании карты, а не на каждой проверке
        # коллизии (rect_intersects_walls вызывается ~сотни раз за тик)
        self.right = self.x + self.width
        self.bottom = self.y + self.height


@dataclass
class Pickup:
    id: str
    x: float
    y: float
    kind: str  # "heal" | "armor" | "damage" | "speed" | "super" | "minigun" | "flamethrower" | "rocket"
    size: float = PICKUP_SIZE

    @staticmethod
    def new(x: float, y: float, kind: str) -> "Pickup":
        return Pickup(id=str(uuid.uuid4())[:8], x=x, y=y, kind=kind)


@dataclass
class Trap:
    id: str
    x: float
    y: float
    size: float = TRAP_SIZE

    @staticmethod
    def new(x: float, y: float) -> "Trap":
        return Trap(id=str(uuid.uuid4())[:8], x=x, y=y)


@dataclass
class Bomb:
    # случайный фоновый авиаудар "для атмосферы поля боя": появляется в
    # случайной точке карты с предупреждением (warning telegraph), через
    # BOMB_FUSE_TIME взрывается сплэш-уроном по всем, кто в радиусе
    id: str
    x: float
    y: float
    spawned_at: float
    radius: float = 70.0

    @staticmethod
    def new(x: float, y: float, now: float) -> "Bomb":
        return Bomb(id=str(uuid.uuid4())[:8], x=x, y=y, spawned_at=now)


BOMB_MIN_INTERVAL = 12.0
BOMB_MAX_INTERVAL = 25.0
BOMB_FUSE_TIME = 2.2  # сек между появлением предупреждения и взрывом
BOMB_DAMAGE = 35
BOMB_RADIUS = 70.0

import time
import uuid
from dataclasses import dataclass, field


TANK_SIZE = 32
TANK_SPEED = 160.0  # px/sec
TANK_MAX_HP = 100

BULLET_SPEED = 700.0
BULLET_SIZE = 10
BULLET_DAMAGE = 20
FIRE_COOLDOWN = 0.80  # сек между выстрелами

PICKUP_SIZE = 20


@dataclass
class Player:
    id: str
    nickname: str
    x: float
    y: float
    dir_x: float = 0.0
    dir_y: float = 0.0
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

    def lifetime(self) -> float:
        end = self.died_at if self.died_at is not None else time.monotonic()
        return round(end - self.joined_at, 2)

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

    @staticmethod
    def new(owner_id: str, x: float, y: float, angle: float, damage: int) -> "Bullet":
        import math

        vx = math.cos(angle) * BULLET_SPEED
        vy = math.sin(angle) * BULLET_SPEED
        return Bullet(
            id=str(uuid.uuid4())[:8],
            owner_id=owner_id,
            x=x,
            y=y,
            vx=vx,
            vy=vy,
            damage=damage,
        )


@dataclass
class Wall:
    x: float
    y: float
    width: float
    height: float


@dataclass
class Pickup:
    id: str
    x: float
    y: float
    kind: str  # "heal" | "armor" | "damage"
    size: float = PICKUP_SIZE

    @staticmethod
    def new(x: float, y: float, kind: str) -> "Pickup":
        return Pickup(id=str(uuid.uuid4())[:8], x=x, y=y, kind=kind)

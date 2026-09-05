import time
import uuid
from dataclasses import dataclass, field


PLAYER_SIZE = 24
PLAYER_SPEED = 220.0  # px/sec


@dataclass
class Player:
    id: str
    nickname: str
    x: float
    y: float
    dir_x: float = 0.0
    dir_y: float = 0.0
    alive: bool = True
    size: float = PLAYER_SIZE
    speed: float = PLAYER_SPEED
    joined_at: float = field(default_factory=time.monotonic)
    died_at: float | None = None

    def lifetime(self) -> float:
        end = self.died_at if self.died_at is not None else time.monotonic()
        return round(end - self.joined_at, 2)

    @staticmethod
    def new(nickname: str, x: float, y: float) -> "Player":
        return Player(id=str(uuid.uuid4())[:8], nickname=nickname, x=x, y=y)


@dataclass
class Projectile:
    id: str
    x: float
    y: float
    vx: float
    vy: float
    size: float

    @staticmethod
    def new(x: float, y: float, vx: float, vy: float, size: float) -> "Projectile":
        return Projectile(id=str(uuid.uuid4())[:8], x=x, y=y, vx=vx, vy=vy, size=size)

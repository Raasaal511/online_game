import math
import time

import pytest

from app.game.entities import Player, Bullet, WALL_MAX_HP
from app.game.map import WALLS, FIELD_WIDTH, FIELD_HEIGHT, ray_distance_to_field_edge
from app.game.room import rect_intersects_walls, _find_intersecting_wall


def test_ray_distance_to_field_edge_from_center():
    cx, cy = FIELD_WIDTH / 2, FIELD_HEIGHT / 2
    # вправо от центра — до правого края
    assert ray_distance_to_field_edge(cx, cy, 0.0) == pytest.approx(FIELD_WIDTH / 2)
    # вниз от центра — до нижнего края
    assert ray_distance_to_field_edge(cx, cy, math.pi / 2) == pytest.approx(FIELD_HEIGHT / 2)
    # влево от центра — до левого края
    assert ray_distance_to_field_edge(cx, cy, math.pi) == pytest.approx(FIELD_WIDTH / 2)


def test_ray_distance_to_field_edge_never_exceeds_field_bounds():
    # луч из произвольной точки под произвольным углом должен всегда
    # заканчиваться строго внутри границ поля (с небольшим допуском на
    # погрешность вычислений с плавающей точкой)
    x, y = FIELD_WIDTH * 0.2, FIELD_HEIGHT * 0.8
    for i in range(16):
        angle = i * (2 * math.pi / 16)
        dist = ray_distance_to_field_edge(x, y, angle)
        end_x = x + math.cos(angle) * dist
        end_y = y + math.sin(angle) * dist
        assert -0.5 <= end_x <= FIELD_WIDTH + 0.5
        assert -0.5 <= end_y <= FIELD_HEIGHT + 0.5


def _shoot_wall_once(room, player_id, wall):
    cx = wall.x + wall.width / 2
    cy = wall.y + wall.height / 2
    b = Bullet.new(player_id, cx - 100, cy, 0.0, 20)
    room.bullets[b.id] = b
    for _ in range(30):
        if b.id not in room.bullets:
            break
        room._move_bullets()


def test_destructible_wall_breaks_after_two_hits(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    wall = next(w for w in WALLS if w.destructible)
    wall.hp = 2
    wall.destroyed_at = None

    _shoot_wall_once(room, p.id, wall)
    assert wall.hp == 1
    assert wall.is_active

    _shoot_wall_once(room, p.id, wall)
    assert not wall.is_active, "wall should be destroyed after exactly 2 hits"


def test_destroyed_wall_does_not_block_movement(room):
    wall = next(w for w in WALLS if w.destructible)
    wall.hp = 0
    wall.destroyed_at = time.monotonic()

    cx = wall.x + wall.width / 2
    cy = wall.y + wall.height / 2
    assert not rect_intersects_walls(cx, cy, 20), "destroyed wall should not block movement"

    wall.hp = 2
    wall.destroyed_at = None  # restore for other tests sharing module-level WALLS


def test_wall_respawns_after_delay(room):
    wall = next(w for w in WALLS if w.destructible)
    wall.hp = 0
    wall.destroyed_at = time.monotonic() - 999  # force expiry

    room._process_wall_respawns(time.monotonic())

    assert wall.is_active
    assert wall.hp == WALL_MAX_HP
    wall.destroyed_at = None



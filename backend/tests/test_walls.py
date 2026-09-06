import time

from app.game.entities import Player, Bullet
from app.game.map import WALLS
from app.game.room import rect_intersects_walls, _find_intersecting_wall


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
    assert wall.hp == 2
    wall.destroyed_at = None


def test_ramp_allows_players_but_bullets_hit_underlying_wall(room):
    ramp = next(w for w in WALLS if w.is_ramp)
    cx = ramp.x + ramp.width / 2
    cy = ramp.y + ramp.height / 2

    assert not rect_intersects_walls(cx, cy, 32), "player should pass freely over a ramp"

    underlying_wall = _find_intersecting_wall(cx, cy, 10)
    assert underlying_wall is not None, "bullet should still collide with wall beneath ramp"
    assert not underlying_wall.is_ramp

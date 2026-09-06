import asyncio
import time

import pytest

from app.game.entities import Player, Bullet
from app.game.map import SPAWN_POINTS


@pytest.mark.asyncio
async def test_bomb_spawns_and_explodes_with_damage(room):
    room._next_bomb_at = time.monotonic() - 1  # force immediate spawn
    p = Player.new("Test", 700, 450)
    room.players[p.id] = p

    room._spawn_bombs(time.monotonic())
    assert len(room.bombs) == 1
    bomb = list(room.bombs.values())[0]

    p.x, p.y = bomb.x, bomb.y
    hp_before = p.hp
    bomb.spawned_at = time.monotonic() - 10  # force fuse expiry
    room._process_bombs(time.monotonic())
    await asyncio.sleep(0)

    assert p.hp < hp_before
    assert len(room.bombs) == 0, "bomb should be removed after exploding"
    assert len(room._explosions) == 1


def test_spawn_point_avoids_bullet_danger_zones(room):
    safe_point = SPAWN_POINTS[0]
    for pt in SPAWN_POINTS[1:]:
        b = Bullet.new("x", pt[0], pt[1], 0.0, 20)
        room.bullets[b.id] = b

    chosen = room._pick_spawn_point()
    assert chosen == safe_point, f"expected the only bullet-free point, got {chosen}"


def test_spawn_protection_blocks_damage_then_expires(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    room._respawn(p.id)

    assert p.spawn_protected_until > time.monotonic()

    hp_before = p.hp
    room._apply_damage(p, 50, "someone")
    assert p.hp == hp_before, "damage should be blocked during spawn protection"

    p.spawn_protected_until = time.monotonic() - 1
    room._apply_damage(p, 50, "someone")
    assert p.hp == hp_before - 50, "damage should apply normally after protection expires"

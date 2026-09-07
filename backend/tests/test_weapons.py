import asyncio
import time

import pytest

from app.game.entities import Player


def test_ice_weapon_fires_and_slows_target_on_hit(room):
    # "minigun" убран из пула пикапов карты (дублировал класс gunner) — этот
    # тест теперь покрывает "ice", занявший его место в пуле (см. PICKUP_KINDS
    # в room.py и WEAPON_KINDS в entities.py)
    p1 = Player.new("P1", 100, 100)
    p2 = Player.new("P2", 200, 100)
    room.players[p1.id] = p1
    room.players[p2.id] = p2

    now = time.monotonic()
    p1.weapon = "ice"
    p1.weapon_until = now + 30
    p1.turret_angle = 0.0

    hp_before = p2.hp
    room.try_shoot(p1.id, use_pickup=True)
    assert len(room.bullets) == 1
    bullet = list(room.bullets.values())[0]
    assert bullet.kind == "ice"

    for _ in range(10):
        room._tick()
        if p2.hp < hp_before:
            break
    else:
        raise AssertionError("ice bullet never hit the target")

    assert p2.slow_until > time.monotonic(), "ice hit should slow the target"


def test_rocket_direct_damage_matches_buffed_constant(room):
    # баланс поднят: ROCKET_DIRECT_DAMAGE было 55, теперь 65 (см. entities.py)
    from app.game.entities import ROCKET_DIRECT_DAMAGE

    assert ROCKET_DIRECT_DAMAGE == 65

    p1 = Player.new("P1", 100, 450)
    p2 = Player.new("P2", 400, 450)
    room.players[p1.id] = p1
    room.players[p2.id] = p2

    now = time.monotonic()
    p1.weapon = "rocket"
    p1.weapon_until = now + 30
    p1.turret_angle = 0.0

    room.try_shoot(p1.id, use_pickup=True)
    bullet = list(room.bullets.values())[0]
    assert bullet.damage == ROCKET_DIRECT_DAMAGE


def test_rocket_deals_splash_damage(room):
    p1 = Player.new("P1", 100, 450)
    p2 = Player.new("P2", 400, 450)
    p3 = Player.new("P3", 420, 470)  # near p2, should catch splash
    room.players[p1.id] = p1
    room.players[p2.id] = p2
    room.players[p3.id] = p3

    now = time.monotonic()
    p1.weapon = "rocket"
    p1.weapon_until = now + 30
    p1.turret_angle = 0.0

    room.try_shoot(p1.id, use_pickup=True)
    assert len(room.bullets) == 1
    assert list(room.bullets.values())[0].kind == "rocket"

    hp2_before, hp3_before = p2.hp, p3.hp
    for _ in range(60):
        room._tick()
        if p2.hp < hp2_before or p3.hp < hp3_before:
            break
    else:
        raise AssertionError("rocket never exploded")

    assert p2.hp < hp2_before, "direct target should take damage"
    assert p3.hp < hp3_before, "nearby player should take splash damage"


@pytest.mark.asyncio
async def test_flamethrower_deals_cone_damage_and_burn_dot(room):
    p1 = Player.new("P1", 100, 450)
    p2 = Player.new("P2", 180, 450)  # within FLAMETHROWER_RANGE
    room.players[p1.id] = p1
    room.players[p2.id] = p2

    now = time.monotonic()
    p1.weapon = "flamethrower"
    p1.weapon_until = now + 30
    p1.turret_angle = 0.0

    hp_before = p2.hp
    room.try_shoot(p1.id, use_pickup=True)
    assert len(room.bullets) == 0, "flamethrower should not create projectiles"

    for _ in range(3):
        room.try_shoot(p1.id, use_pickup=True)
        room._tick()
        await asyncio.sleep(0)

    assert p2.hp < hp_before or not p2.alive

    if p2.alive:
        hp_after_flame = p2.hp
        for _ in range(40):
            room._tick()
            await asyncio.sleep(0)
        assert p2.hp < hp_after_flame or not p2.alive, "burn DoT should keep ticking"

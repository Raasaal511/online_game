import time

import pytest

from app.game.entities import Player, Pickup


def test_trap_damages_and_slows_player(room):
    trap = next(iter(room.traps.values()))
    p = Player.new("Test", trap.x, trap.y)
    room.players[p.id] = p

    hp_before = p.hp
    room._check_trap_collisions(time.monotonic())

    assert p.hp < hp_before
    assert p.slow_until > time.monotonic()


def test_tank_collision_damages_and_pushes_back(room):
    a = Player.new("A", 700, 450)
    b = Player.new("B", 715, 450)  # overlapping (size=32, dist=15 < 32)
    room.players[a.id] = a
    room.players[b.id] = b

    hp_before = a.hp
    room._check_tank_collisions(time.monotonic())

    assert a.hp < hp_before
    assert a.x < 700, "player should be pushed back from collision"


def test_super_pickup_grants_laser_star(room):
    # "super" больше не выдаёт пассивный стат-бафф (урон/броня/скорость) —
    # превращает танк в лазерную турель на LASER_STAR_DURATION секунд с 8
    # лучами, зафиксированными под углом в момент подбора (см. room.py._apply_pickup)
    from app.game.entities import LASER_STAR_BEAM_COUNT

    now = time.monotonic()
    x, y = 700, 450
    pickup = Pickup.new(x, y, "super")
    room.pickups[pickup.id] = pickup

    p = Player.new("Test", x, y)
    p.hp = 10  # damaged, should be fully healed by the super pickup
    p.turret_angle = 0.5
    room.players[p.id] = p

    room._check_pickup_collisions(now)

    assert now < p.laser_star_until
    assert p.hp == p.max_hp
    assert len(p.laser_star_angles) == LASER_STAR_BEAM_COUNT
    assert p.laser_star_angles[0] == pytest.approx(0.5)


def test_weapon_pickup_equips_weapon(room):
    x, y = 700, 450
    pickup = Pickup.new(x, y, "rocket")
    room.pickups[pickup.id] = pickup

    p = Player.new("Test", x, y)
    room.players[p.id] = p

    room._check_pickup_collisions(time.monotonic())

    assert p.weapon == "rocket"
    assert p.weapon_until > time.monotonic()


def test_ice_bullet_slows_target_on_hit(room):
    from app.game.entities import Bullet

    p1 = Player.new("P1", 100, 100)
    p2 = Player.new("P2", 106, 100)  # overlapping so the bullet collides immediately
    room.players[p1.id] = p1
    room.players[p2.id] = p2

    bullet = Bullet.new(p1.id, p2.x, p2.y, 0.0, 20, kind="ice")
    room.bullets[bullet.id] = bullet

    now = time.monotonic()
    room._check_bullet_collisions()

    assert p2.slow_until > now, "ice bullet should apply a slow debuff on hit"
    # короткий и мягкий дебафф, а не полноценный slow ловушки
    from app.game.entities import ICE_SLOW_DURATION

    assert p2.slow_until <= now + ICE_SLOW_DURATION + 0.1


@pytest.mark.asyncio
async def test_pit_zone_kills_player_after_fall_time(room):
    # _kill_player планирует asyncio.create_task(_handle_death) — нужен
    # реально работающий event loop, как и у остальных тестов, доходящих до смерти
    from app.game.entities import PIT_FALL_TIME
    from app.game.map import SUPER_PICKUP_POINT

    # угол ядра крепости заведомо внутри одной из PIT_ZONES (не на мосту)
    cx, cy = SUPER_PICKUP_POINT
    p = Player.new("Faller", cx - 150, cy - 150)
    room.players[p.id] = p

    t0 = time.monotonic()
    room._process_pits(t0)
    assert p.alive, "falling should take a brief moment, not kill instantly"
    assert p.falling_since > 0

    # переносим falling_since в прошлое, чтобы имитировать истечение PIT_FALL_TIME
    p.falling_since = t0 - PIT_FALL_TIME - 0.01
    room._process_pits(time.monotonic())
    assert not p.alive, "player should die after PIT_FALL_TIME in a pit zone"


def test_pit_zone_spares_player_who_leaves_in_time(room):
    from app.game.map import SUPER_PICKUP_POINT

    cx, cy = SUPER_PICKUP_POINT
    p = Player.new("Runner", cx - 150, cy - 150)
    room.players[p.id] = p

    room._process_pits(time.monotonic())
    assert p.falling_since > 0

    # выехал на безопасный мост до истечения времени падения
    p.x, p.y = cx, cy
    room._process_pits(time.monotonic())
    assert p.falling_since == 0.0
    assert p.alive


def test_laser_star_ticks_damage_on_nearby_target(room):
    p1 = Player.new("P1", 400, 400)
    p2 = Player.new("P2", 450, 400)  # прямо по одному из 8 фиксированных лучей (угол 0)
    room.players[p1.id] = p1
    room.players[p2.id] = p2

    now = time.monotonic()
    p1.turret_angle = 0.0
    p1.laser_star_until = now + 5.0
    from app.game.entities import LASER_STAR_BEAM_COUNT
    import math

    p1.laser_star_angles = [i * (2 * math.pi / LASER_STAR_BEAM_COUNT) for i in range(LASER_STAR_BEAM_COUNT)]
    p1.laser_star_last_tick_at = -999.0

    hp_before = p2.hp
    room._process_laser_star(time.monotonic())

    assert p2.hp < hp_before, "target on one of the 8 fixed beams should take tick damage"

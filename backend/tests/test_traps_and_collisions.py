import time

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


def test_super_pickup_grants_combined_buffs(room):
    now = time.monotonic()
    x, y = 700, 450
    pickup = Pickup.new(x, y, "super")
    room.pickups[pickup.id] = pickup

    p = Player.new("Test", x, y)
    p.hp = 10  # damaged, should be fully healed by the super pickup
    room.players[p.id] = p

    room._check_pickup_collisions(now)

    assert now < p.super_until
    assert p.hp == p.max_hp
    assert now < p.speed_boost_until


def test_weapon_pickup_equips_weapon(room):
    x, y = 700, 450
    pickup = Pickup.new(x, y, "rocket")
    room.pickups[pickup.id] = pickup

    p = Player.new("Test", x, y)
    room.players[p.id] = p

    room._check_pickup_collisions(time.monotonic())

    assert p.weapon == "rocket"
    assert p.weapon_until > time.monotonic()

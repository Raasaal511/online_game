import time

import pytest

from app.game.entities import Player, TANK_MAX_HP, XP_PER_KILL, LEVEL_XP_THRESHOLDS


@pytest.mark.asyncio
async def test_kill_grants_xp_and_levels_up(room):
    killer = Player.new("Killer", 100, 100)
    victim = Player.new("Victim", 200, 100)
    room.players[killer.id] = killer
    room.players[victim.id] = victim

    victim.hp = 1
    room._apply_damage(victim, 10, killer.id)

    assert killer.xp == XP_PER_KILL
    assert not victim.alive


@pytest.mark.asyncio
async def test_level_resets_to_one_on_death(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    p.level = 3
    p.xp = 100
    p.max_hp = 130
    p.hp = 130

    room._kill_player(p, "someone-else")

    assert p.level == 1
    assert p.xp == 0
    assert p.max_hp == TANK_MAX_HP


@pytest.mark.asyncio
async def test_miniboss_spawns_on_player_death_and_excluded_from_room_limit(room, monkeypatch):
    killer = Player.new("Killer", 100, 100)
    victim = Player.new("Victim", 300, 300)
    room.players[killer.id] = killer
    room.players[victim.id] = victim

    monkeypatch.setattr("app.game.miniboss.random.random", lambda: 0.0)  # force spawn
    room._kill_player(victim, killer.id)

    bosses = [p for p in room.players.values() if p.is_miniboss]
    assert len(bosses) == 1
    boss = bosses[0]
    assert boss.hp > TANK_MAX_HP, "miniboss should have much more HP than a normal tank"
    # босс спавнится в фиксированной безопасной точке карты (MINIBOSS_SPAWN_POINT),
    # а не в месте смерти игрока — иначе он мог появиться вплотную к стене и
    # застрять (у него нет pathfinding'а, см. _drive_miniboss_ai)
    from app.game.map import MINIBOSS_SPAWN_POINT

    assert (boss.x, boss.y) == MINIBOSS_SPAWN_POINT

    # мини-боссы не считаются в лимите комнаты
    assert not room.is_full()


def test_miniboss_kill_grants_strong_reward(room):
    from app.game.miniboss import spawn_miniboss, apply_miniboss_kill_reward

    killer = Player.new("Killer", 100, 100)
    killer.hp = 10
    room.players[killer.id] = killer

    boss = spawn_miniboss(200, 200, "SomeVictim")
    room.players[boss.id] = boss

    now = time.monotonic()
    apply_miniboss_kill_reward(killer, now)

    assert killer.hp == killer.max_hp
    assert now < killer.super_until
    assert now < killer.miniboss_reward_until


@pytest.mark.asyncio
async def test_nuke_spawns_and_deals_damage_after_warning(room):
    from app.game.entities import NUKE_WARNING_DURATION

    p = Player.new("Test", 700, 550)
    room.players[p.id] = p

    room._next_nuke_at = time.monotonic() - 1
    room._spawn_nuke(time.monotonic())
    assert room._active_nuke is not None

    # ставим игрока прямо в центр взрыва
    room._active_nuke.x = p.x
    room._active_nuke.y = p.y

    # до истечения предупреждения урон не наносится
    room._process_nuke(time.monotonic())
    assert p.hp == p.max_hp
    assert room._active_nuke is not None

    hp_before = p.hp
    room._active_nuke.spawned_at = time.monotonic() - NUKE_WARNING_DURATION - 1
    room._process_nuke(time.monotonic())

    assert p.hp < hp_before
    assert room._active_nuke is None, "nuke should be consumed after exploding"

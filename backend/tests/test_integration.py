import time

from app.game.entities import Player


def test_full_tick_cycle_runs_stably_with_all_systems_active(room):
    p1 = Player.new("P1", 100, 100)
    p2 = Player.new("P2", 200, 100)
    room.players[p1.id] = p1
    room.players[p2.id] = p2
    p1.dir_x = 1.0
    room.try_shoot(p1.id)

    for _ in range(300):
        room._tick()

    assert all(p.hp >= 0 for p in room.players.values())
    assert len(room.traps) == 4


def test_kills_are_not_reset_on_respawn(room):
    # регрессия: player.kills раньше обнулялся в _respawn(), из-за чего
    # ScoreBoard и запись в топ-3 при повторной смерти теряли накопленные фраги
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    p.kills = 5

    room._respawn(p.id)

    assert p.kills == 5

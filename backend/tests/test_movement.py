import time

from app.game.entities import Player, TANK_SPEED


def test_inertia_accelerates_gradually(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    p.dir_x, p.dir_y = 1.0, 0.0

    for _ in range(5):
        room._move_players(time.monotonic())
    partial_speed = (p.vx**2 + p.vy**2) ** 0.5

    assert 0 < partial_speed < TANK_SPEED, (
        f"expected partial speed after 5 ticks, got {partial_speed} (max {TANK_SPEED})"
    )


def test_inertia_reaches_max_speed(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    p.dir_x, p.dir_y = 1.0, 0.0

    for _ in range(35):
        room._move_players(time.monotonic())
    full_speed = (p.vx**2 + p.vy**2) ** 0.5

    assert abs(full_speed - TANK_SPEED) < 1.0


def test_friction_brakes_gradually_not_instantly(room):
    p = Player.new("Test", 100, 100)
    room.players[p.id] = p
    p.dir_x, p.dir_y = 1.0, 0.0
    for _ in range(35):
        room._move_players(time.monotonic())
    full_speed = (p.vx**2 + p.vy**2) ** 0.5

    p.dir_x, p.dir_y = 0.0, 0.0
    room._move_players(time.monotonic())
    speed_after_release = (p.vx**2 + p.vy**2) ** 0.5

    assert 0 < speed_after_release < full_speed


def test_player_stops_cleanly_at_border_and_can_reverse(room):
    # регрессия: clamp() к границам поля раньше подгонял позицию ВНУТРЬ
    # толщины периметровой стены, из-за чего коллизия навсегда блокировала
    # движение в любую сторону (танк застревал у края карты без возможности
    # отъехать назад)
    from app.game.map import FIELD_WIDTH

    p = Player.new("Test", 1300, 80)  # открытая полоса у верхнего края, вдали от крепости
    room.players[p.id] = p
    p.dir_x, p.dir_y = 1.0, 0.0

    for _ in range(300):
        room._move_players(time.monotonic())

    stuck_x = p.x
    assert stuck_x < FIELD_WIDTH - 24, f"player clipped into border wall: {stuck_x}"
    assert stuck_x > FIELD_WIDTH - 24 - 20, f"player stopped too far from wall: {stuck_x}"

    p.dir_x, p.dir_y = -1.0, 0.0
    for _ in range(30):
        room._move_players(time.monotonic())

    assert p.x < stuck_x - 20, (
        f"player stuck at wall, could not reverse away: {p.x} vs was {stuck_x}"
    )


def test_player_does_not_get_stuck_in_any_corner(room):
    from app.game.map import FIELD_WIDTH, FIELD_HEIGHT

    corners = [
        ((1300, 80), (1, -1)),
        ((100, 80), (-1, -1)),
        ((1300, 820), (1, 1)),
        ((100, 820), (-1, 1)),
    ]
    for start, direction in corners:
        p = Player.new("Test", *start)
        room.players.clear()
        room.players[p.id] = p
        p.dir_x, p.dir_y = direction

        for _ in range(400):
            room._move_players(time.monotonic())
        stuck_pos = (p.x, p.y)

        p.dir_x, p.dir_y = -direction[0], -direction[1]
        for _ in range(30):
            room._move_players(time.monotonic())

        moved = abs(p.x - stuck_pos[0]) > 15 or abs(p.y - stuck_pos[1]) > 15
        assert moved, f"player stuck in corner starting at {start}, direction {direction}"

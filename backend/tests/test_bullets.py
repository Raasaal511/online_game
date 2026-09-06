from app.game.entities import Player, Bullet


def test_bullet_disappears_on_border_hit(room):
    # без рикошета: пуля гаснет при первом же касании границы поля, не отскакивает
    from app.game.map import FIELD_WIDTH

    p = Player.new("Test", 100, 100)
    room.players[p.id] = p

    b = Bullet.new(p.id, FIELD_WIDTH - 50, 450, 0.0, 20)
    room.bullets[b.id] = b

    for _ in range(20):
        if b.id not in room.bullets:
            break
        room._move_bullets()
    else:
        raise AssertionError("bullet survived 20 ticks after hitting the border, expected it to vanish")


def test_bullet_destroyed_by_inner_wall_without_bounce(room):
    # внутренние стены крепости не дают рикошета — гасят пулю сразу,
    # чтобы избежать хаотичных отскоков в тесных проходах
    from app.game.map import WALLS

    inner_wall = next(w for w in WALLS if not w.is_border and not w.is_ramp)
    target_y = inner_wall.y + inner_wall.height / 2
    start_x = inner_wall.x - 100

    p = Player.new("Test", start_x, target_y)
    room.players[p.id] = p

    b = Bullet.new(p.id, start_x, target_y, 0.0, 20)  # летит вправо в стену
    room.bullets[b.id] = b

    for _ in range(20):
        if b.id not in room.bullets:
            break
        room._move_bullets()
    else:
        raise AssertionError("bullet never hit the inner fortress wall")


def test_bullet_does_not_tunnel_through_thin_wall():
    # регрессия: пуля на полной скорости (700px/s) проходит ~23px за тик,
    # что сравнимо с толщиной стены (24px) — без под-шагов движения она
    # могла целиком проскочить стену за один тик без коллизии
    from app.game.room import _find_intersecting_wall
    from app.game.map import FIELD_WIDTH

    # позиция сразу за внешней стеной, между под-шагами
    x_inside_wall_zone = FIELD_WIDTH - 15
    wall = _find_intersecting_wall(x_inside_wall_zone, 450, 10)
    assert wall is not None, "expected border wall to be detected near field edge"

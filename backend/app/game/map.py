from app.game.entities import Wall

FIELD_WIDTH = 1700
FIELD_HEIGHT = 1100

WALL_THICKNESS = 24

# Карта v3 — "Крепость" (расширенная): открытое кольцо по периметру для
# манёвра/спавна, внутреннее укреплённое ядро с четырьмя проходами, диагональные
# укрытия во внутреннем кольце и рампы у части стен крепости для переезда сверху.
# Внутренние укрытия (destructible=True) разрушаются за 2 попадания и
# восстанавливаются через WALL_RESPAWN_DELAY секунд.
WALLS: list[Wall] = [
    # внешние границы (чтобы танки и снаряды не улетали за карту) — единственные
    # стены, от которых рикошетят пули (is_border=True); внутренние укрытия
    # просто гасят пулю, чтобы рикошет не был хаотичным внутри крепости
    Wall(0, 0, FIELD_WIDTH, WALL_THICKNESS, is_border=True),
    Wall(0, FIELD_HEIGHT - WALL_THICKNESS, FIELD_WIDTH, WALL_THICKNESS, is_border=True),
    Wall(0, 0, WALL_THICKNESS, FIELD_HEIGHT, is_border=True),
    Wall(FIELD_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, FIELD_HEIGHT, is_border=True),

    # центральное кольцевое укрепление с 4 проходами (крепость) — разрушаемое,
    # северная и южная стены дополнительно снабжены рампой для переезда сверху
    Wall(FIELD_WIDTH / 2 - 220, FIELD_HEIGHT / 2 - 170, 170, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 + 50, FIELD_HEIGHT / 2 - 170, 170, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 - 220, FIELD_HEIGHT / 2 + 135, 170, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 + 50, FIELD_HEIGHT / 2 + 135, 170, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 - 220, FIELD_HEIGHT / 2 - 170, 30, 170, destructible=True),
    Wall(FIELD_WIDTH / 2 - 220, FIELD_HEIGHT / 2 + 0, 30, 135, destructible=True),
    Wall(FIELD_WIDTH / 2 + 185, FIELD_HEIGHT / 2 - 170, 30, 170, destructible=True),
    Wall(FIELD_WIDTH / 2 + 185, FIELD_HEIGHT / 2 + 0, 30, 135, destructible=True),

    # рампы поверх части крепостных стен — танк, заехавший на рампу, "поверх"
    # стены (визуально приподнят), коллизия для игроков на этом участке не
    # действует; пули всё ещё простреливают саму стену как обычно
    Wall(FIELD_WIDTH / 2 - 220, FIELD_HEIGHT / 2 - 170, 60, 30, is_ramp=True),
    Wall(FIELD_WIDTH / 2 + 160, FIELD_HEIGHT / 2 + 135, 60, 30, is_ramp=True),

    # ядро в центре крепости оставлено открытым — здесь стоит супер-power-up,
    # так что вместо укрытия здесь открытая площадка под перекрёстным огнём
    # диагональные укрытия во внутреннем кольце (NW/NE/SW/SE) — разрушаемые
    Wall(300, 190, 180, 28, destructible=True),
    Wall(300, 190, 28, 155, destructible=True),

    Wall(FIELD_WIDTH - 480, 190, 180, 28, destructible=True),
    Wall(FIELD_WIDTH - 328, 190, 28, 155, destructible=True),

    Wall(300, FIELD_HEIGHT - 218, 28, 155, destructible=True),
    Wall(300, FIELD_HEIGHT - 218, 180, 28, destructible=True),

    Wall(FIELD_WIDTH - 328, FIELD_HEIGHT - 345, 28, 155, destructible=True),
    Wall(FIELD_WIDTH - 480, FIELD_HEIGHT - 218, 180, 28, destructible=True),

    # короткие простреливаемые баррикады у боковых проходов — разрушаемые
    Wall(FIELD_WIDTH / 2 - 15, 100, 30, 130, destructible=True),
    Wall(FIELD_WIDTH / 2 - 15, FIELD_HEIGHT - 230, 30, 130, destructible=True),
    Wall(180, FIELD_HEIGHT / 2 - 15, 150, 30, destructible=True),
    Wall(FIELD_WIDTH - 330, FIELD_HEIGHT / 2 - 15, 150, 30, destructible=True),

    # новые угловые укрытия в расширенных зонах карты (симметричные пары)
    Wall(560, 90, 30, 120, destructible=True),
    Wall(FIELD_WIDTH - 590, 90, 30, 120, destructible=True),
    Wall(560, FIELD_HEIGHT - 210, 30, 120, destructible=True),
    Wall(FIELD_WIDTH - 590, FIELD_HEIGHT - 210, 30, 120, destructible=True),
]

# Точки спавна игроков — вынесены во внешнее открытое кольцо, подальше от
# крепости и внутренних укрытий, чтобы респавн не попадал под обстрел центра
SPAWN_POINTS: list[tuple[float, float]] = [
    (90, 90),
    (FIELD_WIDTH - 90, 90),
    (90, FIELD_HEIGHT - 90),
    (FIELD_WIDTH - 90, FIELD_HEIGHT - 90),
    (FIELD_WIDTH / 2, 65),
    (FIELD_WIDTH / 2, FIELD_HEIGHT - 65),
    (65, FIELD_HEIGHT / 2),
    (FIELD_WIDTH - 65, FIELD_HEIGHT / 2),
    (FIELD_WIDTH / 2 - 580, FIELD_HEIGHT / 2 - 140),
    (FIELD_WIDTH / 2 + 580, FIELD_HEIGHT / 2 + 140),
]

# Ловушки — фиксированные позиции в 4 проходах крепости: срезать путь через
# центр рискованно (урон + замедление), в отличие от обхода по внешнему кольцу
TRAP_POINTS: list[tuple[float, float]] = [
    (FIELD_WIDTH / 2, FIELD_HEIGHT / 2 - 195),
    (FIELD_WIDTH / 2, FIELD_HEIGHT / 2 + 195),
    (FIELD_WIDTH / 2 - 245, FIELD_HEIGHT / 2),
    (FIELD_WIDTH / 2 + 245, FIELD_HEIGHT / 2),
]

# Точка супер-power-up — прямо в центральном ядре крепости (самое опасное,
# но самое ценное место карты; единственная точка спавна для kind="super")
SUPER_PICKUP_POINT: tuple[float, float] = (FIELD_WIDTH / 2, FIELD_HEIGHT / 2)

from app.game.entities import Wall

FIELD_WIDTH = 1400
FIELD_HEIGHT = 900

WALL_THICKNESS = 24

# Карта v2 — "Крепость": открытое кольцо по периметру для манёвра/спавна,
# внутреннее укреплённое ядро с четырьмя проходами и рассредоточенные
# диагональные укрытия в средней зоне. Рассчитана на до 10 игроков.
WALLS: list[Wall] = [
    # внешние границы (чтобы танки и снаряды не улетали за карту) — единственные
    # стены, от которых рикошетят пули (is_border=True); внутренние укрытия
    # просто гасят пулю, чтобы рикошет не был хаотичным внутри крепости
    Wall(0, 0, FIELD_WIDTH, WALL_THICKNESS, is_border=True),
    Wall(0, FIELD_HEIGHT - WALL_THICKNESS, FIELD_WIDTH, WALL_THICKNESS, is_border=True),
    Wall(0, 0, WALL_THICKNESS, FIELD_HEIGHT, is_border=True),
    Wall(FIELD_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, FIELD_HEIGHT, is_border=True),

    # центральное кольцевое укрепление с 4 проходами (крепость)
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 - 140, 140, 30),
    Wall(FIELD_WIDTH / 2 + 40, FIELD_HEIGHT / 2 - 140, 140, 30),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 + 110, 140, 30),
    Wall(FIELD_WIDTH / 2 + 40, FIELD_HEIGHT / 2 + 110, 140, 30),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 - 140, 30, 140),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 + 0, 30, 110),
    Wall(FIELD_WIDTH / 2 + 150, FIELD_HEIGHT / 2 - 140, 30, 140),
    Wall(FIELD_WIDTH / 2 + 150, FIELD_HEIGHT / 2 + 0, 30, 110),

    # ядро в центре крепости оставлено открытым — здесь стоит супер-power-up,
    # так что вместо укрытия здесь открытая площадка под перекрёстным огнём
    # диагональные укрытия во внутреннем кольце (NW/NE/SW/SE)
    Wall(260, 160, 150, 28),
    Wall(260, 160, 28, 130),

    Wall(FIELD_WIDTH - 410, 160, 150, 28),
    Wall(FIELD_WIDTH - 288, 160, 28, 130),

    Wall(260, FIELD_HEIGHT - 188, 28, 130),
    Wall(260, FIELD_HEIGHT - 188, 150, 28),

    Wall(FIELD_WIDTH - 288, FIELD_HEIGHT - 290, 28, 130),
    Wall(FIELD_WIDTH - 410, FIELD_HEIGHT - 188, 150, 28),

    # короткие простреливаемые баррикады у боковых проходов
    Wall(FIELD_WIDTH / 2 - 15, 90, 30, 110),
    Wall(FIELD_WIDTH / 2 - 15, FIELD_HEIGHT - 200, 30, 110),
    Wall(160, FIELD_HEIGHT / 2 - 15, 130, 30),
    Wall(FIELD_WIDTH - 290, FIELD_HEIGHT / 2 - 15, 130, 30),
]

# Точки спавна игроков — вынесены во внешнее открытое кольцо, подальше от
# крепости и внутренних укрытий, чтобы респавн не попадал под обстрел центра
SPAWN_POINTS: list[tuple[float, float]] = [
    (80, 80),
    (FIELD_WIDTH - 80, 80),
    (80, FIELD_HEIGHT - 80),
    (FIELD_WIDTH - 80, FIELD_HEIGHT - 80),
    (FIELD_WIDTH / 2, 60),
    (FIELD_WIDTH / 2, FIELD_HEIGHT - 60),
    (60, FIELD_HEIGHT / 2),
    (FIELD_WIDTH - 60, FIELD_HEIGHT / 2),
    (FIELD_WIDTH / 2 - 480, FIELD_HEIGHT / 2 - 120),
    (FIELD_WIDTH / 2 + 480, FIELD_HEIGHT / 2 + 120),
]

# Ловушки — фиксированные позиции в 4 проходах крепости: срезать путь через
# центр рискованно (урон + замедление), в отличие от обхода по внешнему кольцу
TRAP_POINTS: list[tuple[float, float]] = [
    (FIELD_WIDTH / 2, FIELD_HEIGHT / 2 - 165),
    (FIELD_WIDTH / 2, FIELD_HEIGHT / 2 + 165),
    (FIELD_WIDTH / 2 - 205, FIELD_HEIGHT / 2),
    (FIELD_WIDTH / 2 + 205, FIELD_HEIGHT / 2),
]

# Точка супер-power-up — прямо в центральном ядре крепости (самое опасное,
# но самое ценное место карты; единственная точка спавна для kind="super")
SUPER_PICKUP_POINT: tuple[float, float] = (FIELD_WIDTH / 2, FIELD_HEIGHT / 2)

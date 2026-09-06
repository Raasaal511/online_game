from app.game.entities import Wall

FIELD_WIDTH = 1400
FIELD_HEIGHT = 900

WALL_THICKNESS = 24

# Карта v2 — "Крепость": открытое кольцо по периметру для манёвра/спавна,
# внутреннее укреплённое ядро с четырьмя проходами и рассредоточенные
# диагональные укрытия в средней зоне. Рассчитана на до 10 игроков.
WALLS: list[Wall] = [
    # внешние границы (чтобы танки и снаряды не улетали за карту)
    Wall(0, 0, FIELD_WIDTH, WALL_THICKNESS),
    Wall(0, FIELD_HEIGHT - WALL_THICKNESS, FIELD_WIDTH, WALL_THICKNESS),
    Wall(0, 0, WALL_THICKNESS, FIELD_HEIGHT),
    Wall(FIELD_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, FIELD_HEIGHT),

    # центральное кольцевое укрепление с 4 проходами (крепость)
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 - 140, 140, 30),
    Wall(FIELD_WIDTH / 2 + 40, FIELD_HEIGHT / 2 - 140, 140, 30),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 + 110, 140, 30),
    Wall(FIELD_WIDTH / 2 + 40, FIELD_HEIGHT / 2 + 110, 140, 30),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 - 140, 30, 140),
    Wall(FIELD_WIDTH / 2 - 180, FIELD_HEIGHT / 2 + 0, 30, 110),
    Wall(FIELD_WIDTH / 2 + 150, FIELD_HEIGHT / 2 - 140, 30, 140),
    Wall(FIELD_WIDTH / 2 + 150, FIELD_HEIGHT / 2 + 0, 30, 110),

    # ядро в самом центре — маленькое укрытие внутри крепости
    Wall(FIELD_WIDTH / 2 - 25, FIELD_HEIGHT / 2 - 25, 50, 50),

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

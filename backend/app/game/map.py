from app.game.entities import Wall

FIELD_WIDTH = 1400
FIELD_HEIGHT = 900

WALL_THICKNESS = 24

# Карта рассчитана на до 10 игроков одновременно: открытые зоны по углам
# для спавна + набор стен-препятствий в центре и по периметру для тактики/укрытий.
WALLS: list[Wall] = [
    # внешние границы (чтобы танки и снаряды не улетали за карту)
    Wall(0, 0, FIELD_WIDTH, WALL_THICKNESS),
    Wall(0, FIELD_HEIGHT - WALL_THICKNESS, FIELD_WIDTH, WALL_THICKNESS),
    Wall(0, 0, WALL_THICKNESS, FIELD_HEIGHT),
    Wall(FIELD_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, FIELD_HEIGHT),

    # центральный крестообразный блок препятствий
    Wall(FIELD_WIDTH / 2 - 100, FIELD_HEIGHT / 2 - 20, 200, 40),
    Wall(FIELD_WIDTH / 2 - 20, FIELD_HEIGHT / 2 - 100, 40, 200),

    # угловые укрытия
    Wall(200, 200, 160, 30),
    Wall(200, 200, 30, 160),

    Wall(FIELD_WIDTH - 360, 200, 160, 30),
    Wall(FIELD_WIDTH - 230, 200, 30, 160),

    Wall(200, FIELD_HEIGHT - 230, 30, 160),
    Wall(200, FIELD_HEIGHT - 230, 160, 30),

    Wall(FIELD_WIDTH - 360, FIELD_HEIGHT - 230, 160, 30),
    Wall(FIELD_WIDTH - 230, FIELD_HEIGHT - 360, 30, 160),

    # дополнительные препятствия по бокам карты
    Wall(FIELD_WIDTH / 2 - 250, 80, 30, 140),
    Wall(FIELD_WIDTH / 2 + 220, FIELD_HEIGHT - 220, 30, 140),
    Wall(80, FIELD_HEIGHT / 2 - 70, 140, 30),
    Wall(FIELD_WIDTH - 220, FIELD_HEIGHT / 2 + 40, 140, 30),
]

# Точки спавна игроков — по периметру карты, вдали от центральных стен
SPAWN_POINTS: list[tuple[float, float]] = [
    (100, 100),
    (FIELD_WIDTH - 100, 100),
    (100, FIELD_HEIGHT - 100),
    (FIELD_WIDTH - 100, FIELD_HEIGHT - 100),
    (FIELD_WIDTH / 2, 100),
    (FIELD_WIDTH / 2, FIELD_HEIGHT - 100),
    (100, FIELD_HEIGHT / 2),
    (FIELD_WIDTH - 100, FIELD_HEIGHT / 2),
    (FIELD_WIDTH / 2 - 300, FIELD_HEIGHT / 2 - 250),
    (FIELD_WIDTH / 2 + 300, FIELD_HEIGHT / 2 + 250),
]

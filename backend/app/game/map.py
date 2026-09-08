import math

from app.game.entities import Wall

FIELD_WIDTH = 1760
FIELD_HEIGHT = 1140

WALL_THICKNESS = 24


def ray_distance_to_field_edge(x: float, y: float, angle: float) -> float:
    # длина луча от точки (x, y) под углом до края игрового поля [0,W]x[0,H] —
    # используется всеми лазерами (лазерная звезда игрока, лазер мини-босса),
    # чтобы луч визуально и по хитбоксу всегда обрывался ровно на границе
    # арены, а не летел на фиксированную дистанцию, которая для одной точки
    # старта верна, а для другой — вылезает за карту или, наоборот, не
    # дотягивается до угла. Стены карты (крепость и т.п.) намеренно
    # игнорируются — это только внешняя граница поля, не препятствия.
    dx, dy = math.cos(angle), math.sin(angle)
    candidates = []
    if dx > 1e-9:
        candidates.append((FIELD_WIDTH - x) / dx)
    elif dx < -1e-9:
        candidates.append((0 - x) / dx)
    if dy > 1e-9:
        candidates.append((FIELD_HEIGHT - y) / dy)
    elif dy < -1e-9:
        candidates.append((0 - y) / dy)
    if not candidates:
        return 0.0
    return max(0.0, min(candidates))

# Карта v4 — "Крепость" (просторная): та же общая композиция (внешнее кольцо
# для манёвра/спавна, укреплённое ядро в центре, укрытия в углах), но заметно
# меньше стен и заметно шире все проходы — v3 давала слишком тесные коридоры
# (30px проём при танке 32px — впритык, легко застрять на повороте) и слишком
# плотные угловые карманы (несколько укрытий почти вплотную друг к другу).
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

    # центральное кольцевое укрепление с 4 проходами (крепость) — проёмы
    # расширены до 260px (было 170-185px), с большим запасом относительно
    # размера танка (32px) даже для двух танков разъехаться в проходе;
    # рампа на северной стене осталась для переезда сверху
    Wall(FIELD_WIDTH / 2 - 260, FIELD_HEIGHT / 2 - 170, 130, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 + 130, FIELD_HEIGHT / 2 - 170, 130, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 - 260, FIELD_HEIGHT / 2 + 140, 130, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 + 130, FIELD_HEIGHT / 2 + 140, 130, 30, destructible=True),
    Wall(FIELD_WIDTH / 2 - 260, FIELD_HEIGHT / 2 - 170, 30, 170, destructible=True),
    Wall(FIELD_WIDTH / 2 + 230, FIELD_HEIGHT / 2 - 170, 30, 170, destructible=True),

    # ядро в центре крепости открыто (супер-power-up под перекрёстным огнём);
    # диагональные укрытия во внутреннем кольце — по одному короткому элементу
    # на угол вместо двух смежных (L-образных), проходы между ними и стенами
    # крепости заметно просторнее
    Wall(280, 200, 160, 28, destructible=True),
    Wall(FIELD_WIDTH - 440, 200, 160, 28, destructible=True),
    Wall(280, FIELD_HEIGHT - 228, 160, 28, destructible=True),
    Wall(FIELD_WIDTH - 440, FIELD_HEIGHT - 228, 160, 28, destructible=True),

    # короткие простреливаемые баррикады у боковых проходов — разрушаемые
    Wall(FIELD_WIDTH / 2 - 15, 110, 30, 110, destructible=True),
    Wall(FIELD_WIDTH / 2 - 15, FIELD_HEIGHT - 220, 30, 110, destructible=True),
    Wall(200, FIELD_HEIGHT / 2 - 15, 130, 30, destructible=True),
    Wall(FIELD_WIDTH - 330, FIELD_HEIGHT / 2 - 15, 130, 30, destructible=True),

    # угловые укрытия в расширенных зонах карты — разнесены от боковых
    # баррикад и от углов крепости заметно дальше, чем в v3, чтобы не
    # создавать тесные "карманы" сразу у нескольких стен
    Wall(620, 120, 30, 110, destructible=True),
    Wall(FIELD_WIDTH - 650, 120, 30, 110, destructible=True),
    Wall(620, FIELD_HEIGHT - 230, 30, 110, destructible=True),
    Wall(FIELD_WIDTH - 650, FIELD_HEIGHT - 230, 30, 110, destructible=True),
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

# Точка супер-power-up — прямо в центральном ядре крепости (самое опасное,
# но самое ценное место карты; единственная точка спавна для kind="super")
SUPER_PICKUP_POINT: tuple[float, float] = (FIELD_WIDTH / 2, FIELD_HEIGHT / 2)

# Яма вокруг ядра крепости: кольцо из 4 прямоугольников (по одному на сторону
# ядра), с вырезами-мостами в местах, где уже стоят проёмы крепостной стены
# (см. WALLS выше) — эти вырезы и есть узкие мосты, единственный безопасный
# проход к центру. Мост заметно уже (80px) самого проёма в стене (260px) —
# стена уже пускала свободно, а теперь по бокам моста в проёме ждёт яма, из-за
# которой пройти можно только по центру прохода. Заезд в прямоугольник ниже
# (вне мостов) = падение (см. PIT_FALL_TIME в entities.py, _process_pits в room.py).
PIT_BRIDGE_HALF_WIDTH = 40.0  # половина ширины безопасного моста в каждом из 4 проёмов
_pit_cx, _pit_cy = SUPER_PICKUP_POINT
# внешний край ямы раздельно по осям — крепостная стена не круглая и не
# квадратная: у неё есть угловые выступы там, где горизонтальный сегмент
# (y от 140 до 170) стыкуется с вертикальным (x от 230 до 260) — эти углы
# ближе к центру, чем "радиус" в 170 или 260px. Единый квадратный радиус
# ямы (раньше 205, потом 160) в обоих случаях либо нахлёстывался на угол
# стены ("забор в яме" — стена торчала прямо из пропасти), либо оставлял
# неоправданно широкий нетронутый пол у другой пары стен. Эти конкретные
# значения подобраны программным перебором (проверка пересечения прямо-
# угольников зон ямы против всех 6 сегментов крепостной стены) — максимум
# охвата без единого пересечения.
_PIT_OUTER_NS = 140.0
_PIT_OUTER_EW = 230.0
_PIT_INNER = 70.0  # внутренний край — оставляет площадку вокруг самого пикапа не заминированной
PIT_ZONES: list[tuple[float, float, float, float]] = [
    # север/юг: полосы над/под ядром, вырез-мост по центру (x) — реализовано
    # как два прямоугольника слева и справа от моста, а не один с вырезом,
    # т.к. PIT_ZONES — простые прямоугольники (point-in-rect), без булевых вычитаний
    (_pit_cx - _PIT_OUTER_EW, _pit_cy - _PIT_OUTER_NS, _PIT_OUTER_EW - PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_NS - _PIT_INNER),
    (_pit_cx + PIT_BRIDGE_HALF_WIDTH, _pit_cy - _PIT_OUTER_NS, _PIT_OUTER_EW - PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_NS - _PIT_INNER),
    (_pit_cx - _PIT_OUTER_EW, _pit_cy + _PIT_INNER, _PIT_OUTER_EW - PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_NS - _PIT_INNER),
    (_pit_cx + PIT_BRIDGE_HALF_WIDTH, _pit_cy + _PIT_INNER, _PIT_OUTER_EW - PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_NS - _PIT_INNER),
    # запад/восток
    (_pit_cx - _PIT_OUTER_EW, _pit_cy - _PIT_OUTER_NS, _PIT_OUTER_EW - _PIT_INNER, _PIT_OUTER_NS - PIT_BRIDGE_HALF_WIDTH),
    (_pit_cx - _PIT_OUTER_EW, _pit_cy + PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_EW - _PIT_INNER, _PIT_OUTER_NS - PIT_BRIDGE_HALF_WIDTH),
    (_pit_cx + _PIT_INNER, _pit_cy - _PIT_OUTER_NS, _PIT_OUTER_EW - _PIT_INNER, _PIT_OUTER_NS - PIT_BRIDGE_HALF_WIDTH),
    (_pit_cx + _PIT_INNER, _pit_cy + PIT_BRIDGE_HALF_WIDTH, _PIT_OUTER_EW - _PIT_INNER, _PIT_OUTER_NS - PIT_BRIDGE_HALF_WIDTH),
]

# Точки-кандидаты для порталов — рядом с внутренними стенами/укрытиями (не с
# внешней границей, чтобы портал не зажимал танк у края карты), достаточно
# далеко друг от друга, чтобы пара портал-точка не создавала телепорт
# "в шаге" от исходной позиции. Каждый спавн случайно выбирает 2 из этого
# набора под новую пару.
PORTAL_POINTS: list[tuple[float, float]] = [
    (FIELD_WIDTH / 2 - 320, FIELD_HEIGHT / 2 - 90),
    (FIELD_WIDTH / 2 + 320, FIELD_HEIGHT / 2 - 90),
    (FIELD_WIDTH / 2 - 320, FIELD_HEIGHT / 2 + 90),
    (FIELD_WIDTH / 2 + 320, FIELD_HEIGHT / 2 + 90),
    (360, 165),
    (FIELD_WIDTH - 360, 165),
    (360, FIELD_HEIGHT - 165),
    (FIELD_WIDTH - 360, FIELD_HEIGHT - 165),
    (FIELD_WIDTH / 2 - 90, 150),
    (FIELD_WIDTH / 2 - 90, FIELD_HEIGHT - 150),
    (150, FIELD_HEIGHT / 2),
    (FIELD_WIDTH - 150, FIELD_HEIGHT / 2),
]

import time
import uuid
from dataclasses import dataclass, field


TANK_SIZE = 32
TANK_SPEED = 160.0  # px/sec, максимальная скорость танка
TANK_ACCEL = 480.0  # px/sec^2, разгон — за 1/3 сек танк набирает полную скорость
TANK_FRICTION = 560.0  # px/sec^2, торможение при отсутствии ввода — чуть резче разгона
TANK_MAX_HP = 100

BULLET_SPEED = 820.0
BULLET_SIZE = 10
BULLET_DAMAGE = 20
FIRE_COOLDOWN = 0.80  # сек между выстрелами
BULLET_MAX_BOUNCES = 0  # без рикошета — пуля гаснет при любом попадании в стену

# Классы танка: выбираются перед началом игры (и заново после каждой смерти),
# постоянны на всю жизнь танка (в отличие от временных weapon-пикапов с карты,
# которые продолжают работать поверх базового оружия класса).
TANK_CLASSES = ("sniper", "brawler", "gunner")
DEFAULT_TANK_CLASS = "gunner"

# Снайпер: редкий но мощный сквозной выстрел — пробивает всех на линии огня
SNIPER_COOLDOWN = 1.5
SNIPER_DAMAGE = 45
SNIPER_SPEED = 1280.0
SNIPER_SIZE = 8
SNIPER_PIERCE = True

# Ближний бой: двойная пушка веером, урон линейно падает с дистанцией
BRAWLER_COOLDOWN = 0.55
BRAWLER_DAMAGE = 26  # урон в упор (falloff=0), на BRAWLER_MAX_RANGE падает до BRAWLER_MIN_DAMAGE_MULT
BRAWLER_MIN_DAMAGE_MULT = 0.35
BRAWLER_MAX_RANGE = 420.0
BRAWLER_SPREAD = 0.12  # радианы между двумя стволами
BRAWLER_SPEED = 760.0
BRAWLER_SIZE = 11

# Пулемёт: очень быстрая стрельба с ограниченным магазином и автоперезарядкой
GUNNER_COOLDOWN = 0.09
GUNNER_DAMAGE = 7
GUNNER_SPEED = 900.0
GUNNER_SIZE = 6
GUNNER_MAG_SIZE = 88
GUNNER_RELOAD_TIME = 2.0

# Ульта: копится по убийствам, разряжается одним мощным выстрелом (усиленная
# бомба на прямом попадании — не мгновенный хитскан, отдельный управляемый снаряд)
ULTIMATE_KILLS_REQUIRED = 5
ULTIMATE_SPEED = 460.0
ULTIMATE_SIZE = 20
ULTIMATE_DIRECT_DAMAGE = 90
ULTIMATE_SPLASH_RADIUS = 140.0
ULTIMATE_SPLASH_DAMAGE = 70

# Порталы: пара точек у стен, спавнится/исчезает динамически. Заезд танка в
# один портал телепортирует к его паре — не отдельная способность игрока
# (заменили Shift-прыжок по курсору), а объект карты, доступный всем.
PORTAL_SIZE = 42.0
PORTAL_LIFETIME = 25.0  # сек, сколько живёт пара порталов до исчезновения
PORTAL_MIN_INTERVAL = 15.0  # сек между появлением новых пар (от исчезновения предыдущей)
PORTAL_MAX_INTERVAL = 30.0
PORTAL_COOLDOWN_AFTER_USE = 1.0  # сек неактивности портала для игрока сразу после телепортации (не отскакивает туда-обратно)

# Скин пушки: чисто косметический выбор в главном меню, не влияет на баланс —
# сервер только хранит и рассылает выбор, вся отрисовка цвета на клиенте
GUN_SKINS = ("steel", "crimson", "gold", "toxic", "azure")
DEFAULT_GUN_SKIN = "steel"

# Пулемёт: быстрый и слабый, без рикошета — чистый DPS-race на реакции
MINIGUN_COOLDOWN = 0.12
MINIGUN_DAMAGE = 6
MINIGUN_SPEED = 820.0
MINIGUN_SIZE = 6

# Огнемёт: короткий конус, тикающий урон, без баллистики — попадание мгновенное
FLAMETHROWER_COOLDOWN = 0.15
FLAMETHROWER_RANGE = 190.0  # увеличена дальность конуса (было 130)
FLAMETHROWER_CONE_HALF_ANGLE = 0.45  # радианы (~26°) в каждую сторону от прицела
FLAMETHROWER_TICK_DAMAGE = 4  # урон за один "тик" контакта с конусом
FLAMETHROWER_BURN_DURATION = 2.0  # горение продолжается и после выхода из конуса
FLAMETHROWER_BURN_TICK_DAMAGE = 3
FLAMETHROWER_BURN_INTERVAL = 0.5

# Ракетница: медленный тяжёлый снаряд, взрывается сплэшем при попадании/выключении рикошета.
# Урон и радиус подняты на ~18% (было 55/90/30) — "чуть больше", просьба пользователя
# сделать ракету заметно мощнее, но не превращать в one-shot оружие
ROCKET_COOLDOWN = 1.6
ROCKET_SPEED = 320.0
ROCKET_SIZE = 14
ROCKET_DIRECT_DAMAGE = 65
ROCKET_SPLASH_RADIUS = 105.0
ROCKET_SPLASH_DAMAGE = 35

# Ледомёт: одиночный выстрел умеренной силы, при попадании коротко и несильно
# замедляет цель — отдельный от ловушки (TRAP_SLOW_*) набор констант, т.к.
# ловушка тюнингована под более долгий и жёсткий дебафф
ICE_COOLDOWN = 0.9
ICE_SPEED = 620.0
ICE_SIZE = 10
ICE_DAMAGE = 22
ICE_SLOW_DURATION = 1.5
ICE_SLOW_MULT = 0.65

WEAPON_KINDS = ("cannon", "flamethrower", "rocket", "ice")
WEAPON_PICKUP_DURATION = 20.0  # сек, на которые оружие подобрано с карты

PICKUP_SIZE = 20
SPEED_BOOST_DURATION = 8.0
SPEED_BOOST_MULT = 1.6
SLOW_DEBUFF_DURATION = 5.0
SLOW_DEBUFF_MULT = 0.5

TRAP_SIZE = 26
TRAP_DAMAGE = 15
TRAP_SLOW_DURATION = 2.5
TRAP_SLOW_MULT = 0.4
TRAP_TRIGGER_COOLDOWN = 3.0  # сек до повторного срабатывания для того же игрока

COLLISION_DAMAGE = 6  # урон каждому танку при столкновении друг с другом
COLLISION_PUSHBACK = 90.0  # px/sec импульс взаимного отталкивания

SPAWN_PROTECTION_DURATION = 3.0  # сек неуязвимости сразу после респавна

# Прокачка уровня: опыт копится за убийства, сбрасывается на 1 уровень при
# смерти (риск/фарм-петля — чем дольше живёшь, тем сильнее, но теряешь всё).
# Пороги снижены (было 40/90/150/220) — уровень растёт заметно быстрее, а
# бонус за уровень уменьшен (было 10%/5%), чтобы прокачка не превращалась в
# imbа на верхних уровнях — просто более частое и явное ощущение роста силы.
XP_PER_KILL = 25
LEVEL_MAX = 5
LEVEL_XP_THRESHOLDS = [0, 25, 55, 90, 130]  # XP, нужный для перехода на уровень i+1
LEVEL_HP_BONUS_PCT = 0.06  # +6% к max_hp за уровень
LEVEL_DAMAGE_BONUS_PCT = 0.03  # +3% к урону оружия за уровень

# Мини-босс: спавнится с шансом на месте смерти игрока, значительно сильнее
# обычного танка; убийца получает мощное усиление (сильнее "super" пикапа)
MINIBOSS_SPAWN_CHANCE = 0.2
MINIBOSS_HP_MULT = 5.0
MINIBOSS_DAMAGE_MULT = 2.0
MINIBOSS_SPEED_MULT = 0.6
MINIBOSS_REWARD_DURATION = 20.0  # дольше обычного supel-pickup (15с)
MINIBOSS_REWARD_ARMOR_REDUCTION = 0.9
MINIBOSS_REWARD_DAMAGE_MULT = 3.0

# Арсенал мини-босса: 4 типа атак чередуются случайно между залпами — вместо
# единственного предсказуемого веера. Каждая читается и уклоняется иначе.
MINIBOSS_ATTACK_COOLDOWN = 2.4  # сек между любыми залпами (не суммируется с индивидуальными)

# 1) Веерный залп — базовая AoE-атака (была единственной раньше)
MINIBOSS_SALVO_SIZE = 5
MINIBOSS_SALVO_SPREAD = 0.85

# 2) Артиллерийский залп — 3 отложенных снаряда с телеграфом на земле (как
# фоновая бомба), падают в область вокруг цели — заставляет покинуть зону
# заранее, а не реагировать на уже летящий снаряд
MINIBOSS_ARTILLERY_COUNT = 3
MINIBOSS_ARTILLERY_SPREAD_RADIUS = 140.0  # разброс точек падения вокруг цели
MINIBOSS_ARTILLERY_FUSE_TIME = 1.6  # сек между появлением метки и взрывом
MINIBOSS_ARTILLERY_DAMAGE = 45
MINIBOSS_ARTILLERY_RADIUS = 85.0

# 3) Лазерный луч — после короткого прицельного телеграфа мгновенно бьёт по
# прямой линии; легко уклониться, если заметить луч заранее, но не простить
# промедление — высокий урон при попадании
MINIBOSS_LASER_CHARGE_TIME = 0.9  # сек прицеливания перед выстрелом (видимый телеграф)
MINIBOSS_LASER_WIDTH = 18.0
MINIBOSS_LASER_RANGE = 900.0
MINIBOSS_LASER_DAMAGE = 50

# 4) Дробовик/осколочный — широкий веер множества слабых снарядов на средней
# дистанции, опасен только вблизи (сильно расходится с расстоянием)
MINIBOSS_SHOTGUN_COUNT = 10
MINIBOSS_SHOTGUN_SPREAD = 1.6
MINIBOSS_SHOTGUN_DAMAGE_MULT = 0.45  # доля от обычного урона босса за снаряд

# Лазерная звезда: замена старого пассивного "super"-баффа — 8 лучей,
# зафиксированных под углом относительно танка в момент подбора, тикают урон
# по всем, кого касаются, всё время действия (не требует зажатия кнопки)
LASER_STAR_DURATION = 5.0
LASER_STAR_BEAM_COUNT = 8
LASER_STAR_RANGE = 380.0  # короче MINIBOSS_LASER_RANGE (900) — оружие масштаба игрока, не босса
LASER_STAR_WIDTH = 14.0  # чуть уже MINIBOSS_LASER_WIDTH (18) — тот же класс оружия, но не копия
LASER_STAR_TICK_INTERVAL = 0.25  # сек между тиками урона на одну цель
LASER_STAR_TICK_DAMAGE = 9  # за 5с и тик 0.25с луч бьющий в упор даёт ~180 урона — мощно, но не мгновенная казнь

# Яма вокруг супер-пикапа в ядре крепости: усложняет подход к самому ценному
# месту карты — заезд в яму = падение и смерть через короткое время, узкие
# "мосты" (проёмы, не помеченные как яма) остаются единственным безопасным путём
PIT_FALL_TIME = 0.5  # сек между заездом в яму и смертью — короткое окно, чтобы успеть выехать

# Ядерка: редкое глобальное событие, взрыв покрывает ~50% диагонали карты
NUKE_MIN_INTERVAL = 100.0
NUKE_MAX_INTERVAL = 140.0  # в среднем ~раз в 2 минуты
NUKE_WARNING_DURATION = 6.0  # сек предупреждения перед взрывом
NUKE_DAMAGE = 70
NUKE_RADIUS_FRACTION = 0.475  # доля от диагонали поля (уменьшено на 5% от исходных 0.5)
NUKE_LETHAL_FRACTION = 0.55  # доля радиуса от эпицентра — гарантированная смерть


@dataclass
class Player:
    id: str
    nickname: str
    x: float
    y: float
    dir_x: float = 0.0
    dir_y: float = 0.0
    vx: float = 0.0  # текущая скорость (инерция: разгон/торможение, не мгновенная)
    vy: float = 0.0
    turret_angle: float = 0.0  # радианы, направление башни (к курсору)
    hp: int = TANK_MAX_HP
    max_hp: int = TANK_MAX_HP
    damage: int = BULLET_DAMAGE
    alive: bool = True
    size: float = TANK_SIZE
    speed: float = TANK_SPEED
    kills: int = 0
    deaths: int = 0
    joined_at: float = field(default_factory=time.monotonic)
    died_at: float | None = None
    last_shot_at: float = -999.0
    armor_until: float = 0.0  # timestamp, до которого действует бонус брони
    damage_until: float = 0.0  # timestamp, до которого действует бонус урона
    speed_boost_until: float = 0.0
    slow_until: float = 0.0
    slow_mult: float = SLOW_DEBUFF_MULT  # множитель, действующий пока slow_until не истёк — ловушка и ледомёт тюнингованы по-разному
    super_until: float = 0.0  # действие супер-power-up из центра карты
    trap_cooldown_until: float = 0.0  # чтобы одна и та же ловушка не тикала каждый тик
    last_collision_at: float = -999.0  # антиспам урона при затяжном контакте танк-танк
    spawn_protected_until: float = 0.0  # неуязвимость сразу после респавна
    weapon: str = "cannon"
    weapon_until: float = 0.0  # timestamp, до которого действует подобранное оружие
    flame_active_until: float = 0.0  # окно, в течение которого конус огнемёта активен
    burn_until: float = 0.0  # DoT от огнемёта продолжает тикать после выхода из конуса
    burn_owner_id: str = ""
    last_burn_tick_at: float = -999.0
    level: int = 1  # прокачка за убийства, сбрасывается на 1 при смерти
    xp: int = 0
    miniboss_reward_until: float = 0.0  # награда за убийство мини-босса
    is_miniboss: bool = False  # True для NPC мини-босса (не обычный игрок)
    miniboss_owner_nickname: str = ""  # чей это был мини-босс (для сообщения на клиенте)
    ai_waypoint_x: float = 0.0  # текущая случайная точка блуждания (мини-босс)
    ai_waypoint_y: float = 0.0
    ai_last_salvo_at: float = -999.0
    chat_last_at: float = -999.0
    laser_charging_until: float = 0.0  # мини-босс: телеграф лазера (виден до выстрела)
    laser_started_at: float = 0.0  # момент начала заряда — для расчёта прогресса на клиенте
    laser_fire_at: float = 0.0  # момент фактического выстрела лазером
    laser_angle: float = 0.0  # угол луча (зафиксирован в момент начала заряда)
    tank_class: str = DEFAULT_TANK_CLASS  # выбирается перед стартом/после смерти, постоянен на жизнь
    ammo: int = GUNNER_MAG_SIZE  # актуально только для gunner — остаток патронов в магазине
    reload_until: float = 0.0  # timestamp окончания автоперезарядки gunner
    ultimate_kills: int = 0  # счётчик убийств до готовности ульты (сбрасывается при использовании)
    portal_cooldown_until: float = 0.0  # антидребезг: сразу после телепортации свой портал/пара временно неактивны для игрока
    gun_skin: str = DEFAULT_GUN_SKIN  # косметический выбор в меню — не влияет на баланс
    laser_star_until: float = 0.0  # timestamp окончания действия лазерной звезды (замена старого super-баффа)
    laser_star_angles: list = field(default_factory=list)  # 8 углов, зафиксированы в момент подбора
    laser_star_last_tick_at: float = -999.0
    falling_since: float = 0.0  # 0 = не падает; >0 — момент захода в зону ямы (PIT_FALL_TIME до смерти)

    def lifetime(self) -> float:
        end = self.died_at if self.died_at is not None else time.monotonic()
        return round(end - self.joined_at, 2)

    def current_speed_mult(self, now: float) -> float:
        mult = 1.0
        if now < self.speed_boost_until:
            mult *= SPEED_BOOST_MULT
        if now < self.slow_until:
            mult *= self.slow_mult
        return mult

    def level_hp_mult(self) -> float:
        return 1.0 + (self.level - 1) * LEVEL_HP_BONUS_PCT

    def level_damage_mult(self) -> float:
        return 1.0 + (self.level - 1) * LEVEL_DAMAGE_BONUS_PCT

    def add_xp(self, amount: int) -> bool:
        # возвращает True, если игрок поднял уровень (для события на клиенте)
        if self.level >= LEVEL_MAX:
            return False
        self.xp += amount
        leveled_up = False
        while self.level < LEVEL_MAX and self.xp >= LEVEL_XP_THRESHOLDS[self.level]:
            self.level += 1
            leveled_up = True
        if leveled_up:
            old_max_hp = self.max_hp
            self.max_hp = round(TANK_MAX_HP * self.level_hp_mult())
            self.hp = min(self.max_hp, self.hp + (self.max_hp - old_max_hp))
        return leveled_up

    @staticmethod
    def new(nickname: str, x: float, y: float) -> "Player":
        return Player(id=str(uuid.uuid4())[:8], nickname=nickname, x=x, y=y)


@dataclass
class Bullet:
    id: str
    owner_id: str
    x: float
    y: float
    vx: float
    vy: float
    damage: int
    size: float = BULLET_SIZE
    bounces_left: int = BULLET_MAX_BOUNCES
    kind: str = "cannon"  # "cannon" | "minigun" | "rocket" | "sniper" | "brawler" | "ultimate" | "ice" — визуал/поведение
    pierce: bool = False  # True = не гаснет при попадании в игрока (снайпер), только при попадании в стену
    hit_ids: set = field(default_factory=set)  # кому уже нанесён урон — не даёт сквозной пуле бить одну цель дважды
    falloff_range: float = 0.0  # >0: урон линейно падает от damage до damage*falloff_min_mult на этой дистанции
    falloff_min_mult: float = 1.0
    spawn_x: float = 0.0  # точка вылета — для расчёта пройденной дистанции (falloff)
    spawn_y: float = 0.0
    splash_radius: float = 0.0  # >0: при попадании/стене — доп. сплэш-урон по площади (ульта)
    splash_damage: int = 0

    @staticmethod
    def new(
        owner_id: str,
        x: float,
        y: float,
        angle: float,
        damage: int,
        speed: float = BULLET_SPEED,
        size: float = BULLET_SIZE,
        bounces: int = BULLET_MAX_BOUNCES,
        kind: str = "cannon",
        pierce: bool = False,
        falloff_range: float = 0.0,
        falloff_min_mult: float = 1.0,
        splash_radius: float = 0.0,
        splash_damage: int = 0,
    ) -> "Bullet":
        import math

        vx = math.cos(angle) * speed
        vy = math.sin(angle) * speed
        return Bullet(
            id=str(uuid.uuid4())[:8],
            owner_id=owner_id,
            x=x,
            y=y,
            vx=vx,
            vy=vy,
            damage=damage,
            size=size,
            bounces_left=bounces,
            kind=kind,
            pierce=pierce,
            falloff_range=falloff_range,
            falloff_min_mult=falloff_min_mult,
            spawn_x=x,
            spawn_y=y,
            splash_radius=splash_radius,
            splash_damage=splash_damage,
        )


WALL_MAX_HP = 5  # разрушаемая стена ломается за 5 попаданий любого оружия
WALL_RESPAWN_DELAY = 20.0  # сек до восстановления разрушенной стены


@dataclass
class Wall:
    x: float
    y: float
    width: float
    height: float
    is_border: bool = False  # внешняя граница поля vs внутреннее укрытие
    destructible: bool = False  # можно ли разрушить стрельбой (только внутренние укрытия)
    is_ramp: bool = False  # пандус: танки проезжают поверх, не создаёт коллизии для игроков
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    hp: int = field(init=False)
    destroyed_at: float | None = field(default=None, init=False)
    right: float = field(init=False)
    bottom: float = field(init=False)

    def __post_init__(self) -> None:
        # предвычислено один раз при создании карты, а не на каждой проверке
        # коллизии (rect_intersects_walls вызывается ~сотни раз за тик)
        self.right = self.x + self.width
        self.bottom = self.y + self.height
        self.hp = WALL_MAX_HP if self.destructible else 0

    @property
    def is_active(self) -> bool:
        # неактивная стена (разрушена и ждёт восстановления) не участвует в
        # коллизиях, но продолжает существовать как объект карты
        return self.destroyed_at is None


@dataclass
class Pickup:
    id: str
    x: float
    y: float
    kind: str  # "heal" | "armor" | "damage" | "speed" | "super" | "flamethrower" | "rocket" | "ice"
    size: float = PICKUP_SIZE

    @staticmethod
    def new(x: float, y: float, kind: str) -> "Pickup":
        return Pickup(id=str(uuid.uuid4())[:8], x=x, y=y, kind=kind)


@dataclass
class Trap:
    id: str
    x: float
    y: float
    size: float = TRAP_SIZE

    @staticmethod
    def new(x: float, y: float) -> "Trap":
        return Trap(id=str(uuid.uuid4())[:8], x=x, y=y)


@dataclass
class Bomb:
    # случайный фоновый авиаудар "для атмосферы поля боя": появляется в
    # случайной точке карты с предупреждением (warning telegraph), через
    # BOMB_FUSE_TIME взрывается сплэш-уроном по всем, кто в радиусе.
    # Переиспользуется также для артиллерийского залпа мини-босса — тогда
    # owner_id и fuse_time/damage/radius переопределяются под этот залп.
    # значения по умолчанию синхронизированы вручную с BOMB_RADIUS/BOMB_DAMAGE/
    # BOMB_FUSE_TIME ниже (константы объявлены позже в файле, использовать их
    # напрямую как значения по умолчанию здесь нельзя — Python выполняет
    # модуль сверху вниз)
    id: str
    x: float
    y: float
    spawned_at: float
    radius: float = 70.0
    damage: int = 35
    fuse_time: float = 2.2
    owner_id: str = ""  # пусто = обычная фоновая бомба (самоурон, без фрага)

    @staticmethod
    def new(
        x: float,
        y: float,
        now: float,
        radius: float = 70.0,
        damage: int = 35,
        fuse_time: float = 2.2,
        owner_id: str = "",
    ) -> "Bomb":
        return Bomb(
            id=str(uuid.uuid4())[:8],
            x=x,
            y=y,
            spawned_at=now,
            radius=radius,
            damage=damage,
            fuse_time=fuse_time,
            owner_id=owner_id,
        )


BOMB_MIN_INTERVAL = 12.0
BOMB_MAX_INTERVAL = 25.0
BOMB_FUSE_TIME = 2.2  # сек между появлением предупреждения и взрывом
BOMB_DAMAGE = 35
BOMB_RADIUS = 70.0


@dataclass
class Nuke:
    # редкое глобальное событие "ядерка": долгое предупреждение (весь экран
    # должен успеть увидеть и разбежаться), огромный радиус — все, кто не
    # успел покинуть зону, получают тяжёлый урон
    id: str
    x: float
    y: float
    spawned_at: float
    radius: float

    @staticmethod
    def new(x: float, y: float, now: float, radius: float) -> "Nuke":
        return Nuke(id=str(uuid.uuid4())[:8], x=x, y=y, spawned_at=now, radius=radius)


@dataclass
class Portal:
    # один портал из пары — хранит id своей пары (link_id), чтобы найти,
    # куда телепортировать при заезде. Обе половины пары рождаются и
    # умирают одновременно (spawned_at общий, отдельных id для удаления по паре не нужно).
    id: str
    x: float
    y: float
    link_id: str  # id противоположного портала той же пары
    spawned_at: float

    @staticmethod
    def new(x: float, y: float, link_id: str, now: float) -> "Portal":
        return Portal(id=str(uuid.uuid4())[:8], x=x, y=y, link_id=link_id, spawned_at=now)

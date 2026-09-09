import math
import random
import time

from app.game.entities import (
    Bullet,
    FIRE_COOLDOWN,
    MINIGUN_COOLDOWN,
    MINIGUN_DAMAGE,
    MINIGUN_SPEED,
    MINIGUN_SIZE,
    FLAMETHROWER_COOLDOWN,
    FLAMETHROWER_RANGE,
    FLAMETHROWER_CONE_HALF_ANGLE,
    FLAMETHROWER_TICK_DAMAGE,
    FLAMETHROWER_BURN_DURATION,
    FLAMETHROWER_BURN_TICK_DAMAGE,
    FLAMETHROWER_BURN_INTERVAL,
    ROCKET_COOLDOWN,
    ROCKET_SPEED,
    ROCKET_SIZE,
    ROCKET_DIRECT_DAMAGE,
    ROCKET_SPLASH_RADIUS,
    ROCKET_SPLASH_DAMAGE,
    ICE_COOLDOWN,
    ICE_SPEED,
    ICE_SIZE,
    ICE_DAMAGE,
    SNIPER_COOLDOWN,
    SNIPER_DAMAGE,
    SNIPER_SPEED,
    SNIPER_SIZE,
    SNIPER_PIERCE,
    BRAWLER_COOLDOWN,
    BRAWLER_PELLET_COUNT,
    BRAWLER_PELLET_DAMAGE,
    BRAWLER_MIN_DAMAGE_MULT,
    BRAWLER_MAX_RANGE,
    BRAWLER_SPREAD,
    BRAWLER_SPEED,
    BRAWLER_SIZE,
    GUNNER_COOLDOWN,
    GUNNER_DAMAGE,
    GUNNER_SPEED,
    GUNNER_SIZE,
    GUNNER_MAG_SIZE,
    GUNNER_RELOAD_TIME,
    ULTIMATE_KILLS_REQUIRED,
    ULTIMATE_SPEED,
    ULTIMATE_SIZE,
    ULTIMATE_DIRECT_DAMAGE,
    ULTIMATE_SPLASH_RADIUS,
    ULTIMATE_SPLASH_DAMAGE,
    TANK_CLASSES,
    DEFAULT_TANK_CLASS,
    LASER_STAR_BEAM_COUNT,
    LASER_STAR_DURATION,
    LASER_STAR_WIDTH,
    LASER_STAR_TICK_INTERVAL,
    LASER_STAR_TICK_DAMAGE,
)
from app.game.map import ray_distance_to_field_edge

_WEAPON_COOLDOWN = {
    "cannon": FIRE_COOLDOWN,
    "minigun": MINIGUN_COOLDOWN,
    "flamethrower": FLAMETHROWER_COOLDOWN,
    "rocket": ROCKET_COOLDOWN,
    "ice": ICE_COOLDOWN,
}

_CLASS_COOLDOWN = {
    "sniper": SNIPER_COOLDOWN,
    "brawler": BRAWLER_COOLDOWN,
    "gunner": GUNNER_COOLDOWN,
}


def _angle_diff(a: float, b: float) -> float:
    diff = b - a
    while diff > math.pi:
        diff -= 2 * math.pi
    while diff < -math.pi:
        diff += 2 * math.pi
    return diff


class WeaponMixin:
    """Логика 4 видов оружия: пушка, пулемёт, огнемёт, ракетница.

    Оформлено как mixin (а не отдельные функции с `room` первым аргументом),
    потому что все методы тесно связаны с состоянием GameRoom через self
    (self.bullets, self.players, self._apply_damage, self._explosions) —
    вынос в чистые функции потребовал бы переписать все self.-вызовы без
    видимой архитектурной выгоды. Вынесено физически в отдельный файл, чтобы
    room.py не разрастался дальше, но логика не тронута — только перемещена.
    """

    def try_shoot(self, player_id: str, use_pickup: bool = False) -> None:
        player = self.players.get(player_id)
        if player is None or not player.alive:
            return
        now = time.monotonic()

        # подобранное оружие с карты (flamethrower/rocket/ice) — ДОПОЛНИТЕЛЬНЫЙ
        # режим атаки поверх постоянного оружия класса, а не замена: класс
        # продолжает стрелять как обычно по основной кнопке (ЛКМ), а пикап
        # доступен отдельно по use_pickup=True (ПКМ) пока не истёк weapon_until.
        # Раньше пикап временно ПОДМЕНЯЛ оружие класса целиком — так игрок на
        # время терял свой снайпер/ближний бой/пулемёт вместо усиления им.
        # "minigun" оставлен в списке кодовых веток ниже (используется классом
        # gunner напрямую), но убран из пула карты — здесь больше не встретится.
        pickup_active = now < player.weapon_until and player.weapon in (
            "flamethrower",
            "rocket",
            "ice",
        )
        if use_pickup:
            if not pickup_active:
                return
            weapon = player.weapon
        else:
            weapon = "class"

        if weapon == "class":
            cooldown = _CLASS_COOLDOWN.get(player.tank_class, GUNNER_COOLDOWN)
        else:
            cooldown = _WEAPON_COOLDOWN.get(weapon, FIRE_COOLDOWN)

        if weapon == "class" and player.tank_class == "gunner":
            # магазин пуст -> ждём автоперезарядку (тикает в _process_gunner_reload,
            # не здесь — иначе reload_until/ammo менялись бы только при попытке
            # выстрелить, а не по факту истечения времени)
            if player.ammo <= 0:
                return

        if now - player.last_shot_at < cooldown:
            return
        player.last_shot_at = now

        if now >= player.damage_until:
            player.damage = 20

        # множитель урона (damage/super boost) применяется поверх базового
        # урона оружия, а не только к пушке — иначе смена оружия "теряла" бы бонус;
        # бонус за уровень прокачки действует поверх всего остального
        boost_mult = player.damage / 20 if player.damage != 20 else 1.0
        boost_mult *= player.level_damage_mult()

        if weapon == "flamethrower":
            player.flame_active_until = now + 0.2  # держится, пока клавиша зажата (клиент шлёт shoot часто)
            return

        muzzle_x = player.x + math.cos(player.turret_angle) * (player.size / 2 + 6)
        muzzle_y = player.y + math.sin(player.turret_angle) * (player.size / 2 + 6)

        if weapon == "minigun":
            spread = random.uniform(-0.05, 0.05)
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle + spread,
                round(MINIGUN_DAMAGE * boost_mult),
                speed=MINIGUN_SPEED,
                size=MINIGUN_SIZE,
                bounces=0,
                kind="minigun",
            )
            self.bullets[bullet.id] = bullet
        elif weapon == "rocket":
            # _explode_rocket ниже берёт радиус/урон сплэша из модульных констант
            # ROCKET_SPLASH_*, а не из полей bullet — сплэш не масштабируется
            # boost_mult намеренно (то же поведение, что было до правки баланса)
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle,
                round(ROCKET_DIRECT_DAMAGE * boost_mult),
                speed=ROCKET_SPEED,
                size=ROCKET_SIZE,
                bounces=0,
                kind="rocket",
            )
            self.bullets[bullet.id] = bullet
        elif weapon == "ice":
            # одиночный выстрел (не автомат, в отличие от minigun/rocket-очереди
            # нет) — умеренный урон + короткий слоу при попадании (см.
            # _check_bullet_collisions в room.py, где bullet.kind == "ice" читается)
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle,
                round(ICE_DAMAGE * boost_mult),
                speed=ICE_SPEED,
                size=ICE_SIZE,
                bounces=0,
                kind="ice",
            )
            self.bullets[bullet.id] = bullet
        elif player.tank_class == "sniper":
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle,
                round(SNIPER_DAMAGE * boost_mult),
                speed=SNIPER_SPEED,
                size=SNIPER_SIZE,
                bounces=0,
                kind="sniper",
                pierce=SNIPER_PIERCE,
            )
            self.bullets[bullet.id] = bullet
        elif player.tank_class == "brawler":
            # дробовик: BRAWLER_PELLET_COUNT дробин одним залпом, разброс
            # случайный в пределах BRAWLER_SPREAD (не равномерная гребёнка) —
            # так залп читается как настоящий дробовой веер, а не строй
            dmg = round(BRAWLER_PELLET_DAMAGE * boost_mult)
            for _ in range(BRAWLER_PELLET_COUNT):
                spread = random.uniform(-BRAWLER_SPREAD / 2, BRAWLER_SPREAD / 2)
                angle = player.turret_angle + spread
                bullet = Bullet.new(
                    player.id,
                    player.x + math.cos(angle) * (player.size / 2 + 6),
                    player.y + math.sin(angle) * (player.size / 2 + 6),
                    angle,
                    dmg,
                    speed=BRAWLER_SPEED,
                    size=BRAWLER_SIZE,
                    bounces=0,
                    kind="brawler",
                    falloff_range=BRAWLER_MAX_RANGE,
                    falloff_min_mult=BRAWLER_MIN_DAMAGE_MULT,
                )
                self.bullets[bullet.id] = bullet
        elif player.tank_class == "gunner":
            player.ammo -= 1
            spread = random.uniform(-0.05, 0.05)
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle + spread,
                round(GUNNER_DAMAGE * boost_mult),
                speed=GUNNER_SPEED,
                size=GUNNER_SIZE,
                bounces=0,
                kind="minigun",
            )
            self.bullets[bullet.id] = bullet
        else:
            bullet = Bullet.new(
                player.id,
                muzzle_x,
                muzzle_y,
                player.turret_angle,
                round(player.damage * player.level_damage_mult()),
                kind="cannon",
            )
            self.bullets[bullet.id] = bullet

    def try_ultimate(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None or not player.alive:
            return
        if player.ultimate_kills < ULTIMATE_KILLS_REQUIRED:
            return
        player.ultimate_kills = 0

        muzzle_x = player.x + math.cos(player.turret_angle) * (player.size / 2 + 10)
        muzzle_y = player.y + math.sin(player.turret_angle) * (player.size / 2 + 10)
        bullet = Bullet.new(
            player.id,
            muzzle_x,
            muzzle_y,
            player.turret_angle,
            ULTIMATE_DIRECT_DAMAGE,
            speed=ULTIMATE_SPEED,
            size=ULTIMATE_SIZE,
            bounces=0,
            kind="ultimate",
            splash_radius=ULTIMATE_SPLASH_RADIUS,
            splash_damage=ULTIMATE_SPLASH_DAMAGE,
        )
        self.bullets[bullet.id] = bullet

    def _process_gunner_reload(self, now: float) -> None:
        for player in self.players.values():
            if player.tank_class != "gunner" or player.ammo > 0:
                continue
            if player.reload_until == 0.0:
                player.reload_until = now + GUNNER_RELOAD_TIME
            elif now >= player.reload_until:
                player.ammo = GUNNER_MAG_SIZE
                player.reload_until = 0.0

    def _explode_ultimate(self, bullet: Bullet) -> None:
        for player in list(self.players.values()):
            if not player.alive:
                continue
            dist = math.hypot(player.x - bullet.x, player.y - bullet.y)
            if dist > bullet.splash_radius:
                continue
            falloff = 1 - dist / bullet.splash_radius
            dmg = round(bullet.splash_damage * falloff)
            if dmg > 0:
                self._apply_damage(player, dmg, bullet.owner_id)
        self._explosions.append({"x": bullet.x, "y": bullet.y, "radius": bullet.splash_radius})

    def _explode_rocket(self, bullet: Bullet) -> None:
        # сплэш-урон по всем живым в радиусе взрыва, урон убывает с расстоянием
        # чисто линейно от ROCKET_SPLASH_DAMAGE до 0 на границе радиуса.
        # Снимок списка игроков: _apply_damage может убить игрока и через
        # _maybe_spawn_miniboss добавить нового NPC в self.players, мутируя
        # словарь прямо во время итерации по нему (RuntimeError).
        for player in list(self.players.values()):
            if not player.alive:
                continue
            dist = math.hypot(player.x - bullet.x, player.y - bullet.y)
            if dist > ROCKET_SPLASH_RADIUS:
                continue
            falloff = 1 - dist / ROCKET_SPLASH_RADIUS
            dmg = round(ROCKET_SPLASH_DAMAGE * falloff)
            if dmg > 0:
                self._apply_damage(player, dmg, bullet.owner_id)
        self._explosions.append({"x": bullet.x, "y": bullet.y, "radius": ROCKET_SPLASH_RADIUS})

    def _process_flamethrower(self, now: float) -> None:
        # огнемёт не создаёт снарядов — конус проверяется напрямую каждый тик,
        # пока игрок удерживает кнопку стрельбы (flame_active_until обновляется в try_shoot)
        for player in list(self.players.values()):
            if not player.alive or now >= player.flame_active_until:
                continue
            # снимок целей — см. комментарий в _explode_rocket
            for target in list(self.players.values()):
                if target.id == player.id or not target.alive:
                    continue
                dist = math.hypot(target.x - player.x, target.y - player.y)
                if dist > FLAMETHROWER_RANGE:
                    continue
                angle_to_target = math.atan2(target.y - player.y, target.x - player.x)
                diff = abs(_angle_diff(player.turret_angle, angle_to_target))
                if diff > FLAMETHROWER_CONE_HALF_ANGLE:
                    continue
                dmg = round(FLAMETHROWER_TICK_DAMAGE * player.level_damage_mult())
                self._apply_damage(target, dmg, player.id)
                target.burn_until = now + FLAMETHROWER_BURN_DURATION
                target.burn_owner_id = player.id

    def _process_burning(self, now: float) -> None:
        # снимок списка — см. комментарий в _explode_rocket
        for player in list(self.players.values()):
            if not player.alive or now >= player.burn_until:
                continue
            if now - player.last_burn_tick_at < FLAMETHROWER_BURN_INTERVAL:
                continue
            player.last_burn_tick_at = now
            owner = self.players.get(player.burn_owner_id)
            mult = owner.level_damage_mult() if owner is not None else 1.0
            dmg = round(FLAMETHROWER_BURN_TICK_DAMAGE * mult)
            self._apply_damage(player, dmg, player.burn_owner_id)

    def _process_laser_star(self, now: float) -> None:
        # замена старого пассивного "super"-баффа: 8 лучей стартуют под углом
        # относительно башни в момент подбора и НЕПРЕРЫВНО вращаются, делая
        # ровно один полный оборот (360°) за LASER_STAR_DURATION, затем гаснут —
        # не привязаны к кнопке стрельбы игрока, см. _apply_pickup в room.py.
        # Углы пересчитываются КАЖДЫЙ тик (не только на тик-интервале урона),
        # иначе вращение на клиенте читалось бы ступенчато вместо плавного.
        # Геометрия проверки попадания такая же, как у лазера мини-босса
        # (_fire_miniboss_laser в miniboss.py): проекция на направление луча +
        # перпендикулярное расстояние. Длина каждого луча — не константа, а
        # точное расстояние до границы арены под ЕГО ТЕКУЩИМ углом из ТЕКУЩЕЙ
        # позиции игрока (ray_distance_to_field_edge) — луч всегда обрывается
        # ровно на краю поля, при любом положении игрока и любом угле вращения.
        # Стены крепости внутри карты намеренно игнорируются — это только
        # внешняя граница арены, не препятствия.
        for player in list(self.players.values()):
            if not player.alive or now >= player.laser_star_until:
                continue

            progress = (now - player.laser_star_started_at) / LASER_STAR_DURATION
            rotation = min(1.0, max(0.0, progress)) * 2 * math.pi
            player.laser_star_angles = [
                player.laser_star_base_angle + rotation + i * (2 * math.pi / LASER_STAR_BEAM_COUNT)
                for i in range(LASER_STAR_BEAM_COUNT)
            ]

            if now - player.laser_star_last_tick_at < LASER_STAR_TICK_INTERVAL:
                continue
            # угол на НАЧАЛО прошедшего интервала — нужен, чтобы проверять
            # попадание не по мгновенному положению луча (снимок ровно в
            # момент тика), а по всей ДУГЕ, которую луч прошёл за интервал.
            # Раньше: лучи делают полный оборот за 3.5с (~103°/сек), а тик
            # проверки — раз в 0.25с (~26° поворота за интервал), при узком
            # луче (14px) на любой разумной дистанции угловая ширина луча
            # заметно меньше этих 26° — цель часто оказывалась МЕЖДУ двумя
            # проверенными мгновенными положениями луча, хотя реально он
            # "прошёл" через неё в процессе поворота. Из-за этого урон
            # ощущался слабым/непредсказуемым, хотя цифра dmg была верной.
            prev_tick_at = player.laser_star_last_tick_at
            interval = now - prev_tick_at if prev_tick_at > 0 else LASER_STAR_TICK_INTERVAL
            prev_progress = (prev_tick_at - player.laser_star_started_at) / LASER_STAR_DURATION
            prev_rotation = min(1.0, max(0.0, prev_progress)) * 2 * math.pi
            player.laser_star_last_tick_at = now
            mult = player.level_damage_mult()
            dmg = round(LASER_STAR_TICK_DAMAGE * mult)
            # длина и направление каждого луча не зависят от цели — считаем
            # один раз на 8 лучей, а не заново на каждую пару луч×цель (было
            # 8 x N_целей вызовов ray_distance_to_field_edge на один тик урона).
            # Для каждого луча берём и начальный, и конечный угол интервала —
            # проверка попадания идёт по обоим "снимкам" плюс промежуточным
            # сэмплам дуги между ними (см. ARC_SAMPLES ниже), не только по
            # финальному положению.
            ARC_SAMPLES = 4  # сэмплов дуги на интервал — компромисс точность/цена
            beam_arcs = []
            for i in range(LASER_STAR_BEAM_COUNT):
                a_end = player.laser_star_angles[i]
                a_start = player.laser_star_base_angle + prev_rotation + i * (2 * math.pi / LASER_STAR_BEAM_COUNT)
                samples = []
                for s in range(ARC_SAMPLES + 1):
                    frac = s / ARC_SAMPLES
                    a = a_start + (a_end - a_start) * frac
                    samples.append((math.cos(a), math.sin(a), ray_distance_to_field_edge(player.x, player.y, a)))
                beam_arcs.append(samples)
            # снимок целей — см. комментарий в _explode_rocket
            for target in list(self.players.values()):
                if target.id == player.id or not target.alive:
                    continue
                tx, ty = target.x - player.x, target.y - player.y
                hit = False
                for samples in beam_arcs:
                    for dx, dy, beam_len in samples:
                        along = tx * dx + ty * dy
                        if along < 0 or along > beam_len:
                            continue
                        perp = abs(tx * dy - ty * dx)
                        if perp <= LASER_STAR_WIDTH / 2 + target.size / 2:
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    self._apply_damage(target, dmg, player.id)
                    self._laser_star_hits.append({"x": target.x, "y": target.y})

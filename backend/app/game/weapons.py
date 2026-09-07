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
    SNIPER_COOLDOWN,
    SNIPER_DAMAGE,
    SNIPER_SPEED,
    SNIPER_SIZE,
    SNIPER_PIERCE,
    BRAWLER_COOLDOWN,
    BRAWLER_DAMAGE,
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
)

_WEAPON_COOLDOWN = {
    "cannon": FIRE_COOLDOWN,
    "minigun": MINIGUN_COOLDOWN,
    "flamethrower": FLAMETHROWER_COOLDOWN,
    "rocket": ROCKET_COOLDOWN,
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

        # подобранное оружие с карты (minigun/flamethrower/rocket) — ДОПОЛНИТЕЛЬНЫЙ
        # режим атаки поверх постоянного оружия класса, а не замена: класс
        # продолжает стрелять как обычно по основной кнопке (ЛКМ), а пикап
        # доступен отдельно по use_pickup=True (ПКМ) пока не истёк weapon_until.
        # Раньше пикап временно ПОДМЕНЯЛ оружие класса целиком — так игрок на
        # время терял свой снайпер/ближний бой/пулемёт вместо усиления им.
        pickup_active = now < player.weapon_until and player.weapon in (
            "minigun",
            "flamethrower",
            "rocket",
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
            dmg = round(BRAWLER_DAMAGE * boost_mult)
            for spread in (-BRAWLER_SPREAD / 2, BRAWLER_SPREAD / 2):
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

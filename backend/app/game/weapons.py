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
)

_WEAPON_COOLDOWN = {
    "cannon": FIRE_COOLDOWN,
    "minigun": MINIGUN_COOLDOWN,
    "flamethrower": FLAMETHROWER_COOLDOWN,
    "rocket": ROCKET_COOLDOWN,
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

    def try_shoot(self, player_id: str) -> None:
        player = self.players.get(player_id)
        if player is None or not player.alive:
            return
        now = time.monotonic()

        weapon = player.weapon if now < player.weapon_until else "cannon"
        if weapon != player.weapon:
            player.weapon = "cannon"

        cooldown = _WEAPON_COOLDOWN.get(weapon, FIRE_COOLDOWN)
        if now - player.last_shot_at < cooldown:
            return
        player.last_shot_at = now

        if now >= player.damage_until:
            player.damage = 20

        # множитель урона (damage/super boost) применяется поверх базового
        # урона оружия, а не только к пушке — иначе смена оружия "теряла" бы бонус
        boost_mult = player.damage / 20 if player.damage != 20 else 1.0

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
        else:
            bullet = Bullet.new(
                player.id, muzzle_x, muzzle_y, player.turret_angle, player.damage, kind="cannon"
            )
        self.bullets[bullet.id] = bullet

    def _explode_rocket(self, bullet: Bullet) -> None:
        # сплэш-урон по всем живым в радиусе взрыва, урон убывает с расстоянием
        # чисто линейно от ROCKET_SPLASH_DAMAGE до 0 на границе радиуса
        for player in self.players.values():
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
        for player in self.players.values():
            if not player.alive or now >= player.flame_active_until:
                continue
            for target in self.players.values():
                if target.id == player.id or not target.alive:
                    continue
                dist = math.hypot(target.x - player.x, target.y - player.y)
                if dist > FLAMETHROWER_RANGE:
                    continue
                angle_to_target = math.atan2(target.y - player.y, target.x - player.x)
                diff = abs(_angle_diff(player.turret_angle, angle_to_target))
                if diff > FLAMETHROWER_CONE_HALF_ANGLE:
                    continue
                self._apply_damage(target, FLAMETHROWER_TICK_DAMAGE, player.id)
                target.burn_until = now + FLAMETHROWER_BURN_DURATION
                target.burn_owner_id = player.id

    def _process_burning(self, now: float) -> None:
        for player in self.players.values():
            if not player.alive or now >= player.burn_until:
                continue
            if now - player.last_burn_tick_at < FLAMETHROWER_BURN_INTERVAL:
                continue
            player.last_burn_tick_at = now
            self._apply_damage(player, FLAMETHROWER_BURN_TICK_DAMAGE, player.burn_owner_id)

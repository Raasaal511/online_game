import math
import random

from app.game.entities import Pickup, SPEED_BOOST_DURATION, WEAPON_PICKUP_DURATION
from app.game.map import FIELD_WIDTH, FIELD_HEIGHT, SUPER_PICKUP_POINT

PICKUP_MAX_COUNT = 7  # больше предметов на карте одновременно — раньше жаловались, что пикапы (особенно оружие) появляются редко
PICKUP_SPAWN_INTERVAL = 5.0
# "minigun" убран из пула — у gunner-класса уже есть постоянное аналогичное
# оружие, пикап с тем же ощущением на карте дублировал класс, а не добавлял
# разнообразия; "ice" занял освободившееся место в пуле
PICKUP_KINDS = ["heal", "armor", "damage", "speed", "flamethrower", "rocket", "ice"]
ARMOR_DURATION = 12.0
DAMAGE_BOOST_DURATION = 12.0
DAMAGE_BOOST_MULT = 1.5

SUPER_PICKUP_RESPAWN_DELAY = 45.0  # сек до повторного появления супер-пикапа в центре


class PickupMixin:
    """Спавн и подбор пикапов на карте: обычные баффы/оружие плюс редкий
    супер-пикап в центре крепости (лазерная звезда).
    """

    def _spawn_pickups(self, elapsed: float) -> None:
        from app.game.combat import rect_intersects_walls

        if len(self.pickups) >= PICKUP_MAX_COUNT:
            return
        if elapsed - self._last_pickup_spawn < PICKUP_SPAWN_INTERVAL:
            return
        self._last_pickup_spawn = elapsed

        for _ in range(20):
            x = random.uniform(60, FIELD_WIDTH - 60)
            y = random.uniform(60, FIELD_HEIGHT - 60)
            if not rect_intersects_walls(x, y, 24):
                kind = random.choice(PICKUP_KINDS)
                pickup = Pickup.new(x, y, kind)
                self.pickups[pickup.id] = pickup
                break

    def _spawn_super_pickup(self, now: float) -> None:
        # редкий мощный power-up с фиксированным спавном строго в центре
        # крепости — единственная копия одновременно, долгий кулдаун
        if self._super_pickup_id is not None:
            return
        if now < self._super_pickup_respawn_at:
            return
        x, y = SUPER_PICKUP_POINT
        pickup = Pickup.new(x, y, "super")
        self.pickups[pickup.id] = pickup
        self._super_pickup_id = pickup.id

    def _check_pickup_collisions(self, now: float) -> None:
        consumed = []
        for pickup in self.pickups.values():
            for player in self.players.values():
                if not player.alive:
                    continue
                if abs(player.x - pickup.x) < (player.size + pickup.size) / 2 and abs(
                    player.y - pickup.y
                ) < (player.size + pickup.size) / 2:
                    self._apply_pickup(player, pickup, now)
                    consumed.append(pickup.id)
                    break

        for pid in consumed:
            self.pickups.pop(pid, None)
            if pid == self._super_pickup_id:
                self._super_pickup_id = None
                self._super_pickup_respawn_at = now + SUPER_PICKUP_RESPAWN_DELAY

    def _apply_pickup(self, player, pickup: Pickup, now: float) -> None:
        from app.game.entities import LASER_STAR_DURATION, LASER_STAR_BEAM_COUNT

        # баффы одного типа стакаются аддитивно по времени: если armor/damage/
        # speed/super ещё действует, новый пикап ПРОДЛЕВАЕТ оставшееся время
        # (не перезаписывает его заново) — подобрал два подряд, действует дольше,
        # а не просто "обновил" тот же таймер. Сила эффекта не растёт (не стакается
        # мультипликативно) — только длительность, чтобы не сломать баланс.
        if pickup.kind == "heal":
            player.hp = min(player.max_hp, player.hp + 40)
        elif pickup.kind == "armor":
            base = max(now, player.armor_until)
            player.armor_until = base + ARMOR_DURATION
        elif pickup.kind == "damage":
            base = max(now, player.damage_until)
            player.damage_until = base + DAMAGE_BOOST_DURATION
            player.damage = round(20 * DAMAGE_BOOST_MULT)
        elif pickup.kind == "speed":
            base = max(now, player.speed_boost_until)
            player.speed_boost_until = base + SPEED_BOOST_DURATION
        elif pickup.kind == "super":
            # больше не пассивный статовый бафф — превращает танк в лазерную
            # турель на LASER_STAR_DURATION секунд: 8 лучей стартуют под углом
            # ОТНОСИТЕЛЬНО ТЕКУЩЕЙ БАШНИ в момент подбора и затем непрерывно
            # вращаются, делая РОВНО один полный оборот (360°) за всё время
            # действия, после чего гаснут — см. _process_laser_star, которая
            # каждый тик пересчитывает laser_star_angles из started_at/base_angle.
            # Полный хил оставлен как "power fantasy" — не усложняет механику,
            # но подчёркивает, что подбор супер-пикапа — момент силы.
            player.laser_star_until = now + LASER_STAR_DURATION
            player.laser_star_started_at = now
            player.laser_star_base_angle = player.turret_angle
            player.laser_star_angles = [
                player.turret_angle + i * (2 * math.pi / LASER_STAR_BEAM_COUNT)
                for i in range(LASER_STAR_BEAM_COUNT)
            ]
            player.hp = player.max_hp
        elif pickup.kind in ("flamethrower", "rocket", "ice"):
            player.weapon = pickup.kind
            player.weapon_until = now + WEAPON_PICKUP_DURATION
            player.last_shot_at = -999.0  # можно стрелять новым оружием сразу, без остатка кулдауна

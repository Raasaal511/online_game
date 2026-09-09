import math
import random

from app.game.entities import (
    Trap,
    Bomb,
    TRAP_DAMAGE,
    TRAP_SLOW_DURATION,
    TRAP_SLOW_MULT,
    TRAP_TRIGGER_COOLDOWN,
    TRAP_ROTATION_INTERVAL,
    BOMB_MIN_INTERVAL,
    BOMB_MAX_INTERVAL,
    BOMB_RADIUS,
    PIT_FALL_TIME,
)
from app.game.map import FIELD_WIDTH, FIELD_HEIGHT, SUPER_PICKUP_POINT, PIT_ZONES

# доля фоновых бомб, намеренно приземляемых у ямы/супер-пикапа (см. _spawn_bombs) —
# при площади "круга у центра" примерно вчетверо меньше площади всей карты,
# 0.5 шанс даёт эффективную плотность там ~2-3x выше среднекарточной
BOMB_NEAR_SUPER_CHANCE = 0.5


class HazardMixin:
    """Фоновые угрозы карты, не связанные с прямым PvP: бомбы со случайным
    таймером, вращающиеся ловушки и смертельная яма у центра карты.
    """

    def _spawn_bombs(self, now: float) -> None:
        from app.game.combat import rect_intersects_walls

        if now < self._next_bomb_at:
            return
        self._next_bomb_at = now + random.uniform(BOMB_MIN_INTERVAL, BOMB_MAX_INTERVAL)

        # BOMB_NEAR_SUPER_CHANCE смещает выбор точки, а не глобальный интервал —
        # так бомбы у ямы/супер-пикапа появляются заметно (2-3x) чаще НЕ ценой
        # затопления бомбами всей остальной карты (что дал бы просто более
        # короткий BOMB_MIN/MAX_INTERVAL)
        near_super = random.random() < BOMB_NEAR_SUPER_CHANCE
        cx, cy = SUPER_PICKUP_POINT
        for _ in range(20):
            if near_super:
                # круг вокруг центра, за пределами ямы (радиус ямы ~205px) —
                # бомба должна упасть там, где до неё реально можно дойти
                angle = random.uniform(0, math.pi * 2)
                dist = random.uniform(220.0, 340.0)
                x = cx + math.cos(angle) * dist
                y = cy + math.sin(angle) * dist
                x = max(80, min(FIELD_WIDTH - 80, x))
                y = max(80, min(FIELD_HEIGHT - 80, y))
            else:
                x = random.uniform(80, FIELD_WIDTH - 80)
                y = random.uniform(80, FIELD_HEIGHT - 80)
            if not rect_intersects_walls(x, y, BOMB_RADIUS * 0.5) and not self._in_pit_zone(x, y):
                bomb = Bomb.new(x, y, now)
                self.bombs[bomb.id] = bomb
                break

    def _process_bombs(self, now: float) -> None:
        exploded = []
        for bomb in self.bombs.values():
            if now - bomb.spawned_at < bomb.fuse_time:
                continue
            exploded.append(bomb.id)
            # снимок списка — см. комментарий в _check_bullet_collisions
            for player in list(self.players.values()):
                if not player.alive:
                    continue
                dist = math.hypot(player.x - bomb.x, player.y - bomb.y)
                if dist > bomb.radius:
                    continue
                falloff = 1 - dist / bomb.radius
                dmg = round(bomb.damage * falloff)
                if dmg > 0:
                    # владелец (мини-босс, артиллерия) засчитывает фраг; обычная
                    # фоновая бомба без владельца — самоурон, фраг никому
                    killer_id = bomb.owner_id or player.id
                    self._apply_damage(player, dmg, killer_id)
            self._explosions.append({"x": bomb.x, "y": bomb.y, "radius": bomb.radius})

        for bid in exploded:
            self.bombs.pop(bid, None)

    def _check_trap_collisions(self, now: float) -> None:
        for trap in self.traps.values():
            # снимок списка — см. комментарий в _check_bullet_collisions
            for player in list(self.players.values()):
                if (
                    not player.alive
                    or now < player.trap_cooldown_until
                    or now < player.spawn_protected_until
                ):
                    continue
                if abs(player.x - trap.x) < (player.size + trap.size) / 2 and abs(
                    player.y - trap.y
                ) < (player.size + trap.size) / 2:
                    player.trap_cooldown_until = now + TRAP_TRIGGER_COOLDOWN
                    player.slow_until = now + TRAP_SLOW_DURATION
                    player.slow_mult = TRAP_SLOW_MULT
                    player.hp -= TRAP_DAMAGE
                    if player.hp <= 0:
                        player.hp = 0
                        self._kill_player(player, player.id)  # ловушка = самоурон, не чужое убийство

    def _new_random_trap(self) -> Trap | None:
        from app.game.combat import rect_intersects_walls

        # та же логика выбора свободной точки, что у _spawn_pickups/_spawn_bombs —
        # избегаем стен И ямы (ловушка внутри уже смертельной зоны бессмысленна)
        for _ in range(20):
            x = random.uniform(60, FIELD_WIDTH - 60)
            y = random.uniform(60, FIELD_HEIGHT - 60)
            if not rect_intersects_walls(x, y, 24) and not self._in_pit_zone(x, y):
                return Trap.new(x, y)
        return None

    def _rotate_traps(self, now: float) -> None:
        # ловушки больше не стоят на месте — раз в TRAP_ROTATION_INTERVAL
        # одна случайная ловушка исчезает и тут же появляется новая в другой
        # случайной точке, поддерживая постоянное количество TRAP_COUNT
        if now < self._next_trap_rotation_at:
            return
        self._next_trap_rotation_at = now + TRAP_ROTATION_INTERVAL

        if self.traps:
            old_id = random.choice(list(self.traps.keys()))
            del self.traps[old_id]

        new_trap = self._new_random_trap()
        if new_trap is not None:
            self.traps[new_trap.id] = new_trap

    def _in_pit_zone(self, x: float, y: float) -> bool:
        for zx, zy, zw, zh in PIT_ZONES:
            if zx <= x <= zx + zw and zy <= y <= zy + zh:
                return True
        return False

    def _process_pits(self, now: float) -> None:
        # яма вокруг супер-пикапа: заезд в зону запускает короткий отсчёт
        # падения (falling_since), а не мгновенную смерть — если игрок успел
        # выехать до истечения PIT_FALL_TIME, отсчёт сбрасывается (можно
        # "спастись" резким манёвром, а не гарантированно терять танк при
        # касании края ямы). Смерть проведена через _kill_player напрямую
        # (не _apply_damage — та учитывает spawn-неуязвимость/броню, а яма
        # должна убивать безусловно, как и урон от ловушек-самоубийц).
        for player in list(self.players.values()):
            if not player.alive or player.is_miniboss:
                continue
            if self._in_pit_zone(player.x, player.y):
                if player.falling_since <= 0:
                    player.falling_since = now
                elif now - player.falling_since >= PIT_FALL_TIME:
                    player.falling_since = 0.0
                    player.hp = 0
                    self._kill_player(player, player.id)  # яма = самоурон, не чужое убийство
            else:
                player.falling_since = 0.0

import math
import random
import time

from app.game.entities import (
    Nuke,
    NUKE_MIN_INTERVAL,
    NUKE_MAX_INTERVAL,
    NUKE_WARNING_DURATION,
    NUKE_DAMAGE,
    NUKE_RADIUS_FRACTION,
    NUKE_LETHAL_FRACTION,
)


class NukeMixin:
    """Редкое глобальное событие: долгое предупреждение на пол-экрана,
    затем тяжёлый урон всем, кто остался в радиусе.
    """

    def _schedule_next_nuke(self, now: float) -> None:
        self._next_nuke_at = now + random.uniform(NUKE_MIN_INTERVAL, NUKE_MAX_INTERVAL)

    def _spawn_nuke(self, now: float) -> None:
        if self._active_nuke is not None:
            return
        if now < self._next_nuke_at:
            return

        from app.game.map import FIELD_WIDTH, FIELD_HEIGHT

        diagonal = math.hypot(FIELD_WIDTH, FIELD_HEIGHT)
        radius = diagonal * NUKE_RADIUS_FRACTION

        # центр ядерки где-то в средней трети карты — не впритык к краю,
        # чтобы взрыв ощутимо накрывал игровую зону, а не половину пустоты
        x = random.uniform(FIELD_WIDTH * 0.3, FIELD_WIDTH * 0.7)
        y = random.uniform(FIELD_HEIGHT * 0.3, FIELD_HEIGHT * 0.7)

        self._active_nuke = Nuke.new(x, y, now, radius)

    def _process_nuke(self, now: float) -> None:
        nuke = self._active_nuke
        if nuke is None:
            return
        if now - nuke.spawned_at < NUKE_WARNING_DURATION:
            return

        # смертельное ядро — ближе NUKE_LETHAL_FRACTION радиуса от эпицентра
        # урон гарантированно убивает (даже сквозь броню/супер-щит), дальше —
        # обычный линейный falloff до внешнего края радиуса. Раньше урон был
        # линейным от центра (70 макс.) и почти никогда не убивал вообще —
        # ядерка не ощущалась как смертельная угроза, только как неприятный тик.
        # Снимок списка: _apply_damage может убить игрока и через
        # _maybe_spawn_miniboss добавить нового NPC в self.players, мутируя
        # словарь прямо во время итерации по нему (RuntimeError).
        for player in list(self.players.values()):
            if not player.alive:
                continue
            dist = math.hypot(player.x - nuke.x, player.y - nuke.y)
            if dist > nuke.radius:
                continue
            if dist <= nuke.radius * NUKE_LETHAL_FRACTION:
                dmg = 9999  # гарантированный килл в зоне поражения, даже сквозь броню
            else:
                edge_progress = (dist - nuke.radius * NUKE_LETHAL_FRACTION) / (
                    nuke.radius * (1 - NUKE_LETHAL_FRACTION)
                )
                falloff = 1 - edge_progress
                dmg = round(NUKE_DAMAGE * falloff)
            if dmg > 0:
                self._apply_damage(player, dmg, player.id)  # ядерка не засчитывает фраг никому

        self._explosions.append({"x": nuke.x, "y": nuke.y, "radius": nuke.radius, "kind": "nuke"})
        self._active_nuke = None
        self._schedule_next_nuke(now)

import random
import time

from app.game.entities import (
    Portal,
    PORTAL_SIZE,
    PORTAL_LIFETIME,
    PORTAL_MIN_INTERVAL,
    PORTAL_MAX_INTERVAL,
    PORTAL_COOLDOWN_AFTER_USE,
)
from app.game.map import PORTAL_POINTS


class PortalMixin:
    """Пара телепорт-порталов, спавнящихся/исчезающих динамически у случайных
    точек карты — заменяет прежний Shift-прыжок по курсору: перемещение
    теперь объект карты, доступный всем игрокам, а не личная способность.
    """

    def _init_portals(self) -> None:
        self.portals: dict[str, Portal] = {}
        self._next_portal_spawn_at = time.monotonic() + random.uniform(
            PORTAL_MIN_INTERVAL, PORTAL_MAX_INTERVAL
        )
        self._portal_events: list[dict] = []  # spawn/despawn события этого тика для клиента

    def _spawn_portals(self, now: float) -> None:
        if self.portals:
            return  # одна пара одновременно — иначе карта быстро зарастает порталами
        if now < self._next_portal_spawn_at:
            return

        a_point, b_point = random.sample(PORTAL_POINTS, 2)
        a = Portal.new(a_point[0], a_point[1], "", now)
        b = Portal.new(b_point[0], b_point[1], a.id, now)
        a.link_id = b.id
        self.portals[a.id] = a
        self.portals[b.id] = b
        self._portal_events.append(
            {"type": "spawn", "points": [{"x": a.x, "y": a.y}, {"x": b.x, "y": b.y}]}
        )

    def _process_portals(self, now: float) -> None:
        if self.portals and now - next(iter(self.portals.values())).spawned_at >= PORTAL_LIFETIME:
            self._portal_events.append({"type": "despawn"})
            self.portals.clear()
            self._next_portal_spawn_at = now + random.uniform(PORTAL_MIN_INTERVAL, PORTAL_MAX_INTERVAL)
            return

        if not self.portals:
            return

        for player in list(self.players.values()):
            if not player.alive or now < player.portal_cooldown_until:
                continue
            for portal in list(self.portals.values()):
                dist_x = abs(player.x - portal.x)
                dist_y = abs(player.y - portal.y)
                if dist_x > (player.size + PORTAL_SIZE) / 2 or dist_y > (player.size + PORTAL_SIZE) / 2:
                    continue
                target = self.portals.get(portal.link_id)
                if target is None:
                    continue
                player.x, player.y = target.x, target.y
                player.portal_cooldown_until = now + PORTAL_COOLDOWN_AFTER_USE
                self._teleports.append({"player_id": player.id, "x": target.x, "y": target.y})
                break

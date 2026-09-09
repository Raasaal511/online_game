import math
import random
import time

from app.game.entities import Player, TANK_CLASSES, GUN_SKINS, GUNNER_MAG_SIZE
from app.game.map import SPAWN_POINTS


class RespawnMixin:
    """Жизненный цикл смерти/возрождения игрока: выбор точки спавна вдали
    от опасностей, сброс состояния танка на респавне, отложенные респавны
    и текущий (внутрисессионный) лидерборд по убийствам.
    """

    def _live_leaderboard(self) -> list[dict]:
        # топ-3 текущей игровой сессии по убийствам — живёт только в памяти
        # процесса (по нику+соединению текущего захода), без БД/истории между
        # перезапусками сервера или разных игровых сессий одного и того же ника
        real_players = [p for p in self.players.values() if not p.is_miniboss]
        top = sorted(real_players, key=lambda p: p.kills, reverse=True)[:3]
        return [{"nickname": p.nickname, "kills": p.kills} for p in top if p.kills > 0]

    async def _handle_death(self, player: Player) -> None:
        from app.game.room import RESPAWN_DELAY

        lifetime = player.lifetime()
        kills = player.kills
        ws = self.connections.get(player.id)
        if ws is not None:
            try:
                await ws.send_json(
                    {
                        "type": "death",
                        "lifetime_seconds": lifetime,
                        "kills": kills,
                        "respawn_in": RESPAWN_DELAY,
                    }
                )
            except Exception:
                pass

    def _process_respawns(self, now: float) -> None:
        ready = [pid for pid, at in self._pending_respawns.items() if now >= at]
        for pid in ready:
            del self._pending_respawns[pid]
            tank_class = self._pending_respawn_class.pop(pid, None)
            self._respawn(pid, tank_class)

    def set_respawn_class(self, player_id: str, tank_class: str) -> None:
        # игрок выбирает класс на следующее возрождение (пока он мёртв) —
        # применяется в _respawn, не мгновенно, т.к. живой танк не меняет класс
        if tank_class in TANK_CLASSES:
            self._pending_respawn_class[player_id] = tank_class

    def set_gun_skin(self, player_id: str, gun_skin: str) -> None:
        # чисто косметическое — можно менять в любой момент, не только на респавне
        if gun_skin not in GUN_SKINS:
            return
        player = self.players.get(player_id)
        if player is not None:
            player.gun_skin = gun_skin

    def _pick_spawn_point(self) -> tuple[float, float]:
        # избегаем не только других игроков, но и активных угроз рядом с
        # точкой спавна — иначе респавн может высадить танк прямо под
        # пулей/на грани взрыва бомбы, что убивает его почти сразу
        danger_zones = [(p.x, p.y, 80.0) for p in self.players.values() if p.alive]
        danger_zones += [(b.x, b.y, 120.0) for b in self.bullets.values()]
        danger_zones += [(bomb.x, bomb.y, bomb.radius + 40.0) for bomb in self.bombs.values()]

        free_points = [
            pt for pt in SPAWN_POINTS
            if all(math.hypot(pt[0] - zx, pt[1] - zy) > radius for zx, zy, radius in danger_zones)
        ]
        if free_points:
            return random.choice(free_points)

        # если все точки "опасны" (маловероятно, но возможно при полной
        # комнате), лучше вернуть точку подальше от игроков, чем от пуль —
        # столкновение с танком в момент спавна не смертельно само по себе
        safer_points = [
            pt for pt in SPAWN_POINTS
            if all(
                math.hypot(pt[0] - p.x, pt[1] - p.y) > 80
                for p in self.players.values()
                if p.alive
            )
        ]
        return random.choice(safer_points or SPAWN_POINTS)

    def _respawn(self, player_id: str, tank_class: str | None = None) -> None:
        from app.game.entities import SPAWN_PROTECTION_DURATION

        player = self.players.get(player_id)
        if player is None:
            return
        now = time.monotonic()
        x, y = self._pick_spawn_point()
        player.x, player.y = x, y
        player.dir_x, player.dir_y = 0.0, 0.0
        player.vx, player.vy = 0.0, 0.0
        player.hp = player.max_hp
        player.alive = True
        player.died_at = None
        player.joined_at = now
        player.armor_until = 0.0
        player.damage_until = 0.0
        player.speed_boost_until = 0.0
        player.slow_until = 0.0
        player.super_until = 0.0
        player.damage = 20
        player.weapon = "cannon"
        player.weapon_until = 0.0
        player.flame_active_until = 0.0
        player.burn_until = 0.0
        player.laser_star_until = 0.0
        player.laser_star_angles = []
        player.falling_since = 0.0
        if tank_class in TANK_CLASSES:
            player.tank_class = tank_class
        player.ammo = GUNNER_MAG_SIZE
        player.reload_until = 0.0
        player.portal_cooldown_until = 0.0
        # ultimate_kills НЕ обнуляем: копится за всю сессию так же, как kills —
        # риск/фарм-петля уровня намеренно жёстче (сбрасывается на смерти),
        # но ульта — награда за суммарный вклад в игру, а не за одну жизнь
        # короткая неуязвимость сразу после спавна — подстраховка сверх
        # безопасного выбора точки: пуля может долететь уже после спавна,
        # или несколько игроков заспавниться близко друг к другу одновременно
        player.spawn_protected_until = now + SPAWN_PROTECTION_DURATION
        # kills НЕ обнуляем: это счётчик за всю сессию соединения, а не за
        # одну жизнь — раньше сбрасывался на респавне, из-за чего ScoreBoard
        # и запись в топ-3 при повторной смерти теряли уже накопленные фраги

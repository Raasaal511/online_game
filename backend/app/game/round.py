from app.game.entities import TANK_MAX_HP

ROUND_END_BANNER_DURATION = 6.0  # сек показа баннера победителя перед реваншем


class RoundMixin:
    """Таймер раунда: определение победителя по числу убийств по истечении
    ROUND_DURATION, показ баннера победителя и полный реванш (респавн всех,
    сброс счёта) по его окончании.
    """

    def _process_round(self, now: float) -> None:
        from app.game.room import ROUND_DURATION

        # пока показывается баннер победителя — ждём ROUND_END_BANNER_DURATION,
        # затем полный реванш: респавн всех + сброс kills/deaths/level/xp
        if self._round_end_banner_until is not None:
            if now >= self._round_end_banner_until:
                self._round_end_banner_until = None
                self._start_new_round(now)
            return

        if now - self._round_started_at < ROUND_DURATION:
            return

        # раунд закончился — определяем победителя по числу убийств среди
        # реальных игроков (мини-боссы не участвуют, это NPC)
        real_players = [p for p in self.players.values() if not p.is_miniboss]
        winner = max(real_players, key=lambda p: p.kills, default=None)
        self._round_winner = (
            {"nickname": winner.nickname, "kills": winner.kills} if winner is not None else None
        )
        self._round_ended_event = self._round_winner
        self._round_end_banner_until = now + ROUND_END_BANNER_DURATION

    def _start_new_round(self, now: float) -> None:
        # полный реванш: все живые и мёртвые игроки возрождаются на новых
        # точках спавна, счёт (kills/deaths/level/xp) сбрасывается у всех —
        # мини-боссы (NPC) просто удаляются, а не респавнятся как игроки
        self._round_started_at = now
        for player_id in list(self.players.keys()):
            player = self.players.get(player_id)
            if player is None:
                continue
            if player.is_miniboss:
                self.players.pop(player_id, None)
                continue
            player.kills = 0
            player.deaths = 0
            player.level = 1
            player.xp = 0
            player.ultimate_kills = 0
            player.max_hp = TANK_MAX_HP
            self._pending_respawns.pop(player_id, None)
            # если игрок мёртвым выбрал класс через select_class прямо перед
            # концом раунда — реванш должен уважать этот выбор, а не молча
            # проигнорировать его и оставить "зависшим" на следующую обычную
            # смерть уже в новом раунде
            tank_class = self._pending_respawn_class.pop(player_id, None)
            self._respawn(player_id, tank_class)

import time

from fastapi import WebSocket

from app.game.entities import Player, TANK_CLASSES, DEFAULT_TANK_CLASS, GUN_SKINS, DEFAULT_GUN_SKIN

# токен-бакет на входящие WS-сообщения одного игрока: не даёт клиенту (или
# бажным/вредоносным скриптом) заливать сервер сообщениями быстрее, чем
# сервер способен разумно обработать — независимо от игровых кулдаунов
# оружия (те защищают баланс, а не нагрузку на broadcast/lock)
MSG_BUCKET_CAPACITY = 60.0  # максимум "сообщений про запас"
# клиент реально шлёт: aim до 20/сек (throttle 50мс) + shoot до ~11/сек при
# автооружии (throttle 90мс) + input по событию нажатия клавиш — суммарно
# может доходить до ~35-40/сек в пике; лимит выше с запасом, чтобы резать
# только настоящий флуд (десятки сообщений за один тик), а не игру
MSG_BUCKET_REFILL_RATE = 60.0  # сообщений/сек восстановления

CHAT_MAX_LEN = 200
CHAT_HISTORY_SIZE = 30
CHAT_MIN_INTERVAL = 0.5  # сек между сообщениями чата от одного игрока


class ConnectionMixin:
    """Подключение/отключение игроков, приём ввода (движение/прицел), защита
    от флуда входящих WS-сообщений и чат комнаты.
    """

    async def add_player(
        self,
        nickname: str,
        ws: WebSocket,
        tank_class: str = DEFAULT_TANK_CLASS,
        gun_skin: str = DEFAULT_GUN_SKIN,
    ) -> Player | None:
        async with self._lock:
            if self.is_full():
                return None
            x, y = self._pick_spawn_point()
            player = Player.new(nickname[:16] or "Player", x, y)
            if tank_class in TANK_CLASSES:
                player.tank_class = tank_class
            if gun_skin in GUN_SKINS:
                player.gun_skin = gun_skin
            self.players[player.id] = player
            self.connections[player.id] = ws
            return player

    def remove_player(self, player_id: str) -> None:
        self.players.pop(player_id, None)
        self.connections.pop(player_id, None)
        self._pending_respawns.pop(player_id, None)
        self._pending_respawn_class.pop(player_id, None)
        self._msg_buckets.pop(player_id, None)

    def set_input(self, player_id: str, dir_x: float, dir_y: float) -> None:
        from app.game.combat import clamp

        player = self.players.get(player_id)
        if player and player.alive:
            player.dir_x = clamp(dir_x, -1, 1)
            player.dir_y = clamp(dir_y, -1, 1)

    def set_aim(self, player_id: str, angle: float) -> None:
        player = self.players.get(player_id)
        if player and player.alive:
            player.turret_angle = angle

    def allow_message(self, player_id: str) -> bool:
        # токен-бакет: каждому входящему WS-сообщению (input/aim/shoot/chat)
        # нужен токен; бакет пополняется со временем, но не может копиться
        # бесконечно — режет как устойчивый флуд, так и короткие всплески
        now = time.monotonic()
        tokens, last_refill = self._msg_buckets.get(player_id, (MSG_BUCKET_CAPACITY, now))
        tokens = min(MSG_BUCKET_CAPACITY, tokens + (now - last_refill) * MSG_BUCKET_REFILL_RATE)
        if tokens < 1.0:
            self._msg_buckets[player_id] = (tokens, now)
            return False
        self._msg_buckets[player_id] = (tokens - 1.0, now)
        return True

    def add_chat_message(self, player_id: str, text: str) -> dict | None:
        player = self.players.get(player_id)
        if player is None:
            return None
        now = time.monotonic()
        if now - player.chat_last_at < CHAT_MIN_INTERVAL:
            return None
        text = text.strip()[:CHAT_MAX_LEN]
        if not text:
            return None
        player.chat_last_at = now
        entry = {"nickname": player.nickname, "text": text, "at": now}
        self._chat_log.append(entry)
        if len(self._chat_log) > CHAT_HISTORY_SIZE:
            self._chat_log = self._chat_log[-CHAT_HISTORY_SIZE:]
        return entry

    def get_chat_history(self) -> list[dict]:
        return self._chat_log[-CHAT_HISTORY_SIZE:]

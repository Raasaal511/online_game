import math
import random
import time

from app.game.entities import (
    Player,
    Bullet,
    TANK_MAX_HP,
    TANK_SPEED,
    BULLET_DAMAGE,
    BULLET_SPEED,
    FIRE_COOLDOWN,
    MINIBOSS_HP_MULT,
    MINIBOSS_DAMAGE_MULT,
    MINIBOSS_SPEED_MULT,
    MINIBOSS_REWARD_DURATION,
    MINIBOSS_REWARD_ARMOR_REDUCTION,
    MINIBOSS_REWARD_DAMAGE_MULT,
)

MINIBOSS_SIZE = 52  # заметно крупнее обычного танка (32)

# AI мини-босса намеренно НЕ преследует одного игрока: он должен наводить
# суету по всей карте (площадной АоЕ-обстрел) и заставлять уворачиваться
# толпу, а не превращаться в дуэль "босс vs ближайший игрок"
MINIBOSS_WAYPOINT_RADIUS = 40.0  # считается "дошёл", если ближе этого расстояния
MINIBOSS_SALVO_SIZE = 5  # снарядов в одном веерном залпе
MINIBOSS_SALVO_SPREAD = 0.85  # радианы, суммарный раствор веера
MINIBOSS_SALVO_COOLDOWN = 2.2  # сек между залпами (залп сам по себе "плотный")


def spawn_miniboss(x: float, y: float, owner_nickname: str) -> Player:
    # мини-босс — обычный Player (переиспользует всю физику/коллизии/урон),
    # но без записи в GameRoom.connections — значит на него никогда не
    # придёт попытка отправить WS-сообщение, а is_full() его не учитывает
    boss = Player.new(f"{owner_nickname} MK-II", x, y)
    boss.is_miniboss = True
    boss.miniboss_owner_nickname = owner_nickname
    boss.max_hp = round(TANK_MAX_HP * MINIBOSS_HP_MULT)
    boss.hp = boss.max_hp
    boss.damage = round(BULLET_DAMAGE * MINIBOSS_DAMAGE_MULT)
    boss.speed = TANK_SPEED * MINIBOSS_SPEED_MULT
    boss.size = MINIBOSS_SIZE
    # первый waypoint возле точки спавна — иначе он рвался бы в (0,0) на первом тике
    boss.ai_waypoint_x = x
    boss.ai_waypoint_y = y
    return boss


def apply_miniboss_kill_reward(player: Player, now: float) -> None:
    # награда сильнее обычного "super" пикапа: дольше длится, больше брони/урона
    player.super_until = now + MINIBOSS_REWARD_DURATION
    player.miniboss_reward_until = now + MINIBOSS_REWARD_DURATION
    player.speed_boost_until = now + MINIBOSS_REWARD_DURATION
    player.damage_until = now + MINIBOSS_REWARD_DURATION
    player.damage = round(20 * MINIBOSS_REWARD_DAMAGE_MULT)
    player.hp = player.max_hp


class MinibossMixin:
    """AI и жизненный цикл мини-босса — управляется через self.players так же,
    как обычный игрок, но его направление/прицел/стрельбу решает сервер.
    """

    def _drive_all_minibosses(self, now: float) -> None:
        for boss in list(self.players.values()):
            if boss.is_miniboss and boss.alive:
                self._drive_miniboss_ai(boss, now)

    def _drive_miniboss_ai(self, boss: Player, now: float) -> None:
        from app.game.map import FIELD_WIDTH, FIELD_HEIGHT

        # блуждание: идёт к случайной точке по всей карте, а не преследует
        # конкретного игрока — цель "наводить суету" по всему полю боя, а не
        # устраивать дуэль босс vs ближайший
        dwx = boss.ai_waypoint_x - boss.x
        dwy = boss.ai_waypoint_y - boss.y
        wdist = math.hypot(dwx, dwy)
        if wdist < MINIBOSS_WAYPOINT_RADIUS:
            margin = 120.0
            boss.ai_waypoint_x = random.uniform(margin, FIELD_WIDTH - margin)
            boss.ai_waypoint_y = random.uniform(margin, FIELD_HEIGHT - margin)
            dwx = boss.ai_waypoint_x - boss.x
            dwy = boss.ai_waypoint_y - boss.y
            wdist = math.hypot(dwx, dwy) or 1.0
        boss.dir_x, boss.dir_y = dwx / wdist, dwy / wdist

        targets = [p for p in self.players.values() if p.alive and not p.is_miniboss]
        if not targets:
            return

        # башня всегда смотрит на ближайшую цель (читается игроками как угроза),
        # но огонь ведётся площадным веером вокруг её примерного положения —
        # не точным одиночным выстрелом на упреждение
        nearest = min(targets, key=lambda p: math.hypot(p.x - boss.x, p.y - boss.y))
        aim_dx = nearest.x - boss.x
        aim_dy = nearest.y - boss.y
        aim_dist = math.hypot(aim_dx, aim_dy) or 1.0
        boss.turret_angle = math.atan2(aim_dy, aim_dx)

        if now - boss.ai_last_salvo_at < MINIBOSS_SALVO_COOLDOWN or aim_dist > 650:
            return
        boss.ai_last_salvo_at = now
        self._fire_miniboss_salvo(boss, aim_dx, aim_dy, aim_dist)

    def _fire_miniboss_salvo(self, boss: Player, aim_dx: float, aim_dy: float, aim_dist: float) -> None:
        # веерный залп вместо прицельного выстрела: разброс углов покрывает
        # площадь вокруг цели, так что уклонение реально работает, а не только
        # чистая реакция на одну точную пулю
        base_angle = math.atan2(aim_dy, aim_dx)
        muzzle_offset = boss.size / 2 + 8
        for i in range(MINIBOSS_SALVO_SIZE):
            spread = (i / max(1, MINIBOSS_SALVO_SIZE - 1) - 0.5) * MINIBOSS_SALVO_SPREAD
            angle = base_angle + spread
            muzzle_x = boss.x + math.cos(angle) * muzzle_offset
            muzzle_y = boss.y + math.sin(angle) * muzzle_offset
            bullet = Bullet.new(
                boss.id,
                muzzle_x,
                muzzle_y,
                angle,
                boss.damage,
                speed=BULLET_SPEED * 0.85,
                bounces=0,
                kind="cannon",
            )
            self.bullets[bullet.id] = bullet

    def _maybe_spawn_miniboss(self, x: float, y: float, owner_nickname: str) -> None:
        from app.game.entities import MINIBOSS_SPAWN_CHANCE

        if random.random() >= MINIBOSS_SPAWN_CHANCE:
            return
        boss = spawn_miniboss(x, y, owner_nickname)
        self.players[boss.id] = boss
        self._miniboss_spawns.append({"x": x, "y": y, "owner": owner_nickname})

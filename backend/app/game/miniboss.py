import math
import random
import time

from app.game.entities import (
    Player,
    Bullet,
    Bomb,
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
    MINIBOSS_ATTACK_COOLDOWN,
    MINIBOSS_SALVO_SIZE,
    MINIBOSS_SALVO_SPREAD,
    MINIBOSS_ARTILLERY_COUNT,
    MINIBOSS_ARTILLERY_SPREAD_RADIUS,
    MINIBOSS_ARTILLERY_FUSE_TIME,
    MINIBOSS_ARTILLERY_DAMAGE,
    MINIBOSS_ARTILLERY_RADIUS,
    MINIBOSS_LASER_CHARGE_TIME,
    MINIBOSS_LASER_WIDTH,
    MINIBOSS_LASER_RANGE,
    MINIBOSS_LASER_DAMAGE,
    MINIBOSS_SHOTGUN_COUNT,
    MINIBOSS_SHOTGUN_SPREAD,
    MINIBOSS_SHOTGUN_DAMAGE_MULT,
)

MINIBOSS_SIZE = 96  # втрое крупнее обычного танка (32) — должен читаться как реальный босс

# AI мини-босса намеренно НЕ преследует одного игрока: он должен наводить
# суету по всей карте (площадной АоЕ-обстрел) и заставлять уворачиваться
# толпу, а не превращаться в дуэль "босс vs ближайший игрок". Арсенал из 4
# атак чередуется случайно — раньше был только один предсказуемый веер.
MINIBOSS_WAYPOINT_RADIUS = 40.0  # считается "дошёл", если ближе этого расстояния
MINIBOSS_ATTACKS = ("salvo", "artillery", "laser", "shotgun")


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
    # награда сильнее обычного "super" пикапа: дольше длится, больше брони/урона.
    # Стакается аддитивно так же, как обычные баффы (см. _apply_pickup в room.py) —
    # убил второго босса, пока действует награда от первого — время продлевается.
    base = max(
        now,
        player.super_until,
        player.miniboss_reward_until,
        player.speed_boost_until,
        player.damage_until,
    )
    player.super_until = base + MINIBOSS_REWARD_DURATION
    player.miniboss_reward_until = base + MINIBOSS_REWARD_DURATION
    player.speed_boost_until = base + MINIBOSS_REWARD_DURATION
    player.damage_until = base + MINIBOSS_REWARD_DURATION
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

        # лазер уже заряжается с прошлого тика — обрабатываем его созревание
        # независимо от кулдауна обычных залпов (сам факт начала заряда уже
        # потратил кулдаун при выборе атаки)
        if boss.laser_charging_until > 0:
            if now >= boss.laser_fire_at:
                self._fire_miniboss_laser(boss)
                boss.laser_charging_until = 0.0
            return  # во время заряда босс не выбирает новую атаку и не крутит башню

        targets = [p for p in self.players.values() if p.alive and not p.is_miniboss]
        if not targets:
            return

        # башня всегда смотрит на ближайшую цель (читается игроками как угроза),
        # но огонь ведётся не точным одиночным выстрелом, а одной из 4 атак
        nearest = min(targets, key=lambda p: math.hypot(p.x - boss.x, p.y - boss.y))
        aim_dx = nearest.x - boss.x
        aim_dy = nearest.y - boss.y
        aim_dist = math.hypot(aim_dx, aim_dy) or 1.0
        boss.turret_angle = math.atan2(aim_dy, aim_dx)

        if now - boss.ai_last_salvo_at < MINIBOSS_ATTACK_COOLDOWN or aim_dist > 900:
            return
        boss.ai_last_salvo_at = now

        attack = random.choice(MINIBOSS_ATTACKS)
        if attack == "salvo":
            self._fire_miniboss_salvo(boss, aim_dx, aim_dy)
        elif attack == "artillery":
            self._fire_miniboss_artillery(boss, nearest, now)
        elif attack == "laser":
            self._start_miniboss_laser(boss, aim_dx, aim_dy, now)
        elif attack == "shotgun":
            self._fire_miniboss_shotgun(boss, aim_dx, aim_dy, aim_dist)

    def _fire_miniboss_salvo(self, boss: Player, aim_dx: float, aim_dy: float) -> None:
        # веерный залп: разброс углов покрывает площадь вокруг цели, так что
        # уклонение реально работает, а не только чистая реакция на одну точную пулю
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

    def _fire_miniboss_artillery(self, boss: Player, target: Player, now: float) -> None:
        # артиллерийский залп: несколько отложенных снарядов с телеграфом на
        # земле вокруг текущей позиции цели — переиспользует механику фоновой
        # бомбы (warning circle -> взрыв), но с owner_id босса и своим уроном
        for _ in range(MINIBOSS_ARTILLERY_COUNT):
            angle = random.uniform(0, math.pi * 2)
            dist = random.uniform(0, MINIBOSS_ARTILLERY_SPREAD_RADIUS)
            x = target.x + math.cos(angle) * dist
            y = target.y + math.sin(angle) * dist
            shell = Bomb.new(
                x,
                y,
                now,
                radius=MINIBOSS_ARTILLERY_RADIUS,
                damage=MINIBOSS_ARTILLERY_DAMAGE,
                fuse_time=MINIBOSS_ARTILLERY_FUSE_TIME,
                owner_id=boss.id,
            )
            self.bombs[shell.id] = shell

    def _start_miniboss_laser(self, boss: Player, aim_dx: float, aim_dy: float, now: float) -> None:
        # лазер: короткий видимый телеграф (луч уже нарисован, но ещё не бьёт),
        # затем мгновенный урон по всей линии — легко уклониться, если заметить
        # заранее, наказывает промедление
        boss.laser_angle = math.atan2(aim_dy, aim_dx)
        boss.laser_started_at = now
        boss.laser_charging_until = now + MINIBOSS_LASER_CHARGE_TIME
        boss.laser_fire_at = now + MINIBOSS_LASER_CHARGE_TIME

    def _fire_miniboss_laser(self, boss: Player) -> None:
        angle = boss.laser_angle
        dx, dy = math.cos(angle), math.sin(angle)
        # снимок списка — см. комментарий в weapons.py._explode_rocket
        for target in list(self.players.values()):
            if target.id == boss.id or not target.alive:
                continue
            # расстояние от точки до луча (проекция на перпендикуляр), только
            # если попадание находится впереди по направлению луча
            tx, ty = target.x - boss.x, target.y - boss.y
            along = tx * dx + ty * dy
            if along < 0 or along > MINIBOSS_LASER_RANGE:
                continue
            perp = abs(tx * dy - ty * dx)
            if perp > MINIBOSS_LASER_WIDTH / 2 + target.size / 2:
                continue
            self._apply_damage(target, MINIBOSS_LASER_DAMAGE, boss.id)
        self._laser_shots.append(
            {"x": boss.x, "y": boss.y, "angle": angle, "range": MINIBOSS_LASER_RANGE}
        )

    def _fire_miniboss_shotgun(self, boss: Player, aim_dx: float, aim_dy: float, aim_dist: float) -> None:
        # дробовик/осколочный: широкий веер множества слабых снарядов —
        # опасен только вблизи, на средней дистанции разброс делает его
        # почти безвредным (в отличие от плотного salvo)
        base_angle = math.atan2(aim_dy, aim_dx)
        muzzle_offset = boss.size / 2 + 8
        dmg = max(1, round(boss.damage * MINIBOSS_SHOTGUN_DAMAGE_MULT))
        for i in range(MINIBOSS_SHOTGUN_COUNT):
            spread = (i / max(1, MINIBOSS_SHOTGUN_COUNT - 1) - 0.5) * MINIBOSS_SHOTGUN_SPREAD
            angle = base_angle + spread
            muzzle_x = boss.x + math.cos(angle) * muzzle_offset
            muzzle_y = boss.y + math.sin(angle) * muzzle_offset
            bullet = Bullet.new(
                boss.id,
                muzzle_x,
                muzzle_y,
                angle,
                dmg,
                speed=BULLET_SPEED * 0.75,
                bounces=0,
                kind="minigun",
            )
            self.bullets[bullet.id] = bullet

    def _maybe_spawn_miniboss(self, x: float, y: float, owner_nickname: str) -> None:
        from app.game.entities import MINIBOSS_SPAWN_CHANCE

        # не больше одного мини-босса на карте одновременно — раньше при частых
        # смертях в активной игре они накапливались (2-3 сразу), что превращало
        # арену в хаос вместо редкой особой угрозы
        if any(p.is_miniboss and p.alive for p in self.players.values()):
            return
        if random.random() >= MINIBOSS_SPAWN_CHANCE:
            return
        boss = spawn_miniboss(x, y, owner_nickname)
        self.players[boss.id] = boss
        self._miniboss_spawns.append({"x": x, "y": y, "owner": owner_nickname})

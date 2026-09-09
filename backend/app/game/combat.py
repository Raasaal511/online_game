import math
import time

from app.game.entities import Player, Bullet, WALL_RESPAWN_DELAY
from app.game.map import WALLS

# самая тонкая стена на карте — используется для расчёта под-шагов движения
# пуль, чтобы быстрая пуля не "проскакивала" стену насквозь за один тик
from app.game.map import WALL_THICKNESS

MIN_WALL_THICKNESS = WALL_THICKNESS

# SUPER_ARMOR_REDUCTION всё ещё используется наградой за мини-босса (super_until
# остался как поле для этой отдельной механики) — сам пикап "super" на карте
# больше НЕ выдаёт этот бафф, см. _apply_pickup в pickups.py: теперь это лазерная звезда
SUPER_ARMOR_REDUCTION = 0.8
ARMOR_REDUCTION = 0.5  # снижение получаемого урона на 50% (бафф пикапа "armor", см. pickups.py)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rect_intersects_walls(cx: float, cy: float, size: float) -> bool:
    # используется для коллизий игроков: разрушенные стены не блокируют
    # (is_active=False), а рампы дают проехать поверх стены без столкновения
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    on_ramp = False
    hit_solid = False
    for wall in WALLS:
        if not (left < wall.right and right > wall.x and top < wall.bottom and bottom > wall.y):
            continue
        if wall.is_ramp:
            on_ramp = True
            continue
        if wall.is_active:
            hit_solid = True
    return hit_solid and not on_ramp


def _find_intersecting_wall(cx: float, cy: float, size: float):
    # используется для коллизий пуль: рампы игнорируются (пуля бьётся об
    # обычную стену под рампой), разрушенные стены пропускают снаряд насквозь
    half = size / 2
    left, right = cx - half, cx + half
    top, bottom = cy - half, cy + half
    for wall in WALLS:
        if wall.is_ramp or not wall.is_active:
            continue
        if left < wall.right and right > wall.x and top < wall.bottom and bottom > wall.y:
            return wall
    return None


def _approach(current: float, target: float, accel_step: float, friction_step: float) -> float:
    # разгон к target ограничен accel_step за тик; если target — 0 (ввод
    # отпущен), тормозим к нему чуть резче через friction_step
    step = accel_step if abs(target) > abs(current) or target * current < 0 else friction_step
    if current < target:
        return min(current + step, target)
    if current > target:
        return max(current - step, target)
    return current


def aabb_collides_point(player: Player, bullet: Bullet) -> bool:
    return (
        abs(player.x - bullet.x) < player.size / 2 + bullet.size
        and abs(player.y - bullet.y) < player.size / 2 + bullet.size
    )


class CombatMixin:
    """Движение танков и пуль, столкновения пуля-игрок/пуля-стена,
    урон по стенам и танк-в-танк тарáн — вся физика ближнего боя.
    """

    def _move_players(self, now: float) -> None:
        from app.game.room import DT
        from app.game.entities import TANK_ACCEL, TANK_FRICTION

        for player in self.players.values():
            if not player.alive:
                continue

            # инерционное движение: разгон к целевой скорости по вводу и
            # торможение трением при отпущенных клавишах — вместо мгновенной
            # телепортации на полную скорость танк чувствуется как танк
            norm = math.hypot(player.dir_x, player.dir_y)
            speed_mult = player.current_speed_mult(now)
            max_speed = player.speed * speed_mult

            if norm > 1e-6:
                target_vx = (player.dir_x / norm) * max_speed
                target_vy = (player.dir_y / norm) * max_speed
            else:
                target_vx = 0.0
                target_vy = 0.0

            player.vx = _approach(player.vx, target_vx, TANK_ACCEL * DT, TANK_FRICTION * DT)
            player.vy = _approach(player.vy, target_vy, TANK_ACCEL * DT, TANK_FRICTION * DT)

            new_x = player.x + player.vx * DT
            new_y = player.y + player.vy * DT

            # НЕ клампим к границам поля здесь: периметр уже полностью закрыт
            # стенами-границами (WALLS), и коллизия с ними ниже — единственный
            # источник истины. Раньше clamp() подгонял позицию вплотную к
            # границе поля, которая физически лежит ВНУТРИ толщины стены
            # (WALL_THICKNESS=24px) — из-за этого rect_intersects_walls всегда
            # возвращала True на границе, движение блокировалось навсегда, и
            # игрок застревал у края карты без возможности отъехать назад.

            if not rect_intersects_walls(new_x, player.y, player.size):
                player.x = new_x
            else:
                player.vx = 0.0

            if not rect_intersects_walls(player.x, new_y, player.size):
                player.y = new_y
            else:
                player.vy = 0.0

    def _move_bullets(self) -> None:
        from app.game.room import DT
        from app.game.entities import BULLET_SPEED

        # внешние границы поля уже покрыты периметровыми стенами в WALLS
        # (толщина 24px), а пуля на полной скорости проходит ~23px за тик —
        # проверка коллизии только в конечной точке шага может "проскочить"
        # стену насквозь (туннелирование). Поэтому шаг тика бьём на под-шаги
        # короче толщины самой тонкой стены, с проверкой после каждого.
        dead_bullets = []
        # запас x2: шаг под-тика должен быть заметно меньше толщины стены,
        # иначе пуля, стартующая уже внутри тонкой стены, может перепрыгнуть
        # её целиком за один под-шаг (не только "перед" стеной, а "из" неё)
        substeps = max(1, math.ceil(2 * BULLET_SPEED * DT / MIN_WALL_THICKNESS))
        sub_dt = DT / substeps

        for bullet in self.bullets.values():
            if bullet.kind == "flamethrower":
                continue  # огнемёт не создаёт снарядов, обрабатывается отдельно

            hit_wall = False
            for _ in range(substeps):
                bullet.x += bullet.vx * sub_dt
                bullet.y += bullet.vy * sub_dt

                wall = _find_intersecting_wall(bullet.x, bullet.y, bullet.size)
                if wall is None:
                    continue

                # без рикошета: любая стена (внешняя граница или внутреннее
                # укрытие) гасит пулю при первом касании — предсказуемее и
                # понятнее, чем отскок, который сложно предугадать в бою
                hit_wall = True
                if not wall.is_border:
                    self._damage_wall(wall)
                if bullet.kind == "rocket":
                    self._explode_rocket(bullet)
                elif bullet.kind == "ultimate":
                    self._explode_ultimate(bullet)
                break

            if hit_wall:
                dead_bullets.append(bullet.id)

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _check_bullet_collisions(self) -> None:
        from app.game.entities import ICE_SLOW_DURATION, ICE_SLOW_MULT

        dead_bullets = []
        # снимок списка игроков — СНАРУЖИ цикла по пулям: _apply_damage ниже
        # может убить игрока и через _maybe_spawn_miniboss добавить нового
        # NPC в self.players, мутируя словарь прямо во время итерации по
        # нему (RuntimeError), поэтому снимок нужен. Раньше пересоздавался
        # заново на КАЖДУЮ пулю (list(...) внутри внешнего цикла) — при 20-30
        # пулях на экране это 20-30 копий списка игроков за тик без всякой
        # необходимости: свежий минибосс, заспавненный ударом одной пули,
        # станет доступен для коллизий следующим тиком (через ~33мс) вместо
        # того же тика — разница не играет роли в реальном бою.
        players_snapshot = list(self.players.values())
        for bullet in self.bullets.values():
            if bullet.kind == "flamethrower":
                continue
            for player in players_snapshot:
                if not player.alive or player.id == bullet.owner_id:
                    continue
                if bullet.pierce and player.id in bullet.hit_ids:
                    continue  # сквозная пуля уже нанесла урон этой цели — не бьёт дважды
                if aabb_collides_point(player, bullet):
                    dmg = bullet.damage
                    if bullet.falloff_range > 0:
                        traveled = math.hypot(bullet.x - bullet.spawn_x, bullet.y - bullet.spawn_y)
                        frac = min(1.0, traveled / bullet.falloff_range)
                        mult = 1.0 - frac * (1.0 - bullet.falloff_min_mult)
                        dmg = round(dmg * mult)
                    if bullet.kind == "rocket":
                        self._explode_rocket(bullet)
                    elif bullet.kind == "ultimate":
                        self._explode_ultimate(bullet)
                    else:
                        self._apply_damage(player, dmg, bullet.owner_id)
                    if bullet.kind == "ice":
                        # лёгкое, короткое замедление — отдельные константы от
                        # ловушки (TRAP_SLOW_*), та тюнингована жёстче
                        player.slow_until = max(player.slow_until, time.monotonic() + ICE_SLOW_DURATION)
                        player.slow_mult = ICE_SLOW_MULT
                    if bullet.pierce:
                        bullet.hit_ids.add(player.id)
                        # сквозная пуля (снайпер) не гаснет при попадании — без
                        # видимого эффекта в момент удара выглядело как промах,
                        # хотя урон реально прошёл; лёгкая искра НЕ останавливает полёт
                        self._hit_sparks.append({"x": bullet.x, "y": bullet.y})
                    else:
                        dead_bullets.append(bullet.id)
                        break

        for bid in dead_bullets:
            self.bullets.pop(bid, None)

    def _damage_wall(self, wall) -> None:
        if not wall.destructible or not wall.is_active:
            return
        wall.hp -= 1
        if wall.hp <= 0:
            wall.destroyed_at = time.monotonic()
            self._wall_breaks.append({"id": wall.id, "x": wall.x, "y": wall.y})
        else:
            self._wall_hits.append({"id": wall.id, "x": wall.x, "y": wall.y})

    def _process_wall_respawns(self, now: float) -> None:
        from app.game.entities import WALL_MAX_HP

        for wall in WALLS:
            if wall.destroyed_at is None:
                continue
            if now - wall.destroyed_at < WALL_RESPAWN_DELAY:
                continue
            # не восстанавливаем стену прямо под танком: игрок физически
            # застрявший внутри геометрии активной стены оказывался в
            # сломанном состоянии — исходящие пули покидали стену раньше,
            # чем срабатывала проверка коллизии (стреляет нормально), а
            # входящие пули соперников гасли об эту же стену РАНЬШЕ, чем
            # долетали до игрока внутри неё (в него невозможно попасть).
            # Просто откладываем восстановление до следующего тика, пока
            # зона не освободится — не телепортируем и не убиваем игрока.
            if self._wall_zone_occupied(wall):
                continue
            wall.destroyed_at = None
            wall.hp = WALL_MAX_HP
            self._wall_restores.append({"id": wall.id, "x": wall.x, "y": wall.y})

    def _wall_zone_occupied(self, wall) -> bool:
        for player in self.players.values():
            if not player.alive:
                continue
            half = player.size / 2
            if (
                player.x - half < wall.right
                and player.x + half > wall.x
                and player.y - half < wall.bottom
                and player.y + half > wall.y
            ):
                return True
        return False

    def _apply_damage(self, player: Player, damage: int, killer_id: str) -> None:
        now = time.monotonic()
        if now < player.spawn_protected_until:
            return  # неуязвимость сразу после респавна
        dmg = damage
        if now < player.super_until:
            dmg = round(dmg * (1 - SUPER_ARMOR_REDUCTION))
        elif now < player.armor_until:
            dmg = round(dmg * (1 - ARMOR_REDUCTION))
        player.hp -= dmg

        if player.hp <= 0:
            player.hp = 0
            self._kill_player(player, killer_id)

    def _kill_player(self, player: Player, killer_id: str) -> None:
        import asyncio
        from app.game.entities import TANK_MAX_HP, XP_PER_KILL
        from app.game.miniboss import apply_miniboss_kill_reward
        from app.game.room import RESPAWN_DELAY

        now = time.monotonic()
        player.alive = False
        player.died_at = now
        player.deaths += 1
        killer = self.players.get(killer_id)
        if killer is not None and killer.id != player.id:
            killer.kills += 1
            if not killer.is_miniboss:
                if player.is_miniboss:
                    # награда за мини-босса намного мощнее обычного XP/пикапа
                    apply_miniboss_kill_reward(killer, now)
                else:
                    if killer.add_xp(XP_PER_KILL):
                        self._level_ups.append({"player_id": killer.id, "level": killer.level})
                    from app.game.entities import ULTIMATE_KILLS_REQUIRED

                    killer.ultimate_kills = min(ULTIMATE_KILLS_REQUIRED, killer.ultimate_kills + 1)

        if player.is_miniboss:
            # мини-босс — NPC, не участвует в респавне/leaderboard/уровнях
            self.players.pop(player.id, None)
            return

        # прокачка уровня сбрасывается на смерти (риск/фарм-петля) — весь
        # накопленный опыт теряется, max_hp возвращается к базовому
        player.level = 1
        player.xp = 0
        player.max_hp = TANK_MAX_HP

        self._maybe_spawn_miniboss(player.x, player.y, player.nickname)

        self._pending_respawns[player.id] = now + RESPAWN_DELAY
        asyncio.create_task(self._handle_death(player))

    def _check_tank_collisions(self, now: float) -> None:
        from app.game.entities import COLLISION_DAMAGE, COLLISION_PUSHBACK

        # взаимное отталкивание + небольшой урон при "тарáне" двух танков —
        # O(n^2), но n <= MAX_PLAYERS (10), так что пренебрежимо дёшево
        players = [p for p in self.players.values() if p.alive]
        for i in range(len(players)):
            a = players[i]
            for j in range(i + 1, len(players)):
                b = players[j]
                dx = b.x - a.x
                dy = b.y - a.y
                dist = math.hypot(dx, dy)
                min_dist = (a.size + b.size) / 2
                if dist >= min_dist or dist < 1e-6:
                    continue

                nx, ny = dx / dist, dy / dist
                overlap = min_dist - dist

                # раздвигаем поровну, чтобы не залипали друг в друге
                a.x -= nx * overlap / 2
                a.y -= ny * overlap / 2
                b.x += nx * overlap / 2
                b.y += ny * overlap / 2

                a.vx -= nx * COLLISION_PUSHBACK
                a.vy -= ny * COLLISION_PUSHBACK
                b.vx += nx * COLLISION_PUSHBACK
                b.vy += ny * COLLISION_PUSHBACK

                if now - a.last_collision_at > 0.5 and now - b.last_collision_at > 0.5:
                    a.last_collision_at = now
                    b.last_collision_at = now
                    # позиционное разведение выше применяется всегда (даже под
                    # защитой) — иначе танки слипаются при одновременном
                    # спавне рядом; сам урон таранa под защитой не проходит
                    if now >= a.spawn_protected_until:
                        a.hp = max(0, a.hp - COLLISION_DAMAGE)
                        if a.hp <= 0:
                            self._kill_player(a, b.id)
                    if now >= b.spawn_protected_until:
                        b.hp = max(0, b.hp - COLLISION_DAMAGE)
                        if b.hp <= 0:
                            self._kill_player(b, a.id)

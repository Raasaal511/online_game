import asyncio
import math
import time

import orjson
from fastapi import WebSocket

from app.game.entities import (
    GUNNER_MAG_SIZE,
    GUNNER_RELOAD_TIME,
    ULTIMATE_KILLS_REQUIRED,
    PIT_FALL_TIME,
)
from app.game.map import FIELD_WIDTH, FIELD_HEIGHT, WALLS, PIT_ZONES, ray_distance_to_field_edge


class BroadcastMixin:
    """Сериализация состояния комнаты на клиентов: статичная геометрия карты
    (welcome-пакет) и полный тиковый snapshot (позиции, баффы, события), плюс
    рассылка сообщений чата.
    """

    def get_map_info(self) -> dict:
        return {
            "field": {"width": FIELD_WIDTH, "height": FIELD_HEIGHT},
            "walls": [
                {
                    "id": w.id,
                    "x": w.x,
                    "y": w.y,
                    "width": w.width,
                    "height": w.height,
                    "destructible": w.destructible,
                    "is_ramp": w.is_ramp,
                }
                for w in WALLS
            ],
            "traps": [
                {"x": t.x, "y": t.y, "size": t.size} for t in self.traps.values()
            ],
            # яма — статичная геометрия карты (как стены/ловушки), шлётся один
            # раз при welcome, а не каждый тик в _broadcast_state
            "pit_zones": [
                {"x": zx, "y": zy, "width": zw, "height": zh} for zx, zy, zw, zh in PIT_ZONES
            ],
        }

    async def _broadcast_state(self) -> None:
        from app.game.room import ROUND_DURATION
        from app.game.entities import NUKE_WARNING_DURATION

        if not self.connections:
            return
        now = time.monotonic()
        payload = {
            "type": "state",
            "players": [
                {
                    "id": p.id,
                    "nickname": p.nickname,
                    "x": round(p.x, 1),
                    "y": round(p.y, 1),
                    "turret_angle": round(p.turret_angle, 3),
                    "speed": round(math.hypot(p.vx, p.vy), 1),
                    "vx": round(p.vx, 1),
                    "vy": round(p.vy, 1),
                    "alive": p.alive,
                    "hp": p.hp,
                    "max_hp": p.max_hp,
                    "kills": p.kills,
                    "deaths": p.deaths,
                    "lifetime": p.lifetime(),
                    "has_armor": now < p.armor_until,
                    "has_damage_boost": now < p.damage_until,
                    "has_speed_boost": now < p.speed_boost_until,
                    "has_slow": now < p.slow_until,
                    # has_super сохранён для награды за мини-босса (apply_miniboss_kill_reward
                    # всё ещё пишет в super_until — это ДРУГОЙ бафф, статовый, не связан с
                    # пикапом "super" на карте, который теперь превратился в laser_star)
                    "has_super": now < p.super_until,
                    "has_spawn_protection": now < p.spawn_protected_until,
                    "weapon": p.weapon if now < p.weapon_until else "cannon",
                    "is_flaming": now < p.flame_active_until,
                    "is_burning": now < p.burn_until,
                    "laser_star_active": now < p.laser_star_until,
                    "laser_star_angles": p.laser_star_angles if now < p.laser_star_until else [],
                    # длина каждого луча параллельна laser_star_angles — не
                    # константа, обрезана по границе арены под текущим углом
                    # (см. _process_laser_star в weapons.py)
                    "laser_star_lengths": (
                        [ray_distance_to_field_edge(p.x, p.y, a) for a in p.laser_star_angles]
                        if now < p.laser_star_until
                        else []
                    ),
                    "is_falling": p.falling_since > 0,
                    "fall_progress": (
                        max(0.0, min(1.0, (now - p.falling_since) / PIT_FALL_TIME))
                        if p.falling_since > 0
                        else 0.0
                    ),
                    "level": p.level,
                    "xp": p.xp,
                    "is_miniboss": p.is_miniboss,
                    "has_miniboss_reward": now < p.miniboss_reward_until,
                    "tank_class": p.tank_class,
                    "gun_skin": p.gun_skin,
                    "ammo": p.ammo,
                    "ammo_max": GUNNER_MAG_SIZE,
                    "reloading": p.tank_class == "gunner" and now < p.reload_until,
                    "reload_progress": (
                        max(0.0, min(1.0, 1 - (p.reload_until - now) / GUNNER_RELOAD_TIME))
                        if p.tank_class == "gunner" and now < p.reload_until
                        else 1.0
                    ),
                    "ultimate_kills": p.ultimate_kills,
                    "ultimate_ready": p.ultimate_kills >= ULTIMATE_KILLS_REQUIRED,
                    "laser_charging": (
                        {
                            "angle": p.laser_angle,
                            "progress": min(
                                1.0,
                                (now - p.laser_started_at)
                                / max(1e-6, p.laser_fire_at - p.laser_started_at),
                            ),
                            "range": ray_distance_to_field_edge(p.x, p.y, p.laser_angle),
                        }
                        if p.laser_charging_until > now
                        else None
                    ),
                }
                for p in self.players.values()
            ],
            "bullets": [
                {
                    "id": b.id,
                    "owner_id": b.owner_id,
                    "x": round(b.x, 1),
                    "y": round(b.y, 1),
                    "vx": round(b.vx, 1),
                    "vy": round(b.vy, 1),
                    "size": b.size,
                    "kind": b.kind,
                }
                for b in self.bullets.values()
            ],
            "pickups": [
                {"id": pu.id, "x": pu.x, "y": pu.y, "kind": pu.kind}
                for pu in self.pickups.values()
            ],
            "bombs": [
                {
                    "id": bomb.id,
                    "x": bomb.x,
                    "y": bomb.y,
                    "fuse_progress": min(1.0, (now - bomb.spawned_at) / bomb.fuse_time),
                    "radius": bomb.radius,
                    "is_artillery": bool(bomb.owner_id),
                }
                for bomb in self.bombs.values()
            ],
            "explosions": self._explosions,
            # только разрушаемые стены, у которых состояние может меняться —
            # не гоняем все 30 стен каждый тик, только те, что имеют HP
            "wall_states": [
                {"id": w.id, "active": w.is_active, "hp": w.hp}
                for w in WALLS
                if w.destructible
            ],
            "wall_hits": self._wall_hits,
            "wall_breaks": self._wall_breaks,
            "wall_restores": self._wall_restores,
            "hit_sparks": self._hit_sparks,
            "nuke": (
                {
                    "x": self._active_nuke.x,
                    "y": self._active_nuke.y,
                    "radius": self._active_nuke.radius,
                    "warning_progress": min(
                        1.0, (now - self._active_nuke.spawned_at) / NUKE_WARNING_DURATION
                    ),
                }
                if self._active_nuke is not None
                else None
            ),
            "miniboss_spawns": self._miniboss_spawns,
            "level_ups": self._level_ups,
            "laser_shots": self._laser_shots,
            "laser_star_hits": self._laser_star_hits,
            "teleports": self._teleports,
            "round_time_left": (
                0.0
                if self._round_end_banner_until is not None
                else max(0.0, round(ROUND_DURATION - (now - self._round_started_at), 1))
            ),
            "round_end": self._round_ended_event,
            "leaderboard": self._live_leaderboard(),
            "portals": [
                {"id": p.id, "x": p.x, "y": p.y, "link_id": p.link_id}
                for p in self.portals.values()
            ],
            "portal_events": self._portal_events,
            # измеритель лагов на клиенте (F3) сравнивает это с локальным
            # интервалом между state-сообщениями — если tick_ms/loop_ms растут,
            # тормозит сервер; если сервер стабилен, а у клиента низкий FPS —
            # проблема в рендере браузера, не в игровой логике
            "server_perf": {
                "tick_ms": round(self._last_tick_ms, 2),
                "broadcast_ms": round(self._last_broadcast_ms, 2),
                "loop_interval_ms": round(self._last_loop_interval_ms, 2),
            },
        }

        # сериализуем payload один раз за тик (не по разу на каждого клиента) —
        # orjson быстрее stdlib json и отдаёт сразу bytes
        message = {"type": "websocket.send", "bytes": orjson.dumps(payload)}

        async def send_one(pid: str, ws: WebSocket) -> str | None:
            try:
                await asyncio.wait_for(ws.send(message), timeout=0.4)
                return None
            except Exception:
                return pid

        results = await asyncio.gather(
            *(send_one(pid, ws) for pid, ws in self.connections.items())
        )
        for pid in results:
            if pid is not None:
                self.remove_player(pid)

    async def broadcast_chat(self, entry: dict) -> None:
        # чат — редкое событие, шлём сразу текстом (не ждём следующего
        # тикового бинарного state), в отличие от высокочастотных полей
        payload = {"type": "chat", **entry}
        dead = []
        for pid, ws in list(self.connections.items()):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.remove_player(pid)

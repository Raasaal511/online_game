import { useEffect, useRef } from "react";
import { useMouseAim } from "../hooks/useMouseAim.js";
import { useActionKeys } from "../hooks/useActionKeys.js";
import { createParticleSystem } from "../game/particles.js";
import { createTrackSystem } from "../game/tracks.js";
import {
  drawFloor,
  drawWall3D,
  drawPickup3D,
  drawBullet3D,
  drawTank3D,
  drawTrap3D,
  drawFlameCone3D,
  drawMuzzleFlash3D,
  drawBomb3D,
  drawNukeWarning3D,
  drawCastShadow,
  drawExplosion3D,
  drawNukeExplosion3D,
  drawLaserCharge3D,
  drawLaserShot3D,
  drawTeleportEffect3D,
  drawWallBreakEffect3D,
  drawWallHitSpark3D,
  drawParticles3D,
} from "../game/render3d.js";
import {
  playShotSound,
  playMinigunSound,
  playFlamethrowerSound,
  playRocketLaunchSound,
  playHitSound,
  playExplosionSound,
  playPickupSound,
  playBombWarningSound,
  playNukeWarningSound,
  playLevelUpSound,
  playMinibossSpawnSound,
  playMinibossSalvoSound,
  playMinibossLaserChargeSound,
  playMinibossLaserFireSound,
  playWallHitSound,
  playWallBreakSound,
  playTeleportSound,
  playSniperShotSound,
  playBrawlerShotSound,
  playUltimateFireSound,
  unlockAudio,
} from "../game/sound.js";

const WALL_BREAK_LIFETIME = 0.5;
const WALL_HIT_LIFETIME = 0.2;

const TANK_SIZE = 32;
const MINIBOSS_TANK_SIZE = 96; // синхронизировано с MINIBOSS_SIZE на сервере — втрое крупнее обычного танка
const INTERP_SPEED = 12; // выше = быстрее "догоняет" серверную позицию
const EXPLOSION_LIFETIME = 0.6; // сек, длительность визуального взрыва бомбы/ракеты
const NUKE_EXPLOSION_LIFETIME = 2.2; // сек — гриб растёт и держится заметно дольше обычного взрыва
const LASER_SHOT_LIFETIME = 0.25; // сек — вспышка лазерного выстрела мини-босса, короткая и яркая

const PICKUP_COLORS = {
  heal: "#22c55e",
  armor: "#38bdf8",
  damage: "#f97316",
  speed: "#facc15",
  super: "#f472b6",
  minigun: "#fde047",
  flamethrower: "#f97316",
  rocket: "#ef4444",
};

const WEAPON_SHOOT_SOUND = {
  cannon: playShotSound,
  minigun: playMinigunSound,
  flamethrower: playFlamethrowerSound,
  rocket: playRocketLaunchSound,
  sniper: playSniperShotSound,
  brawler: playBrawlerShotSound,
  ultimate: playUltimateFireSound,
};

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

const EMPTY_STATE = { players: [], bullets: [], pickups: [] };

export default function GameCanvas({
  subscribeState,
  mapInfo,
  playerId,
  sendAim,
  sendShoot,
  sendTeleport,
  sendUltimate,
  onGameEvent,
}) {
  const canvasRef = useRef(null);
  // каждый тик (30/сек) приходит сюда напрямую через подписку, минуя React
  // state/ре-рендер — см. комментарий у HUD_THROTTLE_MS в useGameSocket.js
  const stateRef = useRef(EMPTY_STATE);

  useEffect(() => {
    if (!subscribeState) return undefined;
    return subscribeState((data) => {
      stateRef.current = data;
    });
  }, [subscribeState]);

  // сглаженные (интерполированные) позиции/углы игроков для плавного рендера
  const smoothRef = useRef(new Map());
  const particlesRef = useRef(createParticleSystem());
  const tracksRef = useRef(createTrackSystem());
  const lastBulletPos = useRef(new Map());
  const knownAliveState = useRef(new Map());
  const knownPickupIds = useRef(new Set());
  const knownBombIds = useRef(new Set());
  const isFirstPickupSync = useRef(true);
  const isFirstBombSync = useRef(true);
  const explosionsRef = useRef([]); // {x, y, radius, age}
  const wallBreaksRef = useRef([]); // {x, y, age} — эффект разрушения стены
  const wallHitsRef = useRef([]); // {x, y, age} — искра при попадании без разрушения
  const kickbackRef = useRef(new Map()); // playerId -> 0..1, отдача ствола
  const motionSmoothRef = useRef(new Map()); // playerId -> {emaSpeed, dirX, dirY} — EMA для эффекта разгона
  const laserChargingRef = useRef(new Set()); // playerId'ы, у которых лазер уже заряжался в прошлом кадре
  const laserShotsRef = useRef([]); // {x, y, angle, range, age} — вспышки фактических выстрелов лазера
  const teleportEffectsRef = useRef([]); // {x, y, age} — вспышка появления после телепорта
  const hadNukeRef = useRef(false); // была ли ядерка активна в прошлом кадре (для звука появления)
  // сервер шлёт state 30 раз/сек, а draw() вызывается на каждый requestAnimationFrame
  // (~60 раз/сек) — без этой защиты один и тот же тик (с одним и тем же
  // непустым miniboss_spawns/level_ups/explosions/...) обрабатывался бы 2+ раза
  // подряд, пока не придёт следующий тик, дублируя баннеры/звуки/партиклы
  const lastProcessedStateRef = useRef(null);
  const lastRoundEndRef = useRef(null); // последний обработанный объект round_end (по ссылке)
  const onGameEventRef = useRef(onGameEvent);
  onGameEventRef.current = onGameEvent;

  const fieldWidth = mapInfo.field?.width || 1400;
  const fieldHeight = mapInfo.field?.height || 900;
  const walls = mapInfo.walls || [];
  const traps = mapInfo.traps || [];

  const handleShoot = () => {
    unlockAudio();
    sendShoot();
  };

  const { mouseRef, isFiringRef } = useMouseAim(canvasRef, () => {}, handleShoot);
  const shakeRef = useRef({ magnitude: 0 });

  const handleTeleport = () => {
    const current = stateRef.current;
    const me = current.players?.find((p) => p.id === playerId);
    if (!me || !me.alive) return;
    const dx = mouseRef.current.x - me.x;
    const dy = mouseRef.current.y - me.y;
    sendTeleport(Math.atan2(dy, dx));
  };

  useActionKeys(handleTeleport, sendUltimate);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationFrame;
    let lastAimSent = 0;
    let lastAutoShotAt = 0;
    let lastTime = performance.now();

    const draw = (timestamp) => {
      const dt = Math.min(0.1, (timestamp - lastTime) / 1000);
      lastTime = timestamp;

      const current = stateRef.current;
      // защита от повторной обработки одного и того же тика на нескольких
      // подряд requestAnimationFrame — см. комментарий у lastProcessedStateRef
      const isNewTick = current !== lastProcessedStateRef.current;
      lastProcessedStateRef.current = current;
      const smooth = smoothRef.current;
      const seenIds = new Set();

      // обновляем сглаженные позиции к последним серверным данным
      for (const p of current.players || []) {
        seenIds.add(p.id);
        const prev = smooth.get(p.id);
        if (!prev) {
          smooth.set(p.id, { x: p.x, y: p.y, angle: p.turret_angle });
        } else {
          const t = Math.min(1, INTERP_SPEED * dt);
          prev.x += (p.x - prev.x) * t;
          prev.y += (p.y - prev.y) * t;
          prev.angle = lerpAngle(prev.angle, p.turret_angle, t);
        }
      }
      for (const id of Array.from(smooth.keys())) {
        if (!seenIds.has(id)) smooth.delete(id);
      }
      // те же id, что и smooth — очищаем и остальные per-player Map'ы от
      // игроков, вышедших из комнаты. Раньше не чистились вообще: за долгую
      // работу сервера (постоянная ротация игроков, особенно с системой
      // раундов) эти Map росли неограниченно, что медленно, но неуклонно
      // замедляло .get()/.set() в горячем цикле рендера — источник
      // накапливающихся микро-лагов при долгой сессии.
      for (const id of Array.from(motionSmoothRef.current.keys())) {
        if (!seenIds.has(id)) motionSmoothRef.current.delete(id);
      }
      for (const id of Array.from(knownAliveState.current.keys())) {
        if (!seenIds.has(id)) knownAliveState.current.delete(id);
      }

      const particles = particlesRef.current;

      // мини-босс стреляет обычными "cannon" пулями (не отдельным kind), но
      // звук должен отличаться от игрока — иначе залп по площади не читается
      // на слух как угроза от босса
      const minibossOwnerIds = new Set(
        (current.players || []).filter((p) => p.is_miniboss).map((p) => p.id)
      );

      // новые пули -> звук выстрела (зависит от типа оружия) + отдача ствола
      // + вспышка/дым; исчезнувшие пули -> искра на месте последней позиции
      const seenBulletIds = new Set();
      const salvoOwnersPlayed = new Set(); // залп босса — 1 звук на весь веер, не 5 подряд
      for (const b of current.bullets || []) {
        seenBulletIds.add(b.id);
        if (!lastBulletPos.current.has(b.id)) {
          const isBossBullet = minibossOwnerIds.has(b.owner_id);
          if (isBossBullet) {
            if (!salvoOwnersPlayed.has(b.owner_id)) {
              salvoOwnersPlayed.add(b.owner_id);
              playMinibossSalvoSound();
            }
          } else {
            const soundFn = WEAPON_SHOOT_SOUND[b.kind] || playShotSound;
            soundFn();
          }
          kickbackRef.current.set(b.owner_id ?? b.id, 1);
          const angle = Math.atan2(b.vy ?? 0, b.vx ?? 1);
          particles.spawnMuzzleSmoke(b.x, b.y, angle);
          if (b.kind !== "minigun") {
            shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 4);
          }
        }
        lastBulletPos.current.set(b.id, { x: b.x, y: b.y });
      }
      for (const [id, pos] of Array.from(lastBulletPos.current.entries())) {
        if (!seenBulletIds.has(id)) {
          particles.spawnHitSpark(pos.x, pos.y);
          playHitSound();
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 2.5);
          lastBulletPos.current.delete(id);
        }
      }

      // затухание отдачи ствола каждого танка
      for (const [pid, k] of Array.from(kickbackRef.current.entries())) {
        const next = Math.max(0, k - dt * 6);
        if (next <= 0.001) kickbackRef.current.delete(pid);
        else kickbackRef.current.set(pid, next);
      }

      // огнемёт: пока конус активен, каждый кадр подсыпаем частицы пламени
      for (const p of current.players || []) {
        if (p.is_flaming) {
          const s = smooth.get(p.id) || p;
          const tipX = s.x + Math.cos(s.angle ?? p.turret_angle) * 60;
          const tipY = s.y + Math.sin(s.angle ?? p.turret_angle) * 60;
          particles.spawnFlameParticles(tipX, tipY, s.angle ?? p.turret_angle);
        }
      }

      // переход alive: true -> false у любого игрока -> взрыв + звук
      for (const p of current.players || []) {
        const wasAlive = knownAliveState.current.get(p.id);
        if (wasAlive === true && !p.alive) {
          const pos = smooth.get(p.id) || p;
          particles.spawnExplosion(pos.x, pos.y);
          playExplosionSound();
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 9);
        }
        knownAliveState.current.set(p.id, p.alive);
      }

      // дроп исчез (кто-то подобрал) -> звук
      const seenPickupIds = new Set();
      for (const pu of current.pickups || []) {
        seenPickupIds.add(pu.id);
      }
      if (!isFirstPickupSync.current) {
        for (const id of knownPickupIds.current) {
          if (!seenPickupIds.has(id)) {
            playPickupSound();
          }
        }
      }
      isFirstPickupSync.current = false;
      knownPickupIds.current = seenPickupIds;

      // новая бомба-предупреждение появилась на карте -> короткий "бип"
      const seenBombIds = new Set();
      for (const bomb of current.bombs || []) {
        seenBombIds.add(bomb.id);
        if (!isFirstBombSync.current && !knownBombIds.current.has(bomb.id)) {
          playBombWarningSound();
        }
      }
      isFirstBombSync.current = false;
      knownBombIds.current = seenBombIds;

      // ядерка появилась -> тревожная сирена (один раз при появлении, не каждый кадр)
      if (current.nuke && !hadNukeRef.current) {
        playNukeWarningSound();
        onGameEventRef.current?.({ type: "nuke_warning" });
      }
      hadNukeRef.current = Boolean(current.nuke);

      // мини-босс появился на карте -> звук + уведомление в UI (только на
      // новый тик — иначе один и тот же спавн триггерит баннер на каждый
      // requestAnimationFrame, пока сервер не пришлёт следующий тик)
      if (isNewTick) {
        for (const spawn of current.miniboss_spawns || []) {
          playMinibossSpawnSound();
          onGameEventRef.current?.({ type: "miniboss_spawn", owner: spawn.owner });
        }
      }

      // игрок поднял уровень -> звук (для себя) + частицы, уведомление в UI
      if (isNewTick) {
        for (const levelUp of current.level_ups || []) {
          if (levelUp.player_id === playerId) {
            playLevelUpSound();
            onGameEventRef.current?.({ type: "level_up", level: levelUp.level });
          }
          const p = current.players?.find((pl) => pl.id === levelUp.player_id);
          if (p) particles.spawnExplosion(p.x, p.y, 0.5);
        }
      }

      // раунд закончился -> уведомление в UI с победителем. round_end — не
      // массив разовых событий (как level_ups/miniboss_spawns), а единичное
      // поле, непустое ровно один тик — отслеживаем по ссылке, чтобы не
      // сработать повторно, пока сервер не пришлёт следующий объект
      if (isNewTick && current.round_end && current.round_end !== lastRoundEndRef.current) {
        lastRoundEndRef.current = current.round_end;
        onGameEventRef.current?.({ type: "round_end", winner: current.round_end });
      }

      // лазер мини-босса заряжается -> звук нарастания один раз при начале
      // заряда (не каждый тик, пока идёт телеграф); фактический выстрел ->
      // вспышка луча + отдельный звук
      const chargingNow = new Set();
      for (const p of current.players || []) {
        if (p.laser_charging) {
          chargingNow.add(p.id);
          if (!laserChargingRef.current.has(p.id)) {
            playMinibossLaserChargeSound();
          }
        }
      }
      laserChargingRef.current = chargingNow;

      if (isNewTick) {
        for (const shot of current.laser_shots || []) {
          laserShotsRef.current.push({ ...shot, age: 0 });
          playMinibossLaserFireSound();
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 10);
        }
      }

      // телепорт игрока -> вспышка на новом месте + сброс сглаживания (иначе
      // интерполяция "провезёт" танк по прямой от старой точки к новой)
      if (isNewTick) {
        for (const tp of current.teleports || []) {
          teleportEffectsRef.current.push({ x: tp.x, y: tp.y, age: 0 });
          const s = smooth.get(tp.player_id);
          if (s) {
            s.x = tp.x;
            s.y = tp.y;
          }
          if (tp.player_id === playerId) playTeleportSound();
        }
      }
      for (const eff of teleportEffectsRef.current) {
        eff.age += dt / 0.35;
      }
      teleportEffectsRef.current = teleportEffectsRef.current.filter((e) => e.age < 1);
      for (const shot of laserShotsRef.current) {
        shot.age += dt / LASER_SHOT_LIFETIME;
      }
      laserShotsRef.current = laserShotsRef.current.filter((s) => s.age < 1);

      // серверные события взрыва (ракета/бомба) -> визуальная ударная волна
      // + звук; отслеживаем по количеству, т.к. explosions приходят как
      // "снимок за этот тик" без стабильных id
      if (isNewTick) {
        for (const ex of current.explosions || []) {
          const isNuke = ex.kind === "nuke";
          explosionsRef.current.push({ x: ex.x, y: ex.y, radius: ex.radius, age: 0, kind: ex.kind });
          // ядерка — заметно масштабнее и дольше: больше частиц, сильнее тряска
          particles.spawnExplosion(ex.x, ex.y, isNuke ? 4 : 1.6);
          playExplosionSound(true);
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, isNuke ? 26 : 12);
        }
      }
      for (const explosion of explosionsRef.current) {
        const lifetime = explosion.kind === "nuke" ? NUKE_EXPLOSION_LIFETIME : EXPLOSION_LIFETIME;
        explosion.age += dt / lifetime;
      }
      explosionsRef.current = explosionsRef.current.filter((e) => e.age < 1);

      // стена сломана оружием игрока -> обвал обломков + звук + тряска
      if (isNewTick) {
        for (const brk of current.wall_breaks || []) {
          wallBreaksRef.current.push({ x: brk.x, y: brk.y, age: 0 });
          particles.spawnExplosion(brk.x, brk.y, 0.9);
          playWallBreakSound();
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 6);
        }
      }
      for (const effect of wallBreaksRef.current) {
        effect.age += dt / WALL_BREAK_LIFETIME;
      }
      wallBreaksRef.current = wallBreaksRef.current.filter((e) => e.age < 1);

      // попадание в стену без разрушения -> короткая искра + глухой удар
      if (isNewTick) {
        for (const hit of current.wall_hits || []) {
          wallHitsRef.current.push({ x: hit.x, y: hit.y, age: 0 });
          playWallHitSound();
        }
      }
      for (const hit of wallHitsRef.current) {
        hit.age += dt / WALL_HIT_LIFETIME;
      }
      wallHitsRef.current = wallHitsRef.current.filter((e) => e.age < 1);

      particles.update(dt);

      // единый проход по живым игрокам со сглаженными координатами — раньше
      // players.filter(alive).map(...) выполнялся 3 раза за кадр отдельно
      // (для следов гусениц, для теней, и инлайн при сборке sceneObjects),
      // каждый раз заново аллоцируя массив и вызывая smooth.get(); данные
      // на 100% пересекаются, поэтому строим один раз и переиспользуем везде
      const aliveTanksData = [];
      for (const p of current.players || []) {
        if (!p.alive) continue;
        const s = smooth.get(p.id);
        const x = s?.x ?? p.x;
        const y = s?.y ?? p.y;
        const motion = motionSmoothRef.current.get(p.id);
        const moveAngle = motion ? Math.atan2(motion.dirY, motion.dirX) : (s?.angle ?? p.turret_angle);
        aliveTanksData.push({
          player: p,
          x,
          y,
          turret_angle: s?.angle ?? p.turret_angle,
          moveAngle,
          speed: p.speed,
          size: p.is_miniboss ? MINIBOSS_TANK_SIZE : TANK_SIZE,
        });
      }

      // следы гусениц: используем сглаженные позиции + серверную скорость,
      // чтобы след появлялся плавно синхронно с визуальным движением танка
      const tracks = tracksRef.current;
      for (const t of aliveTanksData) {
        if ((t.speed ?? 0) > 100 && Math.random() < 0.3) {
          particles.spawnDust(t.x, t.y, t.moveAngle, t.speed);
        }
      }
      tracks.update(
        aliveTanksData.map((t) => ({
          id: t.player.id,
          x: t.x,
          y: t.y,
          turret_angle: t.turret_angle,
          moveAngle: t.moveAngle,
          alive: true,
          speed: t.speed,
        })),
        timestamp / 1000
      );

      const me = current.players?.find((p) => p.id === playerId);
      const meSmooth = smooth.get(playerId);

      // отправляем угол прицеливания не чаще ~20 раз/сек, считая от сглаженной позиции танка
      if (me && me.alive && meSmooth && timestamp - lastAimSent > 50) {
        lastAimSent = timestamp;
        const dx = mouseRef.current.x - meSmooth.x;
        const dy = mouseRef.current.y - meSmooth.y;
        if (Math.hypot(dx, dy) > 1) {
          sendAim(Math.atan2(dy, dx));
        }
      }

      // автоматическое оружие (пулемёт/огнемёт) стреляет непрерывно, пока
      // зажата ЛКМ — базовый одиночный выстрел остаётся по клику (в useMouseAim)
      if (
        me &&
        me.alive &&
        isFiringRef.current &&
        (me.weapon === "minigun" || me.weapon === "flamethrower") &&
        timestamp - lastAutoShotAt > 90
      ) {
        lastAutoShotAt = timestamp;
        sendShoot();
      }

      // screen-shake: короткий импульс при попадании/взрыве, затухает со временем
      const shake = shakeRef.current;
      shake.magnitude *= Math.max(0, 1 - dt * 10);
      const shakeX = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;
      const shakeY = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      drawFloor(ctx, canvas.width, canvas.height);

      // следы гусениц лежат прямо на полу, ниже всех объектов painter's algorithm
      tracks.draw(ctx);

      // ловушки тоже плоские декали на полу — рисуются перед сортировкой
      // по глубине, чтобы танки/пули всегда перекрывали их визуально
      for (const trap of traps) {
        drawTrap3D(ctx, trap, timestamp / 1000);
      }

      // предупреждения о падающих бомбах — тоже на уровне пола
      for (const bomb of current.bombs || []) {
        drawBomb3D(ctx, bomb, timestamp / 1000);
      }

      // ядерка — редкое глобальное событие, рисуется поверх бомб (крупнее и заметнее)
      if (current.nuke) {
        drawNukeWarning3D(ctx, current.nuke, timestamp / 1000);
      }

      // динамическое состояние разрушаемых стен (active/hp) приходит в
      // каждом тике отдельно от статичной геометрии (mapInfo.walls, один раз
      // при welcome) — объединяем по id перед отрисовкой
      const wallStateById = new Map();
      for (const ws of current.wall_states || []) {
        wallStateById.set(ws.id, ws);
      }

      // отбрасываемые тени: танки рядом со стенами/друг с другом кидают тень
      // на соседний объект (contact shadow) — раньше каждый объект отбрасывал
      // тень только сам под собой, теперь тень "дотягивается" до соседей.
      // Ограничено ~10 танками и стенами рядом — дёшево, не требует spatial index.
      const aliveTanks = aliveTanksData;
      for (let i = 0; i < aliveTanks.length; i++) {
        const tank = aliveTanks[i];
        for (const w of walls) {
          const wallState = wallStateById.get(w.id);
          if (wallState && !wallState.active) continue;
          const closestX = Math.max(w.x, Math.min(tank.x, w.x + w.width));
          const closestY = Math.max(w.y, Math.min(tank.y, w.y + w.height));
          const dist = Math.hypot(tank.x - closestX, tank.y - closestY);
          if (dist < 60) {
            drawCastShadow(ctx, tank.x, tank.y, tank.size, 55);
            break; // одной тени на ближайшую стену достаточно
          }
        }
        for (let j = i + 1; j < aliveTanks.length; j++) {
          const other = aliveTanks[j];
          const dist = Math.hypot(tank.x - other.x, tank.y - other.y);
          if (dist < 50) {
            drawCastShadow(ctx, tank.x, tank.y, tank.size, 45);
            drawCastShadow(ctx, other.x, other.y, other.size, 45);
          }
        }
      }

      // painter's algorithm: все объекты сцены сортируются по Y (глубине),
      // чтобы дальние перекрывались ближними как в настоящей 3D-сцене
      const sceneObjects = [];
      for (const w of walls) {
        const dynamicState = wallStateById.get(w.id);
        const merged = dynamicState
          ? { ...w, active: dynamicState.active, hp: dynamicState.hp }
          : w;
        sceneObjects.push({ type: "wall", y: w.y + w.height, data: merged });
      }
      for (const pu of current.pickups || []) {
        sceneObjects.push({ type: "pickup", y: pu.y, data: pu });
      }
      for (const t of aliveTanksData) {
        sceneObjects.push({
          type: "tank",
          y: t.y,
          data: { ...t.player, x: t.x, y: t.y, turret_angle: t.turret_angle },
        });
      }
      for (const b of current.bullets || []) {
        sceneObjects.push({ type: "bullet", y: b.y, data: b });
      }

      sceneObjects.sort((a, b) => a.y - b.y);

      for (const obj of sceneObjects) {
        if (obj.type === "wall") {
          drawWall3D(ctx, obj.data);
        } else if (obj.type === "pickup") {
          drawPickup3D(ctx, obj.data, PICKUP_COLORS, timestamp / 1000);
        } else if (obj.type === "tank") {
          if (obj.data.is_flaming) {
            drawFlameCone3D(ctx, obj.data, timestamp / 1000);
          }
          const kickback = kickbackRef.current.get(obj.data.id) || 0;

          // эффект разгона: сервер шлёт speed раз в тик (~33мс), а кадры рендера
          // идут на 60fps (~16мс) — сравнение "сырой" скорости между соседними
          // КАДРАМИ давало на каждом новом тике скачкообразную, шумную дельту
          // (корпус резко дёргался в сторону). EMA сглаживает и скорость, и
          // направление движения по времени, а не по кадру — стабильно и плавно.
          let motion = motionSmoothRef.current.get(obj.data.id);
          if (!motion) {
            motion = { emaSpeed: 0, dirX: Math.cos(obj.data.turret_angle), dirY: Math.sin(obj.data.turret_angle) };
          }
          const rawSpeed = obj.data.speed ?? 0;
          const speedAlpha = Math.min(1, dt * 8); // ~125мс до устаканивания
          const prevEmaSpeed = motion.emaSpeed;
          motion.emaSpeed += (rawSpeed - motion.emaSpeed) * speedAlpha;
          if (rawSpeed > 20) {
            // направление движения обновляем только когда танк реально едет —
            // на скорости ~0 vx/vy шумят и направление не имеет смысла
            const dirAlpha = Math.min(1, dt * 10);
            const targetDirX = obj.data.vx / rawSpeed;
            const targetDirY = obj.data.vy / rawSpeed;
            motion.dirX += (targetDirX - motion.dirX) * dirAlpha;
            motion.dirY += (targetDirY - motion.dirY) * dirAlpha;
          }
          motionSmoothRef.current.set(obj.data.id, motion);

          const accelBoost = Math.max(0, Math.min(1, (motion.emaSpeed - prevEmaSpeed) / dt / 400));
          const moveAngle = Math.atan2(motion.dirY, motion.dirX);

          // резкий разгон с места — всплеск пыли из-под гусениц, отдельно
          // от обычной пыли на ходу (та зависит только от текущей скорости)
          if (accelBoost > 0.4) {
            particles.spawnDust(obj.data.x, obj.data.y, moveAngle, motion.emaSpeed, true);
          }

          drawTank3D(ctx, obj.data, obj.data.id === playerId, TANK_SIZE, timestamp / 1000, kickback, accelBoost, moveAngle);
          if (kickback > 0.5) {
            const flashX = obj.data.x + Math.cos(obj.data.turret_angle) * (TANK_SIZE / 2 + 8);
            const flashY = obj.data.y + Math.sin(obj.data.turret_angle) * (TANK_SIZE / 2 + 8);
            drawMuzzleFlash3D(ctx, flashX, flashY, obj.data.turret_angle, kickback);
          }
          if (obj.data.laser_charging) {
            drawLaserCharge3D(ctx, obj.data.x, obj.data.y, obj.data.laser_charging.angle, obj.data.laser_charging.progress);
          }
        } else if (obj.type === "bullet") {
          drawBullet3D(ctx, obj.data, timestamp / 1000);
        }
      }

      // взрывы ракет/бомб поверх всей сцены
      for (const explosion of explosionsRef.current) {
        if (explosion.kind === "nuke") {
          drawNukeExplosion3D(ctx, explosion, explosion.age);
          continue;
        }
        drawExplosion3D(ctx, explosion, explosion.age);
      }

      // вспышки фактических выстрелов лазера мини-босса
      for (const shot of laserShotsRef.current) {
        drawLaserShot3D(ctx, shot, shot.age);
      }

      // вспышки телепорта
      for (const eff of teleportEffectsRef.current) {
        drawTeleportEffect3D(ctx, eff, eff.age);
      }

      // эффекты попаданий/разрушения стен
      for (const hit of wallHitsRef.current) {
        drawWallHitSpark3D(ctx, hit, hit.age);
      }
      for (const brk of wallBreaksRef.current) {
        drawWallBreakEffect3D(ctx, brk, brk.age);
      }

      // частицы (взрывы, искры, дым, пламя) поверх всего, с псевдо-3D высотой
      drawParticles3D(ctx, particles.getParticles());

      ctx.restore();

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [playerId, walls, traps, sendAim, sendShoot]);

  return (
    <canvas
      ref={canvasRef}
      width={fieldWidth}
      height={fieldHeight}
      style={{
        display: "block",
        border: "2px solid #334155",
        borderRadius: "8px",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(148, 163, 184, 0.08)",
        cursor: "crosshair",
        // ограничиваем ОБА измерения доступным пространством, сохраняя
        // соотношение сторон карты — иначе на невысоких viewport (маленькое
        // окно браузера) canvas вылезал за пределы экрана и создавал скролл
        maxWidth: "100%",
        maxHeight: "100%",
        width: "auto",
        height: "auto",
        objectFit: "contain",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
    />
  );
}

import { useEffect, useRef } from "react";
import { useMouseAim } from "../hooks/useMouseAim.js";
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
  playWallHitSound,
  playWallBreakSound,
  unlockAudio,
} from "../game/sound.js";

const WALL_BREAK_LIFETIME = 0.5;
const WALL_HIT_LIFETIME = 0.2;

const TANK_SIZE = 32;
const INTERP_SPEED = 12; // выше = быстрее "догоняет" серверную позицию
const EXPLOSION_LIFETIME = 0.6; // сек, длительность визуального взрыва бомбы/ракеты

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
};

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export default function GameCanvas({ state, mapInfo, playerId, sendAim, sendShoot, onGameEvent }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

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
  const hadNukeRef = useRef(false); // была ли ядерка активна в прошлом кадре (для звука появления)
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

      // мини-босс появился на карте -> звук + уведомление в UI
      for (const spawn of current.miniboss_spawns || []) {
        playMinibossSpawnSound();
        onGameEventRef.current?.({ type: "miniboss_spawn", owner: spawn.owner });
      }

      // игрок поднял уровень -> звук (для себя) + частицы, уведомление в UI
      for (const levelUp of current.level_ups || []) {
        if (levelUp.player_id === playerId) {
          playLevelUpSound();
          onGameEventRef.current?.({ type: "level_up", level: levelUp.level });
        }
        const p = current.players?.find((pl) => pl.id === levelUp.player_id);
        if (p) particles.spawnExplosion(p.x, p.y, 0.5);
      }

      // серверные события взрыва (ракета/бомба) -> визуальная ударная волна
      // + звук; отслеживаем по количеству, т.к. explosions приходят как
      // "снимок за этот тик" без стабильных id
      for (const ex of current.explosions || []) {
        explosionsRef.current.push({ x: ex.x, y: ex.y, radius: ex.radius, age: 0 });
        particles.spawnExplosion(ex.x, ex.y, 1.6);
        playExplosionSound(true);
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 12);
      }
      for (const explosion of explosionsRef.current) {
        explosion.age += dt / EXPLOSION_LIFETIME;
      }
      explosionsRef.current = explosionsRef.current.filter((e) => e.age < 1);

      // стена сломана оружием игрока -> обвал обломков + звук + тряска
      for (const brk of current.wall_breaks || []) {
        wallBreaksRef.current.push({ x: brk.x, y: brk.y, age: 0 });
        particles.spawnExplosion(brk.x, brk.y, 0.9);
        playWallBreakSound();
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 6);
      }
      for (const effect of wallBreaksRef.current) {
        effect.age += dt / WALL_BREAK_LIFETIME;
      }
      wallBreaksRef.current = wallBreaksRef.current.filter((e) => e.age < 1);

      // попадание в стену без разрушения -> короткая искра + глухой удар
      for (const hit of current.wall_hits || []) {
        wallHitsRef.current.push({ x: hit.x, y: hit.y, age: 0 });
        playWallHitSound();
      }
      for (const hit of wallHitsRef.current) {
        hit.age += dt / WALL_HIT_LIFETIME;
      }
      wallHitsRef.current = wallHitsRef.current.filter((e) => e.age < 1);

      particles.update(dt);

      // следы гусениц: используем сглаженные позиции + серверную скорость,
      // чтобы след появлялся плавно синхронно с визуальным движением танка
      const tracks = tracksRef.current;
      const trackSources = (current.players || [])
        .filter((p) => p.alive)
        .map((p) => {
          const s = smooth.get(p.id);
          const x = s?.x ?? p.x;
          const y = s?.y ?? p.y;
          if ((p.speed ?? 0) > 100 && Math.random() < 0.3) particles.spawnDust(x, y);
          return { id: p.id, x, y, turret_angle: s?.angle ?? p.turret_angle, alive: true, speed: p.speed };
        });
      tracks.update(trackSources, timestamp / 1000);

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
      const aliveTanks = (current.players || [])
        .filter((p) => p.alive)
        .map((p) => {
          const s = smooth.get(p.id);
          return { x: s?.x ?? p.x, y: s?.y ?? p.y, size: p.is_miniboss ? 52 : TANK_SIZE };
        });
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
      for (const p of current.players || []) {
        if (!p.alive) continue;
        const s = smooth.get(p.id) || p;
        sceneObjects.push({
          type: "tank",
          y: s.y,
          data: { ...p, x: s.x, y: s.y, turret_angle: s.angle },
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
          drawTank3D(ctx, obj.data, obj.data.id === playerId, TANK_SIZE, timestamp / 1000, kickback);
          if (kickback > 0.5) {
            const flashX = obj.data.x + Math.cos(obj.data.turret_angle) * (TANK_SIZE / 2 + 8);
            const flashY = obj.data.y + Math.sin(obj.data.turret_angle) * (TANK_SIZE / 2 + 8);
            drawMuzzleFlash3D(ctx, flashX, flashY, obj.data.turret_angle, kickback);
          }
        } else if (obj.type === "bullet") {
          drawBullet3D(ctx, obj.data);
        }
      }

      // взрывы ракет/бомб поверх всей сцены
      for (const explosion of explosionsRef.current) {
        drawExplosion3D(ctx, explosion, explosion.age);
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

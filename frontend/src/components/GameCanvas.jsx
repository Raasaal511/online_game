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
  drawExplosion3D,
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
  unlockAudio,
} from "../game/sound.js";

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

export default function GameCanvas({ state, mapInfo, playerId, sendAim, sendShoot }) {
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
  const kickbackRef = useRef(new Map()); // playerId -> 0..1, отдача ствола

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

      // новые пули -> звук выстрела (зависит от типа оружия) + отдача ствола
      // + вспышка/дым; исчезнувшие пули -> искра на месте последней позиции
      const seenBulletIds = new Set();
      for (const b of current.bullets || []) {
        seenBulletIds.add(b.id);
        if (!lastBulletPos.current.has(b.id)) {
          const soundFn = WEAPON_SHOOT_SOUND[b.kind] || playShotSound;
          soundFn();
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

      // painter's algorithm: все объекты сцены сортируются по Y (глубине),
      // чтобы дальние перекрывались ближними как в настоящей 3D-сцене
      const sceneObjects = [];
      for (const w of walls) {
        sceneObjects.push({ type: "wall", y: w.y + w.height, data: w });
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
        margin: "0 auto",
        border: "2px solid #334155",
        borderRadius: "8px",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(148, 163, 184, 0.08)",
        cursor: "crosshair",
        maxWidth: "100%",
        height: "auto",
      }}
    />
  );
}

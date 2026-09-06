import { useEffect, useRef } from "react";
import { useMouseAim } from "../hooks/useMouseAim.js";
import { createParticleSystem } from "../game/particles.js";
import {
  drawFloor,
  drawWall3D,
  drawPickup3D,
  drawBullet3D,
  drawTank3D,
  drawParticles3D,
} from "../game/render3d.js";
import {
  playShotSound,
  playHitSound,
  playExplosionSound,
  playPickupSound,
  unlockAudio,
} from "../game/sound.js";

const TANK_SIZE = 32;
const INTERP_SPEED = 12; // выше = быстрее "догоняет" серверную позицию

const PICKUP_COLORS = {
  heal: "#22c55e",
  armor: "#38bdf8",
  damage: "#f97316",
};

const PICKUP_LABELS = {
  heal: "+HP",
  armor: "ARM",
  damage: "DMG",
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
  const lastBulletPos = useRef(new Map());
  const knownAliveState = useRef(new Map());
  const knownPickupIds = useRef(new Set());
  const isFirstPickupSync = useRef(true);

  const fieldWidth = mapInfo.field?.width || 1400;
  const fieldHeight = mapInfo.field?.height || 900;
  const walls = mapInfo.walls || [];

  const handleShoot = () => {
    unlockAudio();
    sendShoot();
  };

  const mouseRef = useMouseAim(canvasRef, () => {}, handleShoot);
  const shakeRef = useRef({ magnitude: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationFrame;
    let lastAimSent = 0;
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

      // новые пули -> звук выстрела; исчезнувшие пули -> искра на месте последней позиции
      const particles = particlesRef.current;
      const seenBulletIds = new Set();
      for (const b of current.bullets || []) {
        seenBulletIds.add(b.id);
        if (!lastBulletPos.current.has(b.id)) {
          playShotSound();
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

      particles.update(dt);

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

      // screen-shake: короткий импульс при попадании/взрыве, затухает со временем
      const shake = shakeRef.current;
      shake.magnitude *= Math.max(0, 1 - dt * 10);
      const shakeX = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;
      const shakeY = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      drawFloor(ctx, canvas.width, canvas.height);

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
          drawPickup3D(ctx, obj.data, PICKUP_COLORS, PICKUP_LABELS, timestamp / 1000);
        } else if (obj.type === "tank") {
          drawTank3D(ctx, obj.data, obj.data.id === playerId, TANK_SIZE);
        } else if (obj.type === "bullet") {
          drawBullet3D(ctx, obj.data);
        }
      }

      // частицы (взрывы, искры) поверх всего, с собственной псевдо-3D высотой
      drawParticles3D(ctx, particles.getParticles());

      ctx.restore();

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [playerId, walls, sendAim]);

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

import { useEffect, useRef } from "react";
import { useMouseAim } from "../hooks/useMouseAim.js";
import { createParticleSystem } from "../game/particles.js";
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

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // стены
      ctx.fillStyle = "#475569";
      for (const w of walls) {
        ctx.fillRect(w.x, w.y, w.width, w.height);
      }

      // дропы
      for (const pu of current.pickups || []) {
        ctx.fillStyle = PICKUP_COLORS[pu.kind] || "#fff";
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(PICKUP_LABELS[pu.kind] || "", pu.x, pu.y + 3);
      }

      // танки (рисуем по сглаженным позициям для плавности)
      for (const p of current.players || []) {
        if (!p.alive) continue;
        const s = smooth.get(p.id) || p;
        drawTank(ctx, { ...p, x: s.x, y: s.y, turret_angle: s.angle }, p.id === playerId);
      }

      // пули (рисуем крупнее хитбокса, чтобы были заметны на масштабированном canvas)
      for (const b of current.bullets || []) {
        const r = Math.max(b.size, 8);
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "#facc15";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#7c2d12";
        ctx.stroke();
      }

      // частицы (взрывы, искры) поверх всего
      particles.draw(ctx);

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
        cursor: "crosshair",
        maxWidth: "100%",
        height: "auto",
      }}
    />
  );
}

function drawTank(ctx, player, isMe) {
  const { x, y, turret_angle: angle, hp, max_hp: maxHp, has_armor: hasArmor } = player;

  // корпус
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = isMe ? "#22c55e" : "#38bdf8";
  ctx.fillRect(-TANK_SIZE / 2, -TANK_SIZE / 2, TANK_SIZE, TANK_SIZE);

  if (hasArmor) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.strokeRect(-TANK_SIZE / 2 - 2, -TANK_SIZE / 2 - 2, TANK_SIZE + 4, TANK_SIZE + 4);
  }

  // башня + ствол
  ctx.rotate(angle);
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(0, 0, TANK_SIZE / 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(0, -3, TANK_SIZE / 2 + 8, 6);
  ctx.restore();

  // ник и HP-бар
  ctx.fillStyle = "white";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(player.nickname, x, y - TANK_SIZE / 2 - 14);

  const barWidth = TANK_SIZE;
  const barHeight = 5;
  const hpRatio = Math.max(0, hp / maxHp);
  ctx.fillStyle = "#334155";
  ctx.fillRect(x - barWidth / 2, y - TANK_SIZE / 2 - 10, barWidth, barHeight);
  ctx.fillStyle = hpRatio > 0.3 ? "#22c55e" : "#ef4444";
  ctx.fillRect(x - barWidth / 2, y - TANK_SIZE / 2 - 10, barWidth * hpRatio, barHeight);
}

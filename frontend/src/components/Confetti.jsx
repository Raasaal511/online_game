import { useEffect, useRef } from "react";

const COLORS = ["#facc15", "#22c55e", "#38bdf8", "#f472b6", "#fb923c"];
const PIECE_COUNT = 90;
const DURATION = 3200; // мс

// Лёгкий canvas-эффект конфетти на конец раунда — чисто декоративный слой
// поверх канваса игры, не влияет на геймплей. Полноэкранный fixed canvas,
// самоуничтожается через DURATION мс.
export default function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const pieces = Array.from({ length: PIECE_COUNT }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * window.innerHeight * 0.5,
      vx: (Math.random() - 0.5) * 80,
      vy: 120 + Math.random() * 160,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    let raf;
    let lastTime = performance.now();
    const start = lastTime;

    const draw = (timestamp) => {
      const dt = Math.min(0.05, (timestamp - lastTime) / 1000);
      lastTime = timestamp;
      const elapsed = timestamp - start;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const fadeOut = elapsed > DURATION - 600 ? Math.max(0, 1 - (elapsed - (DURATION - 600)) / 600) : 1;

      for (const p of pieces) {
        p.vy += 60 * dt; // лёгкая гравитация
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;

        ctx.save();
        ctx.globalAlpha = fadeOut;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
        ctx.restore();
      }

      if (elapsed < DURATION) {
        raf = requestAnimationFrame(draw);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
      }}
    />
  );
}

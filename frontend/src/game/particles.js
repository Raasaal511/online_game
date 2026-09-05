const EXPLOSION_COLORS = ["#f97316", "#facc15", "#ef4444", "#7c2d12"];
const HIT_COLORS = ["#facc15", "#fbbf24"];

export function createParticleSystem() {
  let particles = [];

  function spawnExplosion(x, y) {
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 180;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.4,
        age: 0,
        size: 3 + Math.random() * 4,
        color: EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)],
      });
    }
  }

  function spawnHitSpark(x, y) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.15 + Math.random() * 0.15,
        age: 0,
        size: 2 + Math.random() * 2,
        color: HIT_COLORS[Math.floor(Math.random() * HIT_COLORS.length)],
      });
    }
  }

  function update(dt) {
    for (const p of particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
    particles = particles.filter((p) => p.age < p.life);
  }

  function draw(ctx) {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { spawnExplosion, spawnHitSpark, update, draw };
}

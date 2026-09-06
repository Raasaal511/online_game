const EXPLOSION_COLORS = ["#f97316", "#facc15", "#ef4444", "#7c2d12"];
const HIT_COLORS = ["#facc15", "#fbbf24"];
const GRAVITY = 420; // px/sec^2, псевдо-3D падение осколков

export function createParticleSystem() {
  let particles = [];

  function spawnExplosion(x, y) {
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 180;
      particles.push({
        x,
        y,
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 120 + Math.random() * 200,
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
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 60 + Math.random() * 100,
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
      p.z = Math.max(0, p.z + p.vz * dt);
      p.vz -= GRAVITY * dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
    particles = particles.filter((p) => p.age < p.life);
  }

  // рендер делегирован вызывающей стороне (render3d.js), чтобы учитывать
  // общую псевдо-3D проекцию и тени на полу
  function getParticles() {
    return particles;
  }

  function draw(ctx) {
    for (const p of particles) {
      const t = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y - p.z, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { spawnExplosion, spawnHitSpark, update, draw, getParticles };
}

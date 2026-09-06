const EXPLOSION_COLORS = ["#f97316", "#facc15", "#ef4444", "#7c2d12"];
const HIT_COLORS = ["#facc15", "#fbbf24"];
const SMOKE_COLORS = ["#64748b", "#475569", "#94a3b8"];
const FLAME_COLORS = ["#fde047", "#f97316", "#ef4444"];
const GRAVITY = 420; // px/sec^2, псевдо-3D падение осколков

export function createParticleSystem() {
  let particles = [];

  function spawnExplosion(x, y, scale = 1) {
    const count = Math.round(36 * scale);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 220) * scale;
      particles.push({
        x,
        y,
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: (120 + Math.random() * 220) * scale,
        life: 0.4 + Math.random() * 0.5,
        age: 0,
        size: (3 + Math.random() * 5) * Math.sqrt(scale),
        color: EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)],
      });
    }
  }

  function spawnHitSpark(x, y) {
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 100;
      particles.push({
        x,
        y,
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 60 + Math.random() * 120,
        life: 0.15 + Math.random() * 0.2,
        age: 0,
        size: 2 + Math.random() * 2.5,
        color: HIT_COLORS[Math.floor(Math.random() * HIT_COLORS.length)],
      });
    }
  }

  function spawnMuzzleSmoke(x, y, angle) {
    for (let i = 0; i < 5; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.6;
      const speed = 30 + Math.random() * 40;
      particles.push({
        x,
        y,
        z: 6 + Math.random() * 4,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        vz: 10 + Math.random() * 20,
        life: 0.3 + Math.random() * 0.3,
        age: 0,
        size: 3 + Math.random() * 3,
        color: SMOKE_COLORS[Math.floor(Math.random() * SMOKE_COLORS.length)],
      });
    }
  }

  function spawnFlameParticles(x, y, angle) {
    for (let i = 0; i < 3; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.8;
      const speed = 100 + Math.random() * 150;
      particles.push({
        x,
        y,
        z: 4,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        vz: 20 + Math.random() * 30,
        life: 0.2 + Math.random() * 0.2,
        age: 0,
        size: 3 + Math.random() * 4,
        color: FLAME_COLORS[Math.floor(Math.random() * FLAME_COLORS.length)],
      });
    }
  }

  function spawnDust(x, y) {
    for (let i = 0; i < 2; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 20;
      particles.push({
        x,
        y,
        z: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 5 + Math.random() * 10,
        life: 0.4 + Math.random() * 0.3,
        age: 0,
        size: 2 + Math.random() * 2,
        color: "#94a3b8",
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

  return {
    spawnExplosion,
    spawnHitSpark,
    spawnMuzzleSmoke,
    spawnFlameParticles,
    spawnDust,
    update,
    draw,
    getParticles,
  };
}

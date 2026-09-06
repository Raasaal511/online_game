const EXPLOSION_COLORS = ["#f97316", "#facc15", "#ef4444", "#7c2d12"];
const HIT_COLORS = ["#facc15", "#fbbf24"];
const SMOKE_COLORS = ["#64748b", "#475569", "#94a3b8"];
const FLAME_COLORS = ["#fde047", "#f97316", "#ef4444"];
const GRAVITY = 420; // px/sec^2, псевдо-3D падение осколков
// жёсткий потолок на общее число живых частиц: при частых взрывах/ядерке
// (spawnExplosion со scale=4 даёт 144 частицы разом) без лимита список мог
// расти в тысячи элементов одновременно — update/filter/draw каждый кадр
// становятся заметно дороже и вносят вклад в лаги. Старые частицы (уже
// почти прозрачные) обрезаются первыми — визуально почти незаметно.
const MAX_PARTICLES = 500;

export function createParticleSystem() {
  let particles = [];

  function capParticles() {
    if (particles.length <= MAX_PARTICLES) return;
    particles.splice(0, particles.length - MAX_PARTICLES);
  }

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
    capParticles();
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
    // дым теперь держится заметно дольше и разлетается медленнее — раньше
    // рассеивался почти мгновенно (0.3-0.6с), выстрел не успевал "подымить"
    for (let i = 0; i < 6; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.7;
      const speed = 12 + Math.random() * 18;
      particles.push({
        x,
        y,
        z: 6 + Math.random() * 4,
        vx: Math.cos(spread) * speed,
        vy: Math.sin(spread) * speed,
        vz: 6 + Math.random() * 12,
        life: 0.9 + Math.random() * 0.6,
        age: 0,
        size: 4 + Math.random() * 4,
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

  // пыль из-под гусениц: раньше — одинаковые сплошные точки, разлетающиеся в
  // случайную сторону вне зависимости от движения танка. Теперь клубы пыли
  // вылетают из-под гусениц НАЗАД относительно направления хода (как
  // настоящий пыльный след), растут в размере пока рассеиваются (мягкий
  // radial-gradient в drawParticles3D, не сплошной круг) и живут дольше при
  // резком разгоне (burst=true), чем на ровном ходу.
  function spawnDust(x, y, angle = 0, speed = 100, burst = false) {
    const backAngle = angle + Math.PI; // клубы остаются позади танка, не по кругу
    const count = burst ? 4 : 2;
    const speedFactor = Math.min(1, speed / 200);
    for (let i = 0; i < count; i++) {
      const spread = backAngle + (Math.random() - 0.5) * 1.1;
      const kickSpeed = (burst ? 30 : 14) + Math.random() * 22 * speedFactor;
      particles.push({
        kind: "dust",
        x: x + Math.cos(backAngle) * 6,
        y: y + Math.sin(backAngle) * 6,
        z: 0,
        vx: Math.cos(spread) * kickSpeed,
        vy: Math.sin(spread) * kickSpeed,
        vz: 4 + Math.random() * 8,
        life: (burst ? 0.55 : 0.4) + Math.random() * 0.35,
        age: 0,
        size: (burst ? 5 : 3) + Math.random() * 3,
        color: burst ? "#a8a29e" : "#8a8f98",
      });
    }
    capParticles();
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
    capParticles();
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

// Следы от гусениц: чисто визуальный слой на клиенте, не влияет на сеть/баланс.
// Каждый живой танк оставляет за собой затухающие отпечатки, пока едет.
// Раньше отпечаток был одной круглой точкой на трак — читалось как "точки",
// а не следы гусениц. Теперь каждый отпечаток — короткий прямоугольный
// сегмент трака, повёрнутый вдоль направления движения (не прицела — башня
// может смотреть в сторону, пока корпус едет прямо), с лёгким шевелением
// поперёк хода — как настоящий рифлёный след гусеницы, а не идеальная линия.

const TRACK_INTERVAL = 0.09; // сек между отпечатками при движении
const TRACK_LIFETIME = 2.4; // сек до полного исчезновения следа
const MIN_SPEED_FOR_TRACK = 15; // px/sec, ниже — считаем что танк стоит на месте
const MAX_TRACKS = 260; // потолок на число следов
const SEGMENT_LEN = 7; // px, длина одного отпечатка трака вдоль хода
const SEGMENT_WIDTH = 3.2; // px, ширина отпечатка

export function createTrackSystem() {
  let tracks = [];
  const lastSpawnAt = new Map(); // playerId -> timestamp сек
  let lastUpdateAt = null;

  function update(players, nowSeconds) {
    // реальный dt кадра, а не захардкоженный 1/60 — на просадках FPS/другом
    // refresh rate следы раньше "старели" медленнее или быстрее реального
    // времени, что при накоплении рассинхронизирует их с TRACK_LIFETIME
    const dt = lastUpdateAt === null ? 1 / 60 : Math.min(0.1, nowSeconds - lastUpdateAt);
    lastUpdateAt = nowSeconds;

    const seenIds = new Set();
    for (const p of players) {
      seenIds.add(p.id);
      if (!p.alive) continue;
      const speed = p.speed ?? 0;
      if (speed < MIN_SPEED_FOR_TRACK) continue;

      const last = lastSpawnAt.get(p.id) ?? 0;
      if (nowSeconds - last < TRACK_INTERVAL) continue;
      lastSpawnAt.set(p.id, nowSeconds);

      // направление реального движения (moveAngle), а не прицела — иначе
      // след "гулял" бы вслед за поворотом башни, а не курсом корпуса
      const angle = p.moveAngle ?? p.turret_angle ?? 0;
      const perpX = Math.cos(angle + Math.PI / 2);
      const perpY = Math.sin(angle + Math.PI / 2);
      const jitter = (Math.random() - 0.5) * 1.5; // лёгкий сдвиг поперёк — не идеальная прямая
      const offset = 10;

      tracks.push({ x: p.x + perpX * (offset + jitter), y: p.y + perpY * (offset + jitter), angle, age: 0 });
      tracks.push({ x: p.x - perpX * (offset - jitter), y: p.y - perpY * (offset - jitter), angle, age: 0 });
    }
    // игроки, вышедшие из комнаты, не должны копиться в lastSpawnAt вечно —
    // тот же паттерн утечки, что был у motionSmoothRef/knownAliveState в
    // GameCanvas.jsx (некритично для одной короткой сессии, но накапливается
    // за много раундов на долго работающем сервере)
    for (const id of Array.from(lastSpawnAt.keys())) {
      if (!seenIds.has(id)) lastSpawnAt.delete(id);
    }

    for (const t of tracks) t.age += dt;
    if (tracks.length > MAX_TRACKS) tracks = tracks.slice(-MAX_TRACKS);
    tracks = tracks.filter((t) => t.age < TRACK_LIFETIME);
  }

  function draw(ctx) {
    for (const t of tracks) {
      const life = 1 - t.age / TRACK_LIFETIME;
      if (life <= 0) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle);
      ctx.globalAlpha = life * 0.4;
      ctx.fillStyle = "#0a0f14";
      ctx.fillRect(-SEGMENT_LEN / 2, -SEGMENT_WIDTH / 2, SEGMENT_LEN, SEGMENT_WIDTH);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  return { update, draw };
}

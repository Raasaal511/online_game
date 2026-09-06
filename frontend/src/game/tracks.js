// Следы от гусениц: чисто визуальный слой на клиенте, не влияет на сеть/баланс.
// Каждый живой танк оставляет за собой затухающие отпечатки, пока едет.

const TRACK_INTERVAL = 0.06; // сек между отпечатками при движении
const TRACK_LIFETIME = 2.2; // сек до полного исчезновения следа
const MIN_SPEED_FOR_TRACK = 15; // px/sec, ниже — считаем что танк стоит на месте

export function createTrackSystem() {
  let tracks = [];
  const lastSpawnAt = new Map(); // playerId -> timestamp сек

  function update(players, nowSeconds) {
    for (const p of players) {
      if (!p.alive) continue;
      const speed = p.speed ?? 0;
      if (speed < MIN_SPEED_FOR_TRACK) continue;

      const last = lastSpawnAt.get(p.id) ?? 0;
      if (nowSeconds - last < TRACK_INTERVAL) continue;
      lastSpawnAt.set(p.id, nowSeconds);

      const angle = p.turret_angle ?? 0;
      // две параллельные гусеницы, перпендикулярно направлению корпуса
      const perpX = Math.cos(angle + Math.PI / 2);
      const perpY = Math.sin(angle + Math.PI / 2);
      const offset = 10;

      tracks.push({ x: p.x + perpX * offset, y: p.y + perpY * offset, age: 0 });
      tracks.push({ x: p.x - perpX * offset, y: p.y - perpY * offset, age: 0 });
    }

    for (const t of tracks) t.age += 1 / 60;
    if (tracks.length > 400) tracks = tracks.slice(-400);
    tracks = tracks.filter((t) => t.age < TRACK_LIFETIME);
  }

  function draw(ctx) {
    for (const t of tracks) {
      const life = 1 - t.age / TRACK_LIFETIME;
      if (life <= 0) continue;
      ctx.globalAlpha = life * 0.35;
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { update, draw };
}

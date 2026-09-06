// Псевдо-3D рендер поверх Canvas2D: наклон "камеры", объёмные грани у танков/стен,
// парящие дропы и тени на полу. Игровые координаты (x, y) остаются 2D-полем истины
// с сервера — здесь только визуальная проекция и слой глубины (z) для отрисовки.

import { drawIcon } from "./icons.js";

const TILT = 0.72; // вертикальное сжатие пола/объектов, имитирует наклон камеры
const LIGHT_DIR = { x: -0.5, y: -1 }; // направление "света" для боковых граней

const WEAPON_BADGE_COLORS = {
  minigun: "#facc15",
  flamethrower: "#f97316",
  rocket: "#ef4444",
};

// экранная высота объекта с данной игровой высотой z (0 = на полу)
export function screenY(y, z = 0) {
  return y - z * TILT;
}

export function drawFloor(ctx, width, height) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#243044");
  grad.addColorStop(1, "#161f2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  ctx.lineWidth = 1;
  const step = 70;
  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // виньетка для ощущения глубины сцены (усилена относительно v1 — карта
  // выросла, и без более тёмных краёв плоское поле визуально "рассыпалось")
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.7
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function drawWall3D(ctx, wall) {
  if (wall.is_ramp) {
    drawRamp3D(ctx, wall);
    return;
  }
  if (wall.destructible && wall.active === false) {
    drawWallRuins3D(ctx, wall);
    return;
  }

  const depth = Math.min(20, wall.height, wall.width) * 0.5 + 8;
  const { x, y, width, height } = wall;

  // растянутая мягкая тень на полу (радиальный градиент вместо жёсткого
  // прямоугольника — читается более объёмно и естественно)
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(
    x + width / 2 + 5,
    y + height + depth * 0.25,
    width / 2 + 6,
    depth * 0.5 + 3,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // боковая грань (темнее, создаёт объём)
  ctx.fillStyle = "#334155";
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - depth * TILT);
  ctx.lineTo(x, y + height - depth * TILT);
  ctx.closePath();
  ctx.fill();

  // верхняя грань (светлее, приподнята на depth)
  const topY = y - depth * TILT;
  const topGrad = ctx.createLinearGradient(x, topY, x, topY + height);
  topGrad.addColorStop(0, "#5b6b84");
  topGrad.addColorStop(1, "#475569");
  ctx.fillStyle = topGrad;
  ctx.fillRect(x, topY, width, height);
  ctx.strokeStyle = "rgba(203, 213, 225, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);

  // повреждение: стена на последнем HP получает видимые трещины —
  // сигнал игроку, что ещё один удар её разрушит
  if (wall.destructible && wall.hp === 1) {
    ctx.strokeStyle = "rgba(15, 23, 42, 0.6)";
    ctx.lineWidth = 1.5;
    const cx = x + width / 2;
    const cy = topY + height / 2;
    ctx.beginPath();
    ctx.moveTo(cx - width * 0.3, topY);
    ctx.lineTo(cx - width * 0.05, cy - height * 0.15);
    ctx.lineTo(cx + width * 0.15, cy + height * 0.1);
    ctx.lineTo(cx + width * 0.3, topY + height);
    ctx.moveTo(cx - width * 0.1, cy - height * 0.1);
    ctx.lineTo(cx - width * 0.35, cy + height * 0.25);
    ctx.stroke();
  }
}

function drawRamp3D(ctx, wall) {
  // пандус: приподнятая площадка со скошенным (не вертикальным) передним
  // краем — визуально читается как "въезд наверх", а не сплошная стена
  const { x, y, width, height } = wall;
  const depth = 10;
  const topY = y - depth * TILT;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(x + width / 2, y + height + 4, width / 2 + 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // скошенный въезд (трапеция вместо прямоугольника)
  const inset = width * 0.25;
  ctx.fillStyle = "#64748b";
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - inset, topY);
  ctx.lineTo(x + inset, topY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // диагональная штриховка — читается как "рифлёная поверхность для въезда"
  ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const fx = x + (width * i) / 4;
    ctx.beginPath();
    ctx.moveTo(fx, y + height);
    ctx.lineTo(fx - inset * (i / 4), topY);
    ctx.stroke();
  }
}

function drawWallRuins3D(ctx, wall) {
  // стена разрушена: низкая куча обломков вместо полноразмерной преграды —
  // читается как "здесь можно проехать", но остаётся визуальным ориентиром
  const { x, y, width, height } = wall;
  const cx = x + width / 2;
  const cy = y + height / 2;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3f4c5f";
  const rubbleCount = 5;
  for (let i = 0; i < rubbleCount; i++) {
    const rx = x + ((i * 37) % width);
    const ry = y + ((i * 53) % Math.max(height, 1));
    const size = 4 + (i % 3) * 2;
    ctx.beginPath();
    ctx.arc(rx, ry, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawPickup3D(ctx, pickup, colors, t) {
  const bob = Math.sin(t * 3 + pickup.x * 0.05) * 4;
  const z = 14 + bob;
  const shadowScale = 1 - z / 60;
  const isSuper = pickup.kind === "super";

  // тень на полу
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(pickup.x, pickup.y, 9 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = screenY(pickup.y, z);

  if (isSuper) {
    // редкий power-up получает дополнительное пульсирующее кольцо, чтобы
    // выделяться среди обычных дропов ещё до подбора
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    const ring = ctx.createRadialGradient(pickup.x, py, 4, pickup.x, py, 18 + pulse * 4);
    ring.addColorStop(0, "rgba(244, 114, 182, 0.5)");
    ring.addColorStop(1, "rgba(244, 114, 182, 0)");
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(pickup.x, py, 18 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(pickup.x, py);

  const radius = isSuper ? 12 : 10;
  const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, radius);
  const color = colors[pickup.kind] || "#fff";
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  drawIcon(ctx, pickup.kind, "#0f172a", 0.85);
  ctx.restore();
}

export function drawTrap3D(ctx, trap, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 4 + trap.x * 0.03);
  const half = trap.size / 2;

  // низкая площадка чуть утоплена в пол — не мешает painter's algorithm
  // соседних объектов, но явно читается как опасная зона
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(trap.x, trap.y, half + 3, half * 0.5 + 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(127, 29, 29, ${0.55 + pulse * 0.25})`;
  ctx.beginPath();
  ctx.ellipse(trap.x, trap.y, half, half * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // шипы — треугольники по кругу, слегка "дышат" пульсацией
  const spikeCount = 6;
  ctx.fillStyle = `rgba(239, 68, 68, ${0.7 + pulse * 0.3})`;
  for (let i = 0; i < spikeCount; i++) {
    const a = (i / spikeCount) * Math.PI * 2;
    const bx = trap.x + Math.cos(a) * half * 0.55;
    const by = trap.y + Math.sin(a) * half * 0.55 * 0.5;
    const spikeLen = 5 + pulse * 3;
    ctx.beginPath();
    ctx.moveTo(bx, by - spikeLen);
    ctx.lineTo(bx - 3, by + 2);
    ctx.lineTo(bx + 3, by + 2);
    ctx.closePath();
    ctx.fill();
  }
}

const BULLET_PALETTE = {
  cannon: { glow: "250, 204, 21", core: ["#fff7cc", "#facc15", "#b45309"], stroke: "#7c2d12" },
  minigun: { glow: "253, 224, 71", core: ["#fffbeb", "#fde047", "#a16207"], stroke: "#713f12" },
  rocket: { glow: "239, 68, 68", core: ["#fecaca", "#ef4444", "#7f1d1d"], stroke: "#450a0a" },
};

export function drawBullet3D(ctx, bullet) {
  const z = 10;
  const kind = bullet.kind || "cannon";
  const palette = BULLET_PALETTE[kind] || BULLET_PALETTE.cannon;
  const isMinigun = kind === "minigun";
  const isRocket = kind === "rocket";
  const r = isMinigun ? Math.max(bullet.size, 5) : Math.max(bullet.size, 8);

  // дымный след ракеты — рисуется первым, чтобы оказаться под самим снарядом
  if (isRocket) {
    ctx.fillStyle = "rgba(100, 116, 139, 0.35)";
    const trailX = bullet.x - Math.sign(bullet.vx || 1) * 14;
    const trailY = bullet.y - Math.sign(bullet.vy || 0) * 14;
    ctx.beginPath();
    ctx.ellipse(trailX, trailY, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // тень
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(bullet.x, bullet.y, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = screenY(bullet.y, z);

  // свечение (слабее у пулемётных пуль — они мелкие и частые, сильный glow
  // на каждой создавал бы "кашу" на экране при высокой скорострельности)
  const glowMult = isMinigun ? 1.4 : 2.2;
  const glowAlpha = isMinigun ? 0.35 : 0.55;
  const glow = ctx.createRadialGradient(bullet.x, py, 0, bullet.x, py, r * glowMult);
  glow.addColorStop(0, `rgba(${palette.glow}, ${glowAlpha})`);
  glow.addColorStop(1, `rgba(${palette.glow}, 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(bullet.x, py, r * glowMult, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(bullet.x - 2, py - 2, 0.5, bullet.x, py, r);
  grad.addColorStop(0, palette.core[0]);
  grad.addColorStop(0.5, palette.core[1]);
  grad.addColorStop(1, palette.core[2]);
  ctx.beginPath();
  ctx.arc(bullet.x, py, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = isMinigun ? 1 : 1.5;
  ctx.strokeStyle = palette.stroke;
  ctx.stroke();
}

export function drawFlameCone3D(ctx, player, t) {
  const { x, y, turret_angle: angle } = player;
  const range = 130;
  const halfAngle = 0.45;
  const flicker = 0.7 + 0.3 * Math.sin(t * 25 + x * 0.1);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, range);
  grad.addColorStop(0, `rgba(255, 241, 191, ${0.85 * flicker})`);
  grad.addColorStop(0.35, `rgba(251, 146, 60, ${0.65 * flicker})`);
  grad.addColorStop(0.75, `rgba(239, 68, 68, ${0.35 * flicker})`);
  grad.addColorStop(1, "rgba(239, 68, 68, 0)");
  ctx.fillStyle = grad;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, range, -halfAngle, halfAngle);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawMuzzleFlash3D(ctx, x, y, angle, strength) {
  if (strength <= 0) return;
  const len = 14 + strength * 10;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const grad = ctx.createRadialGradient(len * 0.3, 0, 1, len * 0.3, 0, len);
  grad.addColorStop(0, `rgba(255, 247, 204, ${0.9 * strength})`);
  grad.addColorStop(0.5, `rgba(250, 204, 21, ${0.6 * strength})`);
  grad.addColorStop(1, "rgba(250, 204, 21, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(len * 0.3, 0, len, len * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawBomb3D(ctx, bomb, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 12);
  const ringRadius = bomb.radius * (0.3 + bomb.fuse_progress * 0.7);

  // предупреждающий круг на полу — растёт по мере приближения взрыва
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + pulse * 0.4})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `rgba(239, 68, 68, ${0.08 + bomb.fuse_progress * 0.12})`;
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, ringRadius, 0, Math.PI * 2);
  ctx.fill();

  // мигающий маркер в центре — учащается по мере приближения детонации
  const blinkSpeed = 4 + bomb.fuse_progress * 12;
  const blink = Math.sin(t * blinkSpeed) > 0;
  if (blink) {
    ctx.fillStyle = "#fecaca";
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y - 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawExplosion3D(ctx, explosion, age) {
  // age: 0..1, прогресс расширения ударной волны после взрыва
  if (age >= 1) return;
  const radius = explosion.radius * (0.3 + age * 0.9);
  const alpha = 1 - age;

  const grad = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius);
  grad.addColorStop(0, `rgba(255, 247, 204, ${0.8 * alpha})`);
  grad.addColorStop(0.4, `rgba(251, 146, 60, ${0.6 * alpha})`);
  grad.addColorStop(0.7, `rgba(239, 68, 68, ${0.35 * alpha})`);
  grad.addColorStop(1, "rgba(239, 68, 68, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawWallBreakEffect3D(ctx, effect, age) {
  // age: 0..1, вспышка пыли/трещин в момент разрушения стены (отдельно от
  // drawExplosion3D — это не взрыв оружия, а обвал каменной кладки)
  if (age >= 1) return;
  const alpha = 1 - age;
  const radius = 40 + age * 50;

  ctx.fillStyle = `rgba(148, 163, 184, ${0.35 * alpha})`;
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // разлетающиеся обломки-щепки по кругу
  const shardCount = 8;
  ctx.strokeStyle = `rgba(71, 85, 105, ${0.7 * alpha})`;
  ctx.lineWidth = 3;
  for (let i = 0; i < shardCount; i++) {
    const a = (i / shardCount) * Math.PI * 2;
    const dist = 15 + age * 35;
    const sx = effect.x + Math.cos(a) * dist;
    const sy = effect.y + Math.sin(a) * dist * 0.6;
    ctx.beginPath();
    ctx.moveTo(effect.x, effect.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
  }
}

export function drawWallHitSpark3D(ctx, hit, age) {
  // age: 0..1, короткая искра при попадании, не разрушившем стену
  if (age >= 1) return;
  const alpha = 1 - age;
  ctx.fillStyle = `rgba(226, 232, 240, ${0.6 * alpha})`;
  ctx.beginPath();
  ctx.arc(hit.x, hit.y, 6 + age * 10, 0, Math.PI * 2);
  ctx.fill();
}

export function drawTank3D(ctx, player, isMe, tankSize, t, kickback = 0) {
  const {
    x,
    y,
    turret_angle: angle,
    hp,
    max_hp: maxHp,
    has_armor: hasArmor,
    has_speed_boost: hasSpeedBoost,
    has_slow: hasSlow,
    has_super: hasSuper,
    has_spawn_protection: hasSpawnProtection,
    weapon,
  } = player;
  const bodyZ = 10;
  const half = tankSize / 2;

  // неуязвимость после респавна — мигающая полупрозрачность, чтобы было
  // видно кто ещё не может получать урон
  const spawnAlpha = hasSpawnProtection ? 0.5 + 0.4 * Math.sin((t ?? 0) * 14) : 1;
  ctx.save();
  ctx.globalAlpha = spawnAlpha;

  // тень корпуса на полу
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + half * 0.4, tankSize * 0.6, tankSize * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyColor = isMe ? "#22c55e" : "#38bdf8";
  const bodyColorDark = isMe ? "#15803d" : "#0369a1";
  const bodyColorLight = isMe ? "#4ade80" : "#7dd3fc";

  const topY = screenY(y, bodyZ);

  // ореол супер-бафа — яркое пульсирующее свечение под танком, самый
  // заметный статус-эффект (редкий мощный power-up из центра карты)
  if (hasSuper) {
    const pulse = 0.6 + 0.4 * Math.sin((t ?? 0) * 8);
    const glow = ctx.createRadialGradient(x, topY, half * 0.3, x, topY, tankSize * 1.3);
    glow.addColorStop(0, `rgba(250, 204, 21, ${0.45 * pulse})`);
    glow.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, topY, tankSize * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, 0);

  // боковая грань корпуса (между полом и приподнятым верхом), даёт объём
  ctx.fillStyle = bodyColorDark;
  ctx.beginPath();
  ctx.moveTo(-half, y + half);
  ctx.lineTo(half, y + half);
  ctx.lineTo(half, topY + half);
  ctx.lineTo(-half, topY + half);
  ctx.closePath();
  ctx.fill();

  // верхняя грань корпуса
  const bodyGrad = ctx.createLinearGradient(-half, topY - half, half, topY + half);
  bodyGrad.addColorStop(0, bodyColorLight);
  bodyGrad.addColorStop(1, bodyColor);
  ctx.fillStyle = bodyGrad;
  ctx.fillRect(-half, topY - half, tankSize, tankSize);

  if (hasSlow) {
    // ледяной оттенок поверх корпуса — читается как "заторможен"
    ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
    ctx.fillRect(-half, topY - half, tankSize, tankSize);
  }

  if (hasArmor || hasSuper) {
    ctx.strokeStyle = hasSuper ? "#facc15" : "#38bdf8";
    ctx.lineWidth = hasSuper ? 4 : 3;
    ctx.strokeRect(-half - 2, topY - half - 2, tankSize + 4, tankSize + 4);
  }

  if (hasSpeedBoost) {
    // короткие "моторные" штрихи по бокам корпуса вдоль оси движения
    ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-half - 6, topY - half + 6);
    ctx.lineTo(-half - 2, topY - half + 6);
    ctx.moveTo(-half - 6, topY + half - 6);
    ctx.lineTo(-half - 2, topY + half - 6);
    ctx.moveTo(half + 2, topY - half + 6);
    ctx.lineTo(half + 6, topY - half + 6);
    ctx.moveTo(half + 2, topY + half - 6);
    ctx.lineTo(half + 6, topY + half - 6);
    ctx.stroke();
  }

  ctx.restore();

  // башня + ствол — приподняты над корпусом, поворачиваются к цели
  const turretZ = bodyZ + 8;
  const turretY = screenY(y, turretZ);
  ctx.save();
  ctx.translate(x, turretY);

  // тень башни на корпусе
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(2, 3, tankSize / 3 + 2, tankSize / 3 + 1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(angle);
  // отдача: ствол на короткое время "уезжает" назад при выстреле — kickback
  // затухает от 1 (сразу после выстрела) до 0, создаёт ощущение мощности
  const barrelPullback = -kickback * 5;
  const turretGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, tankSize / 3);
  turretGrad.addColorStop(0, "#334155");
  turretGrad.addColorStop(1, "#0f172a");
  ctx.fillStyle = turretGrad;
  ctx.beginPath();
  ctx.arc(0, 0, tankSize / 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(barrelPullback, -3, tankSize / 2 + 8, 6);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(barrelPullback, -1.5, tankSize / 2 + 8, 3);
  ctx.restore();

  // бейдж подобранного оружия над башней — короткая цветная метка
  if (weapon && weapon !== "cannon") {
    const badgeColor = WEAPON_BADGE_COLORS[weapon] || "#facc15";
    ctx.save();
    ctx.translate(x + half + 4, topY - half - 4);
    ctx.fillStyle = badgeColor;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawIcon(ctx, weapon, "#0f172a", 0.55);
    ctx.restore();
  }

  // ник и HP-бар — billboard, не наклоняются вместе с полом
  ctx.fillStyle = "white";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 3;
  ctx.fillText(player.nickname, x, topY - half - 14);

  const barWidth = tankSize;
  const barHeight = 5;
  const hpRatio = Math.max(0, hp / maxHp);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#334155";
  ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth, barHeight);
  ctx.fillStyle = hpRatio > 0.3 ? "#22c55e" : "#ef4444";
  ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth * hpRatio, barHeight);
  ctx.shadowColor = "transparent";
  ctx.restore();
}

export function drawParticles3D(ctx, particles) {
  for (const p of particles) {
    const t = 1 - p.age / p.life;
    if (t <= 0) continue;

    // тень на полу, слабеет по мере подъёма частицы
    const shadowAlpha = Math.max(0, t * 0.3 * (1 - p.z / 120));
    if (shadowAlpha > 0) {
      ctx.globalAlpha = shadowAlpha;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size * t * 0.8, p.size * t * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, screenY(p.y, p.z), p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

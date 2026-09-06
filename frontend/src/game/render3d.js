// Псевдо-3D рендер поверх Canvas2D: наклон "камеры", объёмные грани у танков/стен,
// парящие дропы и тени на полу. Игровые координаты (x, y) остаются 2D-полем истины
// с сервера — здесь только визуальная проекция и слой глубины (z) для отрисовки.

const TILT = 0.62; // вертикальное сжатие пола/объектов, имитирует наклон камеры
const LIGHT_DIR = { x: -0.5, y: -1 }; // направление "света" для боковых граней

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

  // мягкая виньетка для ощущения сцены
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.3,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function drawWall3D(ctx, wall) {
  const depth = Math.min(16, wall.height, wall.width) * 0.5 + 6;
  const { x, y, width, height } = wall;

  // тень на полу
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + 4, y + height, width, depth * 0.5);

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
  ctx.fillStyle = "#475569";
  ctx.fillRect(x, topY, width, height);
  ctx.strokeStyle = "rgba(203, 213, 225, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);
}

export function drawPickup3D(ctx, pickup, colors, labels, t) {
  const bob = Math.sin(t * 3 + pickup.x * 0.05) * 4;
  const z = 14 + bob;
  const shadowScale = 1 - z / 60;

  // тень на полу
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(pickup.x, pickup.y, 9 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = screenY(pickup.y, z);
  ctx.save();
  ctx.translate(pickup.x, py);

  const grad = ctx.createRadialGradient(-2, -2, 1, 0, 0, 10);
  const color = colors[pickup.kind] || "#fff";
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.4, color);
  grad.addColorStop(1, color);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "white";
  ctx.font = "bold 9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(labels[pickup.kind] || "", 0, 3);
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

export function drawBullet3D(ctx, bullet) {
  const z = 10;
  const r = Math.max(bullet.size, 8);

  // тень
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(bullet.x, bullet.y, r * 0.8, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = screenY(bullet.y, z);

  // свечение
  const glow = ctx.createRadialGradient(bullet.x, py, 0, bullet.x, py, r * 2.2);
  glow.addColorStop(0, "rgba(250, 204, 21, 0.55)");
  glow.addColorStop(1, "rgba(250, 204, 21, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(bullet.x, py, r * 2.2, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(bullet.x - 2, py - 2, 0.5, bullet.x, py, r);
  grad.addColorStop(0, "#fff7cc");
  grad.addColorStop(0.5, "#facc15");
  grad.addColorStop(1, "#b45309");
  ctx.beginPath();
  ctx.arc(bullet.x, py, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#7c2d12";
  ctx.stroke();
}

export function drawTank3D(ctx, player, isMe, tankSize, t) {
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
  } = player;
  const bodyZ = 10;
  const half = tankSize / 2;

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
  const turretGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, tankSize / 3);
  turretGrad.addColorStop(0, "#334155");
  turretGrad.addColorStop(1, "#0f172a");
  ctx.fillStyle = turretGrad;
  ctx.beginPath();
  ctx.arc(0, 0, tankSize / 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, -3, tankSize / 2 + 8, 6);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, -1.5, tankSize / 2 + 8, 3);
  ctx.restore();

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

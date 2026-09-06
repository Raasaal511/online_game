// Псевдо-3D рендер поверх Canvas2D: наклон "камеры", объёмные грани у танков/стен,
// парящие дропы и тени на полу. Игровые координаты (x, y) остаются 2D-полем истины
// с сервера — здесь только визуальная проекция и слой глубины (z) для отрисовки.

import { drawIcon } from "./icons.js";

const TILT = 0.72; // вертикальное сжатие пола/объектов, имитирует наклон камеры
// синхронизировано с WALL_MAX_HP на сервере (backend/app/game/entities.py) —
// используется только для прогрессии визуальных трещин по стадиям урона
const WALL_MAX_HP = 5;
// направление света (нормализовано) — грани, обращённые к источнику, светлее;
// грани, обращённые от него, темнее. Свет "сверху-слева", как классическое
// студийное освещение — согласуется с тем, что верхняя грань всегда светлее.
const LIGHT_DIR = normalize({ x: -0.55, y: -0.6 });

function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

// прямоугольник со скруглёнными углами — заменяет эллипс там, где раньше
// овал растягивался в бесформенное пятно на длинных узких объектах (стены,
// развалины); добавляет path в текущий ctx, вызывающая сторона делает fill()/stroke()
function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// затемняет/осветляет hex-цвет на factor (-1..1): отрицательный — темнее,
// положительный — светлее. Используется, чтобы одна и та же боковая грань
// краснела/синела по-разному в зависимости от того, куда она "смотрит"
// относительно LIGHT_DIR — это и есть направленное освещение, а не просто
// фиксированный "тёмный низ / светлый верх".
function shadeColor(hex, factor) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  if (factor >= 0) {
    r += (255 - r) * factor;
    g += (255 - g) * factor;
    b += (255 - b) * factor;
  } else {
    r *= 1 + factor;
    g *= 1 + factor;
    b *= 1 + factor;
  }
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

// линейно смешивает два hex-цвета: weight=0 -> чистый a, weight=1 -> чистый b.
// Используется для золотистого перехода корпуса танка с ростом уровня.
function mixColor(a, b, weight) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff, ag = (pa >> 8) & 0xff, ab = pa & 0xff;
  const br = (pb >> 16) & 0xff, bg = (pb >> 8) & 0xff, bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * weight);
  const g = Math.round(ag + (bg - ag) * weight);
  const bl = Math.round(ab + (bb - ab) * weight);
  // hex, не rgb(...) — downstream shadeColor() парсит только "#rrggbb"
  const toHex = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

// яркость грани с нормалью (nx, ny) относительно направления света: 1 —
// грань смотрит прямо на свет, -1 — прямо от света (в тени)
function faceLighting(nx, ny) {
  return nx * LIGHT_DIR.x + ny * LIGHT_DIR.y;
}

// вектор "от света" — тени вытягиваются в эту сторону от объекта, отбрасывающего тень
const SHADOW_DIR = { x: -LIGHT_DIR.x, y: -LIGHT_DIR.y };

// Отбрасываемая тень одного объекта (танка) на другой объект (стену/танк)
// рядом: проецируем эллипс вдоль SHADOW_DIR от основания object'а, длина
// растёт по мере приближения; рисуется только если receiver действительно
// близко (иначе тень "летела" бы через всю карту без реальной геометрии).
export function drawCastShadow(ctx, casterX, casterY, casterHeight, maxReach = 70) {
  const len = Math.min(maxReach, casterHeight * 2.4);
  const tipX = casterX + SHADOW_DIR.x * len;
  const tipY = casterY + SHADOW_DIR.y * len * TILT;

  const grad = ctx.createLinearGradient(casterX, casterY, tipX, tipY);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.38)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = casterHeight * 0.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(casterX, casterY);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
}

// скин пушки — чисто косметика, синхронизировано с GUN_SKINS на сервере
// (backend/app/game/entities.py); {турель, тёмный ствол, светлый ствол}
const GUN_SKIN_COLORS = {
  steel: { turret: "#334155", turretDark: "#0f172a", barrel: "#1e293b", barrelDark: "#0f172a" },
  crimson: { turret: "#991b1b", turretDark: "#3f0d0d", barrel: "#7f1d1d", barrelDark: "#3f0d0d" },
  gold: { turret: "#a16207", turretDark: "#422a06", barrel: "#854d0e", barrelDark: "#422a06" },
  toxic: { turret: "#166534", turretDark: "#052e16", barrel: "#14532d", barrelDark: "#052e16" },
  azure: { turret: "#0c4a6e", turretDark: "#082f49", barrel: "#075985", barrelDark: "#082f49" },
};

const WEAPON_BADGE_COLORS = {
  minigun: "#94a3b8",
  flamethrower: "#d9772f",
  rocket: "#c24228",
};

// экранная высота объекта с данной игровой высотой z (0 = на полу)
export function screenY(y, z = 0) {
  return y - z * TILT;
}

export function drawFloor(ctx, width, height) {
  // приглушённая, чуть желчно-зелёная сталь вместо чистого сине-серого —
  // читается более "военно", как бетонный полигон, а не аркадный неон
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#171d18");
  grad.addColorStop(1, "#0b0e12");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.06)";
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

  // тень отбрасывается ОТ ОСНОВАНИЯ стены (нижний край y+height, где объект
  // реально касается пола), растягиваясь дальше в направлении SHADOW_DIR —
  // не смещённый дубликат всего прямоугольника (тот отрывался от стены:
  // верхний край тени не совпадал с основанием, создавая эффект "левитации"
  // между объектом и его тенью), а полигон, один край которого приклеен
  // точно к контуру стены, а другой вытянут в сторону от света.
  const shadowDx = SHADOW_DIR.x * depth * 1.4;
  const shadowDy = SHADOW_DIR.y * depth * 1.4 * TILT;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width + shadowDx, y + height + shadowDy);
  ctx.lineTo(x + shadowDx, y + height + shadowDy);
  ctx.closePath();
  ctx.fill();

  // боковые грани, обращённые к камере: южная (нормаль вниз) и восточная
  // (нормаль вправо) — каждая освещена по-своему в зависимости от того,
  // насколько она обращена к LIGHT_DIR. Раньше обе красились в один и тот
  // же фиксированный цвет — теперь это два разных, направленно освещённых тона.
  const southLight = faceLighting(0, 1); // всегда <=0 при свете сверху — грань в тени
  const eastLight = faceLighting(1, 0);
  // тёмный бетон/сталь с холодным оливковым оттенком вместо синевато-серого —
  // читается суровее, как военное укрепление, а не декоративная преграда
  const baseSide = "#282a25";
  const southColor = shadeColor(baseSide, southLight * 0.25);
  const eastColor = shadeColor(baseSide, eastLight * 0.25);

  // южная грань
  ctx.fillStyle = southColor;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width, y + height - depth * TILT);
  ctx.lineTo(x, y + height - depth * TILT);
  ctx.closePath();
  ctx.fill();

  // восточная грань (короткий скошенный "срез" по правому краю) — то, чего
  // не было раньше: без неё объект выглядел как выдавленный только вниз,
  // а не полноценный параллелепипед со стороны
  ctx.fillStyle = eastColor;
  ctx.beginPath();
  ctx.moveTo(x + width, y + height);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y - depth * TILT);
  ctx.lineTo(x + width, y + height - depth * TILT);
  ctx.closePath();
  ctx.fill();
  // (восточная грань нулевой толщины в ортографической проекции по x — её
  // объём даёт только разница освещения на стыке с южной гранью; рисуем
  // тонкую полоску вдоль правого края верхней грани, чтобы стык читался)
  ctx.fillRect(x + width - 2, y - depth * TILT, 2, height);

  // верхняя грань (светлее всех — обращена прямо к свету, приподнята на depth)
  const topY = y - depth * TILT;
  const topLight = faceLighting(0, -1); // нормаль вверх — навстречу свету сверху
  const topGrad = ctx.createLinearGradient(x, topY, x, topY + height);
  topGrad.addColorStop(0, shadeColor("#4a4d42", 0.2 + topLight * 0.25));
  topGrad.addColorStop(1, shadeColor("#4a4d42", topLight * 0.2));
  ctx.fillStyle = topGrad;
  ctx.fillRect(x, topY, width, height);
  ctx.strokeStyle = "rgba(203, 213, 225, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);

  // повреждение растёт постепенно с числом попаданий (стена держит несколько
  // ударов, не только последний) — трещины множатся, а не появляются разом
  // на последнем HP, иначе с более живучей стеной прогресс был бы не виден
  if (wall.destructible && wall.hp != null && wall.hp <= WALL_MAX_HP - 1) {
    const damageStage = WALL_MAX_HP - wall.hp; // 1, 2, 3...
    const cx = x + width / 2;
    const cy = topY + height / 2;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.6)";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(cx - width * 0.3, topY);
    ctx.lineTo(cx - width * 0.05, cy - height * 0.15);
    ctx.lineTo(cx + width * 0.15, cy + height * 0.1);
    ctx.lineTo(cx + width * 0.3, topY + height);
    ctx.stroke();

    if (damageStage >= 2) {
      ctx.beginPath();
      ctx.moveTo(cx - width * 0.1, cy - height * 0.1);
      ctx.lineTo(cx - width * 0.35, cy + height * 0.25);
      ctx.stroke();
    }
    if (damageStage >= 3) {
      ctx.beginPath();
      ctx.moveTo(cx + width * 0.1, topY + height * 0.1);
      ctx.lineTo(cx + width * 0.32, cy + height * 0.05);
      ctx.stroke();
    }
    if (damageStage >= 4) {
      // на последнем HP — явные тёмные сколы по краям, не только трещины
      ctx.fillStyle = "rgba(15, 23, 42, 0.5)";
      ctx.beginPath();
      ctx.arc(x + width * 0.15, topY + height * 0.2, Math.min(width, height) * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + width * 0.8, topY + height * 0.75, Math.min(width, height) * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRamp3D(ctx, wall) {
  // пандус: раньше сливался со стеной (тот же тусклый оливковый оттенок,
  // почти не выделялся на фоне соседней секции) — теперь контрастная
  // предупреждающая жёлто-чёрная разметка (как настоящий дорожный пандус) +
  // явная стрелка направления въезда, чтобы объект читался однозначно
  const { x, y, width, height } = wall;
  const depth = 10;
  const topY = y - depth * TILT;
  const isHorizontal = width >= height;

  // тень по форме площадки (прямоугольник), а не овал
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(x - 3, y + 2, width + 6, 8);

  // скошенный въезд (трапеция вместо прямоугольника) — приподнят выше, чем
  // раньше, чтобы объём "выступа" читался лучше на пологой камере
  const inset = width * 0.22;
  ctx.fillStyle = "#8a7a3d";
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - inset, topY);
  ctx.lineTo(x + inset, topY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(15, 23, 42, 0.7)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // предупреждающая диагональная жёлто-чёрная штриховка вдоль всей площадки —
  // однозначно читается как "функциональный объект", а не декоративный кусок стены
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - inset, topY);
  ctx.lineTo(x + inset, topY);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.75)";
  ctx.lineWidth = 6;
  const stripeStep = 14;
  const span = width + height;
  for (let i = -span; i < span; i += stripeStep) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + height + 10);
    ctx.lineTo(x + i + height + 10, topY - 10);
    ctx.stroke();
  }
  ctx.restore();

  // стрелка въезда по центру площадки — направление, куда танк заезжает наверх
  ctx.save();
  ctx.translate(x + width / 2, (y + height + topY) / 2);
  if (!isHorizontal) ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.beginPath();
  ctx.moveTo(-10, -6);
  ctx.lineTo(4, -6);
  ctx.lineTo(4, -11);
  ctx.lineTo(14, 0);
  ctx.lineTo(4, 11);
  ctx.lineTo(4, 6);
  ctx.lineTo(-10, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - inset, topY);
  ctx.lineTo(x + inset, topY);
  ctx.closePath();
  ctx.stroke();
}

// псевдослучайный, но детерминированный генератор — те же обломки на том же
// месте каждый кадр (не должны "мерцать"/переставляться), без Math.random()
function _rubbleRand(seed) {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function drawWallRuins3D(ctx, wall) {
  // стена разрушена: рассыпавшаяся куча каменной кладки вместо полноразмерной
  // преграды — читается как "здесь можно проехать", но остаётся заметным
  // ориентиром на карте. Полный редизайн (было: 5 одинаковых плоских кружков
  // без освещения, тень одним растянутым эллипсом на всю длину стены):
  // теперь общая плоская подложка обвала + крупные и мелкие камни вперемешку,
  // каждый с направленным освещением (как обычные стены) и своей тенью.
  const { x, y, width, height } = wall;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const area = width * height;

  // общая подложка — раскрошенная земля/щебень чуть шире исходной стены,
  // объединяет отдельные камни в один читаемый объект разрушения. Форма
  // повторяет прямоугольник стены (со скруглением), а не эллипс — на
  // длинной узкой секции эллипс растягивался в неестественно вытянутый овал
  // поперёк всей длины вместо компактной кучи обломков под её контуром.
  const pad = 6;
  const rr = Math.min(14, Math.min(width, height) / 2 + pad);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  drawRoundedRect(ctx, x - pad, y - pad + 4, width + pad * 2, height + pad * 2, rr);
  ctx.fill();

  ctx.fillStyle = "rgba(58, 61, 51, 0.55)";
  drawRoundedRect(ctx, x - 2, y - 2, width + 4, height + 4, Math.min(10, Math.min(width, height) / 2));
  ctx.fill();

  // плотность обломков растёт с площадью секции — короткая баррикада и
  // длинный отрезок крепостной стены выглядят пропорционально разрушенными
  const rubbleCount = Math.min(14, Math.max(6, Math.round(area / 900)));
  const southLight = faceLighting(0, 1);
  const topLight = faceLighting(0, -1);

  for (let i = 0; i < rubbleCount; i++) {
    const rx = x + _rubbleRand(i * 3.1 + wall.id?.length ?? 0) * width;
    const ry = y + _rubbleRand(i * 7.7 + 1) * height;
    // размеры вперемешку: часть камней заметно крупнее — читается как настоящий обвал
    const big = i % 4 === 0;
    const size = big ? 9 + _rubbleRand(i) * 5 : 4 + _rubbleRand(i) * 4;

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(rx, ry + size * 0.35, size * 1.2, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // каждый камень — грубый многоугольник, а не идеальный круг, плюс
    // направленное освещение верх/низ грани (согласовано с обычными стенами)
    const sides = 5 + Math.floor(_rubbleRand(i + 40) * 3);
    const rotOffset = _rubbleRand(i + 80) * Math.PI * 2;
    ctx.fillStyle = shadeColor("#3a3d33", 0.12 + topLight * 0.2);
    ctx.beginPath();
    for (let s = 0; s < sides; s++) {
      const a = rotOffset + (s / sides) * Math.PI * 2;
      const jitter = 0.75 + _rubbleRand(i * 5 + s) * 0.5;
      const px = rx + Math.cos(a) * size * jitter;
      const py = ry + Math.sin(a) * size * jitter * 0.85 - size * 0.3;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shadeColor("#242620", southLight * 0.15);
    ctx.beginPath();
    ctx.ellipse(rx, ry - size * 0.1, size * 0.7, size * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // тонкая пыльная дымка над обвалом — усиливает ощущение "недавнего разрушения"
  const dustGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.6);
  dustGrad.addColorStop(0, "rgba(148, 163, 184, 0.1)");
  dustGrad.addColorStop(1, "rgba(148, 163, 184, 0)");
  ctx.fillStyle = dustGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, width / 2 + 10, height / 2 + 10, 0, 0, Math.PI * 2);
  ctx.fill();
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

// приглушённая, "боевая" палитра снарядов вместо ярко-мультяшной жёлтой:
// пушка — тлеющая медь/латунь, пулемёт — холодная сталь с искрой, ракета —
// тёмный тлеющий огонь с копотью, а не чистый неоновый красный
const BULLET_PALETTE = {
  cannon: { glow: "217, 140, 60", core: ["#ffe9c2", "#d98c3c", "#7a3d12"], stroke: "#3d1f0a" },
  minigun: { glow: "203, 213, 225", core: ["#f8fafc", "#94a3b8", "#475569"], stroke: "#1e293b" },
  rocket: { glow: "194, 65, 40", core: ["#f3b988", "#c24228", "#5c1a10"], stroke: "#2a0d08" },
  sniper: { glow: "165, 243, 252", core: ["#ecfeff", "#67e8f9", "#155e75"], stroke: "#0e2a35" },
  brawler: { glow: "252, 165, 89", core: ["#fff1e0", "#f59e42", "#7c3a0a"], stroke: "#3d1f0a" },
  ultimate: { glow: "232, 121, 249", core: ["#fdf4ff", "#c026d3", "#4a044e"], stroke: "#2a0930" },
};

// снаряды с явно вытянутой "пулевидной" формой (не круг) — заострённый нос
// по направлению полёта, скруглённый хвост; пулемётные трассеры остаются
// мелкими точками намеренно (высокая скорострельность, форма не читается)
const SHELL_KINDS = new Set(["cannon", "sniper", "brawler", "ultimate"]);

// Предрендеренные спрайты glow-свечения пули: ctx.createRadialGradient() +
// 2x addColorStop() на КАЖДУЮ пулю КАЖДЫЙ кадр — при скорострельном оружии
// (пулемёт/gunner) на экране легко 20-40 пуль одновременно, это 20-40 новых
// gradient-объектов/кадр только на glow. Вместо этого рендерим один спрайт
// нормализованного радиуса на палитру ОДИН раз, дальше просто drawImage()
// с масштабом — на порядок дешевле, чем пересоздавать градиент каждый раз.
const GLOW_SPRITE_SIZE = 64; // px, разрешение спрайта (радиус = SIZE/2)
const _glowSpriteCache = new Map(); // key: `${glowRgb}` -> HTMLCanvasElement

function getGlowSprite(glowRgb) {
  let sprite = _glowSpriteCache.get(glowRgb);
  if (sprite) return sprite;

  sprite = document.createElement("canvas");
  sprite.width = GLOW_SPRITE_SIZE;
  sprite.height = GLOW_SPRITE_SIZE;
  const sctx = sprite.getContext("2d");
  const center = GLOW_SPRITE_SIZE / 2;
  const grad = sctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, `rgba(${glowRgb}, 1)`);
  grad.addColorStop(1, `rgba(${glowRgb}, 0)`);
  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(center, center, center, 0, Math.PI * 2);
  sctx.fill();

  _glowSpriteCache.set(glowRgb, sprite);
  return sprite;
}

// рисует закэшированный glow-спрайт в позиции (x,y), масштабируя его под
// нужный радиус через drawImage — альфа применяется через ctx.globalAlpha
// (спрайт уже непрозрачный в центре и прозрачный на краю), не пересоздавая
// градиент на каждый вызов
function drawGlowSprite(ctx, glowRgb, x, y, radius, alpha) {
  const sprite = getGlowSprite(glowRgb);
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prevAlpha;
}

export function drawBullet3D(ctx, bullet, t = 0) {
  const z = 10;
  const kind = bullet.kind || "cannon";
  const palette = BULLET_PALETTE[kind] || BULLET_PALETTE.cannon;
  const isMinigun = kind === "minigun";
  const isRocket = kind === "rocket";
  const isCannon = kind === "cannon";
  const isShell = SHELL_KINDS.has(kind);
  const isUltimate = kind === "ultimate";
  // пушечное ядро заметно крупнее и весомее — должно читаться как серьёзная
  // угроза, а не декоративная точка; пулемёт остаётся мелким намеренно
  const r = isMinigun
    ? Math.max(bullet.size, 5)
    : isUltimate
    ? Math.max(bullet.size, 16)
    : isCannon
    ? Math.max(bullet.size, 11)
    : Math.max(bullet.size, 8);

  const angle = Math.atan2(bullet.vy ?? 0, bullet.vx ?? 1);

  // хвостовой мазок скорости вдоль направления полёта — читается как "летит
  // быстро и опасно", особенно заметно у утяжелённого пушечного снаряда
  if (isShell || isRocket) {
    const trailLen = isUltimate ? r * 2.6 : isCannon ? r * 3.2 : r * 2.4;
    const tailX = bullet.x - Math.cos(angle) * trailLen;
    const tailY = bullet.y - Math.sin(angle) * trailLen;
    const streak = ctx.createLinearGradient(bullet.x, bullet.y, tailX, tailY);
    streak.addColorStop(0, `rgba(${palette.glow}, 0.55)`);
    streak.addColorStop(1, `rgba(${palette.glow}, 0)`);
    ctx.strokeStyle = streak;
    ctx.lineWidth = r * 0.9;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bullet.x, bullet.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
  }

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
  // на каждой создавал бы "кашу" на экране при высокой скорострельности);
  // пушечное ядро дополнительно пульсирует — раскалённый снаряд, а не
  // статичная светящаяся точка, должно тревожить сильнее при приближении
  const cannonPulse = isCannon || isUltimate ? 0.85 + 0.15 * Math.sin(t * 30 + bullet.x * 0.1) : 1;
  const glowMult = (isMinigun ? 1.4 : isUltimate ? 3.2 : isCannon ? 2.7 : 2.2) * cannonPulse;
  const glowAlpha = (isMinigun ? 0.35 : isUltimate ? 0.8 : isCannon ? 0.7 : 0.55) * cannonPulse;
  drawGlowSprite(ctx, palette.glow, bullet.x, py, r * glowMult, glowAlpha);

  const grad = ctx.createRadialGradient(bullet.x - 2, py - 2, 0.5, bullet.x, py, r);
  grad.addColorStop(0, palette.core[0]);
  grad.addColorStop(0.5, palette.core[1]);
  grad.addColorStop(1, palette.core[2]);
  ctx.fillStyle = grad;
  ctx.lineWidth = isMinigun ? 1 : isCannon || isUltimate ? 2 : 1.5;
  ctx.strokeStyle = palette.stroke;

  if (isShell) {
    // снарядная форма: вытянутый эллипс вдоль направления полёта с заострённым
    // носом — не окружность, читается как летящий снаряд, а не точка/шарик
    const bodyLen = r * (isUltimate ? 1.9 : 1.6);
    const bodyWidth = r * 0.75;
    ctx.save();
    ctx.translate(bullet.x, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.55, 0); // остриё носа
    ctx.quadraticCurveTo(bodyLen * 0.15, -bodyWidth, -bodyLen * 0.5, -bodyWidth * 0.7);
    ctx.quadraticCurveTo(-bodyLen * 0.7, 0, -bodyLen * 0.5, bodyWidth * 0.7);
    ctx.quadraticCurveTo(bodyLen * 0.15, bodyWidth, bodyLen * 0.55, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(bullet.x, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // тонкое пульсирующее кольцо вокруг раскалённого снаряда — усиливает
  // ощущение "готового снести" при приближении к игроку
  if (isCannon || isUltimate) {
    ctx.strokeStyle = `rgba(255, 220, 170, ${0.5 * cannonPulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bullet.x, py, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawFlameCone3D(ctx, player, t) {
  const { x, y, turret_angle: angle } = player;
  const range = 190; // синхронизировано с FLAMETHROWER_RANGE на сервере
  const halfAngle = 0.45;
  const flicker = 0.7 + 0.3 * Math.sin(t * 25 + x * 0.1);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // базовый широкий конус (как раньше, но длиннее)
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

  // 3 "языка" пламени, каждый со своей фазой пульсации и чуть разной длиной —
  // создаёт эффект живого, неровного огня вместо статичного плоского конуса
  const tongueCount = 3;
  for (let i = 0; i < tongueCount; i++) {
    const tongueAngle = (i - (tongueCount - 1) / 2) * (halfAngle * 0.75);
    const phase = t * 18 + i * 2.1;
    const wobble = 0.75 + 0.25 * Math.sin(phase);
    const tongueRange = range * (0.6 + 0.35 * Math.sin(phase * 0.6));
    const tongueWidth = 0.14 + 0.05 * Math.sin(phase * 1.3);

    const tGrad = ctx.createRadialGradient(0, 0, 2, 0, 0, tongueRange);
    tGrad.addColorStop(0, `rgba(255, 247, 214, ${0.9 * wobble})`);
    tGrad.addColorStop(0.5, `rgba(253, 186, 116, ${0.7 * wobble})`);
    tGrad.addColorStop(1, "rgba(249, 115, 22, 0)");
    ctx.fillStyle = tGrad;

    ctx.save();
    ctx.rotate(tongueAngle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, tongueRange, -tongueWidth, tongueWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export function drawMuzzleFlash3D(ctx, x, y, angle, strength) {
  if (strength <= 0) return;
  const len = 14 + strength * 10;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const grad = ctx.createRadialGradient(len * 0.3, 0, 1, len * 0.3, 0, len);
  grad.addColorStop(0, `rgba(255, 237, 199, ${0.9 * strength})`);
  grad.addColorStop(0.5, `rgba(217, 140, 60, ${0.6 * strength})`);
  grad.addColorStop(1, "rgba(217, 140, 60, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(len * 0.3, 0, len, len * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// синхронизировано с MINIBOSS_LASER_WIDTH/MINIBOSS_LASER_RANGE на сервере
const LASER_WIDTH = 18.0;
const LASER_RANGE = 900.0;

export function drawLaserCharge3D(ctx, x, y, angle, progress) {
  // телеграф лазера мини-босса: тонкая прицельная линия, растущая по
  // толщине/яркости по мере приближения выстрела — даёт игрокам реальное
  // окно, чтобы уйти с линии огня до того, как ударит полный луч
  const len = LASER_RANGE;
  const width = 2 + progress * (LASER_WIDTH - 2);
  const alpha = 0.35 + progress * 0.5;
  const pulse = 0.6 + 0.4 * Math.sin(progress * 40);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  const grad = ctx.createLinearGradient(0, 0, len, 0);
  grad.addColorStop(0, `rgba(239, 68, 68, ${alpha * pulse})`);
  grad.addColorStop(1, `rgba(239, 68, 68, 0)`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.stroke();

  ctx.restore();
}

export function drawLaserShot3D(ctx, shot, age) {
  // выстрел лазера — короткая, но очень яркая полная вспышка на всю длину
  // луча, затухает за долю секунды (мгновенное попадание, не снаряд)
  if (age >= 1) return;
  const alpha = 1 - age;
  const { x, y, angle, range } = shot;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.strokeStyle = `rgba(255, 241, 199, ${0.95 * alpha})`;
  ctx.lineWidth = LASER_WIDTH * (1 - age * 0.5);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(range, 0);
  ctx.stroke();

  ctx.strokeStyle = `rgba(239, 68, 68, ${0.6 * alpha})`;
  ctx.lineWidth = LASER_WIDTH * 2 * (1 - age * 0.5);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(range, 0);
  ctx.stroke();

  ctx.restore();
}

export function drawTeleportEffect3D(ctx, effect, age) {
  // короткая схлопывающаяся вспышка колец на месте появления после телепорта
  if (age >= 1) return;
  const alpha = 1 - age;
  const { x, y } = effect;

  ctx.strokeStyle = `rgba(94, 234, 212, ${0.8 * alpha})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, 10 + age * 34, (10 + age * 34) * TILT, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(45, 212, 191, ${0.5 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, 4 + age * 20, (4 + age * 20) * TILT, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawBomb3D(ctx, bomb, t) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 12);
  const ringRadius = bomb.radius * (0.3 + bomb.fuse_progress * 0.7);
  // артиллерия мини-босса — отдельный пурпурный цвет, чтобы не путать с
  // обычной фоновой бомбой (та же телеграф-механика, но другая угроза)
  const rgb = bomb.is_artillery ? "168, 85, 247" : "239, 68, 68";

  // предупреждающий круг на полу — растёт по мере приближения взрыва
  ctx.strokeStyle = `rgba(${rgb}, ${0.4 + pulse * 0.4})`;
  ctx.lineWidth = bomb.is_artillery ? 4 : 3;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `rgba(${rgb}, ${0.08 + bomb.fuse_progress * 0.12})`;
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, ringRadius, 0, Math.PI * 2);
  ctx.fill();

  // мигающий маркер в центре — учащается по мере приближения детонации
  const blinkSpeed = 4 + bomb.fuse_progress * 12;
  const blink = Math.sin(t * blinkSpeed) > 0;
  if (blink) {
    ctx.fillStyle = bomb.is_artillery ? "#e9d5ff" : "#fecaca";
    ctx.beginPath();
    ctx.arc(bomb.x, bomb.y - 10, bomb.is_artillery ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawNukeWarning3D(ctx, nuke, t) {
  // ядерка накрывает ~50% диагонали карты — предупреждение должно быть
  // однозначно тревожным и видно издалека, не просто "ещё одна бомба"
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  const fastPulse = 0.5 + 0.5 * Math.sin(t * 16);
  const radius = nuke.radius * (0.15 + nuke.warning_progress * 0.85);

  // широкая заливка зоны поражения, усиливается по мере приближения взрыва
  ctx.fillStyle = `rgba(239, 68, 68, ${0.05 + nuke.warning_progress * 0.15})`;
  ctx.beginPath();
  ctx.arc(nuke.x, nuke.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // двойное кольцо — внешнее медленно пульсирует, внутреннее мигает быстрее
  // по мере приближения детонации (учащается тревога)
  ctx.strokeStyle = `rgba(239, 68, 68, ${0.5 + pulse * 0.4})`;
  ctx.lineWidth = 5;
  ctx.setLineDash([18, 10]);
  ctx.beginPath();
  ctx.arc(nuke.x, nuke.y, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(250, 204, 21, ${0.4 + fastPulse * 0.5})`;
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.arc(nuke.x, nuke.y, radius * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // мигающий символ радиации в центре — учащается по мере приближения взрыва
  const blinkSpeed = 3 + nuke.warning_progress * 14;
  const blink = Math.sin(t * blinkSpeed) > 0;
  if (blink) {
    ctx.fillStyle = "#fef08a";
    ctx.save();
    ctx.translate(nuke.x, nuke.y);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i / 3) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.arc(0, 0, 16, -0.5, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function drawExplosion3D(ctx, explosion, age) {
  // age: 0..1, прогресс расширения ударной волны после взрыва
  if (age >= 1) return;
  const radius = explosion.radius * (0.3 + age * 0.9);
  const alpha = 1 - age;

  const grad = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius);
  grad.addColorStop(0, `rgba(255, 233, 194, ${0.8 * alpha})`);
  grad.addColorStop(0.4, `rgba(217, 140, 60, ${0.6 * alpha})`);
  grad.addColorStop(0.7, `rgba(194, 65, 40, ${0.35 * alpha})`);
  grad.addColorStop(1, "rgba(194, 65, 40, 0)");
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

export function drawNukeExplosion3D(ctx, explosion, age) {
  // взрыв ядерки — отдельный от обычного drawExplosion3D эффект "гриба":
  // расширяющаяся ударная волна по земле + поднимающееся облако-шапка со
  // смещением вверх (через screenY), заметно масштабнее и дольше живёт,
  // чем взрыв ракеты/бомбы — раньше рисовался тем же кругом, что и обычная
  // граната, и не читался как нечто катастрофическое
  if (age >= 1) return;
  const alpha = 1 - age;
  const groundRadius = explosion.radius * (0.35 + age * 0.85);

  // ударная волна по земле — тёмно-серая пыльная, не огненная (реалистичнее для "ядерки")
  const groundGrad = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, groundRadius);
  groundGrad.addColorStop(0, `rgba(255, 241, 199, ${0.85 * alpha})`);
  groundGrad.addColorStop(0.3, `rgba(217, 140, 60, ${0.55 * alpha})`);
  groundGrad.addColorStop(0.6, `rgba(120, 113, 108, ${0.45 * alpha})`);
  groundGrad.addColorStop(1, "rgba(120, 113, 108, 0)");
  ctx.fillStyle = groundGrad;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, groundRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 255, 255, ${0.6 * alpha})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, groundRadius, 0, Math.PI * 2);
  ctx.stroke();

  // столб/ножка гриба — поднимается быстрее, чем расширяется шапка
  const stemHeight = 40 + age * 140;
  const stemWidth = explosion.radius * (0.12 + age * 0.05);
  const stemTopY = screenY(explosion.y, stemHeight);
  const stemGrad = ctx.createLinearGradient(explosion.x, explosion.y, explosion.x, stemTopY);
  stemGrad.addColorStop(0, `rgba(120, 113, 108, ${0.7 * alpha})`);
  stemGrad.addColorStop(1, `rgba(87, 83, 78, ${0.5 * alpha})`);
  ctx.fillStyle = stemGrad;
  ctx.beginPath();
  ctx.ellipse(explosion.x, (explosion.y + stemTopY) / 2, stemWidth, Math.abs(explosion.y - stemTopY) / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // шапка гриба — округлое облако над столбом, растёт с задержкой и медленнее ножки
  const capProgress = Math.max(0, age - 0.15) / 0.85;
  const capRadius = explosion.radius * (0.28 + capProgress * 0.5);
  const capY = screenY(explosion.y, stemHeight + capRadius * 0.5);
  const capGrad = ctx.createRadialGradient(explosion.x, capY, 0, explosion.x, capY, capRadius);
  capGrad.addColorStop(0, `rgba(168, 162, 158, ${0.75 * alpha})`);
  capGrad.addColorStop(0.6, `rgba(120, 113, 108, ${0.55 * alpha})`);
  capGrad.addColorStop(1, "rgba(120, 113, 108, 0)");
  ctx.fillStyle = capGrad;
  ctx.beginPath();
  ctx.ellipse(explosion.x, capY, capRadius, capRadius * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
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

export function drawTank3D(ctx, player, isMe, baseTankSize, t, kickback = 0, accelBoost = 0, moveAngle = null) {
  const {
    turret_angle: angle,
    hp,
    max_hp: maxHp,
    has_armor: hasArmor,
    has_speed_boost: hasSpeedBoost,
    has_slow: hasSlow,
    has_super: hasSuper,
    has_spawn_protection: hasSpawnProtection,
    is_miniboss: isMiniboss,
    weapon,
    gun_skin: gunSkin,
  } = player;
  const level = player.level ?? 1;
  // чем выше уровень — тем крупнее и золотистее танк (визуальный статус
  // прокачки, помимо цифры в бейдже): растёт плавно, не рывками
  const levelProgress = isMiniboss ? 0 : (level - 1) / 4; // 0..1 (LEVEL_MAX=5)
  // мини-босс втрое крупнее обычного танка — синхронизировано с MINIBOSS_SIZE
  // на сервере (96 vs 32), должен читаться как настоящий босс, а не чуть
  // подросший игрок
  const tankSize = isMiniboss ? baseTankSize * 3 : baseTankSize * (1 + levelProgress * 0.22);
  const bodyZ = isMiniboss ? 22 : 10; // мини-босс визуально заметно выше обычных танков
  const half = tankSize / 2;

  // при выстреле весь корпус слегка "приседает" назад вдоль ствола — раньше
  // дёргался только сам ствол, что читалось слабо; это короткая, быстро
  // затухающая добавка к позиции, не влияющая на реальные игровые координаты
  const bodyRecoil = kickback * 2.5;
  // при резком разгоне корпус аналогично "приседает" назад по направлению
  // движения (не башни) — тяжёлая машина клюёт носом при старте с места,
  // читается как реальное ускорение, а не мгновенный набор скорости
  const accelDir = moveAngle ?? angle;
  const accelPush = accelBoost * tankSize * 0.18;
  const x = player.x - Math.cos(angle) * bodyRecoil - Math.cos(accelDir) * accelPush;
  const y = player.y - Math.sin(angle) * bodyRecoil - Math.sin(accelDir) * accelPush;

  // неуязвимость после респавна — мигающая полупрозрачность, чтобы было
  // видно кто ещё не может получать урон
  const spawnAlpha = hasSpawnProtection ? 0.5 + 0.4 * Math.sin((t ?? 0) * 14) : 1;
  ctx.save();
  ctx.globalAlpha = spawnAlpha;

  // тень корпуса на полу — квадратная под форму корпуса (не овал), смещена
  // в направлении от света; крупнее у мини-босса пропорционально размеру
  const shadowDx = SHADOW_DIR.x * half * 0.4;
  const shadowDy = SHADOW_DIR.y * half * 0.4 * TILT;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(x - half + shadowDx, y - half + shadowDy, tankSize, tankSize);

  let bodyColor, bodyColorDark, bodyColorLight;
  if (isMiniboss) {
    bodyColor = "#991b1b";
    bodyColorDark = "#450a0a";
    bodyColorLight = "#dc2626";
  } else if (isMe) {
    bodyColor = "#22c55e";
    bodyColorDark = "#15803d";
    bodyColorLight = "#4ade80";
  } else {
    bodyColor = "#38bdf8";
    bodyColorDark = "#0369a1";
    bodyColorLight = "#7dd3fc";
  }

  // с ростом уровня фракционный цвет постепенно вытесняется золотом —
  // видно издалека, кто прокачан, даже без чтения цифры уровня
  if (levelProgress > 0) {
    bodyColor = mixColor(bodyColor, "#facc15", levelProgress * 0.75);
    bodyColorDark = mixColor(bodyColorDark, "#92400e", levelProgress * 0.75);
    bodyColorLight = mixColor(bodyColorLight, "#fef08a", levelProgress * 0.75);
  }

  // угрожающее пульсирующее свечение вокруг мини-босса — виден издалека.
  // Двухслойное: медленный широкий пульс "присутствия" + быстрый узкий
  // "тревожный" импульс поверх — раньше был один слой и читался вяло для
  // объекта втрое крупнее обычного танка.
  if (isMiniboss) {
    const slowPulse = 0.5 + 0.5 * Math.sin((t ?? 0) * 2.2);
    const outerGlow = ctx.createRadialGradient(x, y, half * 0.6, x, y, tankSize * 2.4);
    outerGlow.addColorStop(0, `rgba(220, 38, 38, ${0.3 * slowPulse})`);
    outerGlow.addColorStop(1, "rgba(220, 38, 38, 0)");
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(x, y, tankSize * 2.4, 0, Math.PI * 2);
    ctx.fill();

    const fastPulse = 0.5 + 0.5 * Math.sin((t ?? 0) * 7);
    const innerGlow = ctx.createRadialGradient(x, y, half * 0.4, x, y, tankSize * 1.3);
    innerGlow.addColorStop(0, `rgba(248, 113, 113, ${0.25 * fastPulse})`);
    innerGlow.addColorStop(1, "rgba(248, 113, 113, 0)");
    ctx.fillStyle = innerGlow;
    ctx.beginPath();
    ctx.arc(x, y, tankSize * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

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

  // гусеницы по бокам корпуса — раньше корпус был просто плоским квадратом,
  // без них силуэт не читался как танк. Рисуются под корпусом, чуть выступая
  // по бокам, с сегментами-траками для ощущения механической детали.
  const trackWidth = tankSize * 0.16;
  const trackInset = half * 0.08;
  ctx.fillStyle = "#1c1f18";
  ctx.fillRect(-half - trackWidth + trackInset, topY - half - 2, trackWidth, tankSize + 4);
  ctx.fillRect(half - trackInset, topY - half - 2, trackWidth, tankSize + 4);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  const trackSegments = 5;
  for (let i = 0; i < trackSegments; i++) {
    const segY = topY - half + (i + 0.5) * (tankSize / trackSegments);
    ctx.fillRect(-half - trackWidth + trackInset + 1, segY - 1.5, trackWidth - 2, 3);
    ctx.fillRect(half - trackInset + 1, segY - 1.5, trackWidth - 2, 3);
  }

  // боковые грани корпуса, направленно освещённые — южная (низ) и восточная
  // (правый бок), каждая своим оттенком по faceLighting, вместо одного
  // плоского bodyColorDark на всю боковину
  const bodySouthLight = faceLighting(0, 1);
  const bodyEastLight = faceLighting(1, 0);

  ctx.fillStyle = shadeColor(bodyColorDark, bodySouthLight * 0.2);
  ctx.beginPath();
  ctx.moveTo(-half, y + half);
  ctx.lineTo(half, y + half);
  ctx.lineTo(half, topY + half);
  ctx.lineTo(-half, topY + half);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeColor(bodyColorDark, bodyEastLight * 0.2);
  ctx.fillRect(half - 3, topY - half, 3, tankSize);

  // верхняя грань корпуса — скошенные передние углы (не идеальный квадрат)
  // читаются как броневой лист, а не примитивная коробка; светлее с той
  // стороны, что обращена к источнику света
  const bodyTopLight = faceLighting(0, -1);
  const bodyGrad = ctx.createLinearGradient(-half, topY - half, half, topY + half);
  bodyGrad.addColorStop(0, shadeColor(bodyColorLight, bodyTopLight * 0.2));
  bodyGrad.addColorStop(1, shadeColor(bodyColor, bodyTopLight * 0.15));
  ctx.fillStyle = bodyGrad;
  const chamfer = tankSize * 0.22;
  ctx.beginPath();
  ctx.moveTo(-half + chamfer, topY - half);
  ctx.lineTo(half - chamfer, topY - half);
  ctx.lineTo(half, topY - half + chamfer);
  ctx.lineTo(half, topY + half);
  ctx.lineTo(-half, topY + half);
  ctx.lineTo(-half, topY - half + chamfer);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shadeColor(bodyColorDark, 0.1);
  ctx.lineWidth = 1;
  ctx.stroke();

  // центральная броневая накладка — панель поверх корпуса вдоль продольной
  // оси, добавляет силуэту деталь без нагромождения лишней геометрии
  ctx.fillStyle = shadeColor(bodyColorDark, 0.15);
  ctx.fillRect(-half * 0.35, topY - half + 3, half * 0.7, tankSize - 6);

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
  // скин пушки — чисто косметический выбор из меню, применяется только к
  // обычным игрокам (мини-босс всегда красный, это индикатор угрозы, а не
  // персонализация)
  const skin = GUN_SKIN_COLORS[gunSkin] || GUN_SKIN_COLORS.steel;
  const turretGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, tankSize / 3);
  turretGrad.addColorStop(0, isMiniboss ? "#7f1d1d" : skin.turret);
  turretGrad.addColorStop(1, isMiniboss ? "#1a0505" : skin.turretDark);
  ctx.fillStyle = turretGrad;
  ctx.beginPath();
  ctx.arc(0, 0, tankSize / 3, 0, Math.PI * 2);
  ctx.fill();

  if (isMiniboss) {
    // мини-босс отличим не только размером/цветом: спаренные стволы (он
    // реально бьёт несколькими типами атак) + вращающийся сенсор-кольцо на
    // башне, читается как настоящая боевая машина, а не увеличенный игрок
    const barrelLen = tankSize / 2 + 10;
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(barrelPullback, -7, barrelLen, 5);
    ctx.fillRect(barrelPullback, 2, barrelLen, 5);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(barrelPullback, -5.5, barrelLen, 2.5);
    ctx.fillRect(barrelPullback, 3.5, barrelLen, 2.5);

    const spinAngle = (t ?? 0) * 3;
    ctx.strokeStyle = "rgba(248, 113, 113, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, tankSize / 3 + 4, spinAngle, spinAngle + 1.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, tankSize / 3 + 4, spinAngle + Math.PI, spinAngle + Math.PI + 1.8);
    ctx.stroke();
    ctx.fillStyle = "#fecaca";
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = skin.barrel;
    ctx.fillRect(barrelPullback, -3, tankSize / 2 + 8, 6);
    ctx.fillStyle = skin.barrelDark;
    ctx.fillRect(barrelPullback, -1.5, tankSize / 2 + 8, 3);
  }
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

  // ник и HP-бар — billboard, не наклоняются вместе с полом. Уровень раньше
  // был вписан прямо в текст ника ("Lv.3 Rasl") и сливался с ним визуально —
  // теперь отдельная маленькая золотистая строка НАД ником, всегда видна
  // отдельно от имени начиная со 2 уровня.
  const nameLabel = isMiniboss ? `☠ ${player.nickname}` : player.nickname;
  const nameY = topY - half - 14;

  if (!isMiniboss && level > 1) {
    ctx.fillStyle = "#fde047";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 3;
    ctx.fillText(`★ Уровень ${level}`, x, nameY - 12);
  }

  ctx.fillStyle = isMiniboss ? "#fecaca" : "white";
  ctx.font = isMiniboss ? "bold 13px sans-serif" : "11px sans-serif";
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 3;
  ctx.fillText(nameLabel, x, nameY);

  const barWidth = isMiniboss ? tankSize * 1.6 : tankSize;
  const barHeight = isMiniboss ? 7 : 5;
  const hpRatio = Math.max(0, hp / maxHp);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#334155";
  ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth, barHeight);
  ctx.fillStyle = isMiniboss ? "#dc2626" : hpRatio > 0.3 ? "#22c55e" : "#ef4444";
  ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth * hpRatio, barHeight);
  ctx.shadowColor = "transparent";

  // указатель "это я" сразу после респавна — на большой карте с 10 танками
  // одинакового вида сложно быстро найти себя глазами; пока действует
  // неуязвимость (spawn protection), над своим танком висит заметная
  // подпрыгивающая стрелка — единственный явный сигнал "ты здесь"
  if (isMe && hasSpawnProtection) {
    const bob = Math.sin((t ?? 0) * 6) * 5;
    const arrowY = nameY - 34 + bob;
    ctx.save();
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "rgba(15, 23, 42, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, arrowY + 14);
    ctx.lineTo(x - 8, arrowY);
    ctx.lineTo(x - 3, arrowY);
    ctx.lineTo(x - 3, arrowY - 10);
    ctx.lineTo(x + 3, arrowY - 10);
    ctx.lineTo(x + 3, arrowY);
    ctx.lineTo(x + 8, arrowY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// спрайт клуба пыли — тот же приём, что у drawGlowSprite: рендерим градиент
// один раз в offscreen canvas, дальше только drawImage с масштабом. При
// MAX_PARTICLES=500 и активной езде танков пыль может быть большой долей
// живых частиц — createRadialGradient на каждую каждый кадр был бы заметно
// дороже одного закэшированного спрайта.
let _dustSprite = null;
function getDustSprite() {
  if (_dustSprite) return _dustSprite;
  const size = 128;
  _dustSprite = document.createElement("canvas");
  _dustSprite.width = size;
  _dustSprite.height = size;
  const sctx = _dustSprite.getContext("2d");
  const center = size / 2;
  const grad = sctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, "rgba(148, 141, 130, 1)");
  grad.addColorStop(0.6, "rgba(120, 113, 103, 0.55)");
  grad.addColorStop(1, "rgba(120, 113, 103, 0)");
  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(center, center, center, 0, Math.PI * 2);
  sctx.fill();
  return _dustSprite;
}

export function drawParticles3D(ctx, particles) {
  for (const p of particles) {
    const t = 1 - p.age / p.life;
    if (t <= 0) continue;

    if (p.kind === "dust") {
      // клуб пыли: растёт в размере и теряет чёткость по мере рассеивания —
      // закэшированный спрайт (getDustSprite) вместо пересоздания gradient
      // на каждую частицу каждый кадр, читается как оседающее облако
      const grow = 1 + (1 - t) * 1.8;
      const r = p.size * grow;
      const py = screenY(p.y, p.z);
      const alpha = t * 0.4;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha;
      ctx.drawImage(getDustSprite(), p.x - r, py - r, r * 2, r * 2);
      ctx.globalAlpha = prevAlpha;
      continue;
    }

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

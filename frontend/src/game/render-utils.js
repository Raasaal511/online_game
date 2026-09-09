// Базовый слой рендер-утилит: общая математика, цвет, освещение и проекция
// глубины, используемые всеми доменами рендера (terrain/pickups/bullets/
// effects/tank/particles). Этот модуль НЕ импортирует ничего из других
// render-*.js — он основа, от которой зависят остальные.

export const TILT = 0.72; // вертикальное сжатие пола/объектов, имитирует наклон камеры

// направление света (нормализовано) — грани, обращённые к источнику, светлее;
// грани, обращённые от него, темнее. Свет "сверху-слева", как классическое
// студийное освещение — согласуется с тем, что верхняя грань всегда светлее.
export const LIGHT_DIR = normalize({ x: -0.55, y: -0.6 });

export function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

export function shortestAngleDiff(a, b) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// прямоугольник со скруглёнными углами — заменяет эллипс там, где раньше
// овал растягивался в бесформенное пятно на длинных узких объектах (стены,
// развалины); добавляет path в текущий ctx, вызывающая сторона делает fill()/stroke()
export function drawRoundedRect(ctx, x, y, width, height, radius) {
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
export function shadeColor(hex, factor) {
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

// яркость грани с нормалью (nx, ny) относительно направления света: 1 —
// грань смотрит прямо на свет, -1 — прямо от света (в тени)
export function faceLighting(nx, ny) {
  return nx * LIGHT_DIR.x + ny * LIGHT_DIR.y;
}

// вектор "от света" — тени вытягиваются в эту сторону от объекта, отбрасывающего тень
export const SHADOW_DIR = { x: -LIGHT_DIR.x, y: -LIGHT_DIR.y };

// градиент contact-shadow зависит только от len (casterHeight/maxReach —
// оба берутся из небольшого фиксированного набора значений: TANK_SIZE/
// MINIBOSS_TANK_SIZE и maxReach=45/55/70 из вызовов в GameCanvas.jsx), не
// от позиции — раньше пересоздавался на КАЖДЫЙ вызов drawCastShadow, а этот
// вызов сидит во вложенном цикле "танк x стена" + "танк x танк" в
// GameCanvas.jsx (см. contact-shadow блок) — при кучке из нескольких
// игроков рядом друг с другом (типичная драка за пикап в центре карты) это
// давало до ~2*(N-1) пересозданий градиента за кадр, а не N — именно такой
// нелинейный всплеск совпадает с найденными при профилировании редкими
// выбросами длительности кадра. Кэш по (len) устраняет пересоздание совсем.
const _castShadowGradientCache = new Map(); // key: len -> CanvasGradient
let _castShadowGradientCtx = null; // Gradient непереносим между context — сбрасываем кэш при смене ctx

function getCastShadowGradient(ctx, len) {
  if (_castShadowGradientCtx !== ctx) {
    _castShadowGradientCache.clear();
    _castShadowGradientCtx = ctx;
  }
  let grad = _castShadowGradientCache.get(len);
  if (grad) return grad;
  grad = ctx.createLinearGradient(0, 0, SHADOW_DIR.x * len, SHADOW_DIR.y * len * TILT);
  grad.addColorStop(0, "rgba(0, 0, 0, 0.38)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  _castShadowGradientCache.set(len, grad);
  return grad;
}

// Отбрасываемая тень одного объекта (танка) на другой объект (стену/танк)
// рядом: проецируем эллипс вдоль SHADOW_DIR от основания object'а, длина
// растёт по мере приближения; рисуется только если receiver действительно
// близко (иначе тень "летела" бы через всю карту без реальной геометрии).
export function drawCastShadow(ctx, casterX, casterY, casterHeight, maxReach = 70) {
  const len = Math.min(maxReach, casterHeight * 2.4);
  const tipX = casterX + SHADOW_DIR.x * len;
  const tipY = casterY + SHADOW_DIR.y * len * TILT;

  // градиент закэширован в системе координат "от 0", рисуем через
  // translate вместо пересоздания под каждую пару (caster, len) — тот же
  // приём, что и у getWallTopGradient/getWallBorderPattern
  ctx.save();
  ctx.translate(casterX, casterY);
  ctx.strokeStyle = getCastShadowGradient(ctx, len);
  ctx.lineWidth = casterHeight * 0.7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(tipX - casterX, tipY - casterY);
  ctx.stroke();
  ctx.restore();
}

// экранная высота объекта с данной игровой высотой z (0 = на полу)
export function screenY(y, z = 0) {
  return y - z * TILT;
}

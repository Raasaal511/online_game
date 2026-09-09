// Рендер пыли из-под гусениц и обобщённых частиц (искры, дым, обломки).

import { screenY } from "./render-utils.js";

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

// Пыль из-под гусениц рисуется ОТДЕЛЬНО от остальных частиц (взрывы, искры,
// дым от выстрелов) и на уровне пола — раньше вся пыль шла через общий
// drawParticles3D, вызываемый в самом конце кадра ПОВЕРХ уже нарисованных
// танков по painter's algorithm, из-за чего клубы пыли всегда перекрывали
// танк сверху, даже когда танк должен быть "перед" пылью по глубине сцены.
// Вызывать эту функцию нужно сразу после пола/следов гусениц, ДО сортировки
// и отрисовки основной сцены (стены/танки/пули).
export function drawGroundDust3D(ctx, particles) {
  for (const p of particles) {
    if (p.kind !== "dust") continue;
    const t = 1 - p.age / p.life;
    if (t <= 0) continue;

    // клуб пыли: растёт в размере и теряет чёткость по мере рассеивания —
    // закэшированный спрайт (getDustSprite) вместо пересоздания gradient
    // на каждую частицу каждый кадр, читается как оседающее облако
    const grow = 1 + (1 - t) * 1.8;
    const r = p.size * grow;
    // на уровне пола (без screenY по высоте z) — пыль стелется по земле,
    // а не парит в воздухе, поэтому её глубина в сцене всегда "под танком"
    const alpha = t * 0.4;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.drawImage(getDustSprite(), p.x - r, p.y - r, r * 2, r * 2);
    ctx.globalAlpha = prevAlpha;
  }
  ctx.globalAlpha = 1;
}

export function drawParticles3D(ctx, particles) {
  for (const p of particles) {
    if (p.kind === "dust") continue; // пыль рисуется отдельно, см. drawGroundDust3D
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

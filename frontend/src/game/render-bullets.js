// Рендер снарядов/пуль всех видов оружия (пушка, пулемёт, ракета, снайпер,
// brawler, ultimate, ice).

import { getSprite } from "./sprites.js";
import { shadeColor, screenY } from "./render-utils.js";

// приглушённая, "боевая" палитра снарядов вместо ярко-мультяшной жёлтой:
// пушка — тлеющая медь/латунь, пулемёт — холодная сталь с искрой, ракета —
// тёмный тлеющий огонь с копотью, а не чистый неоновый красный
const BULLET_PALETTE = {
  cannon: { glow: "217, 140, 60", core: ["#ffe9c2", "#d98c3c", "#7a3d12"], stroke: "#3d1f0a" },
  minigun: { glow: "203, 213, 225", core: ["#f8fafc", "#94a3b8", "#475569"], stroke: "#1e293b" },
  // ракета теперь тёмная/чёрная (не медно-красная) — сам корпус снаряда
  // читается как боеприпас, а огонь/цвет несёт отдельный хвост-выхлоп ниже
  rocket: { glow: "234, 88, 12", core: ["#57534e", "#292524", "#0c0a09"], stroke: "#000000" },
  sniper: { glow: "165, 243, 252", core: ["#ecfeff", "#67e8f9", "#155e75"], stroke: "#0e2a35" },
  brawler: { glow: "252, 165, 89", core: ["#fff1e0", "#f59e42", "#7c3a0a"], stroke: "#3d1f0a" },
  ultimate: { glow: "232, 121, 249", core: ["#fdf4ff", "#c026d3", "#4a044e"], stroke: "#2a0930" },
  ice: { glow: "125, 211, 252", core: ["#f0f9ff", "#7dd3fc", "#0369a1"], stroke: "#0c4a6e" },
};

// снаряды с явно вытянутой "пулевидной" формой (не круг) — заострённый нос
// по направлению полёта, скруглённый хвост; пулемётные трассеры остаются
// мелкими точками намеренно (высокая скорострельность, форма не читается)
const SHELL_KINDS = new Set(["cannon", "sniper", "brawler", "ultimate", "rocket", "ice"]);

// какой спрайт пули (bullet<Color>1.png) рисовать на вид снаряда — пак даёт
// только 5 однотонных цветов без формы под конкретное оружие, поэтому выбор
// чисто по смыслу цвета: cannon — самый "тяжёлый" контраст (red), minigun —
// холодная сталь (dark), sniper — уже совпадает с его голубой палитрой
// (blue), brawler — тёплый песочный ближе к его оранжевой палитре (sand).
// ultimate/ice сознательно делят спрайт с sniper/cannon — их узнаваемость
// несёт сильное цветное свечение (glow) и, у ice, дополнительный морозный
// тинт поверх (см. ниже), не сам спрайт. rocket сюда не входит — у неё
// остаётся полностью процедурный корпус, тронутый в этой правке не был.
const BULLET_SPRITE_KIND = {
  cannon: "bulletRed1",
  minigun: "bulletDark1",
  sniper: "bulletBlue1",
  brawler: "bulletSand1",
  ultimate: "bulletRed1",
  ice: "bulletBlue1",
};

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
export function drawGlowSprite(ctx, glowRgb, x, y, radius, alpha) {
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
    : isRocket
    ? Math.max(bullet.size, 13)
    : isCannon
    ? Math.max(bullet.size, 11)
    : Math.max(bullet.size, 8);

  const angle = Math.atan2(bullet.vy ?? 0, bullet.vx ?? 1);

  // хвостовой мазок скорости вдоль направления полёта — читается как "летит
  // быстро и опасно", особенно заметно у утяжелённого пушечного снаряда.
  // Ракета красится собственным огненным выхлопом ниже, этот общий streak
  // ей не нужен (глушил бы более выразительный эффект своим более тусклым мазком).
  if (isShell && !isRocket) {
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

  // огненный хвост-выхлоп ракеты — пользователь явно просил "чёрную ракету,
  // выпускающую огонь": несколько пульсирующих "клубов" пламени вдоль
  // хвоста (не один плоский мазок), яркое ядро выхлопа у сопла + дымная
  // осадка дальше по треку. Рисуется ДО самого корпуса, чтобы корпус лежал
  // поверх собственного пламени (визуально "вылетает" из огня).
  if (isRocket) {
    const backX = -Math.cos(angle);
    const backY = -Math.sin(angle);
    const exhaustLen = r * 3.4;
    const flicker = 0.75 + 0.25 * Math.sin(t * 40 + bullet.x * 0.2);

    // дымная осадка — дальше от сопла, шире и бледнее
    const smokeTailX = bullet.x + backX * exhaustLen * 1.6;
    const smokeTailY = bullet.y + backY * exhaustLen * 1.6;
    const smokeGrad = ctx.createLinearGradient(bullet.x, bullet.y, smokeTailX, smokeTailY);
    smokeGrad.addColorStop(0, "rgba(87, 83, 78, 0.5)");
    smokeGrad.addColorStop(1, "rgba(87, 83, 78, 0)");
    ctx.strokeStyle = smokeGrad;
    ctx.lineWidth = r * 1.3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bullet.x, bullet.y);
    ctx.lineTo(smokeTailX, smokeTailY);
    ctx.stroke();

    // яркое пламя выхлопа — короче дыма, ближе к соплу, с "трепещущей" длиной
    const fireLen = exhaustLen * flicker;
    const fireTailX = bullet.x + backX * fireLen;
    const fireTailY = bullet.y + backY * fireLen;
    const fireGrad = ctx.createLinearGradient(bullet.x, bullet.y, fireTailX, fireTailY);
    fireGrad.addColorStop(0, `rgba(255, 241, 199, ${0.95 * flicker})`);
    fireGrad.addColorStop(0.4, `rgba(251, 146, 60, ${0.8 * flicker})`);
    fireGrad.addColorStop(1, "rgba(234, 88, 12, 0)");
    ctx.strokeStyle = fireGrad;
    ctx.lineWidth = r * 0.85;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bullet.x, bullet.y);
    ctx.lineTo(fireTailX, fireTailY);
    ctx.stroke();

    // 2-3 отдельных клуба огня по бокам хвоста — ломает идеально прямую
    // линию выхлопа, читается как живое пламя, а не статичный градиент.
    // Раньше — 3x ctx.createRadialGradient() на КАЖДУЮ ракету КАЖДЫЙ кадр
    // (плюс 2 линейных градиента дыма/пламени выше = 5 градиентов/ракету/
    // кадр); при нескольких ракетах на экране это заметная нагрузка на GC.
    // Сами клубы — просто радиальное пятно "ярко в центре, прозрачно к
    // краю", тот же паттерн, что уже закэширован в _glowSpriteCache для
    // свечения пуль — переиспользуем его вместо пересоздания градиента.
    for (let i = 0; i < 3; i++) {
      const along = 0.3 + i * 0.28;
      const wobble = Math.sin(t * 24 + i * 2.4 + bullet.x * 0.05) * r * 0.35;
      const px = bullet.x + backX * exhaustLen * along - backY * wobble;
      const py2 = bullet.y + backY * exhaustLen * along + backX * wobble;
      const puffR = r * (0.55 - i * 0.12) * flicker;
      drawGlowSprite(ctx, "253, 186, 116", px, py2, puffR, 0.7 * flicker);
    }
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

  // тело пули теперь везде рисуется спрайтом (isRocket) или готовым PNG
  // (else-ветка ниже) — обе перезаписывают fillStyle перед использованием,
  // так что здесь достаточно line-стиля для контура ракеты (единственный,
  // кто реально вызывает stroke() с этими значениями); createRadialGradient
  // на каждую пулю каждый кадр раньше вычислялся тут и никогда не
  // применялся — чистая трата на самом горячем пути рендера (десятки пуль/кадр)
  ctx.lineWidth = isMinigun ? 1 : isCannon || isUltimate ? 2 : 1.5;
  ctx.strokeStyle = palette.stroke;

  if (isRocket) {
    // корпус ракеты: удлинённый цилиндр с острым носовым конусом и парой
    // стабилизаторов-плавников у хвоста — читается однозначно как ракета,
    // не переиспользованный "снарядный" силуэт других видов пуль
    const bodyLen = r * 2.1;
    const bodyWidth = r * 0.6;
    ctx.save();
    ctx.translate(bullet.x, py);
    ctx.rotate(angle);

    // плавники — тёмный треугольный силуэт по бокам хвоста, рисуются под
    // корпусом (первыми), чтобы корпус лежал поверх их основания
    ctx.fillStyle = shadeColor(palette.core[2], -0.3);
    ctx.beginPath();
    ctx.moveTo(-bodyLen * 0.35, -bodyWidth * 0.6);
    ctx.lineTo(-bodyLen * 0.65, -bodyWidth * 1.6);
    ctx.lineTo(-bodyLen * 0.5, -bodyWidth * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-bodyLen * 0.35, bodyWidth * 0.6);
    ctx.lineTo(-bodyLen * 0.65, bodyWidth * 1.6);
    ctx.lineTo(-bodyLen * 0.5, bodyWidth * 0.5);
    ctx.closePath();
    ctx.fill();

    // основной цилиндрический корпус — прямые борта, не эллипс, плюс острый нос
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.55, 0); // остриё носового конуса
    ctx.lineTo(bodyLen * 0.15, -bodyWidth);
    ctx.lineTo(-bodyLen * 0.5, -bodyWidth);
    ctx.lineTo(-bodyLen * 0.5, bodyWidth);
    ctx.lineTo(bodyLen * 0.15, bodyWidth);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // узкая световая полоса вдоль верхней грани — придаёт цилиндру объём
    // (иначе плоская чёрная заливка сливается в силуэт без формы)
    ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bodyLen * 0.4, -bodyWidth * 0.55);
    ctx.lineTo(-bodyLen * 0.4, -bodyWidth * 0.55);
    ctx.stroke();
    ctx.restore();
  } else {
    // все остальные виды снарядов (раньше — процедурный вытянутый эллипс с
    // заострённым носом или, для minigun, простая заливка круга) теперь
    // рисуются готовым PNG-спрайтом пули (см. BULLET_SPRITE_KIND) — та же
    // идея, что и у стволов/корпуса танка: меньше hand-drawn примитивов
    const spriteName = BULLET_SPRITE_KIND[kind] || "bulletDark1";
    const sprite = getSprite(spriteName);
    const bodyLen = isMinigun ? r * 1.6 : r * (isUltimate ? 2.4 : 2.0);
    ctx.save();
    ctx.translate(bullet.x, py);
    ctx.rotate(angle);
    if (sprite.complete && sprite.naturalWidth > 0) {
      // спрайт нарисован "вверх" (см. drawTank3D) — та же +90° поправка,
      // разворачивает вертикальную пулю вдоль текущей оси X (направление полёта)
      const bodyWidth = bodyLen * (sprite.naturalWidth / sprite.naturalHeight);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(sprite, -bodyWidth / 2, -bodyLen / 2, bodyWidth, bodyLen);
    } else {
      // на случай если спрайт ещё не успел загрузиться — не оставляем пулю
      // невидимой на первых кадрах, простой fallback-кружок в цвете палитры
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = palette.core[1];
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // морозный тинт поверх спрайта у ice — единственный вид, который делит
    // базовый спрайт с другим (sniper/bulletBlue1) и должен отличаться на глаз
    if (kind === "ice") {
      ctx.save();
      ctx.translate(bullet.x, py);
      ctx.fillStyle = "rgba(224, 242, 254, 0.5)";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
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

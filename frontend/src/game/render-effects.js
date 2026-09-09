// Рендер боевых/особых эффектов: пламя, вспышка выстрела, лазер (заряд/
// выстрел/звезда), щит брони, телепорт, портал, предупреждения о бомбе/
// ядерке, взрывы (обычный + ядерный), искры разрушения/попадания по стене,
// искра сквозного (pierce) попадания.

import { getSprite, isSpriteReady } from "./sprites.js";
import { TILT, screenY } from "./render-utils.js";

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

  // мягкое ambient-свечение под спрайтом вспышки — без него резкий край
  // PNG на тёмном фоне читался бы как "наклейка", а не яркая короткая вспышка
  const grad = ctx.createRadialGradient(len * 0.3, 0, 1, len * 0.3, 0, len);
  grad.addColorStop(0, `rgba(255, 237, 199, ${0.7 * strength})`);
  grad.addColorStop(0.5, `rgba(217, 140, 60, ${0.45 * strength})`);
  grad.addColorStop(1, "rgba(217, 140, 60, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(len * 0.3, 0, len, len * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // спрайт вспышки (shotOrange) нарисован "вверх", основанием (точкой) внизу
  // холста — тот же +90° разворот, что и у стволов (см. drawTank3D), плюс
  // сдвиг так, чтобы основание легло точно в дульный срез, а не в его центр
  const sprite = getSprite("shotOrange");
  if (sprite.complete && sprite.naturalWidth > 0) {
    const spriteLen = len * 1.6;
    const spriteW = spriteLen * (sprite.naturalWidth / sprite.naturalHeight);
    ctx.save();
    ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = strength;
    ctx.drawImage(sprite, -spriteW / 2, -spriteLen * 0.15, spriteW, spriteLen);
    ctx.restore();
  }
  ctx.restore();
}

// синхронизировано с MINIBOSS_LASER_WIDTH на сервере
const LASER_WIDTH = 18.0;

export function drawLaserCharge3D(ctx, x, y, angle, progress, range) {
  // телеграф лазера мини-босса: тонкая прицельная линия, растущая по
  // толщине/яркости по мере приближения выстрела — даёт игрокам реальное
  // окно, чтобы уйти с линии огня до того, как ударит полный луч. Длина не
  // константа — сервер шлёт точное расстояние до границы арены под этим
  // углом (см. ray_distance_to_field_edge в map.py)
  const len = range;
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

// синхронизировано с LASER_STAR_WIDTH на сервере
const LASER_STAR_WIDTH = 14.0;

// Лазерная звезда игрока (замена старого пассивного super-баффа) — 8 лучей
// НЕПРЕРЫВНО горят весь LASER_STAR_DURATION, вращаясь на 360° (сервер
// пересчитывает angles каждый тик — здесь только рендер уже готового
// списка). Длина каждого луча приходит в lengths (параллельно angles) — не
// константа, обрезана на сервере точно по границе арены под текущим углом
// (см. ray_distance_to_field_edge в map.py), поэтому луч никогда не вылезает
// за карту независимо от того, где стоял игрок и как далеко успел уехать.
// Переиспользует эстетику лазера босса (яркое ядро + красный ореол), но
// веером из центра танка, а не одной линией.
export function drawLaserStar3D(ctx, x, y, angles, lengths, t) {
  const pulse = 0.75 + 0.25 * Math.sin(t * 14);
  for (let i = 0; i < angles.length; i++) {
    const angle = angles[i];
    const range = lengths[i] ?? 0;
    if (range <= 0) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.strokeStyle = `rgba(239, 68, 68, ${0.45 * pulse})`;
    ctx.lineWidth = LASER_STAR_WIDTH * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(range, 0);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 241, 199, ${0.9 * pulse})`;
    ctx.lineWidth = LASER_STAR_WIDTH * 0.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(range, 0);
    ctx.stroke();

    ctx.restore();
  }

  // яркое ядро-ступица в центре, откуда расходятся все 8 лучей
  const hubGlow = ctx.createRadialGradient(x, y, 0, x, y, 16);
  hubGlow.addColorStop(0, `rgba(255, 241, 199, ${0.85 * pulse})`);
  hubGlow.addColorStop(1, "rgba(239, 68, 68, 0)");
  ctx.fillStyle = hubGlow;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
}

// вспышка подбора брони — объёмная энергетическая сфера, ненадолго
// охватывающая танк целиком (не плоское кольцо-декаль на полу, как
// drawTeleportEffect3D) — читается как формирующийся щит, а не просто
// цветной всплеск. Растёт от центра игрока наружу и гаснет.
export function drawArmorShieldEffect3D(ctx, effect, age) {
  if (age >= 1) return;
  const { x, y } = effect;
  const alpha = 1 - age;
  // сфера сперва быстро раздувается (easeOut), затем держится и гаснет —
  // не линейный рост, иначе расширение читается вяло
  const growth = 1 - Math.pow(1 - Math.min(1, age * 2.2), 3);
  const radius = 14 + growth * 30;

  ctx.save();
  ctx.translate(x, y);

  // полупрозрачная объёмная заливка сферы — радиальный градиент с ярким
  // ободом (энергетическая оболочка ярче в центре толщины стенки, не в ядре)
  const shellGrad = ctx.createRadialGradient(0, 0, radius * 0.55, 0, 0, radius);
  shellGrad.addColorStop(0, "rgba(56, 189, 248, 0)");
  shellGrad.addColorStop(0.75, `rgba(56, 189, 248, ${0.22 * alpha})`);
  shellGrad.addColorStop(1, `rgba(224, 242, 254, ${0.5 * alpha})`);
  ctx.fillStyle = shellGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * TILT, 0, 0, Math.PI * 2);
  ctx.fill();

  // яркий чёткий контур оболочки
  ctx.strokeStyle = `rgba(186, 230, 253, ${0.85 * alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius, radius * TILT, 0, 0, Math.PI * 2);
  ctx.stroke();

  // пара широтных колец поперёк сферы — намёк на объём/3D-глобус, а не
  // плоский диск, без полноценного 3D-каркаса
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.4 * alpha})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.7, radius * TILT * 0.35, 0, 0, Math.PI * 2);
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

// синхронизировано с PORTAL_SIZE на сервере
const PORTAL_RADIUS = 22.0;

// Портал — стоячий вертикальный овал с вращающейся спиралью внутри и
// неоновой зелёно-жёлтой рамкой (характерный "Рик и Морти" стиль), а не
// плоская декаль на полу — это проём, через который танк проезжает.
export function drawPortal3D(ctx, portal, t) {
  const z = 0;
  const py = screenY(portal.y, z);
  // амплитуда пульсации была слишком заметной (±30% размера, портал явно
  // "сжимался/разжимался") — уменьшена до лёгкого дыхания, не мешающего
  // оценить реальный размер зоны срабатывания на глаз
  const pulse = 0.92 + 0.08 * Math.sin(t * 3 + portal.x * 0.02);
  const rx = PORTAL_RADIUS * pulse;
  const ry = PORTAL_RADIUS * 1.4 * pulse; // вытянут по вертикали — стоячий проём, не лужа на полу

  // тень на полу под порталом
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(portal.x, portal.y, rx * 0.8, rx * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  // внешнее свечение — неоновый зелёный ореол, видимый издалека
  const glow = ctx.createRadialGradient(portal.x, py, 2, portal.x, py, rx * 2.6);
  glow.addColorStop(0, "rgba(74, 222, 128, 0.45)");
  glow.addColorStop(1, "rgba(74, 222, 128, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(portal.x, py, rx * 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(portal.x, py);

  // само "жерло" портала — тёмно-изумрудный овал
  const bodyGrad = ctx.createRadialGradient(-rx * 0.2, -ry * 0.2, 1, 0, 0, rx);
  bodyGrad.addColorStop(0, "#0f2e1a");
  bodyGrad.addColorStop(1, "#022c14");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // спираль внутри — несколько вращающихся дуг разной яркости, классический
  // "портальный" вихрь вместо статичного кольца
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const spinBase = t * 2.4;
  for (let i = 0; i < 3; i++) {
    const spinAngle = spinBase + (i / 3) * Math.PI * 2;
    const arcR = rx * (0.35 + i * 0.28);
    ctx.strokeStyle = i % 2 === 0 ? "rgba(134, 239, 172, 0.8)" : "rgba(74, 222, 128, 0.55)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, arcR, arcR * (ry / rx), spinAngle, 0, Math.PI * 1.3);
    ctx.stroke();
  }
  ctx.restore();

  // неоновая рамка — двойной контур (насыщенный зелёный снаружи, бледно-жёлтый внутри)
  ctx.strokeStyle = `rgba(21, 128, 61, ${0.9})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = `rgba(190, 242, 100, ${0.55 + 0.25 * pulse})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx * 0.88, ry * 0.88, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
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

  // третье, вращающееся кольцо-периметр — сканирующий "лазерный" контур,
  // ускоряется по мере приближения детонации, усиливает ощущение отсчёта
  const spinAngle = t * (2 + nuke.warning_progress * 6);
  ctx.strokeStyle = `rgba(248, 113, 113, ${0.6 + pulse * 0.3})`;
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const a0 = spinAngle + (i / 4) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(nuke.x, nuke.y, radius * 0.82, a0, a0 + 0.4);
    ctx.stroke();
  }

  // энергетические разряды от центра к краю зоны — раньше рисовались вручную
  // ломаной линией (сегменты + случайный джиттер), читалось как самопальная
  // геометрия, а не игровой эффект. Заменено на готовый спрайт вспышки
  // (shotThin.png — узкий жёлтый луч из того же CC0-пака) повёрнутый и
  // растянутый по длине — учащаются и становятся ярче ближе к детонации,
  // как нарастающее энергетическое давление, тот же смысл эффекта.
  const boltCount = 3 + Math.floor(nuke.warning_progress * 5);
  const boltSprite = getSprite("shotThin");
  if (isSpriteReady(boltSprite)) {
    const boltAspect = boltSprite.naturalWidth / boltSprite.naturalHeight;
    for (let i = 0; i < boltCount; i++) {
      const seed = i * 37.13 + Math.floor(t * (4 + nuke.warning_progress * 10));
      const a = (Math.sin(seed) * 0.5 + 0.5) * Math.PI * 2;
      const boltLen = radius * (0.4 + 0.5 * (Math.sin(seed * 1.7) * 0.5 + 0.5));
      const boltWidth = Math.max(4, boltLen * boltAspect * 0.12);
      ctx.save();
      ctx.translate(nuke.x, nuke.y);
      ctx.rotate(a + Math.PI / 2);
      ctx.globalAlpha = 0.5 + fastPulse * 0.4;
      ctx.drawImage(boltSprite, -boltWidth / 2, 0, boltWidth, boltLen);
      ctx.restore();
    }
  }

  // тлеющее ядро в центре — тот же спрайт-кадр вспышки (explosion1..5.png),
  // что и у обычных взрывов ниже, а не изолированный процедурный примитив:
  // растущий номер кадра по мере приближения детонации читается как
  // "нарастающая нестабильность" (корона становится всё более рваной), плюс
  // спрайт медленно вращается — простой радиационный трилистник раньше не
  // давал ощущения текстуры/энергии, только геометрический символ
  const coreFrame = Math.min(EXPLOSION_FRAME_COUNT - 1, Math.floor(nuke.warning_progress * EXPLOSION_FRAME_COUNT));
  const coreSprite = getSprite(`explosion${coreFrame + 1}`);
  const coreSize = 26 + nuke.warning_progress * 20 + fastPulse * 6;
  ctx.save();
  ctx.translate(nuke.x, nuke.y);
  ctx.rotate(t * 1.4);
  ctx.globalAlpha = 0.55 + fastPulse * 0.35;
  if (isSpriteReady(coreSprite)) {
    ctx.drawImage(coreSprite, -coreSize / 2, -coreSize / 2, coreSize, coreSize);
  }
  ctx.restore();

  // мигающий "радиационный трилистник" поверх спрайтового ядра — раньше три
  // лепестка рисовались вручную дугами (ctx.arc), теперь три экземпляра
  // готового спрайта вспышки (shotOrange.png) под тем же углом 120°, что и
  // раньше — силуэт трилистника сохранён (единственный однозначно
  // узнаваемый "это ядерка" элемент), но каждый лепесток теперь настоящий
  // спрайт, не нарисованная от руки геометрия
  const blinkSpeed = 3 + nuke.warning_progress * 14;
  const blink = Math.sin(t * blinkSpeed) > 0;
  const radSprite = getSprite("shotOrange");
  if (blink && isSpriteReady(radSprite)) {
    const petalH = 22;
    const petalW = petalH * (radSprite.naturalWidth / radSprite.naturalHeight);
    ctx.save();
    ctx.translate(nuke.x, nuke.y);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i / 3) * Math.PI * 2);
      ctx.drawImage(radSprite, -petalW / 2, -petalH - 4, petalW, petalH);
      ctx.restore();
    }
    ctx.fillStyle = "#7f1d1d";
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Экранная (не мировая!) часть предупреждения — тревожная кромка по краям
// ВСЕГО экрана, усиливающаяся по мере приближения взрыва. Рисуется отдельной
// функцией, вызываемой ПОСЛЕ ctx.restore() в GameCanvas.jsx (тем же способом,
// что и существующая красная виньетка урона hitFlash) — если вызвать её
// внутри мирового save()/translate(shakeX, shakeY) блока вместе с
// drawNukeWarning3D, виньетка дрожала бы вместе со screen-shake и съезжала
// с реальных краёв экрана, а не оставалась приклеенной к границе вьюпорта.
// Игрок может быть далеко от эпицентра (ядерка триггерится глобально по всей
// карте) — эта кромка единственный сигнал для того, кто ещё не видит кольца
// в мировых координатах, что "весь экран должен успеть увидеть и разбежаться".
export function drawNukeScreenWarning3D(ctx, nuke, t, canvasWidth, canvasHeight) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  // едва заметно на старте предупреждения, отчётливо тревожно ближе к взрыву —
  // не должна мешать читать поле боя первые секунды после спавна ядерки
  const intensity = Math.max(0, nuke.warning_progress - 0.15) / 0.85;
  if (intensity <= 0) return;

  const vignette = ctx.createRadialGradient(
    canvasWidth / 2,
    canvasHeight / 2,
    Math.min(canvasWidth, canvasHeight) * 0.38,
    canvasWidth / 2,
    canvasHeight / 2,
    Math.max(canvasWidth, canvasHeight) * 0.58
  );
  const alpha = intensity * (0.28 + pulse * 0.22);
  vignette.addColorStop(0, "rgba(239, 68, 68, 0)");
  vignette.addColorStop(1, `rgba(239, 68, 68, ${alpha})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

// 5 последовательных PNG-кадров (explosion1..5.png) вместо процедурного
// radial-gradient всплеска — Kenney-набор уже даёт настоящую форму вспышки
// (звезда-корона на пике → рассыпающиеся угли-шарики к концу), кадры не
// нужно смешивать/интерполировать, просто показывать по очереди по age
const EXPLOSION_FRAME_COUNT = 5;

export function drawExplosion3D(ctx, explosion, age) {
  // age: 0..1, прогресс расширения ударной волны после взрыва
  if (age >= 1) return;
  const radius = explosion.radius * (0.3 + age * 0.9);
  const alpha = 1 - age;
  const frame = Math.min(EXPLOSION_FRAME_COUNT - 1, Math.floor(age * EXPLOSION_FRAME_COUNT));
  const sprite = getSprite(`explosion${frame + 1}`);

  // мягкое ambient-свечение под спрайтом — усиливает читаемость на светлом
  // полу/стенах, спрайт сам по себе не даёт глобального засвета сцены
  const glow = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, radius);
  glow.addColorStop(0, `rgba(255, 233, 194, ${0.5 * alpha})`);
  glow.addColorStop(0.6, `rgba(217, 140, 60, ${0.3 * alpha})`);
  glow.addColorStop(1, "rgba(217, 140, 60, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
  ctx.fill();

  if (sprite.complete && sprite.naturalWidth > 0) {
    const size = radius * 2.2; // спрайт с полями внутри canvas — чуть крупнее radius, чтобы корона не обрезалась
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, explosion.x - size / 2, explosion.y - size / 2, size, size);
    ctx.restore();
  }
}

export function drawNukeExplosion3D(ctx, explosion, age) {
  // взрыв ядерки — отдельный от обычного drawExplosion3D эффект "гриба":
  // расширяющаяся ударная волна по земле + поднимающееся облако-шапка со
  // смещением вверх (через screenY), заметно масштабнее и дольше живёт,
  // чем взрыв ракеты/бомбы. Дополнено: начальная белая вспышка детонации,
  // огненное кольцо у основания столба, вторичные обломки/куски земли по
  // орбите ударной волны — читается заметно катастрофичнее и опаснее.
  if (age >= 1) return;
  const alpha = 1 - age;
  const groundRadius = explosion.radius * (0.35 + age * 0.85);

  // ослепляющая вспышка детонации — доля секунды в самом начале, ярче и
  // шире всего остального; единственный момент, где взрыв реально "бьёт по глазам"
  if (age < 0.12) {
    const flashAlpha = 1 - age / 0.12;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.9 * flashAlpha})`;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, groundRadius * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

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

  // второе, более тонкое кольцо чуть позади фронта волны — читается как
  // вторичная ударная волна/остаточное давление, добавляет ощущение массы взрыва
  if (age > 0.1) {
    const echoRadius = groundRadius * 0.7;
    ctx.strokeStyle = `rgba(255, 200, 120, ${0.35 * alpha})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, echoRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // обломки/куски вырванной земли, разлетающиеся по орбите ударной волны —
  // мелкие тёмные силуэты на переменном расстоянии, вращаются вокруг эпицентра
  const debrisCount = 14;
  for (let i = 0; i < debrisCount; i++) {
    const a = (i / debrisCount) * Math.PI * 2 + i * 0.7;
    const dist = groundRadius * (0.55 + 0.4 * ((i % 3) / 2));
    const dx = explosion.x + Math.cos(a) * dist;
    const dy = explosion.y + Math.sin(a) * dist * 0.55;
    const size = 3 + (i % 4);
    ctx.fillStyle = `rgba(41, 37, 36, ${0.6 * alpha})`;
    ctx.beginPath();
    ctx.arc(dx, dy, size, 0, Math.PI * 2);
    ctx.fill();
  }

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

  // огненное ядро у основания столба — раскалённое, ещё не остывшее в
  // клубящуюся пыль (в отличие от серой шапки/ножки выше). Раньше был один
  // плоский radial-gradient блин; теперь под тем же ambient-свечением лежат
  // 3 наложенных sprite-кадра explosion (те же PNG, что и у drawExplosion3D,
  // см. EXPLOSION_FRAME_COUNT) под разными углами и масштабами — даёт
  // настоящую рваную "корону" пламени вместо идеально круглого градиента,
  // читается заметно текстурнее и ближе к формату остальных взрывов в игре
  if (age < 0.55) {
    const fireAlpha = (1 - age / 0.55) * alpha;
    const fireR = explosion.radius * (0.22 + age * 0.3);
    const fireGrad = ctx.createRadialGradient(explosion.x, explosion.y, 0, explosion.x, explosion.y, fireR);
    fireGrad.addColorStop(0, `rgba(255, 214, 140, ${0.8 * fireAlpha})`);
    fireGrad.addColorStop(0.5, `rgba(234, 88, 12, ${0.55 * fireAlpha})`);
    fireGrad.addColorStop(1, "rgba(234, 88, 12, 0)");
    ctx.fillStyle = fireGrad;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, fireR, 0, Math.PI * 2);
    ctx.fill();

    const fireFrame = Math.min(EXPLOSION_FRAME_COUNT - 1, Math.floor((age / 0.55) * EXPLOSION_FRAME_COUNT));
    const fireSprite = getSprite(`explosion${fireFrame + 1}`);
    if (isSpriteReady(fireSprite)) {
      ctx.save();
      ctx.globalAlpha = fireAlpha;
      const layers = [
        { scale: 1, rot: 0 },
        { scale: 0.75, rot: Math.PI / 3 },
        { scale: 0.55, rot: -Math.PI / 4 },
      ];
      for (const layer of layers) {
        const size = fireR * 2.6 * layer.scale;
        ctx.save();
        ctx.translate(explosion.x, explosion.y);
        ctx.rotate(layer.rot);
        ctx.drawImage(fireSprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.restore();
    }
  }

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

  // клубящиеся выступы по краю шапки — несколько дополнительных облачных
  // "бугров" вдоль контура, разбивают идеально гладкий эллипс на более
  // органичную, турбулентную форму настоящего грибовидного облака
  const lobeCount = 6;
  for (let i = 0; i < lobeCount; i++) {
    const a = (i / lobeCount) * Math.PI * 2;
    const lobeDist = capRadius * 0.85;
    const lx = explosion.x + Math.cos(a) * lobeDist;
    const ly = capY + Math.sin(a) * lobeDist * 0.7;
    const lobeR = capRadius * (0.22 + 0.08 * (i % 2));
    ctx.fillStyle = `rgba(140, 133, 128, ${0.4 * alpha})`;
    ctx.beginPath();
    ctx.arc(lx, ly, lobeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

// разлетающиеся обломки при разрушении стены — раньше 8 прямых линий-щепок,
// нарисованных вручную (ctx.moveTo/lineTo по кругу), читалось как схематичная
// геометрия, а не реальный обвал. Destructible-стены в игре текстурированы
// мешками с песком (sandbagBeige, см. render-terrain.js) — при разрушении
// логично разлетаются РАЗОРВАННЫЕ мешки того же материала (sandbagBeige_open,
// тот же CC0-пак), а не абстрактные щепки постороннего материала.
const WALL_BREAK_SHARD_SPRITE = "sandbagBeige_open";

export function drawWallBreakEffect3D(ctx, effect, age) {
  // age: 0..1, вспышка пыли/обломков в момент разрушения стены (отдельно от
  // drawExplosion3D — это не взрыв оружия, а обвал баррикады)
  if (age >= 1) return;
  const alpha = 1 - age;
  const radius = 40 + age * 50;

  ctx.fillStyle = `rgba(148, 163, 184, ${0.35 * alpha})`;
  ctx.beginPath();
  ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
  ctx.fill();

  const shardSprite = getSprite(WALL_BREAK_SHARD_SPRITE);
  const shardCount = 6;
  if (isSpriteReady(shardSprite)) {
    const shardAspect = shardSprite.naturalWidth / shardSprite.naturalHeight;
    for (let i = 0; i < shardCount; i++) {
      // фиксированный псевдослучайный угол/скорость разлёта на осколок
      // (детерминированный seed по индексу — не Math.random, чтобы кадр не
      // "дрожал" пересчётом на каждый вызов)
      const seed = i * 12.9;
      const a = (i / shardCount) * Math.PI * 2 + (Math.sin(seed) * 0.4);
      const dist = (15 + age * 40) * (0.8 + Math.sin(seed * 1.7) * 0.3);
      const sx = effect.x + Math.cos(a) * dist;
      const sy = effect.y + Math.sin(a) * dist * 0.6;
      const shardH = 14 * (1 - age * 0.3);
      const shardW = shardH * shardAspect;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a + age * 4); // осколок кувыркается по мере полёта
      ctx.globalAlpha = alpha;
      ctx.drawImage(shardSprite, -shardW / 2, -shardH / 2, shardW, shardH);
      ctx.restore();
    }
    return;
  }

  // спрайт ещё не декодирован — фолбэк на прежние линии-щепки, не блокируем
  // рендер (тот же silent pop-in, что и везде в файле)
  ctx.strokeStyle = `rgba(71, 85, 105, ${0.7 * alpha})`;
  ctx.lineWidth = 3;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
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

// Момент попадания сквозной (pierce) пули снайпера — раньше пуля пролетала
// цель без ЛЮБОГО визуального отклика (в отличие от обычных пуль, которые
// гаснут при ударе), из-за чего попадание читалось как промах, хотя урон
// проходил. Короткая яркая искра НЕ останавливает полёт снаряда — только
// отмечает точку контакта. Лёгкая (не большой взрыв) — срабатывает на КАЖДОЙ
// пробитой цели одного выстрела, не должна перегружать экран при частой стрельбе.
export function drawPierceHitSpark3D(ctx, hit, age) {
  if (age >= 1) return;
  const alpha = 1 - age;
  const r = 4 + age * 8;
  const glow = ctx.createRadialGradient(hit.x, hit.y, 0, hit.x, hit.y, r * 1.8);
  glow.addColorStop(0, `rgba(165, 243, 252, ${0.9 * alpha})`);
  glow.addColorStop(1, "rgba(103, 232, 249, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(hit.x, hit.y, r * 1.8, 0, Math.PI * 2);
  ctx.fill();

  // короткие лучики-искры в стороны — читается как "пробитие", а не просто вспышка
  ctx.strokeStyle = `rgba(236, 254, 255, ${0.85 * alpha})`;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + age * 2;
    ctx.beginPath();
    ctx.moveTo(hit.x, hit.y);
    ctx.lineTo(hit.x + Math.cos(a) * r, hit.y + Math.sin(a) * r);
    ctx.stroke();
  }
}

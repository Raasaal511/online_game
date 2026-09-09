// Рендер подбираемых предметов (пикапов) и ловушек-шипов.

import { drawIcon } from "./icons.js";
import { shadeColor, screenY } from "./render-utils.js";

export function drawPickup3D(ctx, pickup, colors, t) {
  // левитация: выше амплитуда и более плавная (медленнее) волна читаются
  // как настоящее парение объекта в воздухе, а не мелкое дрожание на месте
  const bobPhase = t * 1.8 + pickup.x * 0.05;
  const bob = Math.sin(bobPhase) * 8;
  const z = 18 + bob;
  const shadowScale = 1 - z / 60;
  const isSuper = pickup.kind === "super";
  // фолбэк-цвет обязан быть 6-значным hex — ниже он используется как
  // `${color}55`/`${color}00` (добавление alpha-суффикса к RRGGBB), а
  // 3-значный "#fff" в таком виде даёт невалидную строку "#fff55" (5 символов
  // после #, не парсится как цвет) и рушит весь дальнейший рендер пикапа
  const color = colors[pickup.kind] || "#ffffff";

  // тень на полу дышит в противофазе высоте — чем выше объект, тем меньше
  // и бледнее тень, тем сильнее ощущение реального отрыва от земли
  const shadowLift = 0.5 + 0.5 * Math.sin(bobPhase);
  const shadowAlpha = 0.4 - shadowLift * 0.18;
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.beginPath();
  ctx.ellipse(pickup.x, pickup.y, 9 * shadowScale, 4 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const py = screenY(pickup.y, z);

  // ambient-свечение под капсулой — читается издалека как "здесь лут",
  // раньше единственным сигналом был сам маленький кружок вблизи
  const pulse = 0.5 + 0.5 * Math.sin(t * (isSuper ? 5 : 3.2));
  const glowR = (isSuper ? 22 : 16) + pulse * (isSuper ? 4 : 2.5);
  const glow = ctx.createRadialGradient(pickup.x, py, 2, pickup.x, py, glowR);
  glow.addColorStop(0, `${color}55`);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(pickup.x, py, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(pickup.x, py);

  // лёгкое покачивание из стороны в сторону в такт вертикальной волне —
  // парящий объект не просто едет по прямой вверх-вниз, а слегка "плывёт"
  const swayAngle = Math.sin(bobPhase * 0.5) * 0.12;
  ctx.rotate(swayAngle);

  // настоящая вращающаяся сфера, а не сплющивающийся в линию эллипс — раньше
  // на пол-оборота (squash≈0) капсула схлопывалась в почти невидимую полоску
  // и иконка целиком пропадала на половину цикла, что читалось как баг
  // ("плоский шар, иконка пропадает"), а не как убедительное вращение.
  // Радиус тела всегда полный; вращение показано смещением блика/терминатора
  // света по поверхности (как у реальной вращающейся сферы), не искажением формы.
  const spin = t * 2.2 + pickup.x * 0.01;
  const radius = isSuper ? 16 : 13;
  const highlightX = Math.cos(spin) * radius * 0.5;
  const highlightY = Math.sin(spin * 0.7) * radius * 0.35 - radius * 0.3;

  // супер-пикап красится в классический янтарно-оранжевый Dragon Ball —
  // независимо от общего "super"-цвета из PICKUP_COLORS (тот остаётся
  // розовым для UI/бейджей), здесь это единственное узнаваемое отличие.
  // Настоящий шар — глянцевый и ЯРКИЙ (насыщенный оранжевый почти без
  // затемнения к краю, резкий крупный белый блик), не тускло-затенённая
  // сфера — прошлая версия была заметно бледнее эталона.
  const sphereColor = isSuper ? "#ff9012" : color;

  const grad = ctx.createRadialGradient(highlightX, highlightY, 1, 0, 0, radius);
  if (isSuper) {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.22, "#ffcf7a");
    grad.addColorStop(0.55, sphereColor);
    grad.addColorStop(1, shadeColor(sphereColor, -0.1));
  } else {
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.3, sphereColor);
    grad.addColorStop(0.75, shadeColor(sphereColor, -0.2));
    grad.addColorStop(1, shadeColor(sphereColor, -0.5));
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = isSuper ? "rgba(255, 214, 128, 0.7)" : "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // терминатор (граница света/тени) — у супер-шара заметно слабее, чем у
  // обычных пикапов: настоящий Dragon Ball читается как ровно освещённый
  // глянцевый шар, не затемнённый наполовину
  const termAngle = spin + Math.PI;
  ctx.save();
  ctx.clip(new Path2D(`M ${-radius} 0 A ${radius} ${radius} 0 1 1 ${radius} 0.001 Z`));
  ctx.fillStyle = isSuper ? "rgba(120, 50, 0, 0.16)" : "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(Math.cos(termAngle) * radius * 0.6, 0, radius * 0.55, radius, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (isSuper) {
    // классическая 7-звезда Dragon Ball: 1 звезда строго в центре + кольцо
    // из 6 звёзд ближе к краю сферы (как на настоящем шаре) — раньше кольцо
    // спутников было почти на том же расстоянии от центра, что и радиус
    // самой центральной звезды, из-за чего все 7 звёзд сливались в одно
    // мутное красное пятно вместо 7 читаемых отдельных звёзд. Дистанция
    // кольца увеличена так, чтобы каждая звезда была видна целиком и не
    // перекрывала соседей (проверено измерением радиусов друг относительно
    // друга, не на глаз).
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.clip();

    const centerStarR = radius * 0.22;
    const satelliteStarR = radius * 0.19;
    drawDragonStar(ctx, 0, 0, centerStarR);

    const ringDist = radius * 0.56; // >= centerStarR + satelliteStarR, чтобы не наезжать на центр
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const sx = Math.cos(a) * ringDist;
      const sy = Math.sin(a) * ringDist * 0.82; // лёгкое сплющивание под сферическую перспективу
      drawDragonStar(ctx, sx, sy, satelliteStarR);
    }
    ctx.restore();
  } else {
    // иконка всегда видна (не пропадает) — чуть "плавает" по поверхности
    // вслед за вращением, создавая ощущение объекта на 3D-сфере, а не наклейки
    ctx.save();
    ctx.translate(Math.sin(spin) * radius * 0.12, 0);
    drawIcon(ctx, pickup.kind, "#0f172a", radius / 12);
    ctx.restore();
  }

  ctx.restore();
}

// звезда в стиле Dragon Ball — 4 остроконечных луча (не 5-конечная
// "стандартная" звезда), ярко-красная заливка с толстой тёмной обводкой,
// маленький блик у центра. Рисуется как самостоятельный неподвижный
// элемент — в оригинале звёзды на шарах не крутятся отдельно от шара.
function drawDragonStar(ctx, cx, cy, r) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(r * 0.22, -r * 0.22, r, 0);
  ctx.quadraticCurveTo(r * 0.22, r * 0.22, 0, r);
  ctx.quadraticCurveTo(-r * 0.22, r * 0.22, -r, 0);
  ctx.quadraticCurveTo(-r * 0.22, -r * 0.22, 0, -r);
  ctx.closePath();
  ctx.fillStyle = "#dc2626";
  ctx.fill();
  ctx.strokeStyle = "#450a0a";
  ctx.lineWidth = Math.max(0.6, r * 0.12);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(-r * 0.12, -r * 0.12, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
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

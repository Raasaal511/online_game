// Псевдо-3D рендер поверх Canvas2D: наклон "камеры", объёмные грани у танков/стен,
// парящие дропы и тени на полу. Игровые координаты (x, y) остаются 2D-полем истины
// с сервера — здесь только визуальная проекция и слой глубины (z) для отрисовки.

import { drawIcon } from "./icons.js";
import { getSprite, isSpriteReady } from "./sprites.js";

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

function shortestAngleDiff(a, b) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// сглаженный угол корпуса (не башни): playerId -> {angle, lastT}. Раньше
// (первая интеграция спрайтов) корпус был жёстко axis-aligned — не крутился
// вообще, только башня. Теперь корпус плавно доворачивается к текущему
// направлению движения (moveAngle), но с ограничением на скорость поворота —
// резкий мгновенный разворот на полный угол курса выглядел бы дёрганым при
// каждой смене направления; плавное подруливание читается естественнее и не
// путает с прицелом (тем, куда целится башня — она поворачивается отдельно
// и мгновенно, как и раньше).
const _bodyRotationState = new Map();
const BODY_ROTATION_SPEED = 8; // 1/сек, скорость сглаживания угла корпуса к moveAngle

function computeBodySpriteAngle(playerId, moveAngle, t) {
  // спрайт по умолчанию рисуется "лицом вверх" — в системе отсчёта спрайта
  // это соответствует нулевому повороту; moveAngle уже в игровых координатах
  // (0 = вправо), а спрайт после +90° фикса (см. ниже, у поворота башни) тоже
  // смотрит "вправо" при повороте на 0 — тот же принцип применяем к корпусу.
  if (moveAngle == null || t == null) {
    _bodyRotationState.delete(playerId);
    return 0;
  }
  const prev = _bodyRotationState.get(playerId);
  if (!prev) {
    _bodyRotationState.set(playerId, { angle: moveAngle, lastT: t });
    return moveAngle;
  }
  const dt = Math.max(0, Math.min(0.1, t - prev.lastT));
  const smoothing = 1 - Math.exp(-BODY_ROTATION_SPEED * dt);
  const angle = prev.angle + shortestAngleDiff(prev.angle, moveAngle) * smoothing;
  prev.angle = angle;
  prev.lastT = t;
  return angle;
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
// (backend/app/game/entities.py). Раньше это была палитра для процедурной
// заливки ствола; теперь спрайты стволов даны только в фиксированных цветах
// Kenney-пака (green/blue/red/dark/sand), поэтому скин выбирает, КАКОЙ
// цветной спрайт ствола рисовать — ближайший по ощущению аналог исходного
// цвета скина, а не точное совпадение hex.
// экспортируется (не только используется внутри модуля) — меню выбора скина
// (NicknameForm.jsx) рисует те же спрайты стволов в превью-свотчах, что и
// реальная игра здесь: единый источник соответствия skin -> цвет спрайта,
// вместо дублирования этой таблицы во втором месте кодовой базы
export const GUN_SKIN_SPRITE_COLOR = {
  steel: "Dark",
  crimson: "Red",
  gold: "Sand",
  toxic: "Green",
  azure: "Blue",
};

const WEAPON_BADGE_COLORS = {
  minigun: "#94a3b8",
  flamethrower: "#d9772f",
  rocket: "#c24228",
  ice: "#7dd3fc",
};

// временный оверлей-тинт ствола, пока действует подобранное с карты оружие —
// раньше был цветовой рескин процедурной заливки, теперь спрайт ствола
// зафиксирован (см. GUN_SKIN_SPRITE_COLOR), поэтому "неродной" вид даёт
// полупрозрачное свечение поверх спрайта тем же приёмом, что и раньше
// (обугленный/промёрзший/дымный оттенок), просто другим механизмом
const PICKUP_BARREL_TINT = {
  flamethrower: "rgba(251, 146, 60, 0.55)",
  ice: "rgba(125, 211, 252, 0.55)",
  rocket: "rgba(41, 37, 36, 0.6)",
};

// натуральные пиксельные размеры спрайтов корпуса — ширина/высота заметно
// отличаются (76x72 у green, 96x96 у bigRed), поэтому drawImage масштабирует
// по большей стороне (height), чтобы tankSize однозначно определял "рост"
// танка вдоль ствола, а не растягивал спрайт непропорционально
const TANK_BODY_SPRITE_DIMS = {
  green: { w: 76, h: 72 },
  blue: { w: 76, h: 76 },
  bigRed: { w: 96, h: 96 },
};

// натуральные пиксельные размеры спрайтов стволов — все на холсте 52px в
// высоту (расстояние от опорной точки башни до дульного среза одинаковое
// visually для muzzle-flash позиционирования), различается только видимая
// толщина/форма (см. BARREL_SPRITE_LEN ниже и подбор по классам)
// экспортирован для NicknameForm.jsx — класс-иконки в меню масштабируют тот
// же спрайт по его реальному аспекту, не квадратом
export const BARREL_SPRITE_DIMS = {
  1: { w: 24, h: 52 },
  2: { w: 16, h: 52 },
  3: { w: 16, h: 52 },
};

// какой вариант ствола (1/2/3 из Kenney-пака) рисовать на каждый класс.
// Проверено попиксельно (не на глаз): у всех трёх спрайтов холст 52px, но
// граница "тонкий ствол → широкое основание" проходит на разной высоте —
// barrel1: тонкая часть 0-32px, ШИРОКАЯ (16px); barrel2: тонкая часть тоже
// 0-32px, но узкая (8px); barrel3: тонкая часть всего 0-12px, дальше сразу
// массивное основание. Итого barrel2 — самый длинный и тонкий ствол (→
// снайпер, дальний бой), barrel1 — такой же длины, но вдвое толще (→
// brawler, ближний бой читается как "тяжелее"), barrel3 — самый короткий и
// приземистый, с которым спутать не с чем (→ gunner, оставшийся вариант)
// экспортирован — используется и в NicknameForm.jsx (класс-иконки в меню
// рисуются тем же реальным спрайтом ствола, что игрок увидит в бою, вместо
// абстрактной SVG-пиктограммы, которая не читалась однозначно как "оружие")
export const CLASS_BARREL_VARIANT = {
  sniper: 2,
  brawler: 1,
  gunner: 3,
};

// мини-босс красится в tankRed_barrel1 — тот же "толстый и длинный" вариант,
// что у brawler (не самый длинный тонкий, но самый массивный на вид среди
// трёх), плюс рисуется парой (см. drawTank3D) — вместе это должно читаться
// как более тяжёлое и опасное орудие, чем у любого игрока, без спрайта под
// специальный "босс-ствол", которого в паке просто нет
const MINIBOSS_BARREL_VARIANT = 1;

// экранная высота объекта с данной игровой высотой z (0 = на полу)
export function screenY(y, z = 0) {
  return y - z * TILT;
}

// составной тайл пола из двух вариантов травы (128px каждый, см. Kenney-пак) —
// собирается ОДИН раз в оффскрин-canvas 256x256 (2x2, варианты вперемешку по
// диагонали), а не просто ctx.createPattern(tileGrass1) в одиночку: один
// повторяющийся 128px-тайл на карте 1760x1140 даёт заметный "тираж" — глаз
// быстро цепляет идентичные квадраты; смешение двух едва различимых вариантов
// в шахматном порядке ломает эту периодичность почти бесплатно (тот же приём,
// что и предрендер glow-спрайта пули — дорогая подготовка один раз, потом
// только дешёвое повторение готовой текстуры)
let _floorPattern = null; // CanvasPattern, кэшируется по первому успешному созданию
let _floorPatternCtx = null; // ctx, для которого создан паттерн (Pattern непереносим между context)

function getFloorPattern(ctx) {
  if (_floorPattern && _floorPatternCtx === ctx) return _floorPattern;

  const grass1 = getSprite("tileGrass1");
  const grass2 = getSprite("tileGrass2");
  // createPattern требует уже декодированное изображение-источник — если
  // спрайты ещё не загрузились, откладываем создание паттерна до следующего
  // кадра (см. фолбэк-заливку в drawFloor ниже), не кэшируем "пустой" результат
  if (!isSpriteReady(grass1) || !isSpriteReady(grass2)) return null;

  const tileSize = grass1.naturalWidth || 128;
  const composite = document.createElement("canvas");
  composite.width = tileSize * 2;
  composite.height = tileSize * 2;
  const cctx = composite.getContext("2d");
  cctx.drawImage(grass1, 0, 0, tileSize, tileSize);
  cctx.drawImage(grass2, tileSize, 0, tileSize, tileSize);
  cctx.drawImage(grass2, 0, tileSize, tileSize, tileSize);
  cctx.drawImage(grass1, tileSize, tileSize, tileSize, tileSize);

  // Kenney-текстура сама по себе — яркая аркадная лужайка (насыщенный
  // чистый зелёный), а вся остальная сцена (стены, танки, виньетка) в тёмной
  // военной палитре — прямое наложение спрайта смотрелось резким пятном
  // "мультяшного газона" посреди мрачной сцены. "multiply" с тёмно-оливковым
  // тоном притемняет и обесцвечивает тайл ДО совпадения с фоновым градиентом
  // (#232b24), сохраняя при этом собственный узор травы (не плоская заливка).
  cctx.globalCompositeOperation = "multiply";
  cctx.fillStyle = "#3d4a3a";
  cctx.fillRect(0, 0, composite.width, composite.height);
  cctx.globalCompositeOperation = "source-over";

  _floorPattern = ctx.createPattern(composite, "repeat");
  _floorPatternCtx = ctx;
  return _floorPattern;
}

export function drawFloor(ctx, width, height) {
  // приглушённая, чуть желчно-зелёная сталь вместо чистого сине-серого —
  // читается более "военно", как бетонный полигон, а не аркадный неон.
  // Заметно светлее прежнего (было #171d18..#0b0e12) — яма (почти чёрная,
  // #050505) на старом тёмном полу читалась слабо, не выделялась как
  // отдельная опасная зона; теперь контраст пол/яма однозначный на глаз.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#232b24");
  grad.addColorStop(1, "#161c1a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // тайловая текстура поверх градиента-фолбэка — сам градиент остаётся под
  // ней навсегда (не только пока спрайт грузится): тайл полупрозрачен по
  // альфе сцены не нужен, но чуть темнее к низу карты градиент всё ещё даёт
  // глубину, которую плоский тайл сам по себе не несёт
  const pattern = getFloorPattern(ctx);
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
  }
  // пока спрайты не декодированы — просто остаётся градиентная заливка выше,
  // тайл "проявится" через несколько кадров тем же способом, что и любой
  // другой спрайт в этой кодовой базе (см. sprites.js) — не блокируем рендер

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

// Яма вокруг супер-пикапа — "пропавший" участок пола, а не декаль поверх
// него: тёмная почти чёрная заливка с мягким затухающим краем (не резкая
// граница) читается как настоящий провал/бездна, плюс редкие блики "искр"
// на дне для ощущения глубины. Рисуется сразу после drawFloor, ДО стен и
// танков — это часть уровня земли, не эффект поверх сцены.
// зоны ямы статичны (геометрия карты, не меняется в рантайме) — градиент
// края кэшируется по ключу геометрии, а не пересоздаётся каждый кадр на
// каждую из 8 зон (то же соображение, что у _glowSpriteCache для пуль)
const _pitGradientCache = new Map(); // key: `${x},${y},${w},${h}` -> CanvasGradient

function getPitEdgeGradient(ctx, x, y, width, height) {
  const key = `${x},${y},${width},${height}`;
  let grad = _pitGradientCache.get(key);
  if (grad) return grad;

  const cx = x + width / 2;
  const cy = y + height / 2;
  grad = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.25,
    cx,
    cy,
    Math.max(width, height) * 0.75
  );
  grad.addColorStop(0, "rgba(5, 5, 5, 0)");
  grad.addColorStop(1, "rgba(5, 5, 5, 0.55)");
  _pitGradientCache.set(key, grad);
  return grad;
}

// нет ни одного спрайта "яма/пропасть/провал" в скачанном Kenney-паке (танки
// сверху, укрытия, полы — но не дыра в земле), поэтому яма остаётся
// процедурной сознательно (в отличие от пола/стен выше) — см. бриф задачи.
// Улучшение — не текстура, а более убедительная иллюзия глубины: несколько
// вложенных затемняющихся "ступеней" от края к центру (раньше был один
// плоский чёрный прямоугольник + один затухающий градиент по краю, что
// читалось скорее как чёрное пятно, чем как проём вниз) плюс лёгкое
// анимированное "марево" у самого дна, как нагретый воздух/испарения над
// пропастью — вместе создают ощущение настоящей глубины без единого спрайта.
// силуэт ямы — готовый спрайт oilSpill (Kenney, тот же CC0-пак, что и все
// остальные текстуры), а не нарисованные вручную эллипсы/кольца. По запросу
// пользователя "убери самописную графику, используй готовые реализации":
// органическая неровная клякса пятна по форме — то, что нужно для провала в
// грунте, только перекрашена тинтом source-atop из нефтяного коричневого в
// тёмно-серый/чёрный (сам силуэт спрайта не трогаем, только цвет поверх
// непрозрачных пикселей — вне силуэта тинт не выходит).
const PIT_SPRITE_TINT = "#0a0a0a";

// тонированные версии спрайта пятна — кэшируются в ОТДЕЛЬНОМ offscreen
// canvas (тот же приём, что и getGlowSprite ниже в файле). Раньше source-atop
// применялся ПРЯМО на основном canvas: он красит все уже непрозрачные пиксели
// в целевом fillRect, а к этому моменту там уже лежит нарисованный пол/фон/
// соседние тайлы ямы — тинт заливал их тоже, поэтому вместо органичной кляксы
// на экране был виден ровный закрашенный квадрат bounding-box'а спрайта.
const _tintedPitSpriteCache = new Map(); // key: spriteName -> HTMLCanvasElement

function getTintedPitSprite(spriteName) {
  let tinted = _tintedPitSpriteCache.get(spriteName);
  if (tinted) return tinted;
  const sprite = getSprite(spriteName);
  if (!isSpriteReady(sprite)) return null;

  tinted = document.createElement("canvas");
  tinted.width = sprite.naturalWidth;
  tinted.height = sprite.naturalHeight;
  const tctx = tinted.getContext("2d");
  tctx.drawImage(sprite, 0, 0);
  tctx.globalCompositeOperation = "source-atop";
  tctx.globalAlpha = 0.94;
  tctx.fillStyle = PIT_SPRITE_TINT;
  tctx.fillRect(0, 0, tinted.width, tinted.height);

  _tintedPitSpriteCache.set(spriteName, tinted);
  return tinted;
}

function drawPitSpriteTile(ctx, spriteName, x, y, size, rotation) {
  const tinted = getTintedPitSprite(spriteName);
  if (!tinted) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.drawImage(tinted, -size / 2, -size / 2, size, size);
  ctx.restore();
  return true;
}

export function drawPitZone3D(ctx, zone, t) {
  const { x, y, width, height } = zone;
  const cx = x + width / 2;
  const cy = y + height / 2;

  // запасная процедурная заливка — рисуется ВСЕГДА первым слоем (не только
  // пока спрайт грузится), чтобы под неровными краями кляксы не проглядывал
  // пол сцены там, где спрайт не дотягивается до прямоугольных углов зоны
  ctx.fillStyle = "#050505";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = getPitEdgeGradient(ctx, x, y, width, height);
  ctx.fillRect(x - 20, y - 20, width + 40, height + 40);

  // замащиваем зону несколькими перекрывающимися экземплярами спрайта пятна
  // (большой + мелкий, с фиксированным псевдослучайным разворотом на тайл) —
  // органичные неровные края без единой ровной геометрической линии, вместо
  // одного растянутого на весь прямоугольник спрайта (исказил бы форму клякс)
  const tileSize = Math.min(width, height) * 0.82;
  const cols = Math.max(1, Math.round(width / (tileSize * 0.72)));
  const rows = Math.max(1, Math.round(height / (tileSize * 0.72)));
  let spritesReady = true;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const seed = row * 7.13 + col * 3.71;
      const px = x + ((col + 0.5) / cols) * width + (_rubbleRand(seed) - 0.5) * tileSize * 0.25;
      const py = y + ((row + 0.5) / rows) * height + (_rubbleRand(seed + 1.7) - 0.5) * tileSize * 0.25;
      const isLarge = _rubbleRand(seed + 3.3) > 0.35;
      const size = tileSize * (isLarge ? 1.15 : 0.75);
      const rotation = _rubbleRand(seed + 5.1) * Math.PI * 2;
      const ok = drawPitSpriteTile(ctx, isLarge ? "oilSpill_large" : "oilSpill_small", px, py, size, rotation);
      if (!ok) spritesReady = false;
    }
  }

  // пока спрайты не декодированы — оставляем старые процедурные кольца
  // глубины как временный фолбэк (тот же silent pop-in, что и везде в файле),
  // они же и остаются под спрайтами лёгкой тенью для ощущения глубины
  if (!spritesReady) {
    const ringCount = 4;
    for (let i = ringCount; i >= 1; i--) {
      const frac = i / ringCount;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + (ringCount - i) * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, (width / 2) * frac, (height / 2) * frac, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // марево над дном — 2 смещённых полупрозрачных эллипса, медленно "дышащих"
  // синхронно с ембером ниже; создаёт ощущение восходящего тёплого воздуха
  // из пропасти, а не статичной дыры
  const maxDim = Math.max(width, height) * 0.65;
  const shimmerPhase = t * 0.9;
  for (let i = 0; i < 2; i++) {
    const sway = Math.sin(shimmerPhase + i * Math.PI) * width * 0.08;
    const shimmerAlpha = 0.06 + 0.05 * Math.sin(shimmerPhase * 1.3 + i);
    const grad = ctx.createRadialGradient(cx + sway, cy, 0, cx + sway, cy, maxDim);
    grad.addColorStop(0, `rgba(148, 163, 184, ${shimmerAlpha})`);
    grad.addColorStop(1, "rgba(148, 163, 184, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx + sway, cy, width * 0.4, height * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // явная красная рамка-обводка убрана по прямому запросу пользователя
  // ("убери эти красные границы") — вместо геометрической линии сигнал
  // "опасно" несут только огоньки-угли ниже и естественная тёмная клякса
  // силуэта пятна, без единой прямой/прямоугольной линии по контуру

  // огоньки на дне — тлеющие угли, единственный сохранённый сигнал опасности
  const sparkCount = Math.max(2, Math.round((width * height) / 7000));
  for (let i = 0; i < sparkCount; i++) {
    const sx = x + _rubbleRand(i * 3.7 + x * 0.01) * width;
    const sy = y + _rubbleRand(i * 5.3 + y * 0.01) * height;
    const flicker = 0.35 + 0.4 * Math.sin(t * 2 + i * 3.1);
    const emberGrad = ctx.createRadialGradient(sx, sy, 0, sx, sy, 4);
    emberGrad.addColorStop(0, `rgba(239, 68, 68, ${flicker})`);
    emberGrad.addColorStop(1, "rgba(239, 68, 68, 0)");
    ctx.fillStyle = emberGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// внутренние разрушаемые укрытия (destructible=true в backend/app/game/map.py)
// все короткие/тонкие (130-160 x 28-30px) — одиночный спрайт мешка с песком
// (64x44), замощённый вдоль длинной оси, читается как настоящая баррикада из
// мешков, а не растянутая до неузнаваемости картинка. Внешние границы поля
// (is_border на сервере, не пересылается на клиент — но других
// недеструктиблов на карте сейчас нет, так что "не destructible" здесь и
// значит "граница") остаются процедурной заливкой: та же текстура на полосе
// 1760x24px растянулась бы в мутное пятно без единого узнаваемого мешка —
// сознательно оставлено без спрайта, см. бриф задачи.
const WALL_TOP_SPRITE = "sandbagBeige";

// составной тайл мешков с песком, замощённый по короткой стене — тот же
// приём кэширования готового паттерна, что и у пола (getFloorPattern), но
// без смешения вариантов: у sandbagBeige нет второго варианта текстуры, а
// сама укладка мешков уже даёт достаточно визуального разнообразия построчно
let _wallTopPattern = null;
let _wallTopPatternCtx = null;

function getWallTopPattern(ctx) {
  if (_wallTopPattern && _wallTopPatternCtx === ctx) return _wallTopPattern;
  const sprite = getSprite(WALL_TOP_SPRITE);
  if (!isSpriteReady(sprite)) return null;
  _wallTopPattern = ctx.createPattern(sprite, "repeat");
  _wallTopPatternCtx = ctx;
  return _wallTopPattern;
}

// градиент верхней грани бордюрных (не destructible) стен — зависит только
// от height и topLight (оба статичны для данной стены), см. drawWallTopFace
const _wallTopGradientCache = new Map(); // key: `${height},${topLight}` -> CanvasGradient

function getWallTopGradient(ctx, height, topLight) {
  const key = `${height},${topLight}`;
  let grad = _wallTopGradientCache.get(key);
  if (grad) return grad;
  grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, shadeColor("#4a4d42", 0.2 + topLight * 0.25));
  grad.addColorStop(1, shadeColor("#4a4d42", topLight * 0.2));
  _wallTopGradientCache.set(key, grad);
  return grad;
}

// верхняя (обращённая к камере "сверху") грань стены — единственная часть
// drawWall3D, которая раньше была плоской заливкой-градиентом; боковые грани
// и отбрасываемая тень вокруг неё не трогались, они и так давали объём
function drawWallTopFace(ctx, wall, x, topY, width, height, topLight) {
  if (wall.destructible) {
    const pattern = getWallTopPattern(ctx);
    if (pattern) {
      // ctx.translate двигает и систему координат заливки паттерном (фазу
      // тайла), не только геометрию fillRect — поэтому просто переносим
      // начало координат в угол стены перед заливкой, без ручной DOMMatrix
      // возни с самим CanvasPattern
      ctx.save();
      ctx.translate(x, topY);
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // лёгкое затемнение по освещённости грани поверх текстуры — сохраняет
      // то же направленное освещение, что было у процедурного градиента,
      // текстура одна и та же независимо от ориентации стены иначе выглядела
      // бы "приклеенной", а не частью освещённой сцены
      ctx.fillStyle = `rgba(15, 15, 10, ${Math.max(0, -topLight) * 0.35})`;
      ctx.fillRect(x, topY, width, height);
      ctx.strokeStyle = "rgba(15, 23, 42, 0.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);
      return;
    }
    // спрайт ещё не декодирован — на первых кадрах просто оставляем прежний
    // процедурный градиент ниже, не блокируя рендер (тот же silent pop-in,
    // что и у пола/пуль в этой кодовой базе)
  }

  // topLight — статическая константа освещения грани (faceLighting(0,-1) у
  // вызывающего кода, не анимируется), height — геометрия стены, тоже не
  // меняется в рантайме. Раньше градиент пересоздавался для каждой
  // бордюрной (не destructible) стены каждый кадр — та же ситуация, что уже
  // решена для _pitGradientCache/getWallTopPattern, просто этот конкретный
  // случай был пропущен. createLinearGradient(x, topY, ...) использует
  // координаты ТЕКУЩЕГО transform-пространства, но сами стопы зависят
  // только от относительного смещения (0..height), не от абсолютной
  // позиции — поэтому можно закэшировать один градиент "от 0 до height" и
  // рисовать его через translate вместо пересоздания под каждую стену.
  const topGrad = getWallTopGradient(ctx, height, topLight);
  ctx.save();
  ctx.translate(x, topY);
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  ctx.strokeStyle = "rgba(203, 213, 225, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);
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
  drawWallTopFace(ctx, wall, x, topY, width, height, topLight);

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

  // электрические разряды-трещины от центра к краю зоны — учащаются и
  // становятся ярче ближе к детонации, как нарастающее энергетическое давление
  const boltCount = 3 + Math.floor(nuke.warning_progress * 5);
  ctx.strokeStyle = `rgba(254, 240, 138, ${0.5 + fastPulse * 0.4})`;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < boltCount; i++) {
    const seed = i * 37.13 + Math.floor(t * (4 + nuke.warning_progress * 10));
    const a = (Math.sin(seed) * 0.5 + 0.5) * Math.PI * 2;
    const boltLen = radius * (0.4 + 0.5 * (Math.sin(seed * 1.7) * 0.5 + 0.5));
    ctx.beginPath();
    ctx.moveTo(nuke.x, nuke.y);
    let px = nuke.x;
    let py = nuke.y;
    const segments = 4;
    for (let s = 1; s <= segments; s++) {
      const frac = s / segments;
      const jitter = (Math.sin(seed * 3 + s * 5) * 0.5) * radius * 0.05;
      px = nuke.x + Math.cos(a) * boltLen * frac + Math.cos(a + Math.PI / 2) * jitter;
      py = nuke.y + Math.sin(a) * boltLen * frac * 0.55 + Math.sin(a + Math.PI / 2) * jitter * 0.55;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
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

  // мигающий символ радиации поверх спрайтового ядра — учащается по мере
  // приближения взрыва; сохранён как единственный полностью узнаваемый
  // "это ядерка" силуэт, символ радиации ни с чем не спутать
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

// Длина ствола до дульного среза по классу танка — ДОЛЖНА совпадать с
// barrelLen, используемым внутри drawTank3D для каждой ветки (снайпер длинный,
// brawler короче, gunner барабан, мини-босс спаренный) — иначе позиция
// вспышки выстрела в GameCanvas.jsx (которая считается отдельно, до вызова
// drawTank3D) не совпадает с реальным концом нарисованного ствола.
// Реальный отрисованный размер танка (с учётом уровня/супербаффа/мини-босса) —
// вынесено в отдельную чистую функцию, переиспользуемую и в drawTank3D, и в
// GameCanvas.jsx для позиционирования вспышки выстрела. Раньше вспышка
// считалась от фиксированной константы TANK_SIZE, а корпус мог быть заметно
// крупнее (прокачанный уровень, супер-бафф) — вспышка оставалась у "старого"
// маленького радиуса и визуально отставала от реального конца ствола.
export function computeTankSize(baseTankSize, level, isMiniboss, hasSuper, superPulsePhase = 0) {
  const levelProgress = isMiniboss ? 0 : (level - 1) / 4;
  const superPulse = hasSuper ? 1 + 0.06 * Math.sin(superPulsePhase) : 1;
  const superGrow = hasSuper ? 1.35 * superPulse : 1;
  return isMiniboss ? baseTankSize * 3 : baseTankSize * (1 + levelProgress * 0.22) * superGrow;
}

// длина ствола в пикселях на экране — определяет, где заканчивается спрайт
// относительно опорной точки башни (turret pivot), и куда должна встать
// вспышка выстрела/пробитие. Раньше это были подобранные на глаз константы
// под процедурную геометрию; теперь это реальная высота спрайта ствола
// (BARREL_SPRITE_DIMS[variant].h), отмасштабированная тем же коэффициентом,
// что и сам спрайт при отрисовке (см. barrelScale в drawTank3D) — см. ниже.
function barrelVariantFor(tankClass) {
  return CLASS_BARREL_VARIANT[tankClass] || 2; // пушка по умолчанию — средний ствол
}

// во сколько раз спрайт ствола масштабируется относительно его исходного
// пиксельного размера при данном tankSize — ОДИН и тот же коэффициент px/unit
// для всех трёх вариантов (не подгоняем ширину под фиксированную цель!) —
// иначе натуральная разница в ширине спрайтов (24 vs 16px), которая и несёт
// "потолще/потоньше" между классами, просто стиралась бы масштабированием.
// Опорная точка — высота спрайта относительно tankSize: тот же зрительный
// масштаб, что был у прежней процедурной длины (tankSize/2 + N)
function barrelSpriteScale(tankSize, variant) {
  const dims = BARREL_SPRITE_DIMS[variant] || BARREL_SPRITE_DIMS[2];
  const targetLen = tankSize / 2 + 10; // те же пропорции, что у прежней процедурной длины
  return targetLen / dims.h;
}

export function getMuzzleBarrelLength(tankSize, tankClass, isMiniboss) {
  const variant = isMiniboss ? MINIBOSS_BARREL_VARIANT : barrelVariantFor(tankClass);
  const dims = BARREL_SPRITE_DIMS[variant] || BARREL_SPRITE_DIMS[2];
  const scale = barrelSpriteScale(tankSize, variant);
  // спрайт нарисован основанием у turret pivot и дульным срезом у верхнего
  // края холста (см. drawTank3D) — полная высота спрайта в масштабе и есть
  // расстояние от центра башни до дула
  return dims.h * scale;
}

export function drawTank3D(
  ctx,
  player,
  isMe,
  baseTankSize,
  t,
  kickback = 0,
  accelBoost = 0,
  moveAngle = null,
  hideLabels = false
) {
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
    is_burning: isBurning,
    is_falling: isFalling,
    fall_progress: fallProgress,
    weapon,
    gun_skin: gunSkin,
  } = player;
  // "weapon" в state уже приходит как "cannon", когда пикап истёк (см.
  // room.py._broadcast_state: p.weapon if now < p.weapon_until else "cannon") —
  // поэтому рескин ствола под подобранное оружие достаточно проверять по
  // самому значению weapon, отдельный until на клиенте не нужен
  const pickupWeaponActive = weapon && weapon !== "cannon";
  const level = player.level ?? 1;
  // чем выше уровень — тем крупнее и золотистее танк (визуальный статус
  // прокачки, помимо цифры в бейдже), а супер-бафф ещё и раздувает сам
  // корпус — см. computeTankSize (расчёт вынесен в отдельную функцию,
  // переиспользуемую в GameCanvas.jsx для позиционирования вспышки выстрела)
  const levelProgress = isMiniboss ? 0 : (level - 1) / 4; // 0..1 (LEVEL_MAX=5)
  const tankSize = computeTankSize(baseTankSize, level, isMiniboss, hasSuper, t ?? 0);
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

  // падение в яму: короткое окно (PIT_FALL_TIME на сервере) — танк уменьшается,
  // проседает вниз (screenY со сдвигом по z в минус) и слегка закручивается,
  // одновременно тая — читается как "проваливается в бездну", а не мгновенно исчезает
  if (isFalling) {
    const fp = fallProgress ?? 0;
    ctx.translate(x, screenY(y, -fp * fp * 90));
    ctx.rotate(fp * 3.2);
    ctx.scale(1 - fp * 0.85, 1 - fp * 0.85);
    ctx.translate(-x, -y);
    ctx.globalAlpha = spawnAlpha * (1 - fp * 0.9);
  }

  // тень корпуса на полу — квадратная под форму корпуса (не овал), смещена
  // в направлении от света; крупнее у мини-босса пропорционально размеру
  const shadowDx = SHADOW_DIR.x * half * 0.4;
  const shadowDy = SHADOW_DIR.y * half * 0.4 * TILT;
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(x - half + shadowDx, y - half + shadowDy, tankSize, tankSize);

  // раньше "золочение" с ростом уровня/супер-баффа подмешивалось прямо в
  // цвет процедурного корпуса (mixColor к bodyColor); спрайты тела фиксированы
  // по цвету (зелёный/синий/красный) и подмешать в них золото так же нельзя —
  // вместо этого золотой прогресс уровня и супер-бафф рисуются отдельным
  // полупрозрачным оверлеем ПОВЕРХ спрайта через "source-atop" (красит только
  // непрозрачные пиксели спрайта, не выходит за его силуэт прямоугольником)
  const goldOverlayAlpha = hasSuper ? 0.6 : levelProgress > 0 ? levelProgress * 0.45 : 0;

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

  // тонкое золотое ambient-свечение вокруг уже увеличенного золотого корпуса —
  // дополняет, а не заменяет изменение самого танка (раньше это было
  // единственным признаком баффа: неизменный цветной квадрат со светящимся
  // кольцом вокруг, что и читалось как "просто подсвеченный квадрат")
  if (hasSuper) {
    const pulse = 0.6 + 0.4 * Math.sin((t ?? 0) * 8);
    const glow = ctx.createRadialGradient(x, topY, half * 0.5, x, topY, tankSize * 0.9);
    glow.addColorStop(0, `rgba(250, 204, 21, ${0.35 * pulse})`);
    glow.addColorStop(1, "rgba(250, 204, 21, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, topY, tankSize * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, 0);

  // корпус плавно доворачивается к направлению движения (не мгновенно и не
  // на полный угол — см. computeBodySpriteAngle) — небольшой, но заметный
  // доворот, как будто гусеницы подруливают, вместо жёсткого axis-aligned
  // корпуса, который был при первой интеграции спрайтов. Поворот применяется
  // вокруг РЕАЛЬНОГО центра корпуса (x, topY) — точка, в которой физически
  // рисуется спрайт, — а не вокруг (x, 0), иначе рисунок улетел бы в сторону
  // при повороте. Композиция translate(0,topY)+rotate+translate(0,-topY)
  // позволяет оставить весь существующий код ниже (использующий абсолютные
  // координаты topY±half) без изменений — после неё локальная точка (0,topY)
  // по-прежнему картируется в мировую (x,topY), просто с добавленным поворотом.
  const bodyAngle = computeBodySpriteAngle(player.id, moveAngle, t);
  ctx.translate(0, topY);
  ctx.rotate(bodyAngle + Math.PI / 2);
  ctx.translate(0, -topY);

  // корпус — теперь спрайт Kenney (tankBody_green/blue/bigRed уже включает
  // гусеницы по бокам, отдельный слой tracksDouble/tracksSmall не нужен,
  // проверено визуально по пикселям спрайта), а не процедурные грани.
  // Спрайт нарисован лицом "вверх" (Kenney top-down конвенция), угол корпуса
  // выше уже учитывает эту +90°-поправку (bodyAngle + PI/2) — тот же принцип
  // и знак, что и у поворота башни ниже (spriteForwardFix).
  const bodySpriteName = isMiniboss ? "tankBody_bigRed" : isMe ? "tankBody_green" : "tankBody_blue";
  const bodyDims = isMiniboss
    ? TANK_BODY_SPRITE_DIMS.bigRed
    : isMe
    ? TANK_BODY_SPRITE_DIMS.green
    : TANK_BODY_SPRITE_DIMS.blue;
  const bodySprite = getSprite(bodySpriteName);
  // масштаб по высоте спрайта — если рисовать оба измерения от одного и
  // того же tankSize при неквадратном спрайте (green 76x72), картинка
  // сплющится; вместо этого высота = tankSize, ширина следует натуральному
  // аспекту спрайта, тем же приёмом, что и у barrel-спрайтов ниже
  const bodyDrawH = tankSize;
  const bodyDrawW = tankSize * (bodyDims.w / bodyDims.h);
  if (bodySprite.complete && bodySprite.naturalWidth > 0) {
    ctx.drawImage(bodySprite, -bodyDrawW / 2, topY - bodyDrawH / 2, bodyDrawW, bodyDrawH);

    // золотой прогресс уровня / супер-бафф — тинт "source-atop" красит
    // только уже нарисованные непрозрачные пиксели спрайта (силуэт танка),
    // а не весь bounding box, поэтому не выходит квадратом за пределы корпуса
    if (goldOverlayAlpha > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = goldOverlayAlpha;
      ctx.fillStyle = "#facc15";
      ctx.fillRect(-bodyDrawW / 2, topY - bodyDrawH / 2, bodyDrawW, bodyDrawH);
      ctx.restore();
    }
  }

  if (hasSlow) {
    // "закован в лёд": ледяной оттенок поверх корпуса + тонкий кристаллический
    // контур по краю (ломаная, не идеальный прямоугольник) — раньше был только
    // плоский цветной оверлей без текстуры, теперь читается как настоящая корка льда
    ctx.fillStyle = "rgba(56, 189, 248, 0.35)";
    ctx.fillRect(-half, topY - half, tankSize, tankSize);
    ctx.strokeStyle = "rgba(224, 242, 254, 0.75)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const fx = -half + (i / 4) * tankSize;
      const jag = (i % 2 === 0 ? 1 : -1) * tankSize * 0.08;
      ctx.moveTo(fx, topY - half);
      ctx.lineTo(fx + jag, topY - half + tankSize * 0.28);
      ctx.moveTo(fx, topY + half);
      ctx.lineTo(fx - jag, topY + half - tankSize * 0.28);
    }
    ctx.stroke();
  }

  if (isBurning) {
    // горящий танк: тёплый оранжево-красный оттенок поверх корпуса + пара
    // "языков" пламени, поднимающихся с корпуса — зеркалит паттерн hasSlow
    // (полупрозрачный оверлей своим цветом), но с анимированными огоньками
    // вместо статичного кристаллического контура, т.к. огонь должен "жить"
    const burnFlicker = 0.7 + 0.3 * Math.sin((t ?? 0) * 22 + x * 0.15);
    ctx.fillStyle = `rgba(239, 68, 68, ${0.22 * burnFlicker})`;
    ctx.fillRect(-half, topY - half, tankSize, tankSize);
    for (let i = 0; i < 3; i++) {
      const emberPhase = (t ?? 0) * 3.5 + i * 2.1;
      const ex = -half + tankSize * (0.2 + i * 0.3);
      const riseFrac = (emberPhase % 1);
      const ey = topY - half - riseFrac * tankSize * 0.5;
      const emberAlpha = (1 - riseFrac) * 0.85;
      const emberR = 2.5 + Math.sin(emberPhase * 6) * 1;
      const emberGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, emberR * 2.2);
      emberGrad.addColorStop(0, `rgba(255, 214, 140, ${emberAlpha})`);
      emberGrad.addColorStop(0.5, `rgba(249, 115, 22, ${emberAlpha * 0.7})`);
      emberGrad.addColorStop(1, "rgba(249, 115, 22, 0)");
      ctx.fillStyle = emberGrad;
      ctx.beginPath();
      ctx.arc(ex, ey, emberR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (hasArmor) {
    // броня: раньше — шестигранная бронеплитная насечка поверх процедурного
    // корпуса; теперь корпус сам по себе спрайт с реальной текстурой, и
    // такая мелкая деталь на нём уже не нужна для "объёма" — упрощено до
    // мягкого дышащего контура-свечения по силуэту корпуса, читается как
    // энергощит поверх брони, не спорит с текстурой спрайта под ним
    const armorPulse = 0.6 + 0.4 * Math.sin((t ?? 0) * 5);
    const glowR = tankSize * (0.78 + armorPulse * 0.08);
    ctx.save();
    const glow = ctx.createRadialGradient(0, topY, tankSize * 0.3, 0, topY, glowR);
    glow.addColorStop(0, `rgba(125, 211, 252, ${0.4 + armorPulse * 0.2})`);
    glow.addColorStop(0.7, `rgba(56, 189, 248, ${0.18 + armorPulse * 0.1})`);
    glow.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, topY, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // hasSuper — раньше здесь рисовался ВТОРОЙ прямоугольный strokeRect-контур
  // вокруг корпуса поверх уже существующего ambient-свечения выше (см.
  // "тонкое золотое ambient-свечение" при topY) — на реальном спрайте
  // жёсткая рамка с острыми углами читалась как кустарная декаль поверх
  // готовой текстуры. Убрана целиком: ambient-глоу выше уже полностью
  // покрывает сигнал баффа мягким радиальным сиянием, без единой прямой линии.

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

  // тень башни на корпусе — раньше была слишком слабой (0.25 альфа) на фоне
  // сплошного цветного спрайта башни: читалась не как объёмная тень, а как
  // будто сама башня частично прозрачная и сквозь неё что-то просвечивает.
  // Плотнее и чуть смещена — явный контактный контур у основания, а не
  // полупрозрачное пятно поверх всего круга.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(3, 4, tankSize / 3 + 2, tankSize / 3 + 1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(angle);
  // отдача: ствол на короткое время "уезжает" назад при выстреле — kickback
  // затухает от 1 (сразу после выстрела) до 0, создаёт ощущение мощности.
  // Раньше сдвигался xStart процедурного сегмента, теперь тот же пиксельный
  // сдвиг применяется к translate() перед отрисовкой спрайта ствола.
  const barrelPullback = -kickback * 5;

  // цвет спрайта ствола: скин из меню (gunSkin) выбирает цветовую линейку
  // Kenney-пака под турель (GUN_SKIN_SPRITE_COLOR), мини-босс всегда красный
  // вне зависимости от скина — красный тут индикатор угрозы, а не косметика
  const spriteColorName = isMiniboss ? "Red" : GUN_SKIN_SPRITE_COLOR[gunSkin] || "Dark";
  const barrelVariant = isMiniboss ? MINIBOSS_BARREL_VARIANT : barrelVariantFor(player.tank_class);
  const barrelDims = BARREL_SPRITE_DIMS[barrelVariant];
  const barrelColorPrefix = { Green: "tankGreen", Blue: "tankBlue", Red: "tankRed", Dark: "tankDark", Sand: "tankSand" }[
    spriteColorName
  ];
  const barrelSprite = getSprite(`${barrelColorPrefix}_barrel${barrelVariant}`);

  // спрайт танка нарисован "вверх" (сторона -Y), а игровой angle=0 значит
  // "вправо" (+X), см. turret_angle = atan2(dy,dx) на сервере и
  // TankPreview.jsx (angle=0 → "ствол смотрит строго вправо"); мы уже
  // повернули контекст на angle через ctx.rotate(angle) выше, поэтому здесь
  // достаточно довернуть ещё на +90°, чтобы "верх спрайта" совпал с "текущим
  // +X после поворота" — проверено визуально скриншотом (см. отчёт)
  const spriteForwardFix = Math.PI / 2;
  const barrelScale = barrelSpriteScale(tankSize, barrelVariant);
  const barrelDrawW = barrelDims.w * barrelScale;
  const barrelDrawH = barrelDims.h * barrelScale;

  if (isMiniboss) {
    // мини-босс отличим не только размером/цветом: спаренные стволы (он
    // реально бьёт несколькими типами атак) — два экземпляра одного спрайта
    // бок о бок, вместо одной процедурной пары сегментов
    const offset = barrelDrawW * 0.55;
    for (const oy of [-offset, offset]) {
      ctx.save();
      ctx.translate(barrelPullback, oy);
      ctx.rotate(spriteForwardFix);
      if (barrelSprite.complete && barrelSprite.naturalWidth > 0) {
        ctx.drawImage(barrelSprite, -barrelDrawW / 2, -barrelDrawH, barrelDrawW, barrelDrawH);
      }
      ctx.restore();
    }

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
    // снайпер/brawler/gunner/пушка по умолчанию — теперь один и тот же путь
    // отрисовки, различаются только тем, какой спрайт ствола выбран
    // (CLASS_BARREL_VARIANT): длинный тонкий barrel2 у снайпера, такой же
    // длины, но вдвое толще barrel1 у brawler (тот теряет свой прежний
    // двойной ствол — отдельного спрайта под double-barrel в паке нет,
    // решили не городить фейковую пару из двух наложенных спрайтов ради
    // этого класса), короткий приземистый barrel3 у gunner (вращающийся
    // барабан на 4 стволика убран целиком — просили заменить на обычный
    // одиночный спрайт, как у остальных классов)
    ctx.save();
    ctx.translate(barrelPullback, 0);
    ctx.rotate(spriteForwardFix);
    if (barrelSprite.complete && barrelSprite.naturalWidth > 0) {
      ctx.drawImage(barrelSprite, -barrelDrawW / 2, -barrelDrawH, barrelDrawW, barrelDrawH);
    }
    ctx.restore();
  }

  // оверлей-тинт ствола под подобранное с карты оружие (fire/rocket/ice) —
  // раньше был цветовой рескин процедурной заливки самого ствола, сейчас
  // спрайт стволов зафиксирован по цвету, поэтому вместо подмены картинки
  // рисуем полупрозрачное свечение того же оттенка поверх дульной части
  // (тем же приёмом, что и "свечение на срезе" ниже, но шире — покрывает
  // весь видимый ствол, не только кончик, иначе на длинном снайперском
  // стволе тинт был почти незаметен)
  if (pickupWeaponActive && PICKUP_BARREL_TINT[weapon]) {
    const barrelLen = getMuzzleBarrelLength(tankSize, player.tank_class, isMiniboss);
    ctx.save();
    ctx.translate(barrelPullback, 0);
    ctx.rotate(spriteForwardFix);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = PICKUP_BARREL_TINT[weapon];
    ctx.fillRect(-barrelDrawW / 2, -barrelDrawH, barrelDrawW, barrelDrawH);
    ctx.restore();

    // свечение на срезе — уголёк/изморозь на самом кончике, чтобы подобранное
    // оружие читалось однозначно даже когда сам тинт на маленьком масштабе не заметен
    const glowPulse = 0.6 + 0.4 * Math.sin((t ?? 0) * 6);
    const glowColor = weapon === "ice" ? "191, 219, 254" : "251, 146, 60";
    const glow = ctx.createRadialGradient(barrelPullback + barrelLen - 4, 0, 0, barrelPullback + barrelLen - 4, 0, 7);
    glow.addColorStop(0, `rgba(${glowColor}, ${0.8 * glowPulse})`);
    glow.addColorStop(1, `rgba(${glowColor}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(barrelPullback + barrelLen - 4, 0, 7, 0, Math.PI * 2);
    ctx.fill();
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
  // отдельно от имени начиная со 2 уровня. hideLabels скрывает весь этот
  // HUD-слой целиком — используется для косметического превью танка в меню
  // (там нет ни ника, ни HP, ни уровня — это не настоящий игрок)
  const nameLabel = isMiniboss ? `☠ ${player.nickname}` : player.nickname;
  const nameY = topY - half - 14;

  // shadowBlur — дорогой программный блюр, раньше висел на КАЖДОМ живом
  // игроке КАЖДЫЙ кадр (2 вызова: подпись уровня + ник) — с 8-10 игроками
  // на экране это 16-20 blur-проходов/кадр только на текст. Заменено на
  // дешёвую "поддельную тень": тот же текст, залитый тёмным, рисуется один
  // раз со смещением в 1px под основным — обычная заливка без блюра,
  // читаемость на любом фоне та же, стоимость на порядок ниже.
  if (!hideLabels && !isMiniboss && level > 1) {
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillText(`★ Уровень ${level}`, x + 1, nameY - 12 + 1);
    ctx.fillStyle = "#fde047";
    ctx.fillText(`★ Уровень ${level}`, x, nameY - 12);
  }

  if (!hideLabels) {
    ctx.font = isMiniboss ? "bold 13px sans-serif" : "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillText(nameLabel, x + 1, nameY + 1);
    ctx.fillStyle = isMiniboss ? "#fecaca" : "white";
    ctx.fillText(nameLabel, x, nameY);

    const barWidth = isMiniboss ? tankSize * 1.6 : tankSize;
    const barHeight = isMiniboss ? 7 : 5;
    const hpRatio = Math.max(0, hp / maxHp);
    ctx.fillStyle = "#334155";
    ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth, barHeight);
    ctx.fillStyle = isMiniboss ? "#dc2626" : hpRatio > 0.3 ? "#22c55e" : "#ef4444";
    ctx.fillRect(x - barWidth / 2, topY - half - 10, barWidth * hpRatio, barHeight);

    // прогресс-бары готовности (ульта / патроны gunner) — прямо у танка,
    // видно не отвлекаясь на HUD в углу экрана. Только для своего танка:
    // чужой прогресс ульты/патронов игроку не нужен и загромождал бы экран.
    if (isMe && !isMiniboss) {
      const subBarY = topY - half - 10 + barHeight + 3;
      const subBarHeight = 3.5;
      let barIndex = 0;

      if (player.tank_class === "gunner") {
        const ammoRatio = player.reloading
          ? Math.max(0, Math.min(1, player.reload_progress ?? 0))
          : Math.max(0, (player.ammo ?? 0) / (player.ammo_max || 1));
        const y = subBarY + barIndex * (subBarHeight + 2);
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(x - barWidth / 2, y, barWidth, subBarHeight);
        ctx.fillStyle = player.reloading ? "#f59e0b" : "#38bdf8";
        ctx.fillRect(x - barWidth / 2, y, barWidth * ammoRatio, subBarHeight);
        barIndex++;
      }

      const ultimateRatio = Math.max(0, Math.min(1, (player.ultimate_kills ?? 0) / 5));
      const uy = subBarY + barIndex * (subBarHeight + 2);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(x - barWidth / 2, uy, barWidth, subBarHeight);
      if (player.ultimate_ready) {
        const readyPulse = 0.6 + 0.4 * Math.sin((t ?? 0) * 10);
        ctx.fillStyle = `rgba(250, 204, 21, ${0.7 + 0.3 * readyPulse})`;
      } else {
        ctx.fillStyle = "#a855f7";
      }
      ctx.fillRect(x - barWidth / 2, uy, barWidth * ultimateRatio, subBarHeight);
    }
  }

  // указатель "это я" сразу после респавна — на большой карте с 10 танками
  // одинакового вида сложно быстро найти себя глазами; пока действует
  // неуязвимость (spawn protection), над своим танком висит заметная
  // подпрыгивающая стрелка — единственный явный сигнал "ты здесь"
  if (!hideLabels && isMe && hasSpawnProtection) {
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

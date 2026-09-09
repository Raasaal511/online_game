// Рендер поверхности уровня: пол, ямы (пропасти), стены/пандусы/руины.

import { getSprite, isSpriteReady } from "./sprites.js";
import { TILT, SHADOW_DIR, shadeColor, faceLighting, drawRoundedRect } from "./render-utils.js";

// синхронизировано с WALL_MAX_HP на сервере (backend/app/game/entities.py) —
// используется только для прогрессии визуальных трещин по стадиям урона
const WALL_MAX_HP = 5;

// составной тайл пола из двух вариантов грунта (128px каждый, см. Kenney-пак,
// tileSand1/2) — собирается ОДИН раз в оффскрин-canvas 256x256 (2x2), а не
// просто ctx.createPattern(tileSand1) в одиночку: один повторяющийся 128px-
// тайл на карте 1760x1140 даёт заметный "тираж" — глаз быстро цепляет
// идентичные квадраты; чередование двух едва различимых вариантов в
// шахматном порядке ломает эту периодичность почти бесплатно (тот же приём,
// что и предрендер glow-спрайта пули — дорогая подготовка один раз, потом
// только дешёвое повторение готовой текстуры).
// Раньше пол был травой (tileGrass) — по прямому отзыву пользователя
// ("трава не нравится, поле боя должно быть протоптанное, а не зелёное")
// заменено на чистый грунт без вставок травы: пробная версия со вставками
// травы в отдельных клетках сетки давала заметные квадратные пятна
// (нарушение органичности текстуры), однородный грунт этой проблемы не
// имеет и прямо соответствует запросу "вытоптанное поле".
let _floorPattern = null; // CanvasPattern, кэшируется по первому успешному созданию
let _floorPatternCtx = null; // ctx, для которого создан паттерн (Pattern непереносим между context)

function getFloorPattern(ctx) {
  if (_floorPattern && _floorPatternCtx === ctx) return _floorPattern;

  const dirt1 = getSprite("tileSand1");
  const dirt2 = getSprite("tileSand2");
  // createPattern требует уже декодированное изображение-источник — если
  // спрайты ещё не загрузились, откладываем создание паттерна до следующего
  // кадра (см. фолбэк-заливку в drawFloor ниже), не кэшируем "пустой" результат
  if (!isSpriteReady(dirt1) || !isSpriteReady(dirt2)) return null;

  const tileSize = dirt1.naturalWidth || 128;
  const composite = document.createElement("canvas");
  composite.width = tileSize * 2;
  composite.height = tileSize * 2;
  const cctx = composite.getContext("2d");
  cctx.drawImage(dirt1, 0, 0, tileSize, tileSize);
  cctx.drawImage(dirt2, tileSize, 0, tileSize, tileSize);
  cctx.drawImage(dirt2, 0, tileSize, tileSize, tileSize);
  cctx.drawImage(dirt1, tileSize, tileSize, tileSize, tileSize);

  // Kenney-текстура сама по себе светлая (песочный бежевый), а вся
  // остальная сцена (стены, танки, виньетка) в тёмной военной палитре —
  // прямое наложение смотрелось бы резким светлым пятном посреди мрачной
  // сцены. "multiply" с тёмно-оливковым тоном притемняет и обесцвечивает
  // тайл ДО совпадения с фоновым градиентом (#232b24), сохраняя при этом
  // собственный узор грунта (не плоская заливка).
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

// силуэт ямы — готовый спрайт oilSpill (Kenney, тот же CC0-пак, что и все
// остальные текстуры), а не нарисованные вручную эллипсы/кольца. По запросу
// пользователя "убери самописную графику, используй готовые реализации":
// органическая неровная клякса пятна по форме — то, что нужно для провала в
// грунте, только перекрашена тинтом source-atop из нефтяного коричневого в
// тёмно-серый/чёрный (сам силуэт спрайта не трогаем, только цвет поверх
// непрозрачных пикселей — вне силуэта тинт не выходит).
const PIT_SPRITE_TINT = "#0a0a0a";

// тонированные версии спрайта пятна — кэшируются в ОТДЕЛЬНОМ offscreen
// canvas (тот же приём, что и getGlowSprite в render-bullets.js). Если
// применить source-atop ПРЯМО на основном canvas — он красит все уже
// непрозрачные пиксели в целевом fillRect, а к этому моменту там уже лежит
// нарисованный пол/фон/соседние тайлы ямы: тинт заливал бы их тоже, и вместо
// органичной кляксы на экране был бы виден ровный закрашенный квадрат
// bounding-box'а спрайта.
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

// кэш статичной части ямы (масляные пятна-спрайты + фолбэк-кольца) по её
// bounding box — эта геометрия не зависит от t (никакой анимации), но
// раньше перерисовывалась заново 60 раз/сек: двойной вложенный цикл
// спрайтов (до cols×rows штук) на каждую видимую яму — заметная доля
// времени кадра, подтверждено профилированием реального рендер-лупа.
// Марево/угольки ниже (зависят от t) остаются вне кэша, рисуются поверх
// каждый кадр как и раньше — только статичная подложка теперь drawImage.
// Ключ по x,y,width,height (не index/id — zone сейчас plain-объект без id,
// приходит один раз в welcome-пакете как статичная геометрия карты, так что
// координаты сами по себе стабильный идентификатор конкретной ямы).
const _pitStaticCache = new Map();

function drawPitZoneStatic(zone) {
  const { x, y, width, height } = zone;
  const key = `${x},${y},${width},${height}`;
  let cached = _pitStaticCache.get(key);
  if (cached) return cached;

  const pad = 20; // запас под getPitEdgeGradient, выходящий за границы зоны
  const off = document.createElement("canvas");
  off.width = width + pad * 2;
  off.height = height + pad * 2;
  const ctx = off.getContext("2d");
  // локальные координаты внутри offscreen-canvas — та же геометрия, просто
  // сдвинутая на (pad,pad) относительно исходных мировых x,y зоны
  const lx = pad;
  const ly = pad;

  // запасная процедурная заливка — рисуется ВСЕГДА первым слоем (не только
  // пока спрайт грузится), чтобы под неровными краями кляксы не проглядывал
  // пол сцены там, где спрайт не дотягивается до прямоугольных углов зоны
  ctx.fillStyle = "#050505";
  ctx.fillRect(lx, ly, width, height);
  ctx.fillStyle = getPitEdgeGradient(ctx, lx, ly, width, height);
  ctx.fillRect(lx - 20, ly - 20, width + 40, height + 40);

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
      const px = lx + ((col + 0.5) / cols) * width + (_rubbleRand(seed) - 0.5) * tileSize * 0.25;
      const py = ly + ((row + 0.5) / rows) * height + (_rubbleRand(seed + 1.7) - 0.5) * tileSize * 0.25;
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
    const ringCx = lx + width / 2;
    const ringCy = ly + height / 2;
    const ringCount = 4;
    for (let i = ringCount; i >= 1; i--) {
      const frac = i / ringCount;
      ctx.fillStyle = `rgba(0, 0, 0, ${0.12 + (ringCount - i) * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(ringCx, ringCy, (width / 2) * frac, (height / 2) * frac, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // спрайты ещё не готовы — не кэшируем этот "недоделанный" кадр надолго,
    // следующий вызов попробует снова и закэширует уже с настоящими спрайтами
    return { canvas: off, offsetX: x - pad, offsetY: y - pad, final: false };
  }

  cached = { canvas: off, offsetX: x - pad, offsetY: y - pad, final: true };
  _pitStaticCache.set(key, cached);
  return cached;
}

export function drawPitZone3D(ctx, zone, t) {
  const { x, y, width, height } = zone;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const staticLayer = drawPitZoneStatic(zone);
  ctx.drawImage(staticLayer.canvas, staticLayer.offsetX, staticLayer.offsetY);

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
// мешков, а не растянутая до неузнаваемости картинка.
const WALL_TOP_SPRITE = "sandbagBeige";

// внешние границы поля (is_border на сервере, не пересылается на клиент — но
// других недеструктиблов на карте сейчас нет, так что "не destructible" здесь
// и значит "граница") — раньше оставались плоской процедурной заливкой:
// растягивать ОДИНОЧНЫЙ спрайт на всю длину полосы 1760x24px дало бы мутное
// пятно, но это решается тем же приёмом, что уже работает для sandbagBeige
// выше — createPattern ЗАМАЩИВАЕТ квадратный спрайт мелкими повторами вдоль
// стены, а не растягивает один экземпляр. crateMetal (56x56, квадратный
// металлический контейнер) в ряд читается как настоящее капитальное
// укрепление периметра, а не декоративная преграда.
const WALL_BORDER_SPRITE = "crateMetal";

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

let _wallBorderPattern = null;
let _wallBorderPatternCtx = null;

function getWallBorderPattern(ctx) {
  if (_wallBorderPattern && _wallBorderPatternCtx === ctx) return _wallBorderPattern;
  const sprite = getSprite(WALL_BORDER_SPRITE);
  if (!isSpriteReady(sprite)) return null;
  _wallBorderPattern = ctx.createPattern(sprite, "repeat");
  _wallBorderPatternCtx = ctx;
  return _wallBorderPattern;
}

// верхняя (обращённая к камере "сверху") грань стены — единственная часть
// drawWall3D, которая раньше была плоской заливкой-градиентом; боковые грани
// и отбрасываемая тень вокруг неё не трогались, они и так давали объём
function drawWallTopFace(ctx, wall, x, topY, width, height, topLight) {
  if (wall.destructible) {
    const pattern = getWallTopPattern(ctx);
    if (pattern) {
      // ВАЖНО: заливаем паттерном в МИРОВЫХ координатах (fillRect(x, topY, ...)
      // без ctx.translate) — раньше translate(x, topY) перед заливкой сдвигал
      // фазу тайла в СИСТЕМУ КООРДИНАТ КАЖДОЙ КОНКРЕТНОЙ СТЕНЫ (ноль паттерна
      // всегда в её углу x=0,y=0), а не в единую систему координат карты. Две
      // соседние стены (разные Wall-объекты, но физически стоящие впритык)
      // получали каждая свою фазу тайла независимо друг от друга — на стыке
      // текстура "прыгала", читалось как явный шов/разрез. Без translate
      // фаза паттерна одна на весь canvas, и вплотную стоящие стены сшиваются
      // в единую текстуру сами по себе, без дополнительного кода.
      ctx.fillStyle = pattern;
      ctx.fillRect(x, topY, width, height);

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

  // бордюрные (внешние границы поля) стены — та же логика замощения
  // спрайтом, что и у destructible-веток выше, просто другой спрайт
  // (crateMetal — квадратный металлический контейнер, читается как
  // капитальное укрепление в ряд, не мешок с песком). Раньше здесь была
  // плоская процедурная заливка-градиент — "стены так себе" по прямому
  // отзыву пользователя.
  const borderPattern = getWallBorderPattern(ctx);
  if (borderPattern) {
    // мировые координаты, не translate — та же причина, что у getWallTopPattern
    // выше: единая фаза паттерна на весь canvas, соседние сегменты бордюрной
    // стены сшиваются без видимого шва на стыке
    ctx.fillStyle = borderPattern;
    ctx.fillRect(x, topY, width, height);

    ctx.fillStyle = `rgba(10, 10, 8, ${Math.max(0, -topLight) * 0.4})`;
    ctx.fillRect(x, topY, width, height);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, topY + 0.5, width - 1, height - 1);
    return;
  }

  // спрайт ещё не декодирован — фолбэк на процедурный градиент, не
  // блокируем рендер (тот же silent pop-in, что и везде в файле)
  const topGrad = ctx.createLinearGradient(x, topY, x, topY + height);
  topGrad.addColorStop(0, shadeColor("#4a4d42", 0.2 + topLight * 0.25));
  topGrad.addColorStop(1, shadeColor("#4a4d42", topLight * 0.2));
  ctx.fillStyle = topGrad;
  ctx.fillRect(x, topY, width, height);
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
  // градиент вдоль направления тени вместо сплошной заливки — тёмный у
  // основания стены (где тень физически контактирует с объектом), плавно
  // затухающий к прозрачности на дальнем краю. Раньше единый плоский тон
  // читался как жёсткий чёрный треугольник, а не мягкая падающая тень.
  const shadowGrad = ctx.createLinearGradient(
    x + width / 2,
    y + height,
    x + width / 2 + shadowDx,
    y + height + shadowDy
  );
  shadowGrad.addColorStop(0, "rgba(0,0,0,0.42)");
  shadowGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width + shadowDx, y + height + shadowDy);
  ctx.lineTo(x + shadowDx, y + height + shadowDy);
  ctx.closePath();
  ctx.fill();

  // тень с боку — свет направлен по диагонали (сверху-слева), значит тень
  // физически выходит не только из нижнего ребра, но и из правого (восточного),
  // симметрично первому полигону: без неё объект отбрасывал тень только
  // "вниз", а не в реальном направлении диагонального света, и угол стены
  // выглядел как будто тень обрывается на полпути
  const sideShadowGrad = ctx.createLinearGradient(
    x + width,
    y + height / 2,
    x + width + shadowDx,
    y + height / 2 + shadowDy
  );
  sideShadowGrad.addColorStop(0, "rgba(0,0,0,0.42)");
  sideShadowGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sideShadowGrad;
  ctx.beginPath();
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width + shadowDx, y + height + shadowDy);
  ctx.lineTo(x + width + shadowDx, y + shadowDy);
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

// кэш готовых руин по id стены — вся геометрия ниже (подложка, камни,
// дымка) статична между кадрами (никакого t/времени в расчётах нет), но
// раньше пересчитывалась и перерисовывалась заново 60 раз/сек на каждую
// разрушенную стену на экране: до 14 камней, каждый — 2 эллипса + многоугольник
// через цикл, плюс радиальный градиент — заметная доля времени кадра при
// нескольких руинах одновременно (подтверждено профилированием реального
// рендер-лупа). Рисуем один раз в offscreen canvas размером с bounding box
// стены (+ запас под подложку/дымку, выходящие за её границы) и дальше
// просто drawImage.
const _wallRuinsCache = new Map(); // wall.id -> { canvas, offsetX, offsetY }

function drawWallRuins3D(ctx, wall) {
  const { x, y, width, height } = wall;

  let cached = _wallRuinsCache.get(wall.id);
  if (!cached) {
    const pad = 24; // с запасом под дымку (width/2+10 от центра) и подложку
    const canvasW = width + pad * 2;
    const canvasH = height + pad * 2;
    const off = document.createElement("canvas");
    off.width = canvasW;
    off.height = canvasH;
    const offCtx = off.getContext("2d");
    // рисуем в системе координат offscreen-canvas — та же геометрия, что и
    // раньше, просто со сдвигом (x,y) стены на (pad,pad) внутри канваса
    drawWallRuinsGeometry(offCtx, { ...wall, x: pad, y: pad });
    cached = { canvas: off, offsetX: x - pad, offsetY: y - pad };
    _wallRuinsCache.set(wall.id, cached);
  }

  ctx.drawImage(cached.canvas, cached.offsetX, cached.offsetY);
}

// сама отрисовка руин — вызывается ОДИН раз на стену (см. кэш выше), не
// каждый кадр. Разделено на отдельную функцию, чтобы drawWallRuins3D
// оставалась простым публичным API (ctx, wall) без утечки деталей кэширования.
function drawWallRuinsGeometry(ctx, wall) {
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

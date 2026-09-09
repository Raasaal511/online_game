// Рендер танков: корпус, башня/ствол, оверлеи баффов, HP/ник HUD.

import { drawIcon } from "./icons.js";
import { getSprite } from "./sprites.js";
import { TILT, SHADOW_DIR, screenY, normalize, shortestAngleDiff } from "./render-utils.js";

// силуэтная (не axis-aligned прямоугольная/эллиптическая) тень корпуса —
// тот же приём, что и getTintedPitSprite в render-terrain.js: тонируем ВЕСЬ
// силуэт спрайта в чёрный в отдельном offscreen canvas через source-atop и
// кэшируем результат по имени спрайта, дальше просто drawImage поверх пола.
// Рисуется той же трансформацией (translate+rotate), что и сам корпус, — тень
// всегда точно повторяет форму и текущий поворот танка, не квадрат/эллипс,
// оставшийся неподвижным при повороте.
const _tintedShadowSpriteCache = new Map(); // key: spriteName -> HTMLCanvasElement

function getShadowSprite(spriteName) {
  let tinted = _tintedShadowSpriteCache.get(spriteName);
  if (tinted) return tinted;
  const sprite = getSprite(spriteName);
  if (!(sprite.complete && sprite.naturalWidth > 0)) return null;

  tinted = document.createElement("canvas");
  tinted.width = sprite.naturalWidth;
  tinted.height = sprite.naturalHeight;
  const tctx = tinted.getContext("2d");
  tctx.drawImage(sprite, 0, 0);
  tctx.globalCompositeOperation = "source-atop";
  // alpha ЗДЕСЬ должен быть 1 — source-atop с alpha<1 не тонирует силуэт в
  // чистый чёрный, а СМЕШИВАЕТ чёрный с исходным цветом спрайта (отсюда был
  // баг: тень зелёного танка получалась зеленоватой вместо нейтрально-чёрной).
  // Прозрачность самой тени применяется отдельно — ctx.globalAlpha в месте
  // отрисовки готового силуэта на основной canvas (см. вызов ниже).
  tctx.globalAlpha = 1;
  tctx.fillStyle = "#000000";
  tctx.fillRect(0, 0, tinted.width, tinted.height);

  _tintedShadowSpriteCache.set(spriteName, tinted);
  return tinted;
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

// приближённые hex-цвета Kenney-спрайтов по имени — единый источник для
// процедурной башни (drawTank3D ниже) и превью в меню (NicknameForm.jsx,
// SkinSwatch), чтобы цвет башни на витрине и в реальном бою гарантированно
// совпадал, а не дублировался в двух местах с риском разъехаться
export const SKIN_HEX = {
  Dark: "#4b4636",
  Red: "#c0392b",
  Sand: "#d4b483",
  Green: "#3f9142",
  Blue: "#3d7bc4",
};

export function shadeSkinColor(spriteColorName, factor) {
  const hex = SKIN_HEX[spriteColorName] || SKIN_HEX.Dark;
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

// экранный Y центра башни (turret pivot), с учётом псевдо-3D подъёма над
// полом — та же формула (bodyZ + 8), что использует drawTank3D внутри для
// самой отрисовки ствола. Нужна снаружи для эффектов, привязанных к дулу
// (сниперская линия прицела, вспышка выстрела в GameCanvas.jsx) — раньше
// линия прицела считалась от "сырого" mировогоY на уровне пола (z=0), а
// реальный ствол рисуется выше на screenY(y, turretZ), из-за чего линия
// визуально не совпадала со стволом ("шла криво" относительно дула).
export function getTurretScreenY(y, isMiniboss) {
  const bodyZ = isMiniboss ? 22 : 10;
  const turretZ = bodyZ + 8;
  return screenY(y, turretZ);
}

// накладывает процедурный цилиндрический объём поверх уже нарисованного
// спрайта ствола — исходные Kenney barrel-спрайты абсолютно плоские (два
// сплошных тона одного цвета, без единого блика/тени, проверено попиксельно),
// из-за чего рядом с объёмной процедурной башней (см. drawTank3D, обод/скос
// света/люк) ствол читался как чужеродная плоская 2D-нашлёпка. source-atop
// красит только уже непрозрачные пиксели спрайта (силуэт), не выходя за его
// границы — тот же приём, что уже использует тинт оружия чуть ниже.
// Вызывать СРАЗУ после drawImage(barrelSprite, ...) в тех же локальных
// координатах (та же translate/rotate, что и сам спрайт). offsetY — верхний
// край прямоугольника спрайта (тот же, что был передан в drawImage) — в
// drawTank3D спрайт рисуется от 0 вверх (offsetY = -drawH), в NicknameForm.jsx
// свотчи центрируют его по обеим осям (offsetY = -drawH / 2).
export function drawBarrelVolume(ctx, drawW, drawH, offsetY = -drawH) {
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";

  // тёмная грань справа — тень от направленного слева света (тот же угол,
  // что и скос света на башне)
  const shade = ctx.createLinearGradient(-drawW / 2, 0, drawW / 2, 0);
  shade.addColorStop(0, "rgba(255,255,255,0.22)");
  shade.addColorStop(0.45, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = shade;
  ctx.fillRect(-drawW / 2, offsetY, drawW, drawH);

  // узкий блик вдоль левого края — читается как металлический цилиндр, не
  // плоская полоса
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(-drawW / 2, offsetY, drawW * 0.16, drawH);

  ctx.restore();
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

  // тень корпуса на полу — раньше axis-aligned fillRect, нарисованный ДО
  // поворота корпуса (bodyAngle ниже), поэтому при повороте танка квадратная
  // тень оставалась на месте и торчала углами за пределы уже повёрнутого
  // спрайта корпуса. Настоящая тень рисуется силуэтом самого спрайта корпуса
  // (getShadowSprite, вызывается ниже уже ВНУТРИ повёрнутого контекста) —
  // всегда точно повторяет форму и текущий поворот танка.

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

  // тень корпуса силуэтом спрайта — рисуется здесь (уже внутри повёрнутого
  // на bodyAngle контекста, до самого корпуса) со смещением от света в
  // ЛОКАЛЬНЫХ координатах танка (не мировых shadowDx/shadowDy выше — те были
  // для старого axis-aligned fillRect), поэтому тень всегда ложится точно под
  // текущий силуэт корпуса вне зависимости от его поворота
  const shadowSprite = getShadowSprite(bodySpriteName);
  if (shadowSprite) {
    // прозрачность тени задаётся здесь (не внутри кэшированного силуэта —
    // тот теперь чисто чёрный, alpha=1, см. getShadowSprite), чтобы source-atop
    // тонировка не смешивалась с исходным цветом спрайта
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(
      shadowSprite,
      -bodyDrawW / 2 + half * 0.4,
      topY - bodyDrawH / 2 + half * 0.4 * TILT,
      bodyDrawW,
      bodyDrawH
    );
    ctx.restore();
  }
  if (bodySprite.complete && bodySprite.naturalWidth > 0) {
    ctx.drawImage(bodySprite, -bodyDrawW / 2, topY - bodyDrawH / 2, bodyDrawW, bodyDrawH);

    // процедурный объём поверх плоского Kenney-спрайта корпуса — тот же
    // приём и тот же угол света (сверху-слева), что уже применяется к
    // башне/стволу (см. drawBarrelVolume выше), чтобы весь танк читался как
    // одна согласованная псевдо-3D деталь, а не плоская декаль с объёмной
    // башней сверху
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    const bodyShade = ctx.createLinearGradient(
      -bodyDrawW / 2,
      topY - bodyDrawH / 2,
      bodyDrawW / 2,
      topY + bodyDrawH / 2
    );
    bodyShade.addColorStop(0, "rgba(255,255,255,0.16)");
    bodyShade.addColorStop(0.5, "rgba(0,0,0,0)");
    bodyShade.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = bodyShade;
    ctx.fillRect(-bodyDrawW / 2, topY - bodyDrawH / 2, bodyDrawW, bodyDrawH);
    ctx.restore();

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


  // цвет башни И ствола — ОБА из скина пушки (gunSkin), не из цвета
  // игрока/корпуса: это одна физическая деталь (турель), должна краситься
  // разом. Мини-босс всегда красный вне зависимости от скина — красный тут
  // индикатор угрозы, а не косметика. Вычисляется до отрисовки башни ниже
  // (раньше spriteColorName считался только для ствола, уже ПОСЛЕ башни,
  // которая красилась отдельно по bodySpriteName — из-за этого смена скина
  // пушки в меню визуально никак не влияла на башню в реальном бою).
  const spriteColorName = isMiniboss ? "Red" : GUN_SKIN_SPRITE_COLOR[gunSkin] || "Dark";
  const turretBase = SKIN_HEX[spriteColorName] || SKIN_HEX.Dark;

  // детализированная башня-подложка под ствол — у используемого Kenney-пака
  // спрайт корпуса (tankBody_*) НЕ содержит настоящей башни, только плоский
  // прямоугольный корпус с гусеницами (проверено попиксельно) — ствол-спрайт
  // сам по себе голая полоска без основания. Форма и приём (вложенные слои
  // сплошного цвета разной яркости, не радиальный градиент-шар) взяты из
  // уже существующей детали на tankBody_bigRed (мини-босс) — тот же
  // скруглённый октагон с ободом/заклёпками/центральным люком, чтобы башня
  // выглядела частью того же пиксель-арт языка, что и остальные спрайты.
  const turretR = tankSize * (isMiniboss ? 0.34 : 0.38);
  ctx.save();

  const octagon = (r) => {
    const cut = r * 0.4; // срез углов — тот же характер формы, что у люка на bigRed
    ctx.beginPath();
    ctx.moveTo(-cut, -r);
    ctx.lineTo(cut, -r);
    ctx.lineTo(r, -cut);
    ctx.lineTo(r, cut);
    ctx.lineTo(cut, r);
    ctx.lineTo(-cut, r);
    ctx.lineTo(-r, cut);
    ctx.lineTo(-r, -cut);
    ctx.closePath();
  };

  // корпус башни — тёмный обод (глубина/тень по краю)
  ctx.fillStyle = shadeSkinColor(spriteColorName, -0.35);
  octagon(turretR);
  ctx.fill();

  // основная плоскость — светлее обода, тот же цвет, что и ствол
  ctx.fillStyle = turretBase;
  octagon(turretR * 0.82);
  ctx.fill();

  // верхняя грань со скосом света (имитирует то же плоское псевдо-3D
  // освещение "сверху-слева", что уже используется у корпуса/стен)
  ctx.fillStyle = shadeSkinColor(spriteColorName, 0.22);
  ctx.beginPath();
  ctx.moveTo(-turretR * 0.6, -turretR * 0.82);
  ctx.lineTo(turretR * 0.2, -turretR * 0.82);
  ctx.lineTo(-turretR * 0.1, -turretR * 0.1);
  ctx.lineTo(-turretR * 0.75, -turretR * 0.1);
  ctx.closePath();
  ctx.fill();

  // четыре заклёпки по углам обода — тот же элемент, что уже есть на
  // корпусах (см. углы tankBody_green выше по файлу)
  ctx.fillStyle = shadeSkinColor(spriteColorName, -0.5);
  const rivetR = Math.max(1, tankSize * 0.025);
  const rivetOffset = turretR * 0.68;
  for (const [rx, ry] of [
    [-rivetOffset, -rivetOffset],
    [rivetOffset, -rivetOffset],
    [-rivetOffset, rivetOffset],
    [rivetOffset, rivetOffset],
  ]) {
    ctx.beginPath();
    ctx.arc(rx, ry, rivetR, 0, Math.PI * 2);
    ctx.fill();
  }

  // центральный люк — вложенная рамка тёмный→светлый→тёмный, тот же приём,
  // что у квадратного люка на tankBody_bigRed
  const hatchR = turretR * 0.4;
  ctx.fillStyle = shadeSkinColor(spriteColorName, -0.4);
  ctx.beginPath();
  ctx.arc(0, 0, hatchR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shadeSkinColor(spriteColorName, 0.1);
  ctx.beginPath();
  ctx.arc(0, 0, hatchR * 0.62, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.rotate(angle);
  // отдача: ствол на короткое время "уезжает" назад при выстреле — kickback
  // затухает от 1 (сразу после выстрела) до 0, создаёт ощущение мощности.
  // Раньше сдвигался xStart процедурного сегмента, теперь тот же пиксельный
  // сдвиг применяется к translate() перед отрисовкой спрайта ствола.
  const barrelPullback = -kickback * 5;

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
        drawBarrelVolume(ctx, barrelDrawW, barrelDrawH);
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
      drawBarrelVolume(ctx, barrelDrawW, barrelDrawH);
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

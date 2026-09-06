// Мини-иконки для пикапов/оружия, рисуются напрямую в Canvas2D через Path2D
// (не текстовые лейблы) — компактные векторные силуэты, узнаваемые на глаз.

const ICON_PATHS = {
  // крест аптечки
  heal: "M-1,-6 L1,-6 L1,-1 L6,-1 L6,1 L1,1 L1,6 L-1,6 L-1,1 L-6,1 L-6,-1 L-1,-1 Z",
  // щит брони
  armor: "M0,-7 L6,-4.5 L6,1 C6,4.5 3,6.5 0,7.5 C-3,6.5 -6,4.5 -6,1 L-6,-4.5 Z",
  // молния урона
  damage: "M2,-7 L-4,1 L-0.5,1 L-2,7 L4,-1 L0.5,-1 Z",
  // спидометр/стрелка скорости
  speed: "M-6,3 L-2,-3 L2,1 L6,-5 M6,-5 L2,-5 M6,-5 L6,-1",
  // звезда супер-бафа
  super: "M0,-7 L1.8,-2.2 L7,-2.2 L2.8,1 L4.3,6 L0,3 L-4.3,6 L-2.8,1 L-7,-2.2 L-1.8,-2.2 Z",
  // пулемётная лента
  minigun: "M-6,-2 L6,-2 L6,2 L-6,2 Z M-4,-2 L-4,-4 M-1,-2 L-1,-4 M2,-2 L2,-4 M5,-2 L5,-4",
  // капля пламени
  flamethrower: "M0,-7 C3,-3 4,0 2,3 C4,2 5,-1 4,-3 C6,0 6,4 3,6.5 C0,8 -4,6 -4,2 C-4,-1 -2,-3 0,-7 Z",
  // ракета
  rocket: "M0,-7 L2.5,-2 L2.5,4 L0,7 L-2.5,4 L-2.5,-2 Z M-2.5,2 L-5,5 M2.5,2 L5,5",
};

const iconPathCache = new Map();

function getPath(kind) {
  const raw = ICON_PATHS[kind];
  if (!raw) return null;
  if (!iconPathCache.has(kind)) {
    iconPathCache.set(kind, new Path2D(raw));
  }
  return iconPathCache.get(kind);
}

// рисует иконку с центром в (0,0) текущей трансформации ctx (вызывающий код
// должен сам сделать ctx.translate до вызова)
export function drawIcon(ctx, kind, color = "#fff", scale = 1) {
  const path = getPath(kind);
  if (!path) return;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4 / scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (["speed", "minigun", "rocket"].includes(kind)) {
    ctx.stroke(path);
    if (kind === "rocket") ctx.fill(path);
  } else {
    ctx.fill(path);
  }
  ctx.restore();
}

export function hasIcon(kind) {
  return Boolean(ICON_PATHS[kind]);
}

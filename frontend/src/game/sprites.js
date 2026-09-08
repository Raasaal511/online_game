// Кэш загруженных PNG-спрайтов танков (Kenney "Top-down Tanks Redux", CC0).
// Загрузка асинхронная через new Image(), но drawImage() на ещё не
// загруженном HTMLImageElement — тихий no-op в Canvas2D (не бросает и не
// рисует "битую" картинку), поэтому рендер не нужно блокировать/ждать —
// спрайты просто "проявляются" через несколько кадров после первого захода
// на страницу, это стандартное и незаметное поведение для canvas-игр.
const _spriteCache = new Map();

export function getSprite(name) {
  let img = _spriteCache.get(name);
  if (img) return img;
  img = new Image();
  img.src = `/assets/tanks/${name}.png`;
  _spriteCache.set(name, img);
  return img;
}

// true только когда изображение реально декодировано и имеет размеры —
// используется там, где нужна натуральная ширина/высота спрайта (расчёт
// длины ствола), а не просто сам объект Image (тот существует сразу же)
export function isSpriteReady(img) {
  return !!img && img.complete && img.naturalWidth > 0;
}

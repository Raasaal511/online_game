import { getSprite } from "./sprites.js";

// Полный список PNG-спрайтов игры (Kenney "Top-down Tanks Redux", CC0) —
// раньше каждый спрайт грузился лениво через getSprite() ПЕРВЫЙ раз, когда
// он реально понадобился на экране: в реальном бою это означало, что в
// момент первого рендер-кадра браузер одновременно запрашивал и декодировал
// десятки уникальных PNG, конкурируя с самим 30Гц рендер-лупом за главный
// поток — отсюда и ощутимое подвисание именно в момент входа в игру после
// перехода на спрайты. Список статичный (файлы Kenney-пака не меняются),
// сверен с содержимым frontend/public/assets/tanks/ через `ls`.
export const ALL_SPRITE_NAMES = [
  "barricadeMetal",
  "barricadeWood",
  "bulletBlue1",
  "bulletDark1",
  "bulletGreen1",
  "bulletRed1",
  "bulletSand1",
  "crateMetal",
  "crateMetal_side",
  "crateWood",
  "crateWood_side",
  "explosion1",
  "explosion2",
  "explosion3",
  "explosion4",
  "explosion5",
  "explosionSmoke1",
  "explosionSmoke2",
  "explosionSmoke3",
  "fenceRed",
  "fenceYellow",
  "oilSpill_large",
  "oilSpill_small",
  "sandbagBeige",
  "sandbagBeige_open",
  "sandbagBrown",
  "sandbagBrown_open",
  "shotLarge",
  "shotOrange",
  "shotRed",
  "shotThin",
  "specialBarrel1",
  "specialBarrel2",
  "tankBlue_barrel1",
  "tankBlue_barrel2",
  "tankBlue_barrel3",
  "tankBody_bigRed",
  "tankBody_bigRed_outline",
  "tankBody_blue",
  "tankBody_blue_outline",
  "tankBody_dark",
  "tankBody_dark_outline",
  "tankBody_green",
  "tankBody_green_outline",
  "tankBody_red",
  "tankBody_red_outline",
  "tankBody_sand",
  "tankBody_sand_outline",
  "tankDark_barrel1",
  "tankDark_barrel2",
  "tankDark_barrel3",
  "tankGreen_barrel1",
  "tankGreen_barrel2",
  "tankGreen_barrel3",
  "tankRed_barrel1",
  "tankRed_barrel2",
  "tankRed_barrel3",
  "tankSand_barrel1",
  "tankSand_barrel2",
  "tankSand_barrel3",
  "tileGrass1",
  "tileGrass2",
  "tileGrass_roadCornerLL",
  "tileGrass_roadCornerLR",
  "tileGrass_roadCornerUL",
  "tileGrass_roadCornerUR",
  "tileGrass_roadCrossing",
  "tileGrass_roadCrossingRound",
  "tileGrass_roadEast",
  "tileGrass_roadNorth",
  "tileGrass_roadSplitE",
  "tileGrass_roadSplitN",
  "tileGrass_roadSplitS",
  "tileGrass_roadSplitW",
  "tileGrass_transitionE",
  "tileGrass_transitionN",
  "tileGrass_transitionS",
  "tileGrass_transitionW",
  "tileSand1",
  "tileSand2",
  "tracksDouble",
  "tracksLarge",
  "tracksSmall",
  "treeBrown_large",
  "treeBrown_small",
  "treeGreen_large",
  "treeGreen_small",
  "wireCrooked",
  "wireStraight",
];

// Предзагружает весь список спрайтов ПАРАЛЛЕЛЬНО (не последовательно — 89
// мелких PNG за один RTT каждый, последовательно это была бы секунды
// задержки на пустом месте) и репортит прогресс по мере готовности каждого.
// getSprite() сам кэширует Image по имени (см. sprites.js), поэтому вызов
// здесь и последующие вызовы из рендер-кода переиспользуют один и тот же
// уже загруженный/декодированный HTMLImageElement — браузер тоже не полезет
// в сеть повторно (обычный HTTP-кэш на статику), но decode() не нужно ждать
// заново, если он уже произошёл здесь.
export function preloadAllSprites(onProgress) {
  return new Promise((resolve) => {
    const total = ALL_SPRITE_NAMES.length;
    let loaded = 0;

    const bump = () => {
      loaded += 1;
      onProgress?.(loaded, total);
      if (loaded >= total) resolve();
    };

    for (const name of ALL_SPRITE_NAMES) {
      const img = getSprite(name);
      if (img.complete) {
        // уже был закэширован раньше в этой сессии (HMR / повторный вход в
        // меню) — не вешаем лишний обработчик, просто засчитываем сразу
        bump();
        continue;
      }
      img.addEventListener("load", bump, { once: true });
      // ошибку загрузки тоже засчитываем как "обработано" — отсутствующий
      // файл не должен вечно держать экран загрузки на 99%
      img.addEventListener("error", bump, { once: true });
    }
  });
}

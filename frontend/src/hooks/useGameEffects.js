import { useRef } from "react";
import { createParticleSystem } from "../game/particles.js";
import { createTrackSystem } from "../game/tracks.js";
import {
  playShotSound,
  playMinigunSound,
  playFlamethrowerSound,
  playRocketLaunchSound,
  playHitSound,
  playExplosionSound,
  playPickupSound,
  playBombWarningSound,
  playNukeWarningSound,
  playLevelUpSound,
  playMinibossSpawnSound,
  playMinibossSalvoSound,
  playMinibossLaserChargeSound,
  playMinibossLaserFireSound,
  playWallHitSound,
  playWallBreakSound,
  playTeleportSound,
  playPortalSpawnSound,
  playSniperShotSound,
  playBrawlerShotSound,
  playUltimateFireSound,
} from "../game/sound.js";

const WALL_BREAK_LIFETIME = 0.5;
const WALL_HIT_LIFETIME = 0.2;
const PIERCE_HIT_LIFETIME = 0.22; // сквозное попадание снайпера — короткая искра, не мешает читать полёт пули дальше
const LASER_STAR_HIT_LIFETIME = 0.3; // искра попадания лазерной звезды — чуть заметнее pierce-искры

const EXPLOSION_LIFETIME = 0.6; // сек, длительность визуального взрыва бомбы/ракеты
const NUKE_EXPLOSION_LIFETIME = 2.2; // сек — гриб растёт и держится заметно дольше обычного взрыва
const LASER_SHOT_LIFETIME = 0.25; // сек — вспышка лазерного выстрела мини-босса, короткая и яркая

const WEAPON_SHOOT_SOUND = {
  cannon: playShotSound,
  minigun: playMinigunSound,
  flamethrower: playFlamethrowerSound,
  rocket: playRocketLaunchSound,
  sniper: playSniperShotSound,
  brawler: playBrawlerShotSound,
  ultimate: playUltimateFireSound,
};

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

// продвигает age у всех живых разовых эффектов (телепорт/лазер/взрыв/пробитие
// стены и т.д.) и убирает истёкшие БЕЗ аллокации нового массива каждый кадр —
// раньше 7 однотипных списков эффектов делали array.filter() 60 раз/сек
// каждый (даже когда список пуст), что на 60fps даёт сотни лишних пустых
// аллокаций в секунду и лишнюю нагрузку на GC; simple in-place compaction
// той же идеи, что и в particles.js
function advanceEffects(list, ageStep) {
  let write = 0;
  for (let read = 0; read < list.length; read++) {
    const e = list[read];
    e.age += ageStep(e);
    if (e.age < 1) list[write++] = e;
  }
  list.length = write;
  return list;
}

const INTERP_SPEED = 12; // выше = быстрее "догоняет" серверную позицию

// dead reckoning: сколько максимум ЭКСТРАПОЛИРОВАТЬ позицию вперёд по
// последней известной скорости, если новый тик задерживается (плохая
// сеть/джиттер) — секунд. Дальше этого предела точность экстраполяции
// (движение по прямой без учёта столкновений/поворотов) уже хуже, чем
// просто стоять на месте, поэтому клампим, а не продолжаем бесконечно.
const DEAD_RECKON_MAX_SEC = 0.25;

// Владеет всеми ref'ами, отслеживающими визуальные/звуковые эффекты игры между
// кадрами (сглаженные позиции, партиклы, следы гусениц, вспышки взрывов/лазеров/
// телепортов/подборов и т.д.), и инкапсулирует логику детектирования игровых
// событий из серверного state (новая пуля/смерть/подбор/взрыв/...) -> звук +
// частицы + уведомление в UI. Вынесено из GameCanvas.jsx, где раньше вся эта
// логика была инлайн внутри draw() — тот же паттерн переиспользуемой stateful
// логики, что и у useGameSocket/useKeyboardInput/useMouseAim в этой директории.
export function useGameEffects(playerId, onGameEvent) {
  // сглаженные (интерполированные) позиции/углы игроков для плавного рендера
  const smoothRef = useRef(new Map());
  // dead reckoning: playerId -> {x, y, vx, vy, receivedAt} — "якорь" из
  // ПОСЛЕДНЕГО РЕАЛЬНОГО серверного тика (не путать со smooth, который уже
  // сглажен к цели). Раньше при задержке/джиттере сети следующий тик мог
  // не прийти вовремя — цель для smooth-lerp оставалась ЗАСТЫВШЕЙ на месте
  // последнего известного p.x/p.y, и танк визуально "тормозил и дёргался"
  // ровно в момент лага, даже если он продолжал реально двигаться. Теперь
  // между тиками позиция ЭКСТРАПОЛИРУЕТСЯ вперёд по последней известной
  // скорости (vx/vy уже приходят в state), и smooth подтягивается к этой
  // экстраполированной точке — движение остаётся плавным сквозь джиттер,
  // не залипая на старой точке до следующего реального обновления.
  const deadReckonRef = useRef(new Map());
  const particlesRef = useRef(createParticleSystem());
  const tracksRef = useRef(createTrackSystem());
  const lastBulletPos = useRef(new Map());
  const knownAliveState = useRef(new Map());
  const knownPickupIds = useRef(new Map()); // id -> {x, y, kind}, для вспышки подбора при исчезновении
  const knownBombIds = useRef(new Set());
  const isFirstPickupSync = useRef(true);
  const isFirstBombSync = useRef(true);
  const explosionsRef = useRef([]); // {x, y, radius, age}
  const wallBreaksRef = useRef([]); // {x, y, age} — эффект разрушения стены
  const wallHitsRef = useRef([]); // {x, y, age} — искра при попадании без разрушения
  const pierceHitsRef = useRef([]); // {x, y, age} — искра сквозного попадания снайпера (пуля летит дальше)
  const laserStarHitsRef = useRef([]); // {x, y, age} — искра попадания лазерной звезды
  const kickbackRef = useRef(new Map()); // playerId -> 0..1, отдача ствола
  const motionSmoothRef = useRef(new Map()); // playerId -> {emaSpeed, dirX, dirY} — EMA для эффекта разгона
  const laserChargingRef = useRef(new Set()); // playerId'ы, у которых лазер уже заряжался в прошлом кадре
  const laserShotsRef = useRef([]); // {x, y, angle, range, age} — вспышки фактических выстрелов лазера
  const lastMyHpRef = useRef(null); // отслеживаем свой HP между тиками — красная виньетка при уроне
  const hitFlashRef = useRef(0); // 0..1, затухающая яркость красной виньетки при получении урона
  const teleportEffectsRef = useRef([]); // {x, y, age} — вспышка появления после телепорта
  const armorShieldEffectsRef = useRef([]); // {x, y, age} — объёмная сфера-щит при подборе брони
  const hadNukeRef = useRef(false); // была ли ядерка активна в прошлом кадре (для звука появления)
  const shakeRef = useRef({ magnitude: 0 });
  // throttle звука выстрела — сервер шлёт КАЖДУЮ пулю каждого игрока в
  // комнате, и цикл ниже проигрывает звук на каждую новую пулю (не только
  // свою — так и задумано, чужую стрельбу должно быть слышно). При нескольких
  // активно стреляющих игроках (особенно пулемётчики, ~11 выстр/сек каждый)
  // это давало десятки Web Audio узлов в секунду на одном клиенте — заметная
  // доля времени кадра, подтверждено профилированием реального рендер-лупа
  // на проде. Один звук на короткое окно достаточен на слух (стрельба и так
  // читается как "шквал"), но не создаёт кучу параллельных узлов.
  const lastShotSoundAtRef = useRef(0);
  const SHOT_SOUND_THROTTLE_MS = 40; // не чаще ~25 звуков/сек суммарно по всем игрокам
  // сервер шлёт state 30 раз/сек, а draw() вызывается на каждый requestAnimationFrame
  // (~60 раз/сек) — без этой защиты один и тот же тик (с одним и тем же
  // непустым miniboss_spawns/level_ups/explosions/...) обрабатывался бы 2+ раза
  // подряд, пока не придёт следующий тик, дублируя баннеры/звуки/партиклы
  const lastProcessedStateRef = useRef(null);
  const lastRoundEndRef = useRef(null); // последний обработанный объект round_end (по ссылке)
  const onGameEventRef = useRef(onGameEvent);
  onGameEventRef.current = onGameEvent;

  // обрабатывает один кадр: обновляет сглаживание позиций, детектирует
  // игровые события (новые/исчезнувшие пули, смерти, подборы, взрывы,
  // лазеры, телепорты, порталы, повреждения стен) и триггерит звук/частицы/
  // UI-уведомления. Возвращает { isNewTick, smooth, particles, tracks } —
  // то немногое, что вызывающему draw() нужно достать по значению, остальное
  // читается напрямую из ref'ов, возвращённых этим хуком.
  const processTick = (current, dt, timestamp) => {
    // защита от повторной обработки одного и того же тика на нескольких
    // подряд requestAnimationFrame — см. комментарий у lastProcessedStateRef
    const isNewTick = current !== lastProcessedStateRef.current;
    lastProcessedStateRef.current = current;
    const smooth = smoothRef.current;
    const seenIds = new Set();

    // на КАЖДЫЙ новый серверный тик обновляем якорь dead reckoning реальными
    // данными (позиция + скорость + момент получения) — НЕ на каждый вызов
    // processTick, иначе якорь тоже "застывал" бы между тиками так же, как
    // раньше застывала цель интерполяции
    if (isNewTick) {
      for (const p of current.players || []) {
        deadReckonRef.current.set(p.id, {
          x: p.x,
          y: p.y,
          vx: p.vx ?? 0,
          vy: p.vy ?? 0,
          angle: p.turret_angle,
          receivedAt: timestamp,
        });
      }
    }

    // обновляем сглаженные позиции к ЭКСТРАПОЛИРОВАННОЙ (не сырой серверной)
    // цели — см. комментарий у deadReckonRef выше
    for (const p of current.players || []) {
      seenIds.add(p.id);
      const anchor = deadReckonRef.current.get(p.id);
      let targetX = p.x;
      let targetY = p.y;
      if (anchor) {
        const elapsed = Math.min(DEAD_RECKON_MAX_SEC, Math.max(0, (timestamp - anchor.receivedAt) / 1000));
        targetX = anchor.x + anchor.vx * elapsed;
        targetY = anchor.y + anchor.vy * elapsed;
      }

      const prev = smooth.get(p.id);
      if (!prev) {
        smooth.set(p.id, { x: targetX, y: targetY, angle: p.turret_angle });
      } else {
        const t = Math.min(1, INTERP_SPEED * dt);
        prev.x += (targetX - prev.x) * t;
        prev.y += (targetY - prev.y) * t;
        prev.angle = lerpAngle(prev.angle, p.turret_angle, t);
      }
    }
    // Array.from(map.keys()) убран — каждый цикл ниже удаляет только ТЕКУЩИЙ
    // ключ своей же итерации (delete/set текущего id), а Map-итератор по
    // спецификации безопасен именно к этому случаю (не безопасен только к
    // ДОБАВЛЕНИЮ новых ключей во время итерации, чего здесь не происходит) —
    // копия массива на каждый кадр была лишней аллокацией без необходимости.
    for (const id of smooth.keys()) {
      if (!seenIds.has(id)) smooth.delete(id);
    }
    // те же id, что и smooth — очищаем и остальные per-player Map'ы от
    // игроков, вышедших из комнаты. Раньше не чистились вообще: за долгую
    // работу сервера (постоянная ротация игроков, особенно с системой
    // раундов) эти Map росли неограниченно, что медленно, но неуклонно
    // замедляло .get()/.set() в горячем цикле рендера — источник
    // накапливающихся микро-лагов при долгой сессии.
    for (const id of motionSmoothRef.current.keys()) {
      if (!seenIds.has(id)) motionSmoothRef.current.delete(id);
    }
    for (const id of knownAliveState.current.keys()) {
      if (!seenIds.has(id)) knownAliveState.current.delete(id);
    }
    for (const id of deadReckonRef.current.keys()) {
      if (!seenIds.has(id)) deadReckonRef.current.delete(id);
    }

    const particles = particlesRef.current;

    // мини-босс стреляет обычными "cannon" пулями (не отдельным kind), но
    // звук должен отличаться от игрока — иначе залп по площади не читается
    // на слух как угроза от босса
    const minibossOwnerIds = new Set(
      (current.players || []).filter((p) => p.is_miniboss).map((p) => p.id)
    );

    // новые пули -> звук выстрела (зависит от типа оружия) + отдача ствола
    // + вспышка/дым; исчезнувшие пули -> искра на месте последней позиции
    const seenBulletIds = new Set();
    const salvoOwnersPlayed = new Set(); // залп босса — 1 звук на весь веер, не 5 подряд
    for (const b of current.bullets || []) {
      seenBulletIds.add(b.id);
      if (!lastBulletPos.current.has(b.id)) {
        const isBossBullet = minibossOwnerIds.has(b.owner_id);
        if (isBossBullet) {
          if (!salvoOwnersPlayed.has(b.owner_id)) {
            salvoOwnersPlayed.add(b.owner_id);
            playMinibossSalvoSound();
          }
        } else {
          // throttle только для ЧУЖИХ выстрелов — свой выстрел должен звучать
          // всегда мгновенно (задержка обратной связи на собственное действие
          // была бы заметна и неприятна игроку)
          const isOwn = b.owner_id === playerId;
          const canPlay = isOwn || timestamp - lastShotSoundAtRef.current >= SHOT_SOUND_THROTTLE_MS;
          if (canPlay) {
            if (!isOwn) lastShotSoundAtRef.current = timestamp;
            const soundFn = WEAPON_SHOOT_SOUND[b.kind] || playShotSound;
            soundFn();
          }
        }
        kickbackRef.current.set(b.owner_id ?? b.id, 1);
        const angle = Math.atan2(b.vy ?? 0, b.vx ?? 1);
        particles.spawnMuzzleSmoke(b.x, b.y, angle);
        if (b.kind !== "minigun") {
          shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 4);
        }
      }
      lastBulletPos.current.set(b.id, { x: b.x, y: b.y });
    }
    for (const [id, pos] of lastBulletPos.current) {
      if (!seenBulletIds.has(id)) {
        particles.spawnHitSpark(pos.x, pos.y);
        playHitSound();
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 2.5);
        lastBulletPos.current.delete(id);
      }
    }

    // затухание отдачи ствола каждого танка
    for (const [pid, k] of kickbackRef.current) {
      const next = Math.max(0, k - dt * 6);
      if (next <= 0.001) kickbackRef.current.delete(pid);
      else kickbackRef.current.set(pid, next);
    }

    // огнемёт: пока конус активен, каждый кадр подсыпаем частицы пламени
    for (const p of current.players || []) {
      if (p.is_flaming) {
        const s = smooth.get(p.id) || p;
        const tipX = s.x + Math.cos(s.angle ?? p.turret_angle) * 60;
        const tipY = s.y + Math.sin(s.angle ?? p.turret_angle) * 60;
        particles.spawnFlameParticles(tipX, tipY, s.angle ?? p.turret_angle);
      }
    }

    // переход alive: true -> false у любого игрока -> взрыв + звук
    for (const p of current.players || []) {
      const wasAlive = knownAliveState.current.get(p.id);
      if (wasAlive === true && !p.alive) {
        const pos = smooth.get(p.id) || p;
        particles.spawnExplosion(pos.x, pos.y);
        playExplosionSound();
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 9);
      }
      knownAliveState.current.set(p.id, p.alive);
    }

    // мой HP уменьшился между тиками -> красная виньетка по краям экрана —
    // ощутимый тактильный фидбэк "по тебе попали", раньше единственным
    // сигналом был числовой HP-бар в HUD, легко не заметить в горячке боя
    if (isNewTick) {
      const myPlayer = current.players?.find((p) => p.id === playerId);
      if (myPlayer && myPlayer.alive) {
        if (lastMyHpRef.current !== null && myPlayer.hp < lastMyHpRef.current) {
          const dmg = lastMyHpRef.current - myPlayer.hp;
          hitFlashRef.current = Math.min(1, hitFlashRef.current + 0.3 + dmg / 100);
        }
        lastMyHpRef.current = myPlayer.hp;
      } else if (myPlayer && !myPlayer.alive) {
        lastMyHpRef.current = null;
      }
    }
    hitFlashRef.current = Math.max(0, hitFlashRef.current - dt * 2.5);

    // дроп исчез (кто-то подобрал) -> звук + вспышка частиц на месте,
    // своя по типу бонуса (см. spawnPickupBurst в particles.js)
    const seenPickupIds = new Map();
    for (const pu of current.pickups || []) {
      seenPickupIds.set(pu.id, pu);
    }
    if (!isFirstPickupSync.current) {
      for (const [id, pu] of knownPickupIds.current) {
        if (!seenPickupIds.has(id)) {
          playPickupSound();
          particles.spawnPickupBurst(pu.x, pu.y, pu.kind);
          // броня получает отдельный объёмный эффект сферы-щита поверх
          // обычных частиц — по просьбе пользователя частицы одни не
          // читались как "щит", нужен явный раздувающийся купол
          if (pu.kind === "armor") {
            armorShieldEffectsRef.current.push({ x: pu.x, y: pu.y, age: 0 });
          }
        }
      }
    }
    isFirstPickupSync.current = false;
    knownPickupIds.current = seenPickupIds;
    advanceEffects(armorShieldEffectsRef.current, () => dt / 0.55);

    // новая бомба-предупреждение появилась на карте -> короткий "бип"
    const seenBombIds = new Set();
    for (const bomb of current.bombs || []) {
      seenBombIds.add(bomb.id);
      if (!isFirstBombSync.current && !knownBombIds.current.has(bomb.id)) {
        playBombWarningSound();
      }
    }
    isFirstBombSync.current = false;
    knownBombIds.current = seenBombIds;

    // ядерка появилась -> тревожная сирена (один раз при появлении, не каждый кадр)
    if (current.nuke && !hadNukeRef.current) {
      playNukeWarningSound();
      onGameEventRef.current?.({ type: "nuke_warning" });
    }
    hadNukeRef.current = Boolean(current.nuke);

    // мини-босс появился на карте -> звук + уведомление в UI (только на
    // новый тик — иначе один и тот же спавн триггерит баннер на каждый
    // requestAnimationFrame, пока сервер не пришлёт следующий тик)
    if (isNewTick) {
      for (const spawn of current.miniboss_spawns || []) {
        playMinibossSpawnSound();
        onGameEventRef.current?.({ type: "miniboss_spawn", owner: spawn.owner });
      }
    }

    // игрок поднял уровень -> звук (для себя) + частицы, уведомление в UI
    if (isNewTick) {
      for (const levelUp of current.level_ups || []) {
        if (levelUp.player_id === playerId) {
          playLevelUpSound();
          onGameEventRef.current?.({ type: "level_up", level: levelUp.level });
        }
        const p = current.players?.find((pl) => pl.id === levelUp.player_id);
        if (p) particles.spawnExplosion(p.x, p.y, 0.5);
      }
    }

    // раунд закончился -> уведомление в UI с победителем. round_end — не
    // массив разовых событий (как level_ups/miniboss_spawns), а единичное
    // поле, непустое ровно один тик — отслеживаем по ссылке, чтобы не
    // сработать повторно, пока сервер не пришлёт следующий объект
    if (isNewTick && current.round_end && current.round_end !== lastRoundEndRef.current) {
      lastRoundEndRef.current = current.round_end;
      onGameEventRef.current?.({ type: "round_end", winner: current.round_end });
    }

    // лазер мини-босса заряжается -> звук нарастания один раз при начале
    // заряда (не каждый тик, пока идёт телеграф); фактический выстрел ->
    // вспышка луча + отдельный звук
    const chargingNow = new Set();
    for (const p of current.players || []) {
      if (p.laser_charging) {
        chargingNow.add(p.id);
        if (!laserChargingRef.current.has(p.id)) {
          playMinibossLaserChargeSound();
        }
      }
    }
    laserChargingRef.current = chargingNow;

    if (isNewTick) {
      for (const shot of current.laser_shots || []) {
        laserShotsRef.current.push({ ...shot, age: 0 });
        playMinibossLaserFireSound();
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 10);
      }
    }

    // телепорт игрока -> вспышка на новом месте + сброс сглаживания (иначе
    // интерполяция "провезёт" танк по прямой от старой точки к новой)
    if (isNewTick) {
      for (const tp of current.teleports || []) {
        teleportEffectsRef.current.push({ x: tp.x, y: tp.y, age: 0 });
        const s = smooth.get(tp.player_id);
        if (s) {
          s.x = tp.x;
          s.y = tp.y;
        }
        if (tp.player_id === playerId) playTeleportSound();
      }
    }
    advanceEffects(teleportEffectsRef.current, () => dt / 0.35);

    // новая пара порталов появилась/исчезла на карте -> звук (не привязан
    // к конкретному игроку, слышен всем — это событие карты, не способность)
    if (isNewTick) {
      for (const ev of current.portal_events || []) {
        if (ev.type === "spawn") playPortalSpawnSound();
      }
    }
    advanceEffects(laserShotsRef.current, () => dt / LASER_SHOT_LIFETIME);

    // серверные события взрыва (ракета/бомба) -> визуальная ударная волна
    // + звук; отслеживаем по количеству, т.к. explosions приходят как
    // "снимок за этот тик" без стабильных id
    if (isNewTick) {
      for (const ex of current.explosions || []) {
        const isNuke = ex.kind === "nuke";
        explosionsRef.current.push({ x: ex.x, y: ex.y, radius: ex.radius, age: 0, kind: ex.kind });
        // ядерка — заметно масштабнее и дольше: больше частиц, сильнее тряска
        particles.spawnExplosion(ex.x, ex.y, isNuke ? 4 : 1.6);
        playExplosionSound(true);
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, isNuke ? 26 : 12);
      }
    }
    advanceEffects(explosionsRef.current, (e) => dt / (e.kind === "nuke" ? NUKE_EXPLOSION_LIFETIME : EXPLOSION_LIFETIME));

    // стена сломана оружием игрока -> обвал обломков + звук + тряска
    if (isNewTick) {
      for (const brk of current.wall_breaks || []) {
        wallBreaksRef.current.push({ x: brk.x, y: brk.y, age: 0 });
        particles.spawnExplosion(brk.x, brk.y, 0.9);
        playWallBreakSound();
        shakeRef.current.magnitude = Math.max(shakeRef.current.magnitude, 6);
      }
    }
    advanceEffects(wallBreaksRef.current, () => dt / WALL_BREAK_LIFETIME);

    // попадание в стену без разрушения -> короткая искра + глухой удар
    if (isNewTick) {
      for (const hit of current.wall_hits || []) {
        wallHitsRef.current.push({ x: hit.x, y: hit.y, age: 0 });
        playWallHitSound();
      }
    }
    advanceEffects(wallHitsRef.current, () => dt / WALL_HIT_LIFETIME);

    // сквозная пуля снайпера пробила цель -> лёгкая искра в точке контакта,
    // САМА пуля НЕ гаснет (в отличие от wall_hits это не связано со стеной) —
    // без этого попадание визуально читалось как промах, хотя урон прошёл
    if (isNewTick) {
      for (const hit of current.hit_sparks || []) {
        pierceHitsRef.current.push({ x: hit.x, y: hit.y, age: 0 });
      }
    }
    advanceEffects(pierceHitsRef.current, () => dt / PIERCE_HIT_LIFETIME);

    // лазерная звезда задела цель -> искра в точке контакта — без этого
    // попадание луча читалось как "просто мигает рядом", а не реальный удар
    if (isNewTick) {
      for (const hit of current.laser_star_hits || []) {
        laserStarHitsRef.current.push({ x: hit.x, y: hit.y, age: 0 });
      }
    }
    advanceEffects(laserStarHitsRef.current, () => dt / LASER_STAR_HIT_LIFETIME);

    particles.update(dt);

    return { isNewTick, smooth, particles, tracks: tracksRef.current };
  };

  return {
    processTick,
    smoothRef,
    particlesRef,
    tracksRef,
    kickbackRef,
    motionSmoothRef,
    explosionsRef,
    wallBreaksRef,
    wallHitsRef,
    pierceHitsRef,
    laserStarHitsRef,
    laserShotsRef,
    teleportEffectsRef,
    armorShieldEffectsRef,
    hitFlashRef,
    shakeRef,
  };
}

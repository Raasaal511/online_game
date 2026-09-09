import { useEffect, useRef } from "react";
import { useMouseAim } from "../hooks/useMouseAim.js";
import { useActionKeys } from "../hooks/useActionKeys.js";
import { useGameEffects } from "../hooks/useGameEffects.js";
import {
  drawFloor,
  drawWall3D,
  drawPickup3D,
  drawBullet3D,
  drawTank3D,
  drawTrap3D,
  drawFlameCone3D,
  drawMuzzleFlash3D,
  drawBomb3D,
  drawNukeWarning3D,
  drawNukeScreenWarning3D,
  drawCastShadow,
  drawExplosion3D,
  drawNukeExplosion3D,
  drawGroundDust3D,
  drawLaserCharge3D,
  drawLaserShot3D,
  drawLaserStar3D,
  drawTeleportEffect3D,
  drawArmorShieldEffect3D,
  drawPortal3D,
  drawWallBreakEffect3D,
  drawWallHitSpark3D,
  drawPierceHitSpark3D,
  drawPitZone3D,
  drawParticles3D,
  computeTankSize,
  getMuzzleBarrelLength,
  screenY,
} from "../game/render3d.js";
import { unlockAudio } from "../game/sound.js";

const TANK_SIZE = 32;
const MINIBOSS_TANK_SIZE = 96; // синхронизировано с MINIBOSS_SIZE на сервере — втрое крупнее обычного танка

const PICKUP_COLORS = {
  heal: "#22c55e",
  armor: "#38bdf8",
  damage: "#f97316",
  speed: "#facc15",
  super: "#f472b6",
  // "minigun" оставлен как безопасный fallback-цвет — сам пикап больше не
  // спавнится (см. PICKUP_KINDS в room.py), но старое поле не мешает никому
  minigun: "#fde047",
  flamethrower: "#f97316",
  rocket: "#ef4444",
  ice: "#7dd3fc",
};

const EMPTY_STATE = { players: [], bullets: [], pickups: [] };

export default function GameCanvas({
  subscribeState,
  mapInfo,
  playerId,
  sendAim,
  sendShoot,
  sendUltimate,
  onGameEvent,
}) {
  const canvasRef = useRef(null);
  // каждый тик (30/сек) приходит сюда напрямую через подписку, минуя React
  // state/ре-рендер — см. комментарий у HUD_THROTTLE_MS в useGameSocket.js
  const stateRef = useRef(EMPTY_STATE);

  useEffect(() => {
    if (!subscribeState) return undefined;
    return subscribeState((data) => {
      stateRef.current = data;
    });
  }, [subscribeState]);

  // весь трекинг визуальных/звуковых эффектов между кадрами (сглаживание,
  // партиклы, вспышки взрывов/лазеров/телепортов, детектирование игровых
  // событий из state -> звук/UI) вынесен в переиспользуемый хук — см.
  // frontend/src/hooks/useGameEffects.js
  const {
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
    laserShotsRef,
    teleportEffectsRef,
    armorShieldEffectsRef,
    hitFlashRef,
    shakeRef,
  } = useGameEffects(playerId, onGameEvent);

  const fieldWidth = mapInfo.field?.width || 1760;
  const fieldHeight = mapInfo.field?.height || 1140;
  const walls = mapInfo.walls || [];
  const traps = mapInfo.traps || [];
  const pitZones = mapInfo.pit_zones || [];

  const handleShoot = () => {
    unlockAudio();
    sendShoot(false);
  };

  const handleShootPickup = () => {
    unlockAudio();
    sendShoot(true);
  };

  const { mouseRef, isFiringRef, isFiringPickupRef } = useMouseAim(
    canvasRef,
    () => {},
    handleShoot,
    handleShootPickup
  );

  useActionKeys(sendUltimate);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationFrame;
    let lastAimSent = 0;
    let lastAutoShotAt = 0;
    let lastAutoShotPickupAt = 0;
    let lastTime = performance.now();

    const draw = (timestamp) => {
      const dt = Math.min(0.1, (timestamp - lastTime) / 1000);
      lastTime = timestamp;

      const current = stateRef.current;
      const { smooth, particles } = processTick(current, dt, timestamp);

      // единый проход по живым игрокам со сглаженными координатами — раньше
      // players.filter(alive).map(...) выполнялся 3 раза за кадр отдельно
      // (для следов гусениц, для теней, и инлайн при сборке sceneObjects),
      // каждый раз заново аллоцируя массив и вызывая smooth.get(); данные
      // на 100% пересекаются, поэтому строим один раз и переиспользуем везде
      const aliveTanksData = [];
      for (const p of current.players || []) {
        if (!p.alive) continue;
        const s = smooth.get(p.id);
        const x = s?.x ?? p.x;
        const y = s?.y ?? p.y;
        const motion = motionSmoothRef.current.get(p.id);
        const moveAngle = motion ? Math.atan2(motion.dirY, motion.dirX) : (s?.angle ?? p.turret_angle);
        aliveTanksData.push({
          player: p,
          x,
          y,
          turret_angle: s?.angle ?? p.turret_angle,
          moveAngle,
          speed: p.speed,
          size: p.is_miniboss ? MINIBOSS_TANK_SIZE : TANK_SIZE,
        });
      }

      // следы гусениц: используем сглаженные позиции + серверную скорость,
      // чтобы след появлялся плавно синхронно с визуальным движением танка
      const tracks = tracksRef.current;
      for (const t of aliveTanksData) {
        if ((t.speed ?? 0) > 100 && Math.random() < 0.3) {
          // пыль вылетает из-под гусениц (по бокам корпуса), не из
          // геометрического центра танка — раньше клубы пыли рождались
          // прямо посередине силуэта, что выглядело нефизично
          const perpX = Math.cos(t.moveAngle + Math.PI / 2);
          const perpY = Math.sin(t.moveAngle + Math.PI / 2);
          const side = Math.random() < 0.5 ? 1 : -1;
          const trackOffset = t.size * 0.32;
          particles.spawnDust(
            t.x + perpX * trackOffset * side,
            t.y + perpY * trackOffset * side,
            t.moveAngle,
            t.speed
          );
        }
      }
      tracks.update(
        aliveTanksData.map((t) => ({
          id: t.player.id,
          x: t.x,
          y: t.y,
          turret_angle: t.turret_angle,
          moveAngle: t.moveAngle,
          alive: true,
          speed: t.speed,
        })),
        timestamp / 1000
      );

      const me = current.players?.find((p) => p.id === playerId);
      const meSmooth = smooth.get(playerId);

      // отправляем угол прицеливания не чаще ~20 раз/сек, считая от сглаженной позиции танка
      if (me && me.alive && meSmooth && timestamp - lastAimSent > 50) {
        lastAimSent = timestamp;
        const dx = mouseRef.current.x - meSmooth.x;
        const dy = mouseRef.current.y - meSmooth.y;
        if (Math.hypot(dx, dy) > 1) {
          sendAim(Math.atan2(dy, dx));
        }
      }

      // автоматическое оружие класса (пулемёт стреляет очень быстро) —
      // непрерывно по зажатой ЛКМ, базовый одиночный выстрел по клику уже
      // обработан в useMouseAim
      if (me && me.alive && isFiringRef.current && me.tank_class === "gunner" && timestamp - lastAutoShotAt > 60) {
        lastAutoShotAt = timestamp;
        sendShoot(false);
      }

      // подобранный с карты пикап (пулемёт/огнемёт) — ДОПОЛНИТЕЛЬНЫЙ режим
      // атаки по зажатой ПКМ, независимо от класса и от того, что делает ЛКМ
      if (
        me &&
        me.alive &&
        isFiringPickupRef.current &&
        (me.weapon === "minigun" || me.weapon === "flamethrower") &&
        timestamp - lastAutoShotPickupAt > 90
      ) {
        lastAutoShotPickupAt = timestamp;
        sendShoot(true);
      }

      // screen-shake: короткий импульс при попадании/взрыве, затухает со временем
      const shake = shakeRef.current;
      shake.magnitude *= Math.max(0, 1 - dt * 10);
      const shakeX = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;
      const shakeY = shake.magnitude > 0.05 ? (Math.random() - 0.5) * shake.magnitude : 0;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(shakeX, shakeY);

      drawFloor(ctx, canvas.width, canvas.height);

      // яма вокруг супер-пикапа — часть уровня земли (статичная геометрия
      // карты, пришла один раз в mapInfo), рисуется сразу после пола, до
      // следов гусениц/танков, как и провал в полу должен лежать физически
      for (const zone of pitZones) {
        drawPitZone3D(ctx, zone, timestamp / 1000);
      }

      // следы гусениц лежат прямо на полу, ниже всех объектов painter's algorithm
      tracks.draw(ctx);

      // пыль из-под гусениц — тоже на уровне пола, ДО отрисовки танков, иначе
      // клубы пыли перекрывали бы танк сверху (раньше шли через общий поток
      // частиц, рисуемый в конце кадра поверх всей сцены)
      drawGroundDust3D(ctx, particles.getParticles());

      // ловушки тоже плоские декали на полу — рисуются перед сортировкой
      // по глубине, чтобы танки/пули всегда перекрывали их визуально
      for (const trap of traps) {
        drawTrap3D(ctx, trap, timestamp / 1000);
      }

      // предупреждения о падающих бомбах — тоже на уровне пола
      for (const bomb of current.bombs || []) {
        drawBomb3D(ctx, bomb, timestamp / 1000);
      }

      // ядерка — редкое глобальное событие, рисуется поверх бомб (крупнее и заметнее)
      if (current.nuke) {
        drawNukeWarning3D(ctx, current.nuke, timestamp / 1000);
      }

      // динамическое состояние разрушаемых стен (active/hp) приходит в
      // каждом тике отдельно от статичной геометрии (mapInfo.walls, один раз
      // при welcome) — объединяем по id перед отрисовкой
      const wallStateById = new Map();
      for (const ws of current.wall_states || []) {
        wallStateById.set(ws.id, ws);
      }

      // отбрасываемые тени: танки рядом со стенами/друг с другом кидают тень
      // на соседний объект (contact shadow) — раньше каждый объект отбрасывал
      // тень только сам под собой, теперь тень "дотягивается" до соседей.
      // Ограничено ~10 танками и стенами рядом — дёшево, не требует spatial index.
      const aliveTanks = aliveTanksData;
      for (let i = 0; i < aliveTanks.length; i++) {
        const tank = aliveTanks[i];
        for (const w of walls) {
          const wallState = wallStateById.get(w.id);
          if (wallState && !wallState.active) continue;
          const closestX = Math.max(w.x, Math.min(tank.x, w.x + w.width));
          const closestY = Math.max(w.y, Math.min(tank.y, w.y + w.height));
          const dist = Math.hypot(tank.x - closestX, tank.y - closestY);
          if (dist < 60) {
            drawCastShadow(ctx, tank.x, tank.y, tank.size, 55);
            break; // одной тени на ближайшую стену достаточно
          }
        }
        for (let j = i + 1; j < aliveTanks.length; j++) {
          const other = aliveTanks[j];
          const dist = Math.hypot(tank.x - other.x, tank.y - other.y);
          if (dist < 50) {
            drawCastShadow(ctx, tank.x, tank.y, tank.size, 45);
            drawCastShadow(ctx, other.x, other.y, other.size, 45);
          }
        }
      }

      // painter's algorithm: все объекты сцены сортируются по Y (глубине),
      // чтобы дальние перекрывались ближними как в настоящей 3D-сцене
      const sceneObjects = [];
      for (const w of walls) {
        const dynamicState = wallStateById.get(w.id);
        const merged = dynamicState
          ? { ...w, active: dynamicState.active, hp: dynamicState.hp }
          : w;
        sceneObjects.push({ type: "wall", y: w.y + w.height, data: merged });
      }
      for (const pu of current.pickups || []) {
        sceneObjects.push({ type: "pickup", y: pu.y, data: pu });
      }
      for (const portal of current.portals || []) {
        sceneObjects.push({ type: "portal", y: portal.y, data: portal });
      }
      for (const t of aliveTanksData) {
        sceneObjects.push({
          type: "tank",
          y: t.y,
          data: { ...t.player, x: t.x, y: t.y, turret_angle: t.turret_angle },
        });
      }
      for (const b of current.bullets || []) {
        sceneObjects.push({ type: "bullet", y: b.y, data: b });
      }

      sceneObjects.sort((a, b) => a.y - b.y);

      for (const obj of sceneObjects) {
        if (obj.type === "wall") {
          drawWall3D(ctx, obj.data);
        } else if (obj.type === "pickup") {
          drawPickup3D(ctx, obj.data, PICKUP_COLORS, timestamp / 1000);
        } else if (obj.type === "portal") {
          drawPortal3D(ctx, obj.data, timestamp / 1000);
        } else if (obj.type === "tank") {
          if (obj.data.is_flaming) {
            drawFlameCone3D(ctx, obj.data, timestamp / 1000);
          }
          const kickback = kickbackRef.current.get(obj.data.id) || 0;

          // эффект разгона: сервер шлёт speed раз в тик (~33мс), а кадры рендера
          // идут на 60fps (~16мс) — сравнение "сырой" скорости между соседними
          // КАДРАМИ давало на каждом новом тике скачкообразную, шумную дельту
          // (корпус резко дёргался в сторону). EMA сглаживает скорость по
          // времени, а не по кадру — стабильно и плавно.
          let motion = motionSmoothRef.current.get(obj.data.id);
          if (!motion) {
            motion = {
              emaSpeed: 0,
              dirX: Math.cos(obj.data.turret_angle),
              dirY: Math.sin(obj.data.turret_angle),
              wasMoving: false,
            };
          }
          const rawSpeed = obj.data.speed ?? 0;
          const speedAlpha = Math.min(1, dt * 8); // ~125мс до устаканивания
          const prevEmaSpeed = motion.emaSpeed;
          motion.emaSpeed += (rawSpeed - motion.emaSpeed) * speedAlpha;
          // порог был 20 px/sec — танк разгоняется инерционно (TANK_ACCEL на
          // сервере), поэтому первые несколько тиков после старта rawSpeed
          // проходит диапазон 1..20 НИЖЕ порога: motion.dirX/dirY всё это
          // время не обновлялись вообще (условие ниже не выполнялось), а
          // затем при пересечении 20 направление СКАЧКОМ вставало на место —
          // ровно это и читалось как "дёргается в начале движения". Порог
          // снижен почти до нуля (1 px/sec — уже не шум, реальное начало
          // движения), скачка направления больше нет с первого же тика.
          if (rawSpeed > 1) {
            const targetDirX = obj.data.vx / rawSpeed;
            const targetDirY = obj.data.vy / rawSpeed;
            if (!motion.wasMoving) {
              // старт движения с места (или после полной остановки) — корпус
              // сразу смотрит туда, куда едет, без "довода" через EMA. Раньше
              // dirX/dirY на старте наследовалось от угла ПРИЦЕЛА (турели), и
              // если игрок целился в одну сторону, а поехал в другую, EMA
              // несколько кадров "доводил" направление корпуса — читалось как
              // рывок/дёрганье в момент старта и как "странный" поворот.
              motion.dirX = targetDirX;
              motion.dirY = targetDirY;
            } else {
              // уже едем — плавно доворачиваем направление корпуса при смене курса
              const dirAlpha = Math.min(1, dt * 10);
              motion.dirX += (targetDirX - motion.dirX) * dirAlpha;
              motion.dirY += (targetDirY - motion.dirY) * dirAlpha;
            }
            motion.wasMoving = true;
          } else {
            motion.wasMoving = false;
          }
          motionSmoothRef.current.set(obj.data.id, motion);

          const accelBoost = Math.max(0, Math.min(1, (motion.emaSpeed - prevEmaSpeed) / dt / 400));
          const moveAngle = Math.atan2(motion.dirY, motion.dirX);

          // резкий разгон с места — всплеск пыли из-под гусениц (по бокам
          // корпуса, не из центра), отдельно от обычной пыли на ходу (та
          // зависит только от текущей скорости)
          if (accelBoost > 0.4) {
            const burstSize = obj.data.is_miniboss ? MINIBOSS_TANK_SIZE : TANK_SIZE;
            const perpX = Math.cos(moveAngle + Math.PI / 2);
            const perpY = Math.sin(moveAngle + Math.PI / 2);
            const trackOffset = burstSize * 0.32;
            particles.spawnDust(
              obj.data.x + perpX * trackOffset,
              obj.data.y + perpY * trackOffset,
              moveAngle,
              motion.emaSpeed,
              true
            );
            particles.spawnDust(
              obj.data.x - perpX * trackOffset,
              obj.data.y - perpY * trackOffset,
              moveAngle,
              motion.emaSpeed,
              true
            );
          }

          drawTank3D(ctx, obj.data, obj.data.id === playerId, TANK_SIZE, timestamp / 1000, kickback, accelBoost, moveAngle);
          if (kickback > 0.5) {
            // позиция вспышки должна точно совпадать с реальным концом
            // ствола, нарисованным внутри drawTank3D — раньше считалась от
            // фиксированной константы TANK_SIZE без учёта класса танка
            // (снайпер/brawler/gunner рисуют стволы разной длины) и без
            // учёта роста корпуса от уровня/супер-баффа, из-за чего вспышка
            // "отставала" от дульного среза почти у всех, кроме базовой пушки
            const baseSize = obj.data.is_miniboss ? MINIBOSS_TANK_SIZE : TANK_SIZE;
            const tankSize = computeTankSize(
              baseSize,
              obj.data.level ?? 1,
              obj.data.is_miniboss,
              obj.data.has_super,
              timestamp / 1000
            );
            const barrelLen = getMuzzleBarrelLength(tankSize, obj.data.tank_class, obj.data.is_miniboss);
            const turretZ = (obj.data.is_miniboss ? 22 : 10) + 8;
            const flashX = obj.data.x + Math.cos(obj.data.turret_angle) * barrelLen;
            const flashY = screenY(obj.data.y, turretZ) + Math.sin(obj.data.turret_angle) * barrelLen;
            drawMuzzleFlash3D(ctx, flashX, flashY, obj.data.turret_angle, kickback);
          }
          if (obj.data.laser_charging) {
            drawLaserCharge3D(
              ctx,
              obj.data.x,
              obj.data.y,
              obj.data.laser_charging.angle,
              obj.data.laser_charging.progress,
              obj.data.laser_charging.range
            );
          }
          if (obj.data.laser_star_active && obj.data.laser_star_angles?.length) {
            drawLaserStar3D(
              ctx,
              obj.data.x,
              obj.data.y,
              obj.data.laser_star_angles,
              obj.data.laser_star_lengths || [],
              timestamp / 1000
            );
          }
        } else if (obj.type === "bullet") {
          drawBullet3D(ctx, obj.data, timestamp / 1000);
        }
      }

      // взрывы ракет/бомб поверх всей сцены
      for (const explosion of explosionsRef.current) {
        if (explosion.kind === "nuke") {
          drawNukeExplosion3D(ctx, explosion, explosion.age);
          continue;
        }
        drawExplosion3D(ctx, explosion, explosion.age);
      }

      // вспышки фактических выстрелов лазера мини-босса
      for (const shot of laserShotsRef.current) {
        drawLaserShot3D(ctx, shot, shot.age);
      }

      // вспышки телепорта
      for (const eff of teleportEffectsRef.current) {
        drawTeleportEffect3D(ctx, eff, eff.age);
      }

      // сферы-щиты при подборе брони
      for (const eff of armorShieldEffectsRef.current) {
        drawArmorShieldEffect3D(ctx, eff, eff.age);
      }

      // эффекты попаданий/разрушения стен
      for (const hit of wallHitsRef.current) {
        drawWallHitSpark3D(ctx, hit, hit.age);
      }
      for (const brk of wallBreaksRef.current) {
        drawWallBreakEffect3D(ctx, brk, brk.age);
      }
      // сквозные попадания снайпера — пуля летит дальше, но контакт виден
      for (const hit of pierceHitsRef.current) {
        drawPierceHitSpark3D(ctx, hit, hit.age);
      }

      // частицы (взрывы, искры, дым, пламя) поверх всего, с псевдо-3D высотой
      drawParticles3D(ctx, particles.getParticles());

      ctx.restore();

      // экранная кромка предупреждения о ядерке — тоже ПОСЛЕ restore(), тем
      // же способом, что и красная виньетка урона ниже (см. drawNukeScreenWarning3D)
      if (current.nuke) {
        drawNukeScreenWarning3D(ctx, current.nuke, timestamp / 1000, canvas.width, canvas.height);
      }

      // красная виньетка урона — рисуется ПОСЛЕ restore(), не подвержена
      // screen-shake трансформации (виньетка привязана к экрану, не к миру)
      if (hitFlashRef.current > 0.01) {
        const vignette = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          Math.min(canvas.width, canvas.height) * 0.32,
          canvas.width / 2,
          canvas.height / 2,
          Math.max(canvas.width, canvas.height) * 0.62
        );
        const alpha = hitFlashRef.current * 0.55;
        vignette.addColorStop(0, "rgba(220, 38, 38, 0)");
        vignette.addColorStop(1, `rgba(220, 38, 38, ${alpha})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [playerId, walls, traps, sendAim, sendShoot]);

  return (
    <canvas
      ref={canvasRef}
      width={fieldWidth}
      height={fieldHeight}
      style={{
        display: "block",
        border: "2px solid #334155",
        borderRadius: "8px",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(148, 163, 184, 0.08)",
        cursor: "crosshair",
        // ограничиваем ОБА измерения доступным пространством, сохраняя
        // соотношение сторон карты — иначе на невысоких viewport (маленькое
        // окно браузера) canvas вылезал за пределы экрана и создавал скролл
        maxWidth: "100%",
        maxHeight: "100%",
        width: "auto",
        height: "auto",
        objectFit: "contain",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: "none",
      }}
    />
  );
}

let ctx = null;
let noiseBuffer = null; // общий preset-буфер белого шума — переиспользуется всеми playNoise()

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
}

// один переиспользуемый буфер шума фиксированной длины (1 сек с запасом),
// а не новый createBuffer()+Math.random()-заполнение на КАЖДЫЙ вызов
// playNoise — при частой стрельбе (пулемёт ~11 выстр/сек) генерация буфера
// синхронно в основном потоке при каждом выстреле давала заметные лаги и
// заставляла звук отставать от игровых событий. Разные duration/filterFreq
// просто проигрывают срез этого же буфера с разной длительностью/фильтром.
function getNoiseBuffer(audioCtx) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== audioCtx.sampleRate) {
    const bufferSize = audioCtx.sampleRate * 1; // 1 сек — с запасом длиннее любого duration
    noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

function playTone({ freq, duration, type = "sine", volume = 0.2, freqEnd = null }) {
  const audioCtx = getCtx();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (freqEnd !== null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(freqEnd, 1),
      audioCtx.currentTime + duration
    );
  }

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playNoise({ duration, volume = 0.2, filterFreq = 1000 }) {
  const audioCtx = getCtx();
  const noise = audioCtx.createBufferSource();
  noise.buffer = getNoiseBuffer(audioCtx);
  noise.loop = false;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + duration);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  noise.start();
  noise.stop(audioCtx.currentTime + duration);
}

export function playShotSound() {
  // танковый выстрел: басовый "удар" (низкий sawtooth) + шумовой хлопок сверху —
  // вместе читается заметно мощнее прежнего одиночного тона
  try {
    playTone({ freq: 150, freqEnd: 45, duration: 0.16, type: "sawtooth", volume: 0.22 });
    playNoise({ duration: 0.08, volume: 0.18, filterFreq: 2500 });
  } catch (e) {
    /* аудио может быть недоступно до первого пользовательского жеста */
  }
}

export function playMinigunSound() {
  try {
    playTone({ freq: 320, freqEnd: 160, duration: 0.05, type: "square", volume: 0.1 });
  } catch (e) {
    /* ignore */
  }
}

export function playFlamethrowerSound() {
  try {
    playNoise({ duration: 0.12, volume: 0.08, filterFreq: 900 });
  } catch (e) {
    /* ignore */
  }
}

export function playRocketLaunchSound() {
  try {
    playTone({ freq: 90, freqEnd: 40, duration: 0.3, type: "sawtooth", volume: 0.2 });
    playNoise({ duration: 0.2, volume: 0.12, filterFreq: 1200 });
  } catch (e) {
    /* ignore */
  }
}

export function playHitSound() {
  try {
    playTone({ freq: 440, freqEnd: 220, duration: 0.08, type: "triangle", volume: 0.12 });
  } catch (e) {
    /* ignore */
  }
}

export function playExplosionSound(big = false) {
  try {
    const mult = big ? 1.8 : 1;
    playNoise({ duration: 0.4 * mult, volume: 0.25 * mult, filterFreq: 1500 });
    playTone({ freq: 100, freqEnd: 25, duration: 0.35 * mult, type: "sawtooth", volume: 0.18 * mult });
  } catch (e) {
    /* ignore */
  }
}

export function playPickupSound() {
  try {
    playTone({ freq: 523, freqEnd: 784, duration: 0.15, type: "sine", volume: 0.15 });
  } catch (e) {
    /* ignore */
  }
}

export function playWallHitSound() {
  try {
    playNoise({ duration: 0.1, volume: 0.15, filterFreq: 800 });
    playTone({ freq: 180, freqEnd: 90, duration: 0.1, type: "square", volume: 0.1 });
  } catch (e) {
    /* ignore */
  }
}

export function playWallBreakSound() {
  try {
    playNoise({ duration: 0.3, volume: 0.28, filterFreq: 2000 });
    playTone({ freq: 120, freqEnd: 40, duration: 0.25, type: "sawtooth", volume: 0.15 });
  } catch (e) {
    /* ignore */
  }
}

export function playBombWarningSound() {
  try {
    playTone({ freq: 700, duration: 0.1, type: "square", volume: 0.06 });
  } catch (e) {
    /* ignore */
  }
}

export function playNukeWarningSound() {
  // тревожная сирена — заметно громче/ниже, чем обычная бомба, длится дольше
  try {
    playTone({ freq: 220, freqEnd: 440, duration: 0.5, type: "sawtooth", volume: 0.2 });
    playTone({ freq: 440, freqEnd: 220, duration: 0.5, type: "sawtooth", volume: 0.15 });
  } catch (e) {
    /* ignore */
  }
}

export function playLevelUpSound() {
  try {
    playTone({ freq: 392, freqEnd: 659, duration: 0.2, type: "sine", volume: 0.18 });
  } catch (e) {
    /* ignore */
  }
}

export function playMinibossSalvoSound() {
  // отличается от обычного выстрела намеренно — низкий "утробный" гул под
  // хлопком, чтобы игрок на слух узнавал залп босса, не глядя на экран
  try {
    playTone({ freq: 130, freqEnd: 35, duration: 0.22, type: "sawtooth", volume: 0.24 });
    playNoise({ duration: 0.14, volume: 0.16, filterFreq: 1800 });
  } catch (e) {
    /* ignore */
  }
}

export function playMinibossLaserChargeSound() {
  // нарастающий тон во время прицеливания — предупреждает на слух ещё до
  // визуального телеграфа, что сейчас ударит лазер
  try {
    playTone({ freq: 200, freqEnd: 900, duration: 0.85, type: "sine", volume: 0.1 });
  } catch (e) {
    /* ignore */
  }
}

export function playMinibossLaserFireSound() {
  try {
    playTone({ freq: 1200, freqEnd: 200, duration: 0.3, type: "sawtooth", volume: 0.28 });
    playNoise({ duration: 0.25, volume: 0.2, filterFreq: 3000 });
  } catch (e) {
    /* ignore */
  }
}

export function playMinibossSpawnSound() {
  try {
    playTone({ freq: 60, freqEnd: 40, duration: 0.6, type: "sawtooth", volume: 0.22 });
    playNoise({ duration: 0.4, volume: 0.15, filterFreq: 600 });
  } catch (e) {
    /* ignore */
  }
}

export function playSniperShotSound() {
  try {
    playTone({ freq: 260, freqEnd: 70, duration: 0.22, type: "sawtooth", volume: 0.3 });
    playNoise({ duration: 0.12, volume: 0.22, filterFreq: 5000 });
  } catch (e) {
    /* ignore */
  }
}

export function playBrawlerShotSound() {
  try {
    playTone({ freq: 180, freqEnd: 55, duration: 0.14, type: "square", volume: 0.24 });
    playNoise({ duration: 0.1, volume: 0.18, filterFreq: 2500 });
  } catch (e) {
    /* ignore */
  }
}

export function playTeleportSound() {
  try {
    playTone({ freq: 300, freqEnd: 1400, duration: 0.22, type: "sine", volume: 0.2 });
    playTone({ freq: 900, freqEnd: 2200, duration: 0.15, type: "triangle", volume: 0.12 });
  } catch (e) {
    /* ignore */
  }
}

export function playUltimateFireSound() {
  try {
    playTone({ freq: 90, freqEnd: 30, duration: 0.5, type: "sawtooth", volume: 0.3 });
    playNoise({ duration: 0.35, volume: 0.25, filterFreq: 2200 });
  } catch (e) {
    /* ignore */
  }
}

export function unlockAudio() {
  try {
    getCtx();
  } catch (e) {
    /* ignore */
  }
}

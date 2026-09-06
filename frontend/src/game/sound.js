let ctx = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  return ctx;
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
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

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

export function playBombWarningSound() {
  try {
    playTone({ freq: 700, duration: 0.1, type: "square", volume: 0.06 });
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

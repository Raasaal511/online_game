import { useEffect, useRef, useState } from "react";

// сколько последних сэмплов усредняем для сглаженных цифр (иначе один
// случайный лаговый кадр/тик дёргал бы значение на экране туда-сюда)
const SAMPLE_WINDOW = 60;

function average(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function percentile95(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

// Измеритель лагов: считает клиентский FPS (сколько реально рисуется кадров
// в секунду в браузере) отдельно от серверных тайм-метрик тик-цикла
// (server_perf в каждом state-пакете, см. broadcast.py) и от интервала между
// приходом самих state-пакетов (сетевой джиттер/дропы). Три независимых
// числа нужны, чтобы отличить "тормозит браузер клиента" от "не успевает
// сервер" от "плохая сеть между ними" — раньше единственным сигналом было
// субъективное "игра лагает", без способа понять, где именно.
export function usePerfMonitor(subscribeState, enabled) {
  const [stats, setStats] = useState({
    fps: 0,
    frameMsP95: 0,
    tickIntervalMs: 0,
    tickIntervalP95: 0,
    serverTickMs: 0,
    serverBroadcastMs: 0,
    serverLoopMs: 0,
  });

  const frameTimesRef = useRef([]);
  const tickIntervalsRef = useRef([]);
  const lastTickAtRef = useRef(0);
  const serverPerfRef = useRef({ tick_ms: 0, broadcast_ms: 0, loop_interval_ms: 0 });

  // интервал между входящими state-тиками — считается независимо от
  // включённости оверлея (дёшево, без этого при открытии F3 первые секунды
  // не было бы данных)
  useEffect(() => {
    if (!subscribeState) return undefined;
    return subscribeState((data) => {
      const now = performance.now();
      if (lastTickAtRef.current > 0) {
        const interval = now - lastTickAtRef.current;
        const arr = tickIntervalsRef.current;
        arr.push(interval);
        if (arr.length > SAMPLE_WINDOW) arr.shift();
      }
      lastTickAtRef.current = now;
      if (data.server_perf) serverPerfRef.current = data.server_perf;
    });
  }, [subscribeState]);

  // FPS клиента — независимый rAF-луп, не завязанный на луп рендера канваса,
  // чтобы измеритель показывал правду, даже если сам канвас лагает/встал
  useEffect(() => {
    if (!enabled) return undefined;
    let raf;
    let lastFrameAt = performance.now();

    const tick = (timestamp) => {
      const delta = timestamp - lastFrameAt;
      lastFrameAt = timestamp;
      const arr = frameTimesRef.current;
      arr.push(delta);
      if (arr.length > SAMPLE_WINDOW) arr.shift();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const reportInterval = setInterval(() => {
      const frameMs = average(frameTimesRef.current);
      const tickMs = average(tickIntervalsRef.current);
      setStats({
        fps: frameMs > 0 ? Math.round(1000 / frameMs) : 0,
        frameMsP95: Math.round(percentile95(frameTimesRef.current) * 10) / 10,
        tickIntervalMs: Math.round(tickMs * 10) / 10,
        tickIntervalP95: Math.round(percentile95(tickIntervalsRef.current) * 10) / 10,
        serverTickMs: serverPerfRef.current.tick_ms || 0,
        serverBroadcastMs: serverPerfRef.current.broadcast_ms || 0,
        serverLoopMs: serverPerfRef.current.loop_interval_ms || 0,
      });
    }, 500);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(reportInterval);
    };
  }, [enabled]);

  return stats;
}

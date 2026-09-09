import { usePerfMonitor } from "../hooks/usePerfMonitor.js";

// цвет значения по порогу: зелёный — норма, жёлтый — заметно, красный — плохо.
// Пороги разные для клиентского FPS (высокие числа = хорошо) и мс-метрик
// (низкие числа = хорошо) — простая функция диапазона на каждый случай.
function colorForFps(fps) {
  if (fps >= 50) return "#4ade80";
  if (fps >= 30) return "#facc15";
  return "#f87171";
}
function colorForMs(ms, warnAt, badAt) {
  if (ms <= warnAt) return "#4ade80";
  if (ms <= badAt) return "#facc15";
  return "#f87171";
}

const rowStyle = { display: "flex", justifyContent: "space-between", gap: "16px" };
const labelStyle = { color: "#94a3b8" };

// Измеритель лагов (toggle по F3) — раздельно показывает: FPS рендера в
// браузере, интервал между приходящими тиками state (сеть/дропы), и реальные
// серверные тайминги тик-цикла (tick_ms/broadcast_ms/loop_ms из room.py).
// Цель — быстро отличить "тормозит у меня в браузере" от "не успевает
// сервер" от "плохая сеть между ними", вместо гадания по одному субъективному
// ощущению "игра лагает".
export default function PerfOverlay({ subscribeState, visible }) {
  const stats = usePerfMonitor(subscribeState, visible);

  if (!visible) return null;

  const tickBudgetMs = 33.3; // 30Hz — см. TICK_RATE в room.py

  return (
    <div
      style={{
        position: "absolute",
        top: "8px",
        right: "8px",
        background: "rgba(10, 14, 11, 0.88)",
        border: "1px solid rgba(148, 163, 184, 0.25)",
        borderRadius: "8px",
        padding: "10px 12px",
        fontFamily: "monospace",
        fontSize: "11px",
        lineHeight: 1.6,
        color: "#e2e8f0",
        minWidth: "200px",
        pointerEvents: "none",
        zIndex: 50,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "4px", color: "#94a3b8", letterSpacing: "0.5px" }}>
        ИЗМЕРИТЕЛЬ (F3)
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>FPS клиента</span>
        <span style={{ color: colorForFps(stats.fps), fontWeight: 700 }}>{stats.fps}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>кадр p95</span>
        <span style={{ color: colorForMs(stats.frameMsP95, 20, 33) }}>{stats.frameMsP95}мс</span>
      </div>

      <div style={{ height: "1px", background: "rgba(148,163,184,0.15)", margin: "6px 0" }} />

      <div style={rowStyle}>
        <span style={labelStyle}>интервал тиков</span>
        <span style={{ color: colorForMs(stats.tickIntervalMs, tickBudgetMs * 1.2, tickBudgetMs * 2) }}>
          {stats.tickIntervalMs}мс
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>интервал p95</span>
        <span style={{ color: colorForMs(stats.tickIntervalP95, tickBudgetMs * 1.5, tickBudgetMs * 3) }}>
          {stats.tickIntervalP95}мс
        </span>
      </div>

      <div style={{ height: "1px", background: "rgba(148,163,184,0.15)", margin: "6px 0" }} />

      <div style={rowStyle}>
        <span style={labelStyle}>сервер: тик</span>
        <span style={{ color: colorForMs(stats.serverTickMs, tickBudgetMs * 0.5, tickBudgetMs) }}>
          {stats.serverTickMs}мс
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>сервер: рассылка</span>
        <span style={{ color: colorForMs(stats.serverBroadcastMs, tickBudgetMs * 0.5, tickBudgetMs) }}>
          {stats.serverBroadcastMs}мс
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>сервер: цикл</span>
        <span style={{ color: colorForMs(stats.serverLoopMs, tickBudgetMs * 1.2, tickBudgetMs * 2) }}>
          {stats.serverLoopMs}мс
        </span>
      </div>

      <div style={{ marginTop: "6px", fontSize: "10px", color: "#64748b" }}>
        {stats.serverLoopMs > tickBudgetMs * 1.5
          ? "сервер не успевает"
          : stats.tickIntervalP95 > tickBudgetMs * 2
          ? "сеть/дропы тиков"
          : stats.fps < 30
          ? "тормозит рендер клиента"
          : "всё в норме"}
      </div>
    </div>
  );
}

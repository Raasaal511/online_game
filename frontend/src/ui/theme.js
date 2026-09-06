// Единые визуальные токены для UI-панелей и экранов (не трогает цвета игровой сцены)

export const colors = {
  bg: "#0f172a",
  panel: "rgba(15, 23, 42, 0.82)",
  panelBorder: "rgba(148, 163, 184, 0.16)",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  accent: "#22c55e",
  accentSoft: "rgba(34, 197, 94, 0.15)",
  danger: "#ef4444",
  warning: "#facc15",
  info: "#38bdf8",
};

export const fontFamily =
  "'Segoe UI', system-ui, -apple-system, sans-serif";

export const panel = {
  background: colors.panel,
  border: `1px solid ${colors.panelBorder}`,
  borderRadius: "14px",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
  backdropFilter: "blur(10px)",
  color: colors.text,
  fontFamily,
};

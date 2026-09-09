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

// тело текста — тот же узкий военно-спортивный гротеск, что уже используется
// на HUD/в самой игре (ScoreBoard/MinibossCompass и т.д.), а не системный
// Segoe UI — тот читался как обычный сайт-форма, а не экран игры
export const fontFamily = "'Oswald', 'Segoe UI', system-ui, -apple-system, sans-serif";

// акцентный трафаретный шрифт для заголовков/лейблов — та же военная
// эстетика, что и текстуры Kenney (стены/укрытия), вместо нейтрального
// system-ui на заголовке главного меню
export const displayFontFamily = "'Black Ops One', 'Oswald', sans-serif";

export const panel = {
  background: colors.panel,
  border: `1px solid ${colors.panelBorder}`,
  borderRadius: "14px",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
  backdropFilter: "blur(10px)",
  color: colors.text,
  fontFamily,
};

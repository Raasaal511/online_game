import { colors, panel } from "../ui/theme.js";
import { IconTrophy, IconSkull } from "../ui/icons.jsx";

const MEDAL_COLORS = ["#facc15", "#cbd5e1", "#d97706"];

export default function Leaderboard({ scores }) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>
        <IconTrophy /> Топ-3 этой игры
      </h3>
      <ol style={styles.list}>
        {scores.length === 0 && <li style={styles.empty}>Пока нет рекордов</li>}
        {scores.map((s, i) => (
          <li key={i} style={styles.item}>
            <span style={styles.rank}>
              <span style={{ ...styles.medal, color: MEDAL_COLORS[i] || colors.textMuted }}>
                #{i + 1}
              </span>
              <span style={styles.name}>{s.nickname}</span>
            </span>
            <span style={styles.kills}>
              {s.kills} <IconSkull />
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = {
  container: {
    flexShrink: 0,
    padding: "12px 16px",
    boxSizing: "border-box",
    ...panel,
  },
  title: { margin: "0 0 10px 0", fontSize: "13px", fontWeight: 700, color: colors.text },
  list: { listStyle: "none", padding: 0, margin: 0, fontSize: "13px" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
    padding: "4px 0",
  },
  rank: { display: "flex", alignItems: "center", gap: "6px" },
  medal: { fontWeight: 800, fontSize: "12px", minWidth: "18px" },
  name: { color: colors.text },
  kills: { color: colors.warning, fontWeight: 600 },
  empty: { opacity: 0.5, color: colors.textMuted },
};

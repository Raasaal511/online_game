import { colors, panel } from "../ui/theme.js";

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Leaderboard({ scores }) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🏆 Топ-3 по убийствам</h3>
      <ol style={styles.list}>
        {scores.length === 0 && <li style={styles.empty}>Пока нет рекордов</li>}
        {scores.map((s, i) => (
          <li key={i} style={styles.item}>
            <span style={styles.rank}>
              <span>{MEDALS[i] || `#${i + 1}`}</span>
              <span style={styles.name}>{s.nickname}</span>
            </span>
            <span style={styles.kills}>{s.kills} 💀</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = {
  container: {
    position: "absolute",
    top: 12,
    right: 12,
    minWidth: "180px",
    padding: "12px 16px",
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
  name: { color: colors.text },
  kills: { color: colors.warning, fontWeight: 600 },
  empty: { opacity: 0.5, color: colors.textMuted },
};

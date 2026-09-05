export default function Leaderboard({ scores }) {
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🏆 Топ-3</h3>
      <ol style={styles.list}>
        {scores.length === 0 && <li style={styles.empty}>Пока нет рекордов</li>}
        {scores.map((s, i) => (
          <li key={i} style={styles.item}>
            <span>{s.nickname}</span>
            <span>{s.lifetime_seconds.toFixed(1)}s</span>
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
    background: "rgba(0,0,0,0.6)",
    color: "white",
    padding: "10px 16px",
    borderRadius: "10px",
    minWidth: "160px",
    fontFamily: "sans-serif",
  },
  title: { margin: "0 0 8px 0", fontSize: "14px" },
  list: { listStyle: "none", padding: 0, margin: 0, fontSize: "13px" },
  item: { display: "flex", justifyContent: "space-between", padding: "2px 0" },
  empty: { opacity: 0.6 },
};

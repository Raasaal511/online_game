import { colors, panel } from "../ui/theme.js";
import { IconCrown } from "../ui/icons.jsx";

export default function ScoreBoard({ players, playerId }) {
  return (
    <div style={styles.scoreboard}>
      <h3 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: 700 }}>
        Игроки ({players.length}/10)
      </h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
        {players.map((p, i) => (
          <li
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              padding: "4px 6px",
              borderRadius: "6px",
              background: p.id === playerId ? colors.accentSoft : "transparent",
              color: p.id === playerId ? colors.accent : colors.text,
              fontWeight: p.id === playerId ? 700 : 400,
              transition: "background 0.2s ease",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
              {i === 0 && p.kills > 0 && <IconCrown style={{ color: "#facc15", flexShrink: 0 }} />}
              {p.level > 1 && <span style={{ color: colors.warning }}>Lv.{p.level}</span>}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.nickname}
              </span>
            </span>
            <span style={{ flexShrink: 0 }}>
              {p.kills}K / {p.deaths}D
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = {
  scoreboard: {
    flexShrink: 0,
    padding: "12px 16px",
    boxSizing: "border-box",
    color: colors.text,
    ...panel,
  },
};

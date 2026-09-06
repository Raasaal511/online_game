import { useState } from "react";
import { colors, panel, fontFamily } from "../ui/theme.js";

export default function NicknameForm({ onSubmit }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      onSubmit(trimmed.slice(0, 16));
    }
  };

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.badge}>⚔️ TANK ARENA</div>
        <h1 style={styles.title}>Dodge Game</h1>
        <p style={styles.subtitle}>
          Управляй танком, уничтожай соперников и удерживай вершину рейтинга.
        </p>
        <input
          style={{ ...styles.input, ...(focused ? styles.inputFocused : null) }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Введи ник"
          maxLength={16}
          autoFocus
        />
        <button style={styles.button} type="submit" disabled={!value.trim()}>
          Играть
        </button>

        <div style={styles.controlsBox}>
          <div style={styles.controlsTitle}>Управление</div>
          <div style={styles.controlRow}>
            <span style={styles.keyChip}>W A S D</span>
            <span style={styles.controlText}>движение</span>
          </div>
          <div style={styles.controlRow}>
            <span style={styles.keyChip}>Мышь</span>
            <span style={styles.controlText}>прицел и стрельба (ЛКМ)</span>
          </div>
          <div style={styles.controlRow}>
            <span style={styles.keyChip}>Дропы</span>
            <span style={styles.controlText}>оружие, броня, ускорение на карте</span>
          </div>
        </div>
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 55%, #060a14 100%)",
    fontFamily,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    width: "340px",
    padding: "40px 32px",
    textAlign: "center",
    ...panel,
  },
  badge: {
    fontSize: "12px",
    letterSpacing: "2px",
    color: colors.accent,
    fontWeight: 700,
    marginBottom: "4px",
  },
  title: {
    margin: 0,
    fontSize: "30px",
    fontWeight: 800,
    color: colors.text,
    letterSpacing: "-0.5px",
  },
  subtitle: {
    margin: "0 0 8px 0",
    fontSize: "14px",
    color: colors.textMuted,
    lineHeight: 1.5,
  },
  input: {
    padding: "12px 16px",
    fontSize: "16px",
    borderRadius: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    background: "rgba(255,255,255,0.04)",
    color: colors.text,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    boxShadow: "0 0 0 0 transparent",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  inputFocused: {
    borderColor: colors.accent,
    boxShadow: `0 0 0 3px ${colors.accentSoft}`,
  },
  button: {
    padding: "12px 24px",
    fontSize: "16px",
    fontWeight: 700,
    borderRadius: "10px",
    border: "none",
    background: colors.accent,
    color: "#052e16",
    cursor: "pointer",
    width: "100%",
    transition: "transform 0.1s ease, filter 0.15s ease",
  },
  controlsBox: {
    width: "100%",
    marginTop: "8px",
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.03)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    textAlign: "left",
  },
  controlsTitle: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "1px",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: "8px",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "3px 0",
  },
  keyChip: {
    fontSize: "11px",
    fontWeight: 700,
    color: colors.text,
    background: "rgba(255,255,255,0.07)",
    padding: "3px 8px",
    borderRadius: "6px",
    minWidth: "62px",
    textAlign: "center",
    flexShrink: 0,
  },
  controlText: {
    fontSize: "12px",
    color: colors.textMuted,
  },
};

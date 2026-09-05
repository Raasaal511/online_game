import { useState } from "react";

export default function NicknameForm({ onSubmit }) {
  const [value, setValue] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      onSubmit(trimmed.slice(0, 16));
    }
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <h1>Dodge Game</h1>
      <p>Уклоняйся от летающих квадратов. Живи как можно дольше!</p>
      <input
        style={styles.input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Введи ник"
        maxLength={16}
        autoFocus
      />
      <button style={styles.button} type="submit">
        Играть
      </button>
    </form>
  );
}

const styles = {
  form: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    maxWidth: "320px",
    margin: "80px auto",
    textAlign: "center",
    fontFamily: "sans-serif",
  },
  input: {
    padding: "10px 14px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    width: "100%",
    boxSizing: "border-box",
  },
  button: {
    padding: "10px 24px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "none",
    background: "#4f46e5",
    color: "white",
    cursor: "pointer",
  },
};

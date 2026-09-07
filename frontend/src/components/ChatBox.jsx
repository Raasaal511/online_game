import { useEffect, useRef, useState } from "react";
import { colors, panel } from "../ui/theme.js";

const CHAT_MAX_LEN = 200;

export default function ChatBox({ messages, playerId, myNickname, sendChat }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === "Enter" && document.activeElement !== inputRef.current) {
        setOpen(true);
        // фокус придёт на следующий рендер, когда поле уже смонтировано
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (text) {
      sendChat(text);
    }
    setDraft("");
    inputRef.current?.blur();
    setOpen(false);
  };

  const handleInputKeyDown = (e) => {
    if (e.code === "Escape") {
      setDraft("");
      inputRef.current?.blur();
      setOpen(false);
    }
    // не даём событию всплыть до window-обработчика WASD/стрельбы
    e.stopPropagation();
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.log} ref={listRef}>
        {messages.map((m, i) => (
          <div key={i} className="anim-fade-in" style={styles.line}>
            <span style={{ ...styles.nick, color: m.nickname === myNickname ? colors.accent : colors.info }}>
              {m.nickname}:
            </span>{" "}
            <span style={styles.text}>{m.text}</span>
          </div>
        ))}
      </div>
      <form onSubmit={submit} style={styles.form}>
        {open ? (
          <input
            ref={inputRef}
            value={draft}
            maxLength={CHAT_MAX_LEN}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => setOpen(false)}
            placeholder="Сообщение..."
            style={styles.input}
          />
        ) : (
          <div style={styles.hint} onClick={() => setOpen(true)}>
            Нажми Enter, чтобы написать в чат
          </div>
        )}
      </form>
    </div>
  );
}

const styles = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    flex: 1,
    minHeight: 0,
  },
  log: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "8px 10px",
    fontSize: "12px",
    boxSizing: "border-box",
    ...panel,
    background: "rgba(15, 23, 42, 0.55)",
  },
  line: { lineHeight: 1.4, wordBreak: "break-word" },
  nick: { fontWeight: 700 },
  text: { color: colors.text },
  form: { display: "flex" },
  input: {
    width: "100%",
    padding: "8px 10px",
    borderRadius: "10px",
    border: `1px solid ${colors.panelBorder}`,
    background: "rgba(15, 23, 42, 0.75)",
    color: colors.text,
    fontSize: "12px",
    outline: "none",
  },
  hint: {
    padding: "6px 10px",
    fontSize: "11px",
    color: colors.textMuted,
    cursor: "pointer",
    userSelect: "none",
  },
};

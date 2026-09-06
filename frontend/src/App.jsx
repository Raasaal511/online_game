import { useCallback, useEffect, useState } from "react";
import NicknameForm from "./components/NicknameForm.jsx";
import GameCanvas from "./components/GameCanvas.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { useKeyboardInput } from "./hooks/useKeyboardInput.js";
import { colors, panel, fontFamily } from "./ui/theme.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const WEAPON_LABELS = {
  cannon: "Пушка",
  minigun: "Пулемёт",
  flamethrower: "Огнемёт",
  rocket: "Ракетница",
};

const WEAPON_ICONS = {
  cannon: "🎯",
  minigun: "🔫",
  flamethrower: "🔥",
  rocket: "🚀",
};

export default function App() {
  const [nickname, setNickname] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const {
    state,
    mapInfo,
    playerId,
    deathInfo,
    connected,
    roomFull,
    sendInput,
    sendAim,
    sendShoot,
    clearDeath,
  } = useGameSocket(nickname);

  useKeyboardInput(sendInput);

  const fetchLeaderboard = useCallback(() => {
    fetch(`${API_URL}/api/leaderboard`)
      .then((r) => r.json())
      .then(setLeaderboard)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (deathInfo?.leaderboard) {
      setLeaderboard(deathInfo.leaderboard);
    }
  }, [deathInfo]);

  // авто-респавн: сервер сам возрождает игрока через respawn_in секунд,
  // так что оверлей смерти просто скрывается по таймеру
  useEffect(() => {
    if (!deathInfo) return;
    const timer = setTimeout(clearDeath, (deathInfo.respawn_in || 2) * 1000);
    return () => clearTimeout(timer);
  }, [deathInfo, clearDeath]);

  if (!nickname) {
    return <NicknameForm onSubmit={setNickname} />;
  }

  if (roomFull) {
    return (
      <div style={styles.page}>
        <div style={overlayStyles.box2}>
          <div style={styles.badge}>⚠️ КОМНАТА ЗАПОЛНЕНА</div>
          <h2 style={styles.h2}>Все места заняты</h2>
          <p style={styles.p}>Сейчас играет максимум игроков (10/10). Попробуй зайти чуть позже.</p>
        </div>
      </div>
    );
  }

  const me = state.players?.find((p) => p.id === playerId);
  const sorted = [...(state.players || [])].sort((a, b) => b.kills - a.kills);
  const hpRatio = me ? Math.max(0, me.hp / me.max_hp) : 1;

  return (
    <div style={styles.page}>
      <div style={styles.hud}>
        <span style={styles.status}>
          <span style={{ ...styles.dot, background: connected ? colors.accent : colors.danger }} />
          {connected ? "Онлайн" : "Подключение..."}
        </span>
        {me && (
          <div style={styles.hpGroup}>
            <div style={styles.hpBarTrack}>
              <div
                style={{
                  ...styles.hpBarFill,
                  width: `${hpRatio * 100}%`,
                  background: hpRatio > 0.3 ? colors.accent : colors.danger,
                }}
              />
            </div>
            <span style={styles.hpText}>{me.hp}/{me.max_hp}</span>
            <span style={styles.statChip}>⚔️ {me.kills}</span>
            <span style={styles.statChip}>💀 {me.deaths}</span>
            {me.weapon && me.weapon !== "cannon" && (
              <span style={styles.weaponChip}>
                {WEAPON_ICONS[me.weapon]} {WEAPON_LABELS[me.weapon] || me.weapon}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <GameCanvas
          state={state}
          mapInfo={mapInfo}
          playerId={playerId}
          sendAim={sendAim}
          sendShoot={sendShoot}
        />
        <Leaderboard scores={leaderboard} />
        <ScoreBoard players={sorted} playerId={playerId} />

        {deathInfo && (
          <div style={overlayStyles.backdrop}>
            <div style={overlayStyles.box}>
              <div style={styles.badge}>💥 ТАНК УНИЧТОЖЕН</div>
              <h2 style={styles.h2}>Ты погиб</h2>
              <div style={overlayStyles.statsRow}>
                <div style={overlayStyles.stat}>
                  <div style={overlayStyles.statValue}>{deathInfo.kills}</div>
                  <div style={overlayStyles.statLabel}>убийств</div>
                </div>
                <div style={overlayStyles.stat}>
                  <div style={overlayStyles.statValue}>{deathInfo.lifetime_seconds.toFixed(1)}с</div>
                  <div style={overlayStyles.statLabel}>прожито</div>
                </div>
              </div>
              {deathInfo.is_new_record && (
                <p style={{ color: colors.warning, fontWeight: 700, margin: "12px 0 0" }}>
                  🎉 Новый рекорд топ-3!
                </p>
              )}
              <p style={styles.respawnText}>Респавн через {deathInfo.respawn_in}с...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBoard({ players, playerId }) {
  return (
    <div style={overlayStyles.scoreboard}>
      <h3 style={{ margin: "0 0 10px 0", fontSize: "13px", fontWeight: 700 }}>
        Игроки ({players.length}/10)
      </h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
        {players.map((p) => (
          <li
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              padding: "3px 0",
              color: p.id === playerId ? colors.accent : colors.text,
              fontWeight: p.id === playerId ? 700 : 400,
            }}
          >
            <span>{p.nickname}</span>
            <span>{p.kills}K / {p.deaths}D</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    padding: "16px",
    fontFamily,
    background: "radial-gradient(circle at 50% 0%, #1e293b 0%, #0f172a 60%, #060a14 100%)",
    userSelect: "none",
    WebkitUserSelect: "none",
  },
  badge: {
    fontSize: "11px",
    letterSpacing: "1.5px",
    color: colors.accent,
    fontWeight: 700,
  },
  h2: { margin: "6px 0 4px", fontSize: "22px", color: colors.text },
  p: { color: colors.textMuted, fontSize: "14px", lineHeight: 1.5 },
  hud: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
    maxWidth: "1400px",
    margin: "0 auto 12px",
    padding: "10px 20px",
    ...panel,
  },
  status: { display: "flex", alignItems: "center", gap: "8px", color: colors.text, fontSize: "13px" },
  dot: { width: "8px", height: "8px", borderRadius: "50%", display: "inline-block" },
  hpGroup: { display: "flex", alignItems: "center", gap: "10px" },
  hpBarTrack: {
    width: "120px",
    height: "8px",
    borderRadius: "4px",
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  hpBarFill: { height: "100%", borderRadius: "4px", transition: "width 0.2s ease" },
  hpText: { fontSize: "13px", color: colors.text, minWidth: "50px" },
  statChip: {
    fontSize: "13px",
    color: colors.text,
    background: "rgba(255,255,255,0.06)",
    padding: "2px 8px",
    borderRadius: "6px",
  },
  weaponChip: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#0f172a",
    background: colors.warning,
    padding: "2px 10px",
    borderRadius: "6px",
  },
};

const overlayStyles = {
  backdrop: {
    position: "absolute",
    inset: 0,
    background: "rgba(6, 10, 20, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    borderRadius: "8px",
  },
  box: {
    padding: "32px 40px",
    textAlign: "center",
    minWidth: "280px",
    ...panel,
  },
  box2: {
    padding: "48px",
    textAlign: "center",
    maxWidth: "400px",
    margin: "80px auto",
    ...panel,
  },
  statsRow: { display: "flex", gap: "24px", justifyContent: "center", margin: "16px 0 0" },
  stat: { display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" },
  statValue: { fontSize: "22px", fontWeight: 800, color: colors.text },
  statLabel: { fontSize: "11px", color: colors.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" },
  respawnText: { color: colors.textMuted, fontSize: "13px", margin: "16px 0 0" },
  scoreboard: {
    position: "absolute",
    top: 12,
    left: 12,
    minWidth: "170px",
    padding: "12px 16px",
    color: colors.text,
    ...panel,
  },
};

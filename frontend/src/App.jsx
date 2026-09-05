import { useCallback, useEffect, useState } from "react";
import NicknameForm from "./components/NicknameForm.jsx";
import GameCanvas from "./components/GameCanvas.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { useKeyboardInput } from "./hooks/useKeyboardInput.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
      <div style={overlayStyles.box2}>
        <h2>Комната заполнена</h2>
        <p>Сейчас играет максимум игроков (10/10). Попробуй зайти чуть позже.</p>
      </div>
    );
  }

  const me = state.players?.find((p) => p.id === playerId);
  const sorted = [...(state.players || [])].sort((a, b) => b.kills - a.kills);

  return (
    <div style={{ position: "relative", padding: "16px", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center", color: "white", marginBottom: 8 }}>
        <span>{connected ? "🟢 Онлайн" : "🔴 Подключение..."}</span>
        {me && (
          <>
            <span style={{ marginLeft: 16 }}>HP: {me.hp}/{me.max_hp}</span>
            <span style={{ marginLeft: 16 }}>Убийства: {me.kills}</span>
            <span style={{ marginLeft: 16 }}>Смерти: {me.deaths}</span>
          </>
        )}
      </div>

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
            <h2>Твой танк уничтожен</h2>
            <p>Убийств за этот заход: {deathInfo.kills}</p>
            <p>Прожил {deathInfo.lifetime_seconds.toFixed(1)} секунд</p>
            {deathInfo.is_new_record && <p style={{ color: "#facc15" }}>🎉 Новый рекорд топ-3!</p>}
            <p>Респавн через {deathInfo.respawn_in}с...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBoard({ players, playerId }) {
  return (
    <div style={overlayStyles.scoreboard}>
      <h3 style={{ margin: "0 0 8px 0", fontSize: "14px" }}>Игроки ({players.length}/10)</h3>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
        {players.map((p) => (
          <li
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "12px",
              padding: "2px 0",
              color: p.id === playerId ? "#22c55e" : "white",
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

const overlayStyles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  },
  box: {
    background: "rgba(30,41,59,0.95)",
    color: "white",
    padding: "32px",
    borderRadius: "12px",
    textAlign: "center",
  },
  box2: {
    background: "#1e293b",
    color: "white",
    padding: "48px",
    borderRadius: "12px",
    textAlign: "center",
    maxWidth: "400px",
    margin: "80px auto",
    fontFamily: "sans-serif",
  },
  scoreboard: {
    position: "absolute",
    top: 12,
    left: 12,
    background: "rgba(0,0,0,0.6)",
    color: "white",
    padding: "10px 16px",
    borderRadius: "10px",
    minWidth: "160px",
    fontFamily: "sans-serif",
  },
};

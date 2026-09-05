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
  const { state, playerId, deathInfo, connected, sendInput, respawn } = useGameSocket(nickname);

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

  if (!nickname) {
    return <NicknameForm onSubmit={setNickname} />;
  }

  const me = state.players?.find((p) => p.id === playerId);

  return (
    <div style={{ position: "relative", padding: "16px", fontFamily: "sans-serif" }}>
      <div style={{ textAlign: "center", color: "white", marginBottom: 8 }}>
        <span>{connected ? "🟢 Онлайн" : "🔴 Подключение..."}</span>
        {me && <span style={{ marginLeft: 16 }}>Время жизни: {me.lifetime.toFixed(1)}s</span>}
      </div>

      <GameCanvas state={state} playerId={playerId} />
      <Leaderboard scores={leaderboard} />

      {deathInfo && (
        <div style={overlayStyles.backdrop}>
          <div style={overlayStyles.box}>
            <h2>Игра окончена</h2>
            <p>Ты прожил {deathInfo.lifetime_seconds.toFixed(1)} секунд</p>
            {deathInfo.is_new_record && <p style={{ color: "#facc15" }}>🎉 Новый рекорд топ-3!</p>}
            <button style={overlayStyles.button} onClick={respawn}>
              Играть снова
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const overlayStyles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  box: {
    background: "#1e293b",
    color: "white",
    padding: "32px",
    borderRadius: "12px",
    textAlign: "center",
  },
  button: {
    marginTop: "16px",
    padding: "10px 24px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "none",
    background: "#4f46e5",
    color: "white",
    cursor: "pointer",
  },
};

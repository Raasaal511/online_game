import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/game";

export function useGameSocket(nickname) {
  const [state, setState] = useState({ players: [], projectiles: [], field: null });
  const [playerId, setPlayerId] = useState(null);
  const [deathInfo, setDeathInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!nickname) return;

    const ws = new WebSocket(`${WS_URL}?nickname=${encodeURIComponent(nickname)}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "welcome") {
        setPlayerId(data.player_id);
      } else if (data.type === "state") {
        setState(data);
      } else if (data.type === "death") {
        setDeathInfo(data);
      }
    };

    return () => {
      ws.close();
    };
  }, [nickname]);

  const sendInput = useCallback((dirX, dirY) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", dir: { x: dirX, y: dirY } }));
    }
  }, []);

  const respawn = useCallback(() => {
    setDeathInfo(null);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "respawn" }));
    }
  }, []);

  return { state, playerId, deathInfo, connected, sendInput, respawn };
}

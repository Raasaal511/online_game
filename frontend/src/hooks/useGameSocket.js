import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/game";

export function useGameSocket(nickname) {
  const [state, setState] = useState({ players: [], bullets: [], pickups: [] });
  const [mapInfo, setMapInfo] = useState({ walls: [], field: { width: 1400, height: 900 } });
  const [playerId, setPlayerId] = useState(null);
  const [deathInfo, setDeathInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomFull, setRoomFull] = useState(false);
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
        setMapInfo({ walls: data.walls, field: data.field });
      } else if (data.type === "full") {
        setRoomFull(true);
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

  const sendAim = useCallback((angle) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "aim", angle }));
    }
  }, []);

  const sendShoot = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "shoot" }));
    }
  }, []);

  const clearDeath = useCallback(() => setDeathInfo(null), []);

  return {
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
  };
}

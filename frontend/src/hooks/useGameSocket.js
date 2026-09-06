import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/game";

export function useGameSocket(nickname) {
  const [state, setState] = useState({ players: [], bullets: [], pickups: [] });
  const [mapInfo, setMapInfo] = useState({
    walls: [],
    traps: [],
    field: { width: 1400, height: 900 },
  });
  const [playerId, setPlayerId] = useState(null);
  const [deathInfo, setDeathInfo] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomFull, setRoomFull] = useState(false);
  const [chatMessages, setChatMessages] = useState([]); // {nickname, text, at}
  const wsRef = useRef(null);

  useEffect(() => {
    if (!nickname) return;

    const ws = new WebSocket(`${WS_URL}?nickname=${encodeURIComponent(nickname)}`);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    const decoder = new TextDecoder();

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    const handleData = (data) => {
      if (data.type === "welcome") {
        setPlayerId(data.player_id);
        setMapInfo({ walls: data.walls, traps: data.traps || [], field: data.field });
        setChatMessages(data.chat_history || []);
      } else if (data.type === "full") {
        setRoomFull(true);
      } else if (data.type === "state") {
        setState(data);
      } else if (data.type === "death") {
        setDeathInfo(data);
      } else if (data.type === "chat") {
        setChatMessages((prev) => [...prev.slice(-29), data]);
      }
    };

    ws.onmessage = (event) => {
      // тик состояния приходит бинарно (orjson) для скорости, остальные
      // события — обычным текстом; оба ветвятся в один обработчик
      if (event.data instanceof ArrayBuffer) {
        handleData(JSON.parse(decoder.decode(event.data)));
      } else {
        handleData(JSON.parse(event.data));
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

  const sendChat = useCallback((text) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && text.trim()) {
      ws.send(JSON.stringify({ type: "chat", text: text.slice(0, 200) }));
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
    chatMessages,
    sendInput,
    sendAim,
    sendShoot,
    sendChat,
    clearDeath,
  };
}

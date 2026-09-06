import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/game";

// HUD (HP-бар, ScoreBoard, лидерборд, компас) не нуждается в обновлении 30
// раз/сек — глазу достаточно ~8/сек, а каждый лишний setState 30/сек гонит
// React через полный ре-рендер дерева (App -> HUD -> ScoreBoard -> ...),
// конкурируя с requestAnimationFrame канваса за основной поток и вызывая
// заметные микро-подвисания. Игровой тик по-прежнему приходит 30/сек и
// уходит в GameCanvas напрямую через подписку (без React state вообще) —
// только "разрежённая" копия раз в HUD_THROTTLE_MS триггерит ре-рендер HUD.
const HUD_THROTTLE_MS = 120;

export function useGameSocket(nickname, tankClass = "gunner", gunSkin = "steel") {
  // hudState — троттленная копия последнего тика, используется только для
  // HP-бара/ScoreBoard/лидерборда/компаса; GameCanvas НЕ читает этот state
  // (он получает каждый тик напрямую через subscribeState, минуя React)
  const [hudState, setHudState] = useState({ players: [], bullets: [], pickups: [] });
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
  const stateListenersRef = useRef(new Set()); // GameCanvas подписывается сюда напрямую, без React state
  const lastHudUpdateRef = useRef(0);

  const subscribeState = useCallback((cb) => {
    stateListenersRef.current.add(cb);
    return () => stateListenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    if (!nickname) return;

    const ws = new WebSocket(
      `${WS_URL}?nickname=${encodeURIComponent(nickname)}&tank_class=${encodeURIComponent(tankClass)}&gun_skin=${encodeURIComponent(gunSkin)}`
    );
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
        // каждый тик (30/сек) идёт напрямую подписчикам (GameCanvas) — без
        // единого React setState на кадр состояния
        for (const cb of stateListenersRef.current) cb(data);
        const now = performance.now();
        if (now - lastHudUpdateRef.current >= HUD_THROTTLE_MS) {
          lastHudUpdateRef.current = now;
          setHudState(data);
        }
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
  }, [nickname, tankClass, gunSkin]);

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

  const sendTeleport = useCallback((angle) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "teleport", angle }));
    }
  }, []);

  const sendUltimate = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ultimate" }));
    }
  }, []);

  const sendSelectClass = useCallback((cls) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "select_class", tank_class: cls }));
    }
  }, []);

  const sendSelectGunSkin = useCallback((skin) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "select_gun_skin", gun_skin: skin }));
    }
  }, []);

  const clearDeath = useCallback(() => setDeathInfo(null), []);

  return {
    state: hudState,
    subscribeState,
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
    sendTeleport,
    sendUltimate,
    sendSelectClass,
    sendSelectGunSkin,
    clearDeath,
  };
}

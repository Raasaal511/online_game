import { useCallback, useEffect, useState } from "react";
import NicknameForm from "./components/NicknameForm.jsx";
import GameCanvas from "./components/GameCanvas.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import ChatBox from "./components/ChatBox.jsx";
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

let bannerIdCounter = 0;

export default function App() {
  const [nickname, setNickname] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [banners, setBanners] = useState([]); // {id, text, kind}
  const {
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
  } = useGameSocket(nickname);

  useKeyboardInput(sendInput);

  const pushBanner = useCallback((text, kind, duration = 3000) => {
    const id = ++bannerIdCounter;
    setBanners((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, duration);
  }, []);

  const handleGameEvent = useCallback(
    (event) => {
      if (event.type === "nuke_warning") {
        pushBanner("☢️ ЯДЕРНЫЙ УДАР! ПОКИНЬ ЗОНУ ВЗРЫВА!", "danger", 6000);
      } else if (event.type === "miniboss_spawn") {
        pushBanner(`☠️ Мини-босс ${event.owner} появился на карте! Убей его — получишь мощный супер-бонус!`, "warning", 4500);
      } else if (event.type === "level_up") {
        pushBanner(`⭐ Уровень ${event.level}!`, "success", 2500);
      }
    },
    [pushBanner]
  );

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
  // мини-боссы — временные NPC, не настоящие игроки: не считаем их в списке
  // ScoreBoard, иначе счётчик "N/10" вводит в заблуждение (они не занимают слот)
  const sorted = [...(state.players || [])]
    .filter((p) => !p.is_miniboss)
    .sort((a, b) => b.kills - a.kills);
  const hpRatio = me ? Math.max(0, me.hp / me.max_hp) : 1;
  const miniboss = state.players?.find((p) => p.is_miniboss && p.alive);

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
            {me.level > 1 && <span style={styles.levelChip}>⭐ Lv.{me.level}</span>}
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

      <div style={styles.arenaRow}>
        <div style={styles.canvasWrap}>
          <div
            style={{
              ...styles.canvasFrame,
              aspectRatio: `${mapInfo.field?.width || 1400} / ${mapInfo.field?.height || 900}`,
            }}
          >
            <GameCanvas
              state={state}
              mapInfo={mapInfo}
              playerId={playerId}
              sendAim={sendAim}
              sendShoot={sendShoot}
              onGameEvent={handleGameEvent}
            />
            {/* только игровые индикаторы поверх поля — компас и баннеры коротки
                и не заслоняют обзор; текстовые панели (лидерборд/список
                игроков/чат) вынесены за пределы арены в боковую колонку ниже */}
            {miniboss && me && <MinibossCompass me={me} boss={miniboss} />}

            {banners.length > 0 && (
              <div style={overlayStyles.bannerStack}>
                {banners.map((b) => (
                  <div key={b.id} style={{ ...overlayStyles.banner, ...overlayStyles[`banner_${b.kind}`] }}>
                    {b.text}
                  </div>
                ))}
              </div>
            )}

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

        <div style={styles.sidePanel}>
          <Leaderboard scores={leaderboard} />
          <ScoreBoard players={sorted} playerId={playerId} />
          <ChatBox
            messages={chatMessages}
            playerId={playerId}
            myNickname={nickname}
            sendChat={sendChat}
          />
        </div>
      </div>
    </div>
  );
}

function MinibossCompass({ me, boss }) {
  // постоянный указатель направления на живого мини-босса: баннер спавна
  // виден всего пару секунд, а угроза "наводит суету по всей карте" весь
  // остаток своей жизни — без компаса игрок теряет её из виду вне боя
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dist = Math.round(Math.hypot(dx, dy));

  return (
    <div style={overlayStyles.compass} title="Мини-босс">
      <div
        style={{
          ...overlayStyles.compassArrow,
          transform: `rotate(${angleDeg}deg)`,
        }}
      >
        ➤
      </div>
      <span style={overlayStyles.compassLabel}>☠️ {dist}м</span>
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
            <span>
              {p.level > 1 && <span style={{ color: colors.warning }}>Lv.{p.level} </span>}
              {p.nickname}
            </span>
            <span>{p.kills}K / {p.deaths}D</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const styles = {
  page: {
    height: "100%",
    width: "100%",
    padding: "12px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
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
    flexShrink: 0,
    maxWidth: "1400px",
    width: "100%",
    margin: "0 auto 10px",
    padding: "8px 20px",
    boxSizing: "border-box",
    ...panel,
  },
  arenaRow: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    gap: "12px",
  },
  canvasWrap: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  // боковая колонка вне игрового поля — лидерборд/список игроков/чат больше
  // не лежат поверх арены (перекрывали обзор и мешали целиться/двигаться)
  sidePanel: {
    flexShrink: 0,
    width: "260px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minHeight: 0,
    overflow: "hidden",
  },
  // границы этого блока точно совпадают с отрендеренным canvas (тот же
  // aspect-ratio + max-width/max-height constraint) — раньше все оверлеи
  // (чат, компас, скорборд) позиционировались от canvasWrap, который часто
  // БОЛЬШЕ самого canvas из-за letterbox-центрирования; из-за этого нижние
  // панели съезжали за пределы видимого игрового поля
  canvasFrame: {
    position: "relative",
    maxWidth: "100%",
    maxHeight: "100%",
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
  levelChip: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#052e16",
    background: "#4ade80",
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
    flexShrink: 0,
    padding: "12px 16px",
    boxSizing: "border-box",
    color: colors.text,
    ...panel,
  },
  compass: {
    position: "absolute",
    top: 12,
    right: 12,
    width: "64px",
    height: "64px",
    borderRadius: "50%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "2px",
    color: colors.danger,
    ...panel,
  },
  compassArrow: {
    fontSize: "20px",
    lineHeight: 1,
    transformOrigin: "center",
  },
  compassLabel: {
    fontSize: "10px",
    fontWeight: 700,
    color: colors.text,
  },
  bannerStack: {
    position: "absolute",
    top: "16%",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    pointerEvents: "none",
    zIndex: 10,
  },
  banner: {
    padding: "10px 24px",
    borderRadius: "10px",
    fontSize: "16px",
    fontWeight: 800,
    textAlign: "center",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    animation: "none",
  },
  banner_danger: {
    background: "rgba(127, 29, 29, 0.92)",
    color: "#fef2f2",
    border: "2px solid #ef4444",
  },
  banner_warning: {
    background: "rgba(120, 53, 15, 0.92)",
    color: "#fef3c7",
    border: "2px solid #f59e0b",
  },
  banner_success: {
    background: "rgba(20, 83, 45, 0.92)",
    color: "#f0fdf4",
    border: "2px solid #22c55e",
  },
};

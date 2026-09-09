import { useCallback, useEffect, useState } from "react";
import NicknameForm from "./components/NicknameForm.jsx";
import GameCanvas from "./components/GameCanvas.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import ChatBox from "./components/ChatBox.jsx";
import Confetti from "./components/Confetti.jsx";
import MinibossCompass from "./components/MinibossCompass.jsx";
import ScoreBoard from "./components/ScoreBoard.jsx";
import { playRoundEndFanfare } from "./game/sound.js";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { useKeyboardInput } from "./hooks/useKeyboardInput.js";
import { colors } from "./ui/theme.js";
import { styles, overlayStyles } from "./App.styles.js";
import { TANK_CLASSES } from "./game/tankClasses.js";
import {
  IconSkull,
  IconSword,
  IconStar,
  IconShield,
  IconWind,
  IconSnail,
  IconGun,
  IconFlame,
  IconTarget,
  IconRocket,
  IconRadiation,
  IconCrown,
  IconFlagCheckered,
  IconWarning,
  IconBurst,
} from "./ui/icons.jsx";

const WEAPON_LABELS = {
  cannon: "Пушка",
  minigun: "Пулемёт",
  flamethrower: "Огнемёт",
  rocket: "Ракетница",
};

const WEAPON_ICONS = {
  cannon: <IconTarget />,
  minigun: <IconGun />,
  flamethrower: <IconFlame />,
  rocket: <IconRocket />,
};

let bannerIdCounter = 0;

function formatRoundTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return `${m}:${String(rest).padStart(2, "0")}`;
}

export default function App() {
  const [nickname, setNickname] = useState(null);
  const [tankClass, setTankClass] = useState("gunner");
  const [gunSkin, setGunSkin] = useState("steel");
  const [banners, setBanners] = useState([]); // {id, text, kind}
  const [roundWinner, setRoundWinner] = useState(null); // {nickname, kills} — показ баннера конца раунда
  const {
    state,
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
    sendUltimate,
    sendSelectClass,
    clearDeath,
  } = useGameSocket(nickname, tankClass, gunSkin);

  useKeyboardInput(sendInput);

  const handleStart = useCallback((nick, cls, skin) => {
    setTankClass(cls);
    setGunSkin(skin);
    setNickname(nick);
  }, []);

  const handleRespawnClassPick = useCallback(
    (cls) => {
      setTankClass(cls);
      sendSelectClass(cls);
    },
    [sendSelectClass]
  );

  // groupKey: если указан, убирает предыдущие баннеры с тем же ключом перед
  // добавлением нового — без этого два level_up подряд (миниган позволяет
  // набрать 2 килла за секунды, оба поднимают уровень) показывались
  // ОДНОВРЕМЕННО как "Уровень 2!" и "Уровень 3!" друг под другом, что
  // читалось как баг ("два уровня разом"), хотя каждое событие само по себе
  // корректно — просто предыдущий баннер не успевал исчезнуть
  const pushBanner = useCallback((text, kind, duration = 3000, groupKey = null) => {
    const id = ++bannerIdCounter;
    setBanners((prev) => {
      const filtered = groupKey ? prev.filter((b) => b.groupKey !== groupKey) : prev;
      return [...filtered, { id, text, kind, groupKey }];
    });
    setTimeout(() => {
      setBanners((prev) => prev.filter((b) => b.id !== id));
    }, duration);
  }, []);

  const handleGameEvent = useCallback(
    (event) => {
      if (event.type === "nuke_warning") {
        pushBanner(
          <>
            <IconRadiation /> ЯДЕРНЫЙ УДАР! ПОКИНЬ ЗОНУ ВЗРЫВА!
          </>,
          "danger",
          6000
        );
      } else if (event.type === "miniboss_spawn") {
        pushBanner(
          <>
            <IconSkull /> Мини-босс {event.owner} появился на карте! Убей его — получишь мощный
            супер-бонус!
          </>,
          "warning",
          4500
        );
      } else if (event.type === "level_up") {
        pushBanner(
          <>
            <IconStar /> Уровень {event.level}!
          </>,
          "success",
          2500,
          "level_up"
        );
      } else if (event.type === "round_end") {
        setRoundWinner(event.winner);
        playRoundEndFanfare();
      }
    },
    [pushBanner]
  );

  // баннер победителя раунда скрывается сам чуть раньше, чем сервер сделает
  // реванш (ROUND_END_BANNER_DURATION=6с на бэкенде) — не полноэкранный оверлей,
  // компактная плашка поверх канваса, не мешающая видеть поле
  useEffect(() => {
    if (!roundWinner) return;
    const timer = setTimeout(() => setRoundWinner(null), 5500);
    return () => clearTimeout(timer);
  }, [roundWinner]);

  // авто-респавн: сервер сам возрождает игрока через respawn_in секунд,
  // так что оверлей смерти просто скрывается по таймеру
  useEffect(() => {
    if (!deathInfo) return;
    const timer = setTimeout(clearDeath, (deathInfo.respawn_in || 2) * 1000);
    return () => clearTimeout(timer);
  }, [deathInfo, clearDeath]);

  if (!nickname) {
    return <NicknameForm onSubmit={handleStart} />;
  }

  if (roomFull) {
    return (
      <div style={styles.page}>
        <div style={overlayStyles.box2}>
          <div style={styles.badge}>
            <IconWarning /> КОМНАТА ЗАПОЛНЕНА
          </div>
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
        {typeof state.round_time_left === "number" && (
          <span
            className={state.round_time_left <= 60 ? "anim-chip-pulse" : ""}
            style={{
              ...styles.roundTimer,
              ...(state.round_time_left <= 60 ? styles.roundTimerUrgent : null),
            }}
          >
            <IconFlagCheckered /> {formatRoundTime(state.round_time_left)}
          </span>
        )}
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
            {me.level > 1 && (
              <span style={styles.levelChip}>
                <IconStar /> Lv.{me.level}
              </span>
            )}
            <span style={styles.statChip}>
              <IconSword /> {me.kills}
            </span>
            <span style={styles.statChip}>
              <IconSkull /> {me.deaths}
            </span>
            {me.weapon && me.weapon !== "cannon" && (
              <span style={styles.weaponChip}>
                {WEAPON_ICONS[me.weapon]} {WEAPON_LABELS[me.weapon] || me.weapon}
              </span>
            )}
            {/* индикаторы всех одновременно активных баффов — раньше подбор
                armor+damage одновременно был невозможно отличить визуально
                от одного эффекта, казалось что "работает только один" */}
            {me.has_super && (
              <span style={styles.buffChip}>
                <IconStar /> Супер
              </span>
            )}
            {!me.has_super && me.has_armor && (
              <span style={styles.buffChip}>
                <IconShield /> Броня
              </span>
            )}
            {!me.has_super && me.has_damage_boost && (
              <span style={styles.buffChip}>
                <IconSword /> Урон
              </span>
            )}
            {!me.has_super && me.has_speed_boost && (
              <span style={styles.buffChip}>
                <IconWind /> Скорость
              </span>
            )}
            {me.has_slow && (
              <span style={styles.debuffChip}>
                <IconSnail /> Замедление
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
              subscribeState={subscribeState}
              mapInfo={mapInfo}
              playerId={playerId}
              sendAim={sendAim}
              sendShoot={sendShoot}
              sendUltimate={sendUltimate}
              onGameEvent={handleGameEvent}
            />
            {/* только игровые индикаторы поверх поля — компас и баннеры коротки
                и не заслоняют обзор; текстовые панели (лидерборд/список
                игроков/чат) вынесены за пределы арены в боковую колонку ниже */}
            {miniboss && me && <MinibossCompass me={me} boss={miniboss} />}

            {roundWinner?.nickname && <Confetti />}

            {roundWinner && (
              <div className="anim-banner-pop" style={overlayStyles.roundBanner}>
                <div style={overlayStyles.roundBannerTitle}>
                  <IconFlagCheckered /> Раунд окончен
                </div>
                <div style={overlayStyles.roundBannerText}>
                  {roundWinner.nickname ? (
                    <>
                      <IconCrown /> <strong>{roundWinner.nickname}</strong> — самый крутой! (
                      {roundWinner.kills} убийств)
                    </>
                  ) : (
                    "Никто не набрал убийств — ничья"
                  )}
                </div>
                <div style={overlayStyles.roundBannerSub}>Новый раунд начинается...</div>
              </div>
            )}

            {banners.length > 0 && (
              <div style={overlayStyles.bannerStack}>
                {banners.map((b) => (
                  <div
                    key={b.id}
                    className="anim-pop"
                    style={{ ...overlayStyles.banner, ...overlayStyles[`banner_${b.kind}`] }}
                  >
                    {b.text}
                  </div>
                ))}
              </div>
            )}

            {deathInfo && (
              <div style={overlayStyles.backdrop}>
                <div className="anim-pop" style={overlayStyles.box}>
                  <div style={styles.badge}>
                    <IconBurst /> ТАНК УНИЧТОЖЕН
                  </div>
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
                  <div style={overlayStyles.respawnClassGrid}>
                    {TANK_CLASSES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleRespawnClassPick(c.id)}
                        style={{
                          ...overlayStyles.respawnClassCard,
                          ...(tankClass === c.id ? overlayStyles.respawnClassCardActive : null),
                        }}
                      >
                        <div style={{ fontSize: "11px" }}>{c.name}</div>
                      </button>
                    ))}
                  </div>
                  <p style={styles.respawnText}>Респавн через {deathInfo.respawn_in}с...</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={styles.sidePanel}>
          <Leaderboard scores={state.leaderboard || []} />
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

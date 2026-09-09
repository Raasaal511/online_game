import { useEffect, useState } from "react";
import { preloadAllSprites } from "../game/preloadSprites.js";
import { colors, fontFamily, displayFontFamily } from "../ui/theme.js";

// минимальная длительность показа — честный прогресс всё равно должен
// успеть смениться от 0 до 100% читаемо, а не мелькнуть на быстром
// интернете; на медленной сети экран просто ждёт реальной загрузки дольше
const MIN_DISPLAY_MS = 1500;

// Прелоадер всех спрайтов ПЕРЕД входом в игру — раньше каждый PNG грузился
// лениво в момент первого появления на экране, из-за чего вход в реальный
// бой означал одновременную загрузку+декодирование десятков картинок прямо
// во время работы 30Гц рендер-лупа (см. preloadSprites.js). Теперь вся
// загрузка происходит здесь, на спокойном экране без rAF-лупа и WS-трафика.
export default function LoadingScreen({ onDone }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const startedAt = performance.now();

    preloadAllSprites((loaded, total) => {
      if (!cancelled) setProgress(loaded / total);
    }).then(() => {
      if (cancelled) return;
      const elapsed = performance.now() - startedAt;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      setTimeout(() => {
        if (!cancelled) onDone();
      }, remaining);
    });

    return () => {
      cancelled = true;
    };
  }, [onDone]);

  const percent = Math.round(progress * 100);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        background: "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 55%, #060a14 100%)",
        fontFamily,
      }}
    >
      <div
        style={{
          fontSize: "22px",
          fontWeight: 400,
          color: colors.text,
          letterSpacing: "1px",
          fontFamily: displayFontFamily,
          textTransform: "uppercase",
          textShadow: "0 2px 0 rgba(0,0,0,0.6), 0 0 24px rgba(34,197,94,0.25)",
        }}
      >
        Dodge Game
      </div>

      <div
        style={{
          width: "260px",
          height: "10px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.08)",
          border: `1px solid ${colors.panelBorder}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            borderRadius: "999px",
            background: `linear-gradient(90deg, ${colors.accent} 0%, #16a34a 100%)`,
            transition: "width 0.15s ease",
          }}
        />
      </div>

      <div style={{ fontSize: "13px", color: colors.textMuted, letterSpacing: "0.5px" }}>
        Загрузка ресурсов... {percent}%
      </div>
    </div>
  );
}

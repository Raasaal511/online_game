import { fontFamily } from "../ui/theme.js";
import { IconSkull } from "../ui/icons.jsx";

// постоянный указатель направления на живого мини-босса: баннер спавна
// виден всего пару секунд, а угроза "наводит суету по всей карте" весь
// остаток своей жизни — без компаса игрок теряет её из виду вне боя
export default function MinibossCompass({ me, boss }) {
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dist = Math.round(Math.hypot(dx, dy));

  return (
    <div style={styles.compass} title="Мини-босс">
      <div
        style={{
          ...styles.compassArrow,
          transform: `rotate(${angleDeg}deg)`,
        }}
      >
        ➤
      </div>
      <span style={styles.compassLabel}>
        <IconSkull /> {dist}м
      </span>
    </div>
  );
}

const styles = {
  // компас лежит ПОВЕРХ игрового поля (canvasFrame), не в UI-полосе снаружи —
  // раньше использовал общий ...panel (тот же блюр-стекло-карточка, что и
  // меню/тултипы), и на фоне 3D-рендера арены читался как чужеродный
  // веб-виджет, наложенный на игру. Теперь тёмный полупрозрачный диск без
  // блюра/тени-карточки, с тонким пульсирующим красным кольцом — тот же
  // язык, что у угрожающего свечения самого мини-босса в render3d.js
  // (rgba(220,38,38,...) glow), а не отдельный UI-стиль поверх сцены.
  compass: {
    position: "absolute",
    top: 12,
    right: 12,
    width: "60px",
    height: "60px",
    borderRadius: "50%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1px",
    color: "#fecaca",
    background: "radial-gradient(circle, rgba(20,8,8,0.75) 0%, rgba(12,5,5,0.55) 70%, rgba(12,5,5,0) 100%)",
    border: "1.5px solid rgba(220,38,38,0.55)",
    boxShadow: "0 0 10px rgba(220,38,38,0.35), inset 0 0 8px rgba(220,38,38,0.2)",
    fontFamily,
  },
  compassArrow: {
    fontSize: "18px",
    lineHeight: 1,
    transformOrigin: "center",
    color: "#ef4444",
    filter: "drop-shadow(0 0 3px rgba(239,68,68,0.8))",
  },
  compassLabel: {
    fontSize: "10px",
    fontWeight: 700,
    color: "#fecaca",
    textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  },
};

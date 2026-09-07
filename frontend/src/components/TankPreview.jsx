import { useEffect, useRef } from "react";
import { drawFloor, drawTank3D } from "../game/render3d.js";

const TANK_SIZE = 48;
const CSS_WIDTH = 260;
const CSS_HEIGHT = 130;

// Живой canvas-превью танка для меню выбора класса/скина — использует тот
// же drawTank3D, что и настоящая игра, а не отдельные статичные иконки:
// смена класса или цвета сразу видна на одном и том же танке, включая
// реальную форму ствола (снайпер длинный, брали двойной, пулемёт-барабан).
export default function TankPreview({ tankClass, gunSkin }) {
  const canvasRef = useRef(null);
  const propsRef = useRef({ tankClass, gunSkin });
  propsRef.current = { tankClass, gunSkin };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    // рендерим в реальном разрешении экрана (devicePixelRatio), иначе на
    // Retina/HiDPI дисплеях canvas растягивается и выглядит размытым
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = CSS_WIDTH * dpr;
    canvas.height = CSS_HEIGHT * dpr;
    ctx.scale(dpr, dpr);

    let raf;
    const start = performance.now();

    const draw = (timestamp) => {
      const t = (timestamp - start) / 1000;
      const { tankClass: cls, gunSkin: skin } = propsRef.current;

      ctx.clearRect(0, 0, CSS_WIDTH, CSS_HEIGHT);
      drawFloor(ctx, CSS_WIDTH, CSS_HEIGHT);

      const cx = CSS_WIDTH / 2;
      const cy = CSS_HEIGHT / 2 + 10;

      // мягкое пятно света под танком — превью читается как витрина в
      // шоуруме, а не просто танк на сером полу
      const spot = ctx.createRadialGradient(cx, cy, 4, cx, cy, TANK_SIZE * 1.8);
      spot.addColorStop(0, "rgba(255,255,255,0.09)");
      spot.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spot;
      ctx.beginPath();
      ctx.arc(cx, cy, TANK_SIZE * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // медленное покачивание прицела башни — наглядно показывает ствол со
      // всех сторон, не статичная поза
      const angle = Math.sin(t * 0.6) * 0.55;

      const fakePlayer = {
        id: "preview",
        nickname: "",
        x: cx,
        y: cy,
        turret_angle: angle,
        hp: 100,
        max_hp: 100,
        alive: true,
        level: 1,
        tank_class: cls,
        gun_skin: skin,
        weapon: "cannon",
        is_miniboss: false,
        has_armor: false,
        has_speed_boost: false,
        has_slow: false,
        has_super: false,
        has_spawn_protection: false,
      };

      // hideLabels=true — превью не показывает ник/HP-бар/уровень, это не
      // настоящий игрок, просто витрина класса/скина
      drawTank3D(ctx, fakePlayer, false, TANK_SIZE, t, 0, 0, angle, true);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: "block",
        width: `${CSS_WIDTH}px`,
        height: `${CSS_HEIGHT}px`,
        maxWidth: "100%",
        borderRadius: "10px",
        background: "#0b0e12",
      }}
    />
  );
}

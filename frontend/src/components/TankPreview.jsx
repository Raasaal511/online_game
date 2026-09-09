import { useEffect, useRef, useState } from "react";
import { drawFloor, drawTank3D } from "../game/render3d.js";

const TANK_SIZE = 48;
const CSS_HEIGHT = 130;

// Живой canvas-превью танка для меню выбора класса/скина — использует тот
// же drawTank3D, что и настоящая игра, а не отдельные статичные иконки:
// смена класса или цвета сразу видна на одном и том же танке, включая
// реальную форму ствола (снайпер длинный, брали двойной, пулемёт-барабан).
export default function TankPreview({ tankClass, gunSkin }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const propsRef = useRef({ tankClass, gunSkin });
  propsRef.current = { tankClass, gunSkin };

  // ширина берётся из реального размера контейнера (.previewBox растянут на
  // 100% родителя) вместо жёстко зашитой константы — раньше canvas всегда
  // рисовался в фиксированные 260px независимо от того, насколько шире была
  // сама карточка, оставляя пустую полосу справа
  const [cssWidth, setCssWidth] = useState(260);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width > 0) setCssWidth(width);
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    // рендерим в реальном разрешении экрана (devicePixelRatio), иначе на
    // Retina/HiDPI дисплеях canvas растягивается и выглядит размытым
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cssWidth * dpr;
    canvas.height = CSS_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf;
    const start = performance.now();

    const draw = (timestamp) => {
      const t = (timestamp - start) / 1000;
      const { tankClass: cls, gunSkin: skin } = propsRef.current;

      ctx.clearRect(0, 0, cssWidth, CSS_HEIGHT);
      drawFloor(ctx, cssWidth, CSS_HEIGHT);

      const cx = cssWidth / 2;
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

      // ствол смотрит строго вправо, без покачивания — раньше угол
      // анимировался синусоидой и танк выглядел "перекошенным"/неровным
      const angle = 0;

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
      // настоящий игрок, просто витрина класса/скина. moveAngle=null (не 0!) —
      // превью-танк стоит на месте, а не "едет вправо"; drawTank3D теперь
      // плавно доворачивает корпус к moveAngle (см. computeBodySpriteAngle),
      // и передача 0 сюда раньше была безобидной (moveAngle не влиял на
      // корпус), а после добавления поворота корпуса заставляла витрину
      // разворачиваться боком — превью должно оставаться axis-aligned.
      // isMe=true (не false!) — иначе корпус всегда рисовался синим спрайтом
      // "чужого" танка (tankBody_blue) независимо от выбора игрока, что
      // читалось как "цвет не меняется". В настоящем бою свой/чужой цвет
      // остаётся как есть (не связан со скином пушки) — это только про
      // витрину меню, которая должна показывать "себя".
      drawTank3D(ctx, fakePlayer, true, TANK_SIZE, t, 0, 0, null, true);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cssWidth]);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: `${CSS_HEIGHT}px` }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: `${cssWidth}px`,
          height: `${CSS_HEIGHT}px`,
          borderRadius: "10px",
          background: "#0b0e12",
        }}
      />
    </div>
  );
}

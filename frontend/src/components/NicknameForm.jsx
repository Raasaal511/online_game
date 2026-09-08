import { useEffect, useRef, useState } from "react";
import { colors, panel, fontFamily } from "../ui/theme.js";
import { TANK_CLASSES, GUN_SKINS } from "../game/tankClasses.js";
import TankPreview from "./TankPreview.jsx";
import { IconSword, IconPlay } from "../ui/icons.jsx";
import { GUN_SKIN_SPRITE_COLOR, CLASS_BARREL_VARIANT, BARREL_SPRITE_DIMS } from "../game/render3d.js";
import { getSprite, isSpriteReady } from "../game/sprites.js";

// приближённые hex-цвета Kenney-спрайтов по имени (см. GUN_SKIN_SPRITE_COLOR) —
// нужны только для процедурного круга башни рядом со стволом-спрайтом в
// SkinSwatch, сам ствол по-прежнему настоящий спрайт, не перекрашенный
const SKIN_HEX = {
  Dark: "#4b4636",
  Red: "#c0392b",
  Sand: "#d4b483",
  Green: "#3f9142",
  Blue: "#3d7bc4",
};

function shadeSkinColor(spriteColorName, factor) {
  const hex = SKIN_HEX[spriteColorName] || SKIN_HEX.Dark;
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;
  if (factor >= 0) {
    r += (255 - r) * factor;
    g += (255 - g) * factor;
    b += (255 - b) * factor;
  } else {
    r *= 1 + factor;
    g *= 1 + factor;
    b *= 1 + factor;
  }
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

// класс-иконка — реальный спрайт ствола ЭТОГО класса (тот же файл и тот же
// вариант barrel1/2/3, что рисуется в бою), а не абстрактная SVG-пиктограмма:
// раньше "ближний бой"/"пулемёт" получали IconSword/IconGun из общего набора
// UI-иконок, которые на глаз не читались как оружие конкретно этого класса —
// теперь иконка = то, что игрок реально увидит на своей башне
function ClassIcon({ tankClass, active }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 56;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const variant = CLASS_BARREL_VARIANT[tankClass] || 2;
    const dims = BARREL_SPRITE_DIMS[variant] || BARREL_SPRITE_DIMS[2];
    const sprite = getSprite(`tankGreen_barrel${variant}`);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      if (isSpriteReady(sprite)) {
        // тот же приём, что и у SkinSwatch ниже: спрайт вертикальный в
        // исходном файле, разворачиваем на 90° для горизонтальной витрины
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.rotate(Math.PI / 2);
        const h = size * 0.82;
        const w = h * (dims.w / dims.h);
        ctx.globalAlpha = active ? 1 : 0.75;
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        raf = requestAnimationFrame(draw);
      }
    };
    draw();
    return () => raf && cancelAnimationFrame(raf);
  }, [tankClass, active]);

  return <canvas ref={canvasRef} style={{ width: "56px", height: "56px", display: "block" }} />;
}

// маленький превью-свотч скина пушки — рисует настоящий спрайт ствола
// (tank<Color>_barrel2.png, тот же файл, что и в реальном бою) вместо плоского
// css-кружка цвета: игрок видит, каким РЕАЛЬНО будет его ствол, а не абстрактный тон
function SkinSwatch({ skinId, active, onClick, title }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 32;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const spriteColor = GUN_SKIN_SPRITE_COLOR[skinId] || "Dark";
    const sprite = getSprite(`tank${spriteColor}_barrel2`);

    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      if (isSpriteReady(sprite)) {
        // одинокий ствол без контекста читался как "просто цветная палка",
        // не было понятно что это часть башни — добавлена круглая башня
        // того же цвета скина ПОД стволом, свотч теперь выглядит как
        // настоящая мини-башня танка, а не изолированная деталь
        ctx.save();
        ctx.translate(size / 2, size / 2);

        const turretR = size * 0.28;
        const turretGrad = ctx.createRadialGradient(-2, -2, 1, 0, 0, turretR);
        turretGrad.addColorStop(0, shadeSkinColor(spriteColor, 0.25));
        turretGrad.addColorStop(1, shadeSkinColor(spriteColor, -0.15));
        ctx.fillStyle = turretGrad;
        ctx.beginPath();
        ctx.arc(0, 0, turretR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // ствол в исходном спрайте вертикальный и длинный (16x52) — здесь
        // это компактная витрина, не игровая проекция, поэтому просто
        // разворачиваем на 90° и вписываем в квадрат свотча целиком
        ctx.rotate(Math.PI / 2);
        const h = size * 0.85;
        const w = h * (sprite.naturalWidth / sprite.naturalHeight);
        ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
        ctx.restore();
      } else {
        // силуэт ещё не загрузился — не оставляем свотч пустым несколько
        // кадров, тот же silent-pop-in фолбэк, что и у остальных спрайтов
        raf = requestAnimationFrame(draw);
      }
    };
    draw();
    return () => raf && cancelAnimationFrame(raf);
  }, [skinId]);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        ...styles.skinSwatch,
        ...(active ? styles.skinSwatchActive : null),
      }}
    >
      <canvas ref={canvasRef} style={{ width: "32px", height: "32px", display: "block" }} />
    </button>
  );
}

export default function NicknameForm({ onSubmit }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [tankClass, setTankClass] = useState("gunner");
  const [gunSkin, setGunSkin] = useState("steel");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      onSubmit(trimmed.slice(0, 16), tankClass, gunSkin);
    }
  };

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.badge}>
          <IconSword /> TANK ARENA
        </div>
        <h1 style={styles.title}>Dodge Game</h1>
        <p style={styles.subtitle}>
          Управляй танком, уничтожай соперников и удерживай вершину рейтинга.
        </p>
        <input
          style={{ ...styles.input, ...(focused ? styles.inputFocused : null) }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Введи ник"
          maxLength={16}
          autoFocus
        />

        <div style={styles.previewBox}>
          <TankPreview tankClass={tankClass} gunSkin={gunSkin} />
        </div>

        <div style={styles.classGrid}>
          {TANK_CLASSES.map((c) => {
            const active = tankClass === c.id;
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => setTankClass(c.id)}
                title={c.desc}
                style={{
                  ...styles.classCard,
                  ...(active ? styles.classCardActive : null),
                }}
              >
                <ClassIcon tankClass={c.id} active={active} />
                <div style={styles.className}>{c.name}</div>
                <div style={styles.classTag}>{c.tag}</div>
              </button>
            );
          })}
        </div>

        <div style={styles.skinLabel}>Скин пушки</div>
        <div style={styles.skinRow}>
          {GUN_SKINS.map((s) => (
            <SkinSwatch
              key={s.id}
              skinId={s.id}
              active={gunSkin === s.id}
              onClick={() => setGunSkin(s.id)}
              title={s.name}
            />
          ))}
        </div>

        <button className="btn-primary-cta" style={styles.button} type="submit" disabled={!value.trim()}>
          <IconPlay />
          Играть
        </button>

        <div style={styles.controlsBox}>
          <div style={styles.controlsTitle}>Управление</div>
          {/* 2-колоночная сетка вместо одной длинной колонки строк — та же
              информация (не сокращена, только уплотнён текст справа от
              каждой клавиши до 2-4 слов), но занимает вдвое меньше высоты по
              вертикали, что освобождает место под визуально более тяжёлые
              карточки классов/скинов выше */}
          <div style={styles.controlsGrid}>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>WASD</span>
              <span style={styles.controlText}>движение</span>
            </div>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>ЛКМ</span>
              <span style={styles.controlText}>стрельба класса</span>
            </div>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>ПКМ</span>
              <span style={styles.controlText}>оружие с карты</span>
            </div>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>Пробел</span>
              <span style={styles.controlText}>ульта (5 killstreak)</span>
            </div>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>Портал</span>
              <span style={styles.controlText}>телепорт к паре</span>
            </div>
            <div style={styles.controlRow}>
              <span style={styles.keyChip}>Дропы</span>
              <span style={styles.controlText}>бонусы на карте</span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(circle at 50% 20%, #1e293b 0%, #0f172a 55%, #060a14 100%)",
    fontFamily,
    boxSizing: "border-box",
    // страница никогда не скроллит целиком — если контенту не хватает
    // высоты (маленький экран), скроллит сама форма, а не body/html
    overflow: "hidden",
    padding: "16px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    width: "480px",
    maxHeight: "100%",
    overflowY: "auto",
    padding: "24px 32px",
    textAlign: "center",
    boxSizing: "border-box",
    ...panel,
  },
  previewBox: {
    width: "100%",
    // .form — flex-column с overflowY:auto (см. styles.form) — когда контент
    // не влезает в высоту экрана, flexbox сжимает детей. У элемента с
    // overflow:hidden (как здесь) автоматический флекс-минимум по спеке
    // становится 0 вместо размера по контенту — именно этот блок первым
    // схлопывался до 2px (толщина рамки) на невысоких экранах/окнах, превью
    // танка визуально пропадало целиком, хотя canvas внутри рендерился
    // нормально. height задаёт целевой размер, flexShrink:0 запрещает его
    // ужимать — при нехватке места скроллится сама форма (overflowY:auto),
    // а не заголовок-витрина.
    height: "130px",
    flexShrink: 0,
    borderRadius: "10px",
    overflow: "hidden",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
  },
  badge: {
    fontSize: "12px",
    letterSpacing: "2px",
    color: colors.accent,
    fontWeight: 700,
    marginBottom: "4px",
  },
  title: {
    margin: 0,
    fontSize: "30px",
    fontWeight: 800,
    color: colors.text,
    letterSpacing: "-0.5px",
  },
  subtitle: {
    margin: "0 0 8px 0",
    fontSize: "14px",
    color: colors.textMuted,
    lineHeight: 1.5,
  },
  input: {
    padding: "12px 16px",
    fontSize: "16px",
    borderRadius: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    background: "rgba(255,255,255,0.04)",
    color: colors.text,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    boxShadow: "0 0 0 0 transparent",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  inputFocused: {
    borderColor: colors.accent,
    boxShadow: `0 0 0 3px ${colors.accentSoft}`,
  },
  button: {
    padding: "14px 24px",
    fontSize: "17px",
    fontWeight: 800,
    letterSpacing: "0.03em",
    borderRadius: "12px",
    border: "none",
    // раньше плоская однотонная заливка читалась как обычный веб-элемент —
    // градиент + плотная нижняя "кромка" (box-shadow вместо border, чтобы не
    // менять geometry) имитируют объёмную игровую кнопку с толщиной, которую
    // как будто физически нажимаешь, а не просто ссылка с фоном
    background: `linear-gradient(180deg, ${colors.accent} 0%, #16a34a 100%)`,
    boxShadow: "0 4px 0 #0f6b2c, 0 6px 14px rgba(0,0,0,0.35)",
    color: "#052e16",
    cursor: "pointer",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    transition: "transform 0.1s ease, filter 0.15s ease, box-shadow 0.1s ease",
  },
  controlsBox: {
    width: "100%",
    marginTop: "8px",
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.03)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    textAlign: "left",
  },
  controlsTitle: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "1px",
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: "8px",
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    columnGap: "16px",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "3px 0",
    minWidth: 0,
  },
  keyChip: {
    fontSize: "11px",
    fontWeight: 700,
    color: colors.text,
    background: "rgba(255,255,255,0.07)",
    padding: "3px 8px",
    borderRadius: "6px",
    minWidth: "56px",
    textAlign: "center",
    flexShrink: 0,
  },
  controlText: {
    fontSize: "12px",
    color: colors.textMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  classGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "8px",
    width: "100%",
  },
  // карточка класса теперь ведёт с крупной иконкой (см. CLASS_ICON) вместо
  // абзаца текста — длинное предложение-описание убрано из самой карточки
  // (осталось в title-тултипе на hover), заменено коротким tag в 2-3 слова
  classCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    padding: "14px 6px 10px",
    borderRadius: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.panelBorder,
    background: "rgba(255,255,255,0.03)",
    color: colors.text,
    cursor: "pointer",
    transition: "border-color 0.15s ease, background 0.15s ease",
    fontFamily,
  },
  classCardActive: {
    borderColor: colors.accent,
    background: colors.accentSoft,
  },
  classIcon: { fontSize: "26px", transition: "color 0.15s ease" },
  className: { fontSize: "12px", fontWeight: 700 },
  classTag: {
    fontSize: "10px",
    color: colors.textMuted,
    lineHeight: 1.3,
    textAlign: "center",
  },
  skinLabel: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "1px",
    color: colors.textMuted,
    textTransform: "uppercase",
    width: "100%",
    marginTop: "4px",
  },
  skinRow: {
    display: "flex",
    gap: "10px",
    justifyContent: "center",
    width: "100%",
  },
  // квадратная (не круглая, как раньше skinDot) рамка вокруг превью-спрайта
  // ствола — круглая маска обрезала бы прямоугольный спрайт по углам
  skinSwatch: {
    width: "38px",
    height: "38px",
    borderRadius: "8px",
    borderWidth: "2px",
    borderStyle: "solid",
    borderColor: "transparent",
    background: "rgba(255,255,255,0.05)",
    cursor: "pointer",
    padding: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  skinSwatchActive: {
    borderColor: colors.accent,
    boxShadow: `0 0 0 2px ${colors.accentSoft}`,
  },
};

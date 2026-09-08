// Набор простых inline-SVG иконок для HUD/меню — заменяют emoji ("стикеры"),
// которые на разных ОС/шрифтах рендерятся непредсказуемо (разный стиль,
// иногда цветной emoji-набор системы, иногда чёрно-белый fallback). SVG даёт
// одинаковый вид везде и контролируемый цвет через currentColor.
// Все иконки — 1em по умолчанию, наследуют размер шрифта родителя.

const base = {
  width: "1em",
  height: "1em",
  display: "inline-block",
  verticalAlign: "-0.15em",
  flexShrink: 0,
};

export function IconCrosshair(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="1" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="1" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="23" y2="12" />
    </svg>
  );
}

export function IconSkull(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M12 2C7 2 3 5.6 3 10c0 3 1.6 5.4 4 6.8V19a1 1 0 0 0 1 1h1v-2h1v2h4v-2h1v2h1a1 1 0 0 0 1-1v-2.2c2.4-1.4 4-3.8 4-6.8 0-4.4-4-8-9-8Z" />
      <circle cx="9" cy="10" r="1.6" fill="#0f172a" />
      <circle cx="15" cy="10" r="1.6" fill="#0f172a" />
    </svg>
  );
}

export function IconSword(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="5" y1="19" x2="17" y2="7" />
      <polyline points="13,3 21,3 21,11" />
      <line x1="5" y1="19" x2="3" y2="21" />
      <line x1="15" y1="9" x2="19" y2="13" />
    </svg>
  );
}

export function IconStar(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.7 7-6.3-3.9L5.7 21l1.7-7L2 9.2l7.1-.6L12 2Z" />
    </svg>
  );
}

export function IconShield(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...props}>
      <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3Z" />
    </svg>
  );
}

export function IconBolt(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

export function IconWind(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5" />
      <path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5" />
      <path d="M3 16h9a2.5 2.5 0 1 1-2.5 2.5" />
    </svg>
  );
}

export function IconSnail(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="15" cy="11" r="5" />
      <circle cx="15" cy="11" r="2" />
      <path d="M4 19c2-6 6-8 11-8" />
      <path d="M4 19h16" />
      <path d="M6 19v-3" />
    </svg>
  );
}

export function IconGun(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 13h11l3-3h4v4h-2l-2 3H9l-2 3H3v-7Z" />
      <line x1="7" y1="13" x2="7" y2="20" />
    </svg>
  );
}

export function IconFlame(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1.5-.7-2.3-1.2-3.1.6 3-1 3.6-1 5.1a2.8 2.8 0 0 1-5.6 0C10.2 8.5 12 6.5 12 2Z" />
      <path d="M8 15a4 4 0 1 0 8 0c0-2-1.5-3-2-5-.3 2-2 2.6-2 5a1.5 1.5 0 0 1-3 0c0-1 .5-1.6 1-2.4-2 1-2 2.7-2 2.4Z" />
    </svg>
  );
}

export function IconTarget(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRocket(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2c3 2 4.5 5.5 4.5 9 0 2-1 4-1 4l-3.5 2-3.5-2s-1-2-1-4C7.5 7.5 9 4 12 2Z" />
      <circle cx="12" cy="9" r="1.6" />
      <path d="M9 15l-2.5 1L6 19l3-1.5" />
      <path d="M15 15l2.5 1L18 19l-3-1.5" />
    </svg>
  );
}

export function IconRadiation(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 2a10 10 0 0 1 8.7 5l-4.3 2.5A5 5 0 0 0 12 7V2Z" />
      <path d="M20.7 7a10 10 0 0 1 0 10l-4.3-2.5a5 5 0 0 0 0-5L20.7 7Z" />
      <path d="M20.7 17a10 10 0 0 1-17.4 0L7.6 14.5a5 5 0 0 0 8.8 0l4.3 2.5Z" />
      <path d="M3.3 17a10 10 0 0 1 0-10l4.3 2.5a5 5 0 0 0 0 5L3.3 17Z" />
      <path d="M3.3 7A10 10 0 0 1 12 2v5a5 5 0 0 0-4.4 2.5L3.3 7Z" />
    </svg>
  );
}

export function IconCrown(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8Z" />
      <rect x="5" y="19" width="14" height="2" rx="1" />
    </svg>
  );
}

export function IconFlagCheckered(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="5" y1="3" x2="5" y2="21" />
      <path d="M5 4h14l-3 3.5L19 11H5" />
    </svg>
  );
}

export function IconTrophy(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H5a3 3 0 0 0 3 4" />
      <path d="M16 5h3a3 3 0 0 1-3 4" />
      <line x1="12" y1="12" x2="12" y2="16" />
      <path d="M8 20h8" />
      <path d="M10 16h4v4h-4Z" />
    </svg>
  );
}

export function IconBurst(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M12 1l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3 2-6Z" />
    </svg>
  );
}

export function IconWarning(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3 2 20h20L12 3Z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}

export function IconPlay(props) {
  return (
    <svg viewBox="0 0 24 24" style={base} fill="currentColor" {...props}>
      <path d="M6 4.5v15l14-7.5-14-7.5Z" />
    </svg>
  );
}

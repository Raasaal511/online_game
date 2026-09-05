import { useEffect, useRef } from "react";

// используем e.code (физическое положение клавиши), а не e.key —
// e.key зависит от раскладки (на кириллической раскладке "w" превращается в "ц" и т.п.)
const KEY_MAP = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export function useKeyboardInput(onChange) {
  const pressed = useRef(new Set());

  useEffect(() => {
    const compute = () => {
      let x = 0;
      let y = 0;
      for (const code of pressed.current) {
        const vec = KEY_MAP[code];
        if (vec) {
          x += vec[0];
          y += vec[1];
        }
      }
      onChange(x, y);
    };

    const handleKeyDown = (e) => {
      if (KEY_MAP[e.code]) {
        pressed.current.add(e.code);
        compute();
      }
    };
    const handleKeyUp = (e) => {
      if (KEY_MAP[e.code]) {
        pressed.current.delete(e.code);
        compute();
      }
    };
    const handleBlur = () => {
      pressed.current.clear();
      compute();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [onChange]);
}

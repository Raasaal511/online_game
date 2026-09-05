import { useEffect, useRef } from "react";

const KEY_MAP = {
  w: [0, -1],
  ArrowUp: [0, -1],
  s: [0, 1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  ArrowLeft: [-1, 0],
  d: [1, 0],
  ArrowRight: [1, 0],
};

export function useKeyboardInput(onChange) {
  const pressed = useRef(new Set());

  useEffect(() => {
    const compute = () => {
      let x = 0;
      let y = 0;
      for (const key of pressed.current) {
        const vec = KEY_MAP[key];
        if (vec) {
          x += vec[0];
          y += vec[1];
        }
      }
      onChange(x, y);
    };

    const handleKeyDown = (e) => {
      if (KEY_MAP[e.key]) {
        pressed.current.add(e.key);
        compute();
      }
    };
    const handleKeyUp = (e) => {
      if (KEY_MAP[e.key]) {
        pressed.current.delete(e.key);
        compute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [onChange]);
}

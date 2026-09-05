import { useEffect, useRef } from "react";

export function useMouseAim(canvasRef, onAim, onShoot) {
  const mouseRef = useRef({ x: 0, y: 0 });
  const onShootRef = useRef(onShoot);
  onShootRef.current = onShoot;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateMouse = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      mouseRef.current = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const handlePointerMove = (e) => {
      updateMouse(e);
    };

    const handlePointerDown = (e) => {
      updateMouse(e);
      if (e.button === 0) {
        onShootRef.current();
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("contextmenu", handleContextMenu);
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [canvasRef]);

  return mouseRef;
}

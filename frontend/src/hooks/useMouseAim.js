import { useEffect, useRef } from "react";

export function useMouseAim(canvasRef, onAim, onShoot) {
  const mouseRef = useRef({ x: 0, y: 0 });
  // держим ли зажатой ЛКМ — нужно для автоматического оружия (пулемёт/огнемёт),
  // которое должно стрелять непрерывно, пока кнопка удерживается
  const isFiringRef = useRef(false);
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
        isFiringRef.current = true;
        onShootRef.current();
      }
    };

    const handlePointerUp = (e) => {
      if (e.button === 0) {
        isFiringRef.current = false;
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("contextmenu", handleContextMenu);
    return () => {
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      isFiringRef.current = false;
    };
  }, [canvasRef]);

  return { mouseRef, isFiringRef };
}

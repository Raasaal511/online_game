import { useEffect, useRef } from "react";

export function useMouseAim(canvasRef, onAim, onShoot) {
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      mouseRef.current = {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      };
    };

    const handleMouseDown = (e) => {
      if (e.button === 0) {
        onShoot();
      }
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mousedown", handleMouseDown);
    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mousedown", handleMouseDown);
    };
  }, [canvasRef, onShoot]);

  return mouseRef;
}

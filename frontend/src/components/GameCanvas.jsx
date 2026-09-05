import { useEffect, useRef } from "react";

const PLAYER_SIZE = 24;

export default function GameCanvas({ state, playerId }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fieldWidth = state.field?.width || 900;
  const fieldHeight = state.field?.height || 600;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationFrame;

    const draw = () => {
      const current = stateRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // игроки
      for (const p of current.players || []) {
        if (!p.alive) continue;
        ctx.fillStyle = p.id === playerId ? "#22c55e" : "#38bdf8";
        ctx.fillRect(p.x - PLAYER_SIZE / 2, p.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);

        ctx.fillStyle = "white";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(p.nickname, p.x, p.y - PLAYER_SIZE / 2 - 6);
      }

      // снаряды
      for (const proj of current.projectiles || []) {
        ctx.fillStyle = "#ef4444";
        ctx.fillRect(proj.x - proj.size / 2, proj.y - proj.size / 2, proj.size, proj.size);
      }

      animationFrame = requestAnimationFrame(draw);
    };

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [playerId]);

  return (
    <canvas
      ref={canvasRef}
      width={fieldWidth}
      height={fieldHeight}
      style={{ display: "block", margin: "0 auto", border: "2px solid #334155" }}
    />
  );
}

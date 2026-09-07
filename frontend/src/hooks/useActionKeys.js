import { useEffect } from "react";

// Shift — телепорт в направлении текущего прицела, Пробел — ульта (готовность
// сервер проверяет сам, здесь просто шлём намерение по нажатию клавиши)
export function useActionKeys(onTeleport, onUltimate) {
  useEffect(() => {
    const isTypingTarget = (target) =>
      target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    const handleKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
        onTeleport();
      } else if (e.code === "Space") {
        e.preventDefault(); // пробел по умолчанию скроллит страницу/жмёт фокусную кнопку
        onUltimate();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onTeleport, onUltimate]);
}

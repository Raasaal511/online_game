import { useEffect } from "react";

// Пробел — ульта (готовность сервер проверяет сам, здесь просто шлём
// намерение по нажатию клавиши). Телепорт больше не личная способность по
// клавише — теперь это порталы-объекты карты, активируются заездом танка.
export function useActionKeys(onUltimate) {
  useEffect(() => {
    const isTypingTarget = (target) =>
      target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");

    const handleKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault(); // пробел по умолчанию скроллит страницу/жмёт фокусную кнопку
        onUltimate();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUltimate]);
}

// Псевдо-3D рендер поверх Canvas2D: наклон "камеры", объёмные грани у танков/стен,
// парящие дропы и тени на полу. Игровые координаты (x, y) остаются 2D-полем истины
// с сервера — здесь только визуальная проекция и слой глубины (z) для отрисовки.
//
// Этот файл — тонкий barrel-реэкспорт: сама реализация разнесена по доменам
// в соседние render-*.js модули (render-utils/render-terrain/render-pickups/
// render-bullets/render-effects/render-tank/render-particles), чтобы не
// держать весь рендер в одном файле на 2500+ строк. Публичный API (что можно
// импортировать из "./render3d.js") остаётся неизменным — все существующие
// импортёры (GameCanvas.jsx, NicknameForm.jsx, TankPreview.jsx) продолжают
// работать без изменений.

export * from "./render-utils.js";
export * from "./render-terrain.js";
export * from "./render-pickups.js";
export * from "./render-bullets.js";
export * from "./render-effects.js";
export * from "./render-tank.js";
export * from "./render-particles.js";

# Roadmap: Dodge Game (FastAPI + React + SQLite)

## 1. Описание игры

**Жанр:** Онлайн survival/dodge-игра (в стиле "уклонение от снарядов").

**Игровой процесс:**
- Игрок вводит ник (без регистрации) и попадает в **одну глобальную игровую комнату**, общую для всех онлайн-игроков.
- Игрок управляет своим квадратом-персонажем (WASD / стрелки).
- По полю летают квадраты-снаряды, отскакивающие от краёв экрана как мяч (angle in = angle out, без потери скорости или с небольшим ускорением со временем для нарастающей сложности).
- Игрок видит всех остальных живых игроков на том же поле в реальном времени (позиции синхронизируются через WebSocket).
- Столкновение игрока со снарядом = мгновенная смерть. Засчитывается время жизни (сек), игрок может сыграть заново.
- **Таблица рекордов: Топ-3 по максимальному времени жизни**, хранится в SQLite, видна всем.

**Технологический стек:**
- **Backend:** FastAPI (Python 3.11+), WebSocket для realtime-синхронизации, SQLite + SQLAlchemy для хранения рекордов.
- **Frontend:** React (Vite), Canvas API для рендера игры, нативный WebSocket-клиент.
- **Деплой:** VPS на reg.ru, Docker Compose (backend + frontend/nginx), Caddy/Nginx как reverse-proxy с HTTPS (Let's Encrypt).

---

## 2. Архитектура

```
┌─────────────────┐        WebSocket (/ws/game)        ┌──────────────────────┐
│   React Client   │ ───────────────────────────────▶  │   FastAPI Server      │
│  (Canvas render) │ ◀───────────────────────────────  │  Game Loop (asyncio)  │
└─────────────────┘        REST (/api/leaderboard)      │  - state broadcast    │
                                                          │  - collision checks   │
                                                          │  - hit detection      │
                                                          └──────────┬───────────┘
                                                                     │
                                                              SQLAlchemy ORM
                                                                     │
                                                          ┌──────────▼───────────┐
                                                          │   SQLite (game.db)   │
                                                          │   table: scores      │
                                                          └───────────────────────┘
```

**Модель игрового цикла:**
- Сервер — источник истины (authoritative server). Ведёт единый game loop (~30-60 тиков/сек) с asyncio.
- Клиент отправляет только ввод (нажатые клавиши / направление движения).
- Сервер считает позиции всех игроков и снарядов, детектит коллизии, рассылает снапшот состояния всем подключённым клиентам через WebSocket broadcast.
- При смерти игрока сервер фиксирует `lifetime_seconds`, сохраняет в SQLite если попадает в топ-3, оповещает клиента.

---

## 3. Структура проекта

```
web_game/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app, роуты, CORS, startup
│   │   ├── database.py            # SQLAlchemy engine/session (SQLite)
│   │   ├── models/
│   │   │   └── score.py           # ORM-модель Score (id, nickname, lifetime, created_at)
│   │   ├── schemas/
│   │   │   └── score.py           # Pydantic-схемы (ScoreOut, ScoreCreate)
│   │   ├── routers/
│   │   │   ├── leaderboard.py     # GET /api/leaderboard (топ-3)
│   │   │   └── ws.py              # WebSocket endpoint /ws/game
│   │   └── game/
│   │       ├── engine.py          # GameLoop: тик, физика, коллизии
│   │       ├── entities.py        # Player, Projectile (dataclasses)
│   │       └── room.py            # GameRoom: список игроков/снарядов, broadcast
│   ├── requirements.txt
│   ├── Dockerfile
│   └── game.db                    # (создаётся автоматически)
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── NicknameForm.jsx
│   │   │   ├── Leaderboard.jsx
│   │   │   └── GameCanvas.jsx
│   │   ├── hooks/
│   │   │   └── useGameSocket.js   # управление WebSocket-соединением
│   │   └── game/
│   │       └── renderer.js        # отрисовка на Canvas
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
│
├── docker-compose.yml
├── .env.example
└── ROADMAP.md
```

---

## 4. Этапы разработки (Milestones)

### Milestone 0 — Подготовка окружения
- [x] Инициализация структуры каталогов backend/frontend.
- [ ] Настройка venv + requirements.txt (backend).
- [ ] Настройка Vite + React проекта (frontend).
- [ ] Git-репозиторий, .gitignore.

### Milestone 1 — Backend: база и REST API
- [ ] SQLAlchemy модель `Score` (id, nickname, lifetime_seconds, created_at).
- [ ] SQLite подключение (`sqlite:///./game.db`), автосоздание таблиц при старте.
- [ ] `GET /api/leaderboard` — возвращает топ-3 записи по `lifetime_seconds DESC`.
- [ ] `POST /api/leaderboard` (опционально, если не сохранять прямо из game loop) — сохранение результата.
- [ ] Настройка CORS для фронтенда.

### Milestone 2 — Backend: игровой движок (single-room)
- [ ] `Player` dataclass: id, nickname, x, y, vx, vy, alive, joined_at.
- [ ] `Projectile` dataclass: id, x, y, vx, vy, size.
- [ ] `GameRoom`: хранит список игроков и снарядов; спавнит снаряды с нарастающей частотой/скоростью.
- [ ] Физика отскока снарядов от границ поля (reflect vx/vy при выходе за границы).
- [ ] Game loop на `asyncio` (`asyncio.sleep(1/TICK_RATE)`), обновление позиций каждый тик.
- [ ] Детекция коллизий (AABB) игрок↔снаряд → пометка `alive=False`, расчёт времени жизни.
- [ ] Сохранение результата в SQLite при смерти, если попадает в топ-3.

### Milestone 3 — Backend: WebSocket-синхронизация
- [ ] `WS /ws/game?nickname=...` — подключение игрока, создание Player в GameRoom.
- [ ] Приём от клиента: `{ "type": "input", "dir": {x, y} }` (направление движения).
- [ ] Broadcast всем клиентам: `{ "type": "state", "players": [...], "projectiles": [...] }` каждый тик.
- [ ] Событие смерти: `{ "type": "death", "lifetime": 42.3, "leaderboard": [...] }`.
- [ ] Обработка disconnect (удаление игрока из комнаты).
- [ ] Rate-limiting / валидация входящих сообщений (защита от спама).

### Milestone 4 — Frontend: базовый UI
- [ ] `NicknameForm` — экран ввода ника перед стартом.
- [ ] `Leaderboard` — отображение топ-3, обновление после каждой смерти.
- [ ] `GameCanvas` — canvas-элемент, рендер игрока (свой цвет), других игроков, снарядов.
- [ ] Экран "Game Over" с временем жизни и кнопкой "Играть снова".

### Milestone 5 — Frontend: геймплей и сеть
- [ ] `useGameSocket` хук — открытие WS-соединения, отправка ввода (keydown/keyup → направление), приём state.
- [ ] Обработка ввода: WASD/стрелки → нормализованный вектор направления, throttling отправки (не чаще N раз/сек).
- [ ] Интерполяция/сглаживание позиций других игроков между тиками сервера (для плавности при низком tick rate).
- [ ] Rendering loop через `requestAnimationFrame`, отрисовка снарядов и игроков из последнего полученного state.
- [ ] Таймер жизни на экране (клиентский, синхронизируется с сервером при смерти).

### Milestone 6 — Полировка геймплея
- [ ] Баланс сложности: частота спавна снарядов растёт со временем (глобально или per-player).
- [ ] Визуальные эффекты: анимация смерти, цветовая индикация приближающейся опасности.
- [ ] Звуковые эффекты (опционально).
- [ ] Адаптивный canvas (resize под окно/мобильные устройства).
- [ ] Ограничение поля видимости / масштабирование при большом числе игроков (опционально).

### Milestone 7 — Тестирование
- [ ] Backend: unit-тесты коллизий и отскоков (`pytest`).
- [ ] Backend: тест WebSocket-подключения (`pytest-asyncio` + `httpx`/`websockets`).
- [ ] Frontend: ручное тестирование в браузере (несколько вкладок = несколько игроков).
- [ ] Нагрузочная проверка: 10-20 одновременных WS-подключений локально.

### Milestone 8 — Контейнеризация
- [ ] `backend/Dockerfile` (uvicorn + gunicorn worker для продакшена).
- [ ] `frontend/Dockerfile` (multi-stage build: vite build → nginx static serve).
- [ ] `docker-compose.yml`: сервисы `backend`, `frontend`, volume для `game.db`.
- [ ] `.env` для конфигурации (порт, CORS origin, tick rate).

### Milestone 9 — Деплой на reg.ru
- [ ] Аренда/настройка VPS на reg.ru (Ubuntu 22.04 LTS рекомендуется).
- [ ] Установка Docker + Docker Compose на сервере.
- [ ] Настройка домена (A-запись на IP VPS) через панель reg.ru.
- [ ] Установка Caddy или Nginx + Certbot для HTTPS (Let's Encrypt).
- [ ] Reverse proxy: `/` → frontend (nginx static), `/api/*` и `/ws/*` → backend (uvicorn).
- [ ] Проброс WebSocket через reverse-proxy (обязательно указать `Upgrade`/`Connection` заголовки для WS).
- [ ] Деплой через `docker compose up -d --build`.
- [ ] Настройка автозапуска (systemd unit или `restart: unless-stopped` в compose).
- [ ] Бэкап `game.db` (простой cron-скрипт копирования файла).

### Milestone 10 — Пост-релиз
- [ ] Мониторинг: логи uvicorn, базовый healthcheck endpoint `/health`.
- [ ] Опционально: метрики (кол-во онлайн игроков, uptime).
- [ ] Сбор фидбека, багфиксы.

---

## 5. Ключевые технические детали

### Формат WebSocket-сообщений

**Клиент → Сервер:**
```json
{ "type": "input", "dir": { "x": 0.7, "y": -0.7 } }
```

**Сервер → Клиент (каждый тик):**
```json
{
  "type": "state",
  "tick": 1234,
  "players": [
    { "id": "abc123", "nickname": "Vasya", "x": 120, "y": 340, "alive": true }
  ],
  "projectiles": [
    { "id": "p1", "x": 500, "y": 200, "size": 20 }
  ]
}
```

**Сервер → Клиент (при смерти):**
```json
{
  "type": "death",
  "lifetime_seconds": 47.8,
  "is_new_record": true,
  "leaderboard": [
    { "nickname": "Petya", "lifetime_seconds": 120.5 },
    { "nickname": "Vasya", "lifetime_seconds": 47.8 },
    { "nickname": "Kolya", "lifetime_seconds": 30.1 }
  ]
}
```

### Модель данных SQLite (`scores`)

| Поле              | Тип      | Описание                         |
|-------------------|----------|-----------------------------------|
| id                | INTEGER  | PK, autoincrement                 |
| nickname          | TEXT     | Ник игрока                        |
| lifetime_seconds  | FLOAT    | Время жизни в секундах            |
| created_at        | DATETIME | Время установки рекорда           |

Топ-3 = `SELECT * FROM scores ORDER BY lifetime_seconds DESC LIMIT 3`.

### Игровая физика (отскок снаряда)

```python
# на каждом тике
proj.x += proj.vx * dt
proj.y += proj.vy * dt

if proj.x <= 0 or proj.x >= FIELD_WIDTH:
    proj.vx *= -1
    proj.x = clamp(proj.x, 0, FIELD_WIDTH)

if proj.y <= 0 or proj.y >= FIELD_HEIGHT:
    proj.vy *= -1
    proj.y = clamp(proj.y, 0, FIELD_HEIGHT)
```

Коллизия (AABB, т.к. квадраты):
```python
def collides(a, b):
    return (abs(a.x - b.x) < (a.size + b.size) / 2 and
            abs(a.y - b.y) < (a.size + b.size) / 2)
```

---

## 6. Деплой на reg.ru — пошагово

1. **Заказать VPS** в панели reg.ru (минимально: 1-2 vCPU, 2 GB RAM, Ubuntu 22.04).
2. **Подключиться по SSH**: `ssh root@<server_ip>`.
3. **Установить Docker**:
   ```bash
   curl -fsSL https://get.docker.com | sh
   apt install docker-compose-plugin -y
   ```
4. **Привязать домен**: в панели reg.ru → DNS-записи → добавить A-запись `@`/`www` → IP сервера.
5. **Склонировать проект** на сервер (git clone или scp).
6. **Настроить `.env`** (домен, CORS_ORIGINS, TICK_RATE).
7. **Поднять Caddy** (проще всего для авто-HTTPS) с Caddyfile:
   ```
   yourdomain.ru {
       reverse_proxy /api/* backend:8000
       reverse_proxy /ws/*  backend:8000
       reverse_proxy /*     frontend:80
   }
   ```
8. **Запустить**: `docker compose up -d --build`.
9. **Проверить**: открыть `https://yourdomain.ru`, протестировать WS-подключение (DevTools → Network → WS).
10. **Настроить бэкап БД**: cron-задача `cp game.db backups/game-$(date +%F).db` раз в сутки.

---

## 7. Возможные риски и решения

| Риск                                        | Решение                                                       |
|---------------------------------------------|----------------------------------------------------------------|
| WebSocket не проходит через reverse-proxy   | Явно прописать `Upgrade`/`Connection` заголовки в Nginx/Caddy  |
| Рассинхронизация клиента и сервера          | Сервер — единственный источник истины, клиент только рендерит |
| Много одновременных игроков нагружают сервер| Ограничить tick rate (20-30/сек), оптимизировать broadcast (delta вместо full state) |
| SQLite блокировки при записи               | Один writer-процесс (uvicorn без множества workers для WS-части) или переход на PostgreSQL при росте нагрузки |
| Читерство (подмена данных с клиента)        | Вся физика и коллизии считаются только на сервере              |

---

## 8. Дальнейшее развитие (после MVP)

- Регистрация/авторизация (привязка рекордов к аккаунту).
- Расширенная таблица лидеров (топ-100, фильтр по дате).
- Разные типы снарядов (по размеру/скорости/поведению).
- Power-ups (щит, замедление времени).
- Мобильное управление (touch/джойстик на экране).
- Комнаты/лобби вместо одной глобальной комнаты.

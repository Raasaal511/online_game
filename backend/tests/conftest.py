import os
import shutil
import tempfile

import pytest

# ВАЖНО: DB_DIR должен быть установлен ДО первого импорта app.database —
# он читается один раз на уровне модуля при импорте (os.getenv в module scope).
# Без этого тесты писали бы прямо в реальный backend/game.db (уже случалось
# один раз при ручной отладке — тестовая запись "P2" осталась в проде).
_TEST_DB_DIR = tempfile.mkdtemp(prefix="dodge_game_test_db_")
os.environ["DB_DIR"] = _TEST_DB_DIR


@pytest.fixture(scope="session", autouse=True)
def _cleanup_test_db():
    yield
    shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)


@pytest.fixture(autouse=True)
def _fresh_db_tables():
    # каждый тест получает пустые таблицы — иначе тесты leaderboard влияют
    # друг на друга в зависимости от порядка запуска
    from app.database import Base, engine

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def room():
    from app.game.room import GameRoom

    return GameRoom()

from app.game.leaderboard import save_score, get_leaderboard


def test_leaderboard_shows_unique_players_with_best_score():
    # регрессия: раньше топ-3 брался из отдельных строк "scores" без
    # группировки по нику — один игрок, сыгравший несколько раз подряд,
    # мог занять сразу все 3 места в таблице лидеров
    save_score("Alice", 5, 30.0)
    save_score("Alice", 8, 45.0)  # Alice's best run
    save_score("Alice", 2, 10.0)
    save_score("Bob", 6, 20.0)
    save_score("Carol", 3, 15.0)
    save_score("Dave", 1, 5.0)

    top = get_leaderboard()

    assert len(top) == 3
    nicknames = [row["nickname"] for row in top]
    assert len(nicknames) == len(set(nicknames)), f"duplicate nicknames: {nicknames}"
    assert top[0]["nickname"] == "Alice" and top[0]["kills"] == 8
    assert "Dave" not in nicknames, "Dave's 1 kill should not make top-3"

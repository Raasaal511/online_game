from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.game.room import game_room

router = APIRouter()


@router.websocket("/ws/game")
async def game_ws(websocket: WebSocket, nickname: str = Query(default="Player")):
    await websocket.accept()
    game_room.start()
    player = await game_room.add_player(nickname, websocket)

    if player is None:
        await websocket.send_json({"type": "full"})
        await websocket.close()
        return

    try:
        await websocket.send_json(
            {"type": "welcome", "player_id": player.id, **game_room.get_map_info()}
        )
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "input":
                direction = data.get("dir", {})
                game_room.set_input(
                    player.id,
                    float(direction.get("x", 0)),
                    float(direction.get("y", 0)),
                )
            elif msg_type == "aim":
                game_room.set_aim(player.id, float(data.get("angle", 0)))
            elif msg_type == "shoot":
                game_room.try_shoot(player.id)

    except WebSocketDisconnect:
        pass
    finally:
        game_room.remove_player(player.id)

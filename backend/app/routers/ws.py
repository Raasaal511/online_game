from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.game.entities import DEFAULT_TANK_CLASS, DEFAULT_GUN_SKIN
from app.game.room import game_room

router = APIRouter()


@router.websocket("/ws/game")
async def game_ws(
    websocket: WebSocket,
    nickname: str = Query(default="Player"),
    tank_class: str = Query(default=DEFAULT_TANK_CLASS),
    gun_skin: str = Query(default=DEFAULT_GUN_SKIN),
):
    await websocket.accept()
    game_room.start()
    player = await game_room.add_player(nickname, websocket, tank_class, gun_skin)

    if player is None:
        await websocket.send_json({"type": "full"})
        await websocket.close()
        return

    try:
        await websocket.send_json(
            {
                "type": "welcome",
                "player_id": player.id,
                "chat_history": game_room.get_chat_history(),
                **game_room.get_map_info(),
            }
        )
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # общий rate-limit на любое входящее сообщение — защита от заливки
            # пакетами (не путать с игровыми кулдаунами оружия/чата, которые
            # ограничивают геймплейный эффект, а не сетевую нагрузку)
            if not game_room.allow_message(player.id):
                continue

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
                game_room.try_shoot(player.id, bool(data.get("use_pickup", False)))
            elif msg_type == "teleport":
                game_room.try_teleport(player.id, float(data.get("angle", 0)))
            elif msg_type == "ultimate":
                game_room.try_ultimate(player.id)
            elif msg_type == "select_class":
                game_room.set_respawn_class(player.id, str(data.get("tank_class", "")))
            elif msg_type == "select_gun_skin":
                game_room.set_gun_skin(player.id, str(data.get("gun_skin", "")))
            elif msg_type == "chat":
                entry = game_room.add_chat_message(player.id, str(data.get("text", "")))
                if entry is not None:
                    await game_room.broadcast_chat(entry)

    except WebSocketDisconnect:
        pass
    finally:
        game_room.remove_player(player.id)

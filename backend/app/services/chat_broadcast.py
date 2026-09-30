import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Set
import jwt
from fastapi import WebSocket
from backend.app.config import get_settings

settings = get_settings()

TICKET_EXPIRATION_SECONDS = 60


def create_chat_ticket(user_id: uuid.UUID, business_id: uuid.UUID) -> str:
    """
    Creates a signed, short-lived JWT ticket for secure WebSocket connection handshake.
    Ensures authentication without passing long-lived tokens over URL query parameters.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "biz": str(business_id),
        "purpose": "chat_ws",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=TICKET_EXPIRATION_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_PRIVATE_KEY, algorithm="RS256")


def verify_chat_ticket(ticket: str, expected_business_id: uuid.UUID) -> uuid.UUID:
    """
    Verifies a chat ticket and returns the authenticated user_id UUID.
    Raises ValueError if invalid, expired, or business mismatch.
    """
    try:
        payload = jwt.decode(
            ticket,
            settings.JWT_PUBLIC_KEY,
            algorithms=["RS256"],
            options={"verify_exp": True},
        )
        if payload.get("purpose") != "chat_ws":
            raise ValueError("Invalid ticket purpose.")
        if payload.get("biz") != str(expected_business_id):
            raise ValueError("Ticket business mismatch.")
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise ValueError("Missing user id in ticket.")
        return uuid.UUID(user_id_str)
    except Exception as e:
        raise ValueError(f"Chat ticket verification failed: {e}") from e


class ChatConnectionManager:
    """
    In-memory broadcast manager for multi-client real-time company chat and task comments.
    Maintains active socket sets partitioned by business_id.
    """

    def __init__(self):
        self._active_connections: Dict[uuid.UUID, Set[WebSocket]] = {}

    async def connect(self, business_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        if business_id not in self._active_connections:
            self._active_connections[business_id] = set()
        self._active_connections[business_id].add(websocket)

    def disconnect(self, business_id: uuid.UUID, websocket: WebSocket) -> None:
        if business_id in self._active_connections:
            self._active_connections[business_id].discard(websocket)
            if not self._active_connections[business_id]:
                del self._active_connections[business_id]

    async def broadcast(self, business_id: uuid.UUID, event: dict) -> None:
        if business_id not in self._active_connections:
            return
        dead_sockets = set()
        sockets = list(self._active_connections[business_id])
        for socket in sockets:
            try:
                await socket.send_json(event)
            except Exception:
                dead_sockets.add(socket)
        for dead in dead_sockets:
            self.disconnect(business_id, dead)


chat_manager = ChatConnectionManager()

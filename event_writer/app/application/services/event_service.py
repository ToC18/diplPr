import json

from ...infrastructure.repositories.events_repository import insert_event


def process_message(body: bytes) -> None:
    payload = json.loads(body.decode("utf-8"))
    insert_event(payload)

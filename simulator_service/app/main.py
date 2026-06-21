import json
import os
import random
import time
from datetime import datetime, timedelta, timezone

import requests
from paho.mqtt import publish

ADMIN_API_URL = os.getenv("ADMIN_API_URL", "http://localhost:8000/api/admin/equipment/")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "2"))
REQUEST_TIMEOUT_SEC = int(os.getenv("REQUEST_TIMEOUT_SEC", "5"))

PUSH_RAW_VALUES = [0, 1, 1, 1, 1, 1, 2]
ALARM_MIN_SEC = 30
ALARM_MAX_SEC = 120
STOP_MIN_SEC = 20
STOP_MAX_SEC = 60
NORMAL_MIN_SEC = 40
NORMAL_MAX_SEC = 180

push_state_by_topic: dict[str, dict] = {}


def fetch_equipment() -> list[dict]:
    response = requests.get(ADMIN_API_URL, timeout=REQUEST_TIMEOUT_SEC)
    response.raise_for_status()
    data = response.json()
    return data if isinstance(data, list) else []


def create_equipment_if_missing(existing_ids: set[str]) -> None:
    demo_payloads = [
        {
            "equipment_id": "E-POLL-1001",
            "name": "Demo Poll станок",
            "type": "poll",
            "protocol": "modbus",
            "endpoint": {"host": "127.0.0.1", "port": 502},
            "poll_interval_sec": 2,
            "timeout_sec": 60,
            "mapping": {"status_map": {"0": "STOP", "1": "RUN", "2": "ALARM"}},
        },
        {
            "equipment_id": "E-PUSH-2001",
            "name": "Demo Push станок",
            "type": "push",
            "protocol": "mqtt",
            "endpoint": {"host": "mosquitto", "port": 1883, "topic": "equip/E-PUSH-2001/status"},
            "poll_interval_sec": None,
            "timeout_sec": 60,
            "mapping": {"status_map": {"0": "STOP", "1": "RUN", "2": "ALARM"}},
        },
    ]

    for payload in demo_payloads:
        if payload["equipment_id"] in existing_ids:
            continue
        response = requests.post(ADMIN_API_URL, json=payload, timeout=REQUEST_TIMEOUT_SEC)
        response.raise_for_status()
        print(f"simulator: created {payload['equipment_id']}")


def select_duration_sec(raw: int) -> int:
    if raw == 2:
        return random.randint(ALARM_MIN_SEC, ALARM_MAX_SEC)
    if raw == 0:
        return random.randint(STOP_MIN_SEC, STOP_MAX_SEC)
    return random.randint(NORMAL_MIN_SEC, NORMAL_MAX_SEC)


def normalize_status(raw: int, mapping: dict | None) -> str:
    status_map = ((mapping or {}).get("status_map")) or {"0": "STOP", "1": "RUN", "2": "ALARM"}
    return status_map.get(str(raw), "RUN" if raw == 1 else "ALARM" if raw == 2 else "STOP")


def ensure_push_slot(topic: str, now: datetime) -> dict:
    slot = push_state_by_topic.get(topic)
    if slot is None or now >= slot["until"]:
        previous_raw = slot["raw"] if slot else None
        raw = random.choice(PUSH_RAW_VALUES)
        if previous_raw is not None and raw == previous_raw:
            raw = random.choice(PUSH_RAW_VALUES)
        slot = {"raw": raw, "until": now + timedelta(seconds=select_duration_sec(raw))}
        push_state_by_topic[topic] = slot
    return slot


def publish_push_messages(equipment: list[dict]) -> None:
    for item in equipment:
        if item.get("type") != "push" or item.get("protocol") != "mqtt":
            continue

        topic = (item.get("endpoint") or {}).get("topic")
        equipment_id = item.get("equipment_id")
        if not topic or not equipment_id:
            continue

        now = datetime.now(timezone.utc)
        slot = ensure_push_slot(topic, now)
        raw = slot["raw"]
        publish.single(
            topic,
            payload=json.dumps({"raw": raw}),
            hostname=MQTT_HOST,
            port=MQTT_PORT,
            qos=1,
            retain=True,
        )

        ttl_left = int((slot["until"] - now).total_seconds())
        status = normalize_status(raw, item.get("mapping"))
        print(f"simulator: mqtt -> {equipment_id} status={status} raw={raw} ttl={max(0, ttl_left)}s")


def main() -> None:
    while True:
        try:
            equipment = fetch_equipment()
            create_equipment_if_missing({item.get("equipment_id") for item in equipment if item.get("equipment_id")})
            equipment = fetch_equipment()
            if not equipment:
                print("simulator: no equipment configured")
            publish_push_messages(equipment)
        except Exception as exc:
            print(f"simulator error: {exc}")

        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()

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
# Telemetry is frequent (every 2s), status transitions are less frequent.
ALARM_MIN_SEC = 30
ALARM_MAX_SEC = 120
NORMAL_MIN_SEC = 40
NORMAL_MAX_SEC = 180

state_by_topic: dict[str, dict] = {}


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
            "timeout_sec": 30,
            "mapping": {"status_map": {"0": "STOP", "1": "RUN", "2": "ALARM"}},
        },
        {
            "equipment_id": "E-PUSH-2001",
            "name": "Demo Push станок",
            "type": "push",
            "protocol": "mqtt",
            "endpoint": {"host": "mosquitto", "port": 1883, "topic": "equip/E-PUSH-2001/status"},
            "poll_interval_sec": None,
            "timeout_sec": 30,
            "mapping": {"status_map": {"0": "STOP", "1": "RUN", "2": "ALARM"}},
        },
    ]

    for payload in demo_payloads:
        if payload["equipment_id"] in existing_ids:
            continue
        response = requests.post(ADMIN_API_URL, json=payload, timeout=REQUEST_TIMEOUT_SEC)
        response.raise_for_status()
        print(f"simulator: created {payload['equipment_id']}")


def publish_push_messages(equipment: list[dict]) -> None:
    for item in equipment:
        if item.get("type") != "push" or item.get("protocol") != "mqtt":
            continue
        topic = (item.get("endpoint") or {}).get("topic")
        if not topic:
            continue

        now = datetime.now(timezone.utc)
        slot = state_by_topic.get(topic)

        if slot is None or now >= slot["until"]:
            previous_raw = slot["raw"] if slot else None
            raw = random.choice(PUSH_RAW_VALUES)
            if previous_raw is not None and raw == previous_raw:
                raw = random.choice(PUSH_RAW_VALUES)

            duration_sec = random.randint(ALARM_MIN_SEC, ALARM_MAX_SEC) if raw == 2 else random.randint(
                NORMAL_MIN_SEC,
                NORMAL_MAX_SEC,
            )
            slot = {"raw": raw, "until": now + timedelta(seconds=duration_sec)}
            state_by_topic[topic] = slot

        raw = slot["raw"]
        payload = json.dumps({"raw": raw})
        publish.single(
            topic,
            payload=payload,
            hostname=MQTT_HOST,
            port=MQTT_PORT,
            qos=1,
            retain=False,
        )
        ttl_left = int((slot["until"] - now).total_seconds())
        print(f"simulator: mqtt push -> {topic} raw={raw} ttl={max(0, ttl_left)}s")


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

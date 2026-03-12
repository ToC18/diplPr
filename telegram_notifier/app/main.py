import json
import time
from datetime import datetime

import pika
import requests

from .config import settings


last_status_by_equipment: dict[str, str] = {}


def send_telegram_message(text: str) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        print("telegram_notifier: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, skip send")
        return
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    payload = {"chat_id": settings.telegram_chat_id, "text": text}
    r = requests.post(url, json=payload, timeout=10)
    r.raise_for_status()


def format_message(equipment_id: str, status: str, ts_raw: str) -> str:
    try:
        ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        ts_text = ts.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        ts_text = str(ts_raw)
    return (
        "Вызов ремонтной бригады\n"
        f"Оборудование: {equipment_id}\n"
        f"Статус: {status}\n"
        f"Время события: {ts_text}\n"
        "Требуется проверка и ремонт."
    )


def handle_message(ch, method, properties, body) -> None:
    try:
        data = json.loads(body.decode("utf-8"))
        equipment_id = str(data.get("equipment_id", "")).strip()
        status = str(data.get("status", "")).strip().upper()
        ts_raw = data.get("ts")
        if not equipment_id or not status:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        prev = last_status_by_equipment.get(equipment_id)
        last_status_by_equipment[equipment_id] = status

        # Отправляем только при переходе в аварийный статус.
        if status in settings.alert_statuses and prev != status:
            msg = format_message(equipment_id, status, ts_raw)
            send_telegram_message(msg)
            print(f"telegram_notifier: alert sent for {equipment_id} status={status}")
    except Exception as exc:
        print(f"telegram_notifier: handle error: {exc}")
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)


def run_consumer() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbit_url))
    channel = connection.channel()
    channel.queue_declare(queue=settings.queue_name, durable=True)
    channel.basic_qos(prefetch_count=50)
    channel.basic_consume(queue=settings.queue_name, on_message_callback=handle_message)
    print(
        f"telegram_notifier: consuming queue={settings.queue_name}, "
        f"alert_statuses={sorted(settings.alert_statuses)}"
    )
    channel.start_consuming()


def main() -> None:
    while True:
        try:
            run_consumer()
        except Exception as exc:
            print(f"telegram_notifier: retry after error: {exc}")
            time.sleep(2)


if __name__ == "__main__":
    main()

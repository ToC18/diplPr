import json

import pika

from ...config import settings
from ...schemas import EventIn


def publish_event(event: EventIn) -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbit_url))
    channel = connection.channel()
    payload = json.dumps(event.model_dump(), default=str)
    queue_names = {
        settings.writer_queue_name,
        settings.telegram_queue_name,
    }
    for queue_name in queue_names:
        channel.queue_declare(queue=queue_name, durable=True)
        channel.basic_publish(
            exchange="",
            routing_key=queue_name,
            body=payload,
            properties=pika.BasicProperties(delivery_mode=2),
        )
    connection.close()

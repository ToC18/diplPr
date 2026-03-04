import json

import pika

from ...config import settings
from ...schemas import EventIn


def publish_event(event: EventIn) -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbit_url))
    channel = connection.channel()
    channel.queue_declare(queue="equipment_events", durable=True)
    channel.basic_publish(
        exchange="",
        routing_key="equipment_events",
        body=json.dumps(event.model_dump(), default=str),
        properties=pika.BasicProperties(delivery_mode=2),
    )
    connection.close()

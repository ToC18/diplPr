import pika

from ...config import settings
from ...application.services.event_service import process_message


def handle_event(ch, method, properties, body):
    process_message(body)
    ch.basic_ack(delivery_tag=method.delivery_tag)


def run_consumer() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbit_url))
    channel = connection.channel()
    channel.queue_declare(queue="equipment_events", durable=True)
    channel.basic_qos(prefetch_count=50)
    channel.basic_consume(queue="equipment_events", on_message_callback=handle_event)
    channel.start_consuming()

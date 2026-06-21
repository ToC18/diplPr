import unittest
from unittest.mock import patch

from app.application.services.event_service import process_message


class EventWriterServiceTests(unittest.TestCase):
    def test_process_message_decodes_json_and_inserts_event(self):
        payload = b'{"equipment_id":"EQ-1","status":"RUN","ts":"2026-01-01T00:00:00"}'

        with patch("app.application.services.event_service.insert_event") as insert_event:
            process_message(payload)

        insert_event.assert_called_once_with(
            {"equipment_id": "EQ-1", "status": "RUN", "ts": "2026-01-01T00:00:00"}
        )

import unittest
from unittest.mock import patch

from app.application.services import events_service


class EventsServiceTests(unittest.TestCase):
    def test_receive_event_publishes_payload(self):
        event = object()

        with patch.object(events_service, "publish_event") as publish_event:
            result = events_service.receive_event(event)

        publish_event.assert_called_once_with(event)
        self.assertEqual(result, {"status": "ok"})

    def test_recent_events_clamps_limit_to_minimum(self):
        with patch.object(events_service.events_repository, "list_recent", return_value=[]) as list_recent:
            events_service.recent_events(0)

        list_recent.assert_called_once_with(1)

    def test_events_by_equipment_clamps_limit_to_maximum(self):
        with patch.object(events_service.events_repository, "list_by_equipment", return_value=[]) as list_by_equipment:
            events_service.events_by_equipment("EQ-1", 5000)

        list_by_equipment.assert_called_once_with("EQ-1", 1000)

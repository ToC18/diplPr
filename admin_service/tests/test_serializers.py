import os
import unittest

import django


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "admin_core.settings")
django.setup()

from admin_app.serializers import EquipmentSerializer


class EquipmentSerializerTests(unittest.TestCase):
    @staticmethod
    def make_serializer(payload):
        serializer = EquipmentSerializer(data=payload)
        serializer.fields["equipment_id"].validators = []
        return serializer

    def test_valid_poll_equipment_is_accepted(self):
        serializer = self.make_serializer(
            {
                "equipment_id": "EQ-1",
                "name": "Poll equipment",
                "type": "poll",
                "protocol": "modbus",
                "endpoint": {"host": "127.0.0.1", "port": 502},
                "poll_interval_sec": 5,
                "timeout_sec": 60,
                "mapping": {"status_map": {"0": "STOP", "1": "RUN"}},
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_timeout_below_minimum_is_rejected(self):
        serializer = self.make_serializer(
            {
                "equipment_id": "EQ-1",
                "name": "Poll equipment",
                "type": "poll",
                "protocol": "modbus",
                "endpoint": {"host": "127.0.0.1", "port": 502},
                "poll_interval_sec": 5,
                "timeout_sec": 30,
                "mapping": {"status_map": {"0": "STOP", "1": "RUN"}},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("timeout_sec", serializer.errors)

    def test_push_equipment_requires_topic(self):
        serializer = self.make_serializer(
            {
                "equipment_id": "EQ-2",
                "name": "Push equipment",
                "type": "push",
                "protocol": "mqtt",
                "endpoint": {"host": "mosquitto", "port": 1883},
                "timeout_sec": 60,
                "mapping": {"status_map": {"0": "STOP", "1": "RUN"}},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("endpoint", serializer.errors)

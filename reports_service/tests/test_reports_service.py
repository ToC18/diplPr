import unittest
from datetime import datetime
from unittest.mock import patch

from app.application.services import reports_service


class ReportsServiceTests(unittest.TestCase):
    def test_create_manual_downtime_normalizes_status_and_strings(self):
        captured = {}

        def fake_create_manual_downtime(**kwargs):
            captured.update(kwargs)
            return {"status": "ok"}

        with patch.object(
            reports_service.reports_repository,
            "create_manual_downtime",
            side_effect=fake_create_manual_downtime,
        ):
            result = reports_service.create_manual_downtime(
                equipment_id=" EQ-1 ",
                status="broken",
                start_ts=datetime(2026, 1, 1, 10, 0, 0),
                end_ts=None,
                note=" note ",
                created_by=" admin ",
            )

        self.assertEqual(result, {"status": "ok"})
        self.assertEqual(captured["equipment_id"], "EQ-1")
        self.assertEqual(captured["status"], "STOP")
        self.assertEqual(captured["note"], "note")
        self.assertEqual(captured["created_by"], "admin")

    def test_get_equipment_live_clamps_threshold(self):
        with patch.object(reports_service.reports_repository, "get_equipment_live", return_value=[]) as get_equipment_live:
            reports_service.get_equipment_live(1)

        get_equipment_live.assert_called_once_with(10)

    def test_export_downtime_csv_contains_expected_columns(self):
        rows = [
            {
                "equipment_id": "EQ-1",
                "status": "STOP",
                "start_ts": "2026-01-01T10:00:00",
                "end_ts": "2026-01-01T10:05:00",
                "source": "manual",
                "note": "repair",
                "created_by": "admin",
            }
        ]

        with patch.object(reports_service.reports_repository, "get_downtime_export_rows", return_value=rows):
            csv_payload = reports_service.export_downtime_csv()

        self.assertIn("equipment_id,status,start_ts,end_ts,source,note,created_by", csv_payload)
        self.assertIn("EQ-1,STOP,2026-01-01T10:00:00,2026-01-01T10:05:00,manual,repair,admin", csv_payload)

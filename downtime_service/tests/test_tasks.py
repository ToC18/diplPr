import unittest
from datetime import datetime

from app import tasks


class DowntimeTasksTests(unittest.TestCase):
    def test_split_interval_by_day_breaks_cross_day_range(self):
        start_ts = datetime(2026, 4, 18, 23, 58, 0)
        end_ts = datetime(2026, 4, 19, 0, 2, 0)

        segments = tasks.split_interval_by_day(start_ts, end_ts)

        self.assertEqual(
            segments,
            [
                (datetime(2026, 4, 18, 23, 58, 0), datetime(2026, 4, 18, 23, 59, 59, 999999)),
                (datetime(2026, 4, 19, 0, 0, 0), datetime(2026, 4, 19, 0, 2, 0)),
            ],
        )

    def test_split_interval_by_day_keeps_same_day_range_intact(self):
        start_ts = datetime(2026, 4, 18, 12, 0, 0)
        end_ts = datetime(2026, 4, 18, 12, 5, 0)

        segments = tasks.split_interval_by_day(start_ts, end_ts)

        self.assertEqual(segments, [(start_ts, end_ts)])

    def test_plan_gap_transition_returns_none_without_timeout_breach(self):
        plan = tasks.plan_gap_transition(
            last_status="RUN",
            last_ts=datetime(2026, 4, 18, 12, 0, 0),
            next_ts=datetime(2026, 4, 18, 12, 0, 30),
            timeout_sec=60,
        )

        self.assertIsNone(plan)

    def test_plan_gap_transition_returns_offline_window_after_timeout(self):
        plan = tasks.plan_gap_transition(
            last_status="RUN",
            last_ts=datetime(2026, 4, 18, 12, 0, 0),
            next_ts=datetime(2026, 4, 18, 12, 5, 0),
            timeout_sec=60,
        )

        self.assertEqual(
            plan,
            {
                "close_previous_at": datetime(2026, 4, 18, 12, 1, 0),
                "offline_start": datetime(2026, 4, 18, 12, 1, 0),
                "offline_end": datetime(2026, 4, 18, 12, 5, 0),
            },
        )

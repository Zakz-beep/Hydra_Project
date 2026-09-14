import unittest
from datetime import datetime, timezone
from greeks_chart_data import chart_payload, epoch_seconds


class ChartDataTests(unittest.TestCase):
    def test_timestamp_conversion(self):
        self.assertEqual(epoch_seconds("2026-09-06T10:00:00+07:00"), epoch_seconds("2026-09-06T03:00:00Z"))
        local = datetime(2026, 9, 6, 10, 0, 0)
        self.assertEqual(epoch_seconds(local.isoformat()), local.astimezone(timezone.utc).timestamp())
        self.assertIsNone(epoch_seconds("invalid"))

    def test_dedup_history_cutoff_and_no_strikes_in_summary(self):
        row = dict(expiry="2026-09-07", option_type="call", strike=100)
        snapshot = dict(ticker="SPY", timestamp="2026-09-06T03:00:00Z", data_source="live", by_expiry={"0": {"strikes": [row]}, "1": {"strikes": [row]}})
        cutoff = epoch_seconds(snapshot["timestamp"])
        result = chart_payload(snapshot, [{"timestamp": "invalid"}, {"timestamp": "2026-09-06T04:00:00Z"}, {"timestamp": snapshot["timestamp"]}], [], cutoff)
        self.assertEqual(len(result["chain"]), 1)
        self.assertEqual(len(result["history"]), 1)
        self.assertNotIn("strikes", result["snapshot"]["by_expiry"]["0"])
        self.assertEqual(result["meta"]["gex_usd_per_1pct_multiplier"], 1e7)


if __name__ == "__main__":
    unittest.main()

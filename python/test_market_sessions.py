import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sdk = load("sdk", ROOT / "vrp-claude/public/chart-studio/sdk.py")
indicator = load("sessions", ROOT / "indicators/custom/market_sessions.py")
code = (ROOT / "indicators/custom/market_sessions.py").read_text(encoding="utf-8")


def bars(start, periods=24, freq="1h"):
    return [dict(time=int(t.timestamp()), open=100 + i, high=102 + i, low=99 + i, close=101 + i, volume=10)
            for i, t in enumerate(sdk.pd.date_range(start, periods=periods, freq=freq, tz="UTC"))]


def run(rows, params=None, interval="1h"):
    with contextlib.redirect_stdout(io.StringIO()):
        return json.loads(sdk.execute_indicator(code, {"datasets": {"chart": rows}, "symbol": "BTC", "interval": interval, "params": params or {}}))


class SessionTests(unittest.TestCase):
    def test_winter_summer_and_mismatched_dst_weeks(self):
        for date, london, ny in [("2026-01-05", 8, 13), ("2026-07-06", 7, 12), ("2026-03-09", 8, 12)]:
            result = run(bars(date))["plots"]
            for key, hour in [("asia", 0), ("london", london), ("new_york", ny)]:
                box = next(p for p in result if p["id"] == key + "_zone_0")
                expected = int(sdk.pd.Timestamp(date, tz="UTC").timestamp()) + hour * 3600
                self.assertEqual(box["value"], expected)
                self.assertEqual(box["endTime"], expected + 9 * 3600)

    def test_causal_lines_and_partial_box(self):
        rows = bars("2026-07-06", 24)
        params = {"show_running_high_low": 1}
        short, full = run(rows[:4], params)["plots"], run(rows, params)["plots"]
        for key in ["asia_high", "asia_low"]:
            a = next(p for p in short if p["id"] == key)["data"]
            b = next(p for p in full if p["id"] == key)["data"]
            self.assertEqual(a, b[:4])
        zone = next(p for p in short if p["id"] == "asia_zone_0")
        self.assertEqual(zone["top"], 105)
        self.assertEqual(zone["endTime"], rows[3]["time"] + 3600)

    def test_overnight(self):
        result = run(bars("2026-09-07 12:00", 8), {"asia_start_hhmm": 2300, "asia_end_hhmm": 200})["plots"]
        zone = next(p for p in result if p["id"] == "asia_zone_0")
        self.assertEqual(zone["endTime"] - zone["value"], 3 * 3600)
        self.assertEqual(sdk.pd.Timestamp(zone["value"], unit="s", tz="UTC").hour, 14)

    def test_weekends_and_all_disabled(self):
        rows = bars("2026-09-05")
        self.assertFalse(any(p["kind"] == "box" for p in run(rows)["plots"]))
        self.assertEqual(sum(p["kind"] == "box" for p in run(rows, {"include_weekends": 1})["plots"]), 3)
        output = run(rows, {"asia_enabled": 0, "london_enabled": 0, "new_york_enabled": 0})["plots"]
        self.assertEqual(output[0]["id"], "sessions_empty")

    def test_maximum_output_budget(self):
        output = run(bars("2026-07-01", 24 * 14), {"sessions_per_market": 6, "show_running_high_low": 1, "show_session_open": 1})["plots"]
        self.assertEqual(len(output), 30)
        self.assertEqual(len({p["id"] for p in output}), 30)

    def test_invalid_time_and_timeframe(self):
        with self.assertRaisesRegex(ValueError, "HHMM"):
            run(bars("2026-07-06"), {"asia_start_hhmm": 860})
        with self.assertRaisesRegex(ValueError, "must differ"):
            run(bars("2026-07-06"), {"asia_end_hhmm": 900})
        with self.assertRaisesRegex(ValueError, "Switch timeframe"):
            run(bars("2026-07-06"), interval="1d")

    def test_missing_open_not_fabricated_and_straddling_excluded(self):
        output = run(bars("2026-07-06 01:00", 4), {"show_session_open": 1})["plots"]
        self.assertTrue(all(v["value"] is None for v in next(p for p in output if p["id"] == "asia_open")["data"]))
        self.assertEqual(next(p for p in output if p["id"] == "asia_labels")["data"], [])
        output = run(bars("2026-07-06", 12), {"asia_start_hhmm": 930, "asia_end_hhmm": 1130})["plots"]
        zone = next(p for p in output if p["id"] == "asia_zone_0")
        self.assertEqual(zone["endTime"] - zone["value"], 3600)
        self.assertEqual(zone["top"], 103)


if __name__ == "__main__":
    unittest.main()

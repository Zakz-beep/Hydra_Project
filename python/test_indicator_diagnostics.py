"""Real SDK tests: validation never executes, diagnostics retain user source locations."""
import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "vrp-claude/public/chart-studio/sdk.py"
spec = importlib.util.spec_from_file_location("studio_sdk", path)
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)
payload = {"datasets": {"chart": [{"time": 1700000000, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 10}]}, "symbol": "BTC", "interval": "1m"}


class DiagnosticsTests(unittest.TestCase):
    def request(self, code, validate=False):
        return json.loads(sdk.studio_request(code, payload, validate))

    def test_validation_does_not_execute_or_import(self):
        self.assertEqual(self.request('import definitely_missing_package\nraise RuntimeError("must not execute")', True), {"valid": True})

    def test_syntax_location(self):
        error = self.request("def calculate(ctx)\n    pass", True)["error"]
        self.assertEqual((error["type"], error["line"]), ("SyntaxError", 1))
        self.assertGreater(error["column"], 0)
        self.assertEqual(error["source"], "def calculate(ctx)")

    def test_indentation(self):
        self.assertEqual(self.request("def calculate(ctx):\npass", True)["error"]["type"], "IndentationError")

    def test_nested_user_frame(self):
        code = "def helper():\n    return missing_name\ndef calculate(ctx):\n    helper()"
        error = self.request(code)["error"]
        self.assertEqual((error["type"], error["line"]), ("NameError", 2))

    def test_sdk_frame_points_to_user_call(self):
        error = self.request('def calculate(ctx):\n    ctx.plot.hline("x", 1, color="red")')["error"]
        self.assertEqual(error["line"], 2)
        self.assertIn("six-digit", error["message"])

    def test_exit_does_not_lose_response(self):
        self.assertEqual(self.request("raise SystemExit(3)")["error"]["type"], "SystemExit")

    def test_no_plot_and_recovery(self):
        self.assertIn("No plots", self.request("def calculate(ctx):\n    pass")["error"]["message"])
        result = self.request('def calculate(ctx):\n    ctx.plot.line("x", ctx.data.ohlcv().close)')["result"]
        self.assertEqual(result["plots"][0]["data"], [{"time": 1700000000, "value": 2.0}])

    def test_unicode_line(self):
        error = self.request('def calculate(ctx):\n    label = "Δ 🟢"\n    return missing')["error"]
        self.assertEqual(error["line"], 3)
        self.assertEqual(error["source"], "    return missing")


if __name__ == "__main__":
    unittest.main()

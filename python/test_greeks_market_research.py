import math
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient
from greeks_research_math import exposure_summary, holdings_rows, relative_metrics, rv_vix_history
from greeks_market_research import create_research_router


class VolatilityTests(unittest.TestCase):
    def setUp(self):
        self.dates = pd.bdate_range("2025-01-01", periods=150)
        self.prices = pd.Series(100 * np.exp(np.arange(150) * .01), index=self.dates)
        self.vix = pd.Series(20., index=self.dates)

    def test_calendar_horizon_and_units(self):
        row = rv_vix_history(self.prices, self.vix)["rows"][60]
        expected = 100 * math.sqrt(row["trailing_returns"] * .01 ** 2 * 365 / 30)
        self.assertAlmostEqual(row["rv_trailing"], expected)
        self.assertAlmostEqual(row["rv_trailing"] * math.sqrt(30 / 365), 100 * math.sqrt(row["trailing_returns"] * .01 ** 2))
        self.assertAlmostEqual(row["variance_spread"], 400 - expected ** 2)
        self.assertNotEqual(row["trailing_returns"], 30)

    def test_forward_has_no_future_values_until_mature(self):
        result = rv_vix_history(self.prices, self.vix)
        self.assertIsNone(result["latest"]["rv_forward"])
        for row in result["rows"]:
            if pd.Timestamp(row["forward_target"]) > self.dates[-1]:
                self.assertIsNone(row["rv_forward"])

    def test_trailing_prefix_invariance(self):
        a = rv_vix_history(self.prices.iloc[:90], self.vix.iloc[:90])["rows"]
        b = rv_vix_history(self.prices, self.vix)["rows"]
        self.assertEqual([r["rv_trailing"] for r in a], [r["rv_trailing"] for r in b[:90]])

    def test_forward_uses_after_origin_not_trailing(self):
        prices = self.prices.copy(); prices.iloc[80:] *= 1.5
        result = rv_vix_history(prices, self.vix)["rows"]
        self.assertGreater(result[75]["rv_forward"], result[75]["rv_trailing"])
        original = rv_vix_history(self.prices, self.vix)["rows"]
        self.assertEqual(result[75]["rv_trailing"], original[75]["rv_trailing"])

    def test_missing_price_invalidates_instead_of_filling(self):
        prices = self.prices.copy(); prices.iloc[60] = np.nan
        rows = rv_vix_history(prices, self.vix)["rows"]
        self.assertIsNone(rows[61]["rv_trailing"])
        self.assertIsNone(rows[55]["rv_forward"])
        self.assertIsNotNone(rows[100]["rv_trailing"])

    def test_missing_dates_and_vix_alignment(self):
        prices = self.prices.drop(self.dates[50:60])
        rows = rv_vix_history(prices, self.vix.drop(self.dates[80]))["rows"]
        self.assertNotIn(str(self.dates[80].date()), [r["date"] for r in rows])
        row = next(r for r in rows if r["date"] == str(self.dates[61].date()))
        self.assertIsNone(row["rv_trailing"])

    def test_flat_price_zero_rv(self):
        result = rv_vix_history(self.prices * 0 + 100, self.vix)
        self.assertEqual(result["latest"]["rv_trailing"], 0)

    def test_http_serialization(self):
        app = FastAPI(); app.include_router(create_research_router(lambda t: {}))
        with patch('greeks_market_research.cached', return_value=rv_vix_history(self.prices, self.vix)):
            response = TestClient(app).get('/api/greeks/rv-vix')
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(response.json()["latest"]["rv_forward"])


class ConstituentTests(unittest.TestCase):
    def test_beta_correlation_known_returns(self):
        dates = pd.bdate_range("2025-01-01", periods=100)
        moves = np.sin(np.arange(100)) * .01
        a = pd.Series(100 * np.cumprod(1 + moves), index=dates)
        b = pd.Series(50 * np.cumprod(1 + 2 * moves), index=dates)
        result = relative_metrics(a, b)
        self.assertAlmostEqual(result["beta"], 2)
        self.assertAlmostEqual(result["correlation"], 1)
        self.assertEqual(result["samples"], 60)

    def test_constant_and_insufficient_data(self):
        a = pd.Series(100., index=pd.bdate_range("2025-01-01", periods=25))
        self.assertIsNone(relative_metrics(a, a)["beta"])
        self.assertIsNone(relative_metrics(a.iloc[:5], a.iloc[:5])["relative_return_20"])

    def test_weights_are_not_renormalized_or_percent_guessed(self):
        frame = pd.DataFrame({"Name": ["NVIDIA", "Apple"], "Holding Percent": [.08, .06]}, index=["NVDA", "AAPL"])
        rows = holdings_rows(frame)
        self.assertAlmostEqual(sum(r["weight"] for r in rows), .14)
        with self.assertRaises(ValueError):
            holdings_rows(frame.assign(**{"Holding Percent": [8, 6]}))

    def test_synthetic_excluded_and_independent_signs_preserved(self):
        base = {"data_source": "live", "total_net_gex": -2, "total_gross_gex": 4}
        parent = exposure_summary(base)
        child = exposure_summary({**base, "total_net_gex": 1})
        self.assertEqual(parent["net_gex"], -20_000_000)
        self.assertEqual(child["net_gex"], 10_000_000)
        self.assertIsNone(exposure_summary({**base, "data_source": "mixed"})["net_gex"])

    def test_endpoint_errors_and_validation(self):
        app = FastAPI(); app.include_router(create_research_router(lambda t: {"ticker": t, "data_source": "synthetic"}))
        client = TestClient(app)
        self.assertEqual(client.get('/api/greeks/etf-constituents?etf=NVDA').status_code, 422)
        self.assertEqual(client.get('/api/greeks/etf-constituents?window=999').status_code, 422)
        self.assertIsNone(client.get('/api/greeks/constituent-exposure?ticker=NVDA').json()["net_gex"])
        with patch('greeks_market_research.cached', side_effect=RuntimeError('provider unavailable')):
            response = client.get('/api/greeks/rv-vix')
            self.assertEqual(response.status_code, 502)
            self.assertIn('No synthetic', response.json()['detail'])


if __name__ == '__main__':
    unittest.main()

"""
msar.py
=======
Markov-Switching Autoregressive Model — MS(K)-AR(p)
====================================================

Pure logic module for API consumption (no charts, no print, no hardcoded config).

Pipeline:
  1. Fit MS(K)-AR(p) on log-return series (in-sample)
  2. Identify regimes (Bull / Bear / Neutral) by mean return ranking
  3. Compute per-regime stats: Sharpe, Kelly fraction, VaR/CVaR
  4. Apply IS params to full data → filtered probabilities (OOS regime detection)
  5. Multi-step forecast via transition matrix propagation
  6. Price cone forecast with 95% CI

Usage:
  model = MSARModel(k_regimes=2, ar_order=2)
  result = model.fit(returns_series)       # returns JSON-ready dict
  forecast = model.forecast(n_days=10)     # regime + price forecast
"""

import numpy as np
import pandas as pd
from statsmodels.tsa.regime_switching.markov_autoregression import MarkovAutoregression
from scipy.stats import norm
from typing import Optional
import warnings
warnings.filterwarnings("ignore")


# ── Constants ─────────────────────────────────────────────────────────────────
DEFAULT_K_REGIMES = 2
DEFAULT_AR_ORDER  = 2
DEFAULT_VAR_LEVELS = [0.95, 0.99]


def _regime_label(idx: int, bull: int, bear: int) -> str:
    """Map regime index to human-readable label."""
    if idx == bull:
        return "BULL"
    if idx == bear:
        return "BEAR"
    return "NEUTRAL"


# ══════════════════════════════════════════════════════════════════════════════
# MSAR MODEL CLASS
# ══════════════════════════════════════════════════════════════════════════════

class MSARModel:
    """
    Markov-Switching AR(p) — Regime detection, position sizing, and forecasting.

    Parameters
    ----------
    k_regimes : int
        Number of hidden regimes (default 2: Bull / Bear).
    ar_order : int
        Autoregressive order (default 2).
    var_confidence : list[float]
        VaR confidence levels (default [0.95, 0.99]).
    """

    def __init__(
        self,
        k_regimes: int = DEFAULT_K_REGIMES,
        ar_order: int = DEFAULT_AR_ORDER,
        var_confidence: list[float] = None,
    ):
        self.k_regimes = k_regimes
        self.ar_order = ar_order
        self.var_confidence = var_confidence or DEFAULT_VAR_LEVELS

        # Populated after fit()
        self._result = None
        self._returns = None
        self._regime_means: list[float] = []
        self._regime_vars: list[float] = []
        self._regime_vols: list[float] = []
        self._bull_regime: int = 0
        self._bear_regime: int = 0
        self._transition_matrix: Optional[np.ndarray] = None

    # ── CORE: fit ─────────────────────────────────────────────────────────────

    def fit(self, returns: pd.Series) -> dict:
        """
        Fit MS(K)-AR(p) model on a returns series.

        Parameters
        ----------
        returns : pd.Series
            Log-returns in percent (e.g., +1.2 means +1.2%), DatetimeIndex.

        Returns
        -------
        dict : JSON-ready result with keys:
            model_spec, regime_summary, position_sizing, var_cvar,
            current_regime, filtered_probabilities, transition_matrix
        """
        self._returns = returns.copy()

        # Fit model
        model = MarkovAutoregression(
            returns,
            k_regimes=self.k_regimes,
            order=self.ar_order,
            switching_ar=True,
            switching_variance=True,
        )
        self._result = model.fit(search_reps=20, search_iter=100, disp=False)

        # Extract regime parameters
        self._regime_means = [
            float(self._result.params[f"const[{i}]"]) for i in range(self.k_regimes)
        ]
        self._regime_vars = [
            float(self._result.params[f"sigma2[{i}]"]) for i in range(self.k_regimes)
        ]
        self._regime_vols = [np.sqrt(v) for v in self._regime_vars]

        # Identify bull/bear by mean return
        self._bull_regime = int(np.argmax(self._regime_means))
        self._bear_regime = int(np.argmin(self._regime_means))

        # Transition matrix
        self._transition_matrix = self._result.regime_transition.reshape(
            self.k_regimes, self.k_regimes
        )

        # Filtered probabilities (full series)
        filtered_result = MarkovAutoregression(
            returns,
            k_regimes=self.k_regimes,
            order=self.ar_order,
            switching_ar=True,
            switching_variance=True,
        ).filter(self._result.params)

        filtered_probs = filtered_result.filtered_marginal_probabilities

        # Current regime
        latest_filtered = filtered_probs.iloc[-1]
        current_regime_idx = int(latest_filtered.values.argmax())
        current_prob = float(latest_filtered.values[current_regime_idx])
        latest_date = filtered_probs.index[-1]

        # Build posteriors dict
        current_posteriors = {}
        for i in range(self.k_regimes):
            label = self._label(i)
            current_posteriors[label] = round(float(latest_filtered.values[i]), 4)

        # Build regime probability timeseries (last 500 bars)
        prob_series = self._build_prob_series(filtered_probs, tail=500)

        return {
            "model_spec": {
                "type": f"MS({self.k_regimes})-AR({self.ar_order})",
                "k_regimes": self.k_regimes,
                "ar_order": self.ar_order,
                "n_observations": len(returns),
                "log_likelihood": round(float(self._result.llf), 4),
                "aic": round(float(self._result.aic), 4),
                "bic": round(float(self._result.bic), 4),
            },
            "regime_summary": self._get_regime_summary(),
            "position_sizing": self._get_position_sizing(),
            "var_cvar": self._get_var_cvar(),
            "current_regime": {
                "regime_id": current_regime_idx,
                "regime_name": self._label(current_regime_idx),
                "probability": round(current_prob, 4),
                "posteriors": current_posteriors,
                "as_of": str(latest_date.date()) if hasattr(latest_date, "date") else str(latest_date),
            },
            "transition_matrix": self._get_transition_matrix(),
            "filtered_probabilities": prob_series,
        }

    # ── REGIME SUMMARY ────────────────────────────────────────────────────────

    def _get_regime_summary(self) -> list[dict]:
        """Per-regime statistical summary."""
        summary = []
        for i in range(self.k_regimes):
            mu = self._regime_means[i]
            sigma = self._regime_vols[i]
            sigma2 = self._regime_vars[i]

            # AR coefficients
            phi1 = float(self._result.params[f"ar.L1[{i}]"])
            phi2 = float(self._result.params[f"ar.L2[{i}]"]) if self.ar_order >= 2 else 0.0

            # Steady-state mean: μ / (1 - φ₁ - φ₂)
            denom = 1 - phi1 - phi2
            ss_mean = mu / denom if abs(denom) > 1e-6 else mu

            ann_return = ss_mean * 252
            ann_vol = sigma * np.sqrt(252)
            sharpe = ann_return / ann_vol if ann_vol > 0 else 0.0

            summary.append({
                "regime_id": i,
                "name": self._label(i),
                "daily_mean_pct": round(ss_mean, 4),
                "daily_vol_pct": round(sigma, 4),
                "ann_return_pct": round(ann_return, 2),
                "ann_vol_pct": round(ann_vol, 2),
                "sharpe": round(sharpe, 3),
                "ar_coefficients": {
                    "const": round(mu, 6),
                    "ar_L1": round(phi1, 6),
                    "ar_L2": round(phi2, 6),
                },
            })
        return summary

    # ── POSITION SIZING (Kelly) ───────────────────────────────────────────────

    def _get_position_sizing(self) -> list[dict]:
        """Per-regime Kelly fraction and position sizing metrics."""
        sizing = []
        for i in range(self.k_regimes):
            mu = self._regime_means[i]
            sigma2 = self._regime_vars[i]

            phi1 = float(self._result.params[f"ar.L1[{i}]"])
            phi2 = float(self._result.params[f"ar.L2[{i}]"]) if self.ar_order >= 2 else 0.0
            denom = 1 - phi1 - phi2
            ss_mean = mu / denom if abs(denom) > 1e-6 else mu

            # Kelly: f* = μ / σ² (continuous)
            kelly = ss_mean / sigma2 if sigma2 > 0 else 0.0
            half_kelly = kelly / 2.0

            sizing.append({
                "regime_id": i,
                "name": self._label(i),
                "full_kelly_pct": round(kelly * 100, 2),
                "half_kelly_pct": round(half_kelly * 100, 2),
            })
        return sizing

    # ── VaR / CVaR ────────────────────────────────────────────────────────────

    def _get_var_cvar(self) -> list[dict]:
        """Regime-conditional parametric VaR and CVaR (Expected Shortfall)."""
        var_results = []
        for i in range(self.k_regimes):
            mu = self._regime_means[i]
            sigma = self._regime_vols[i]
            entry = {
                "regime_id": i,
                "name": self._label(i),
                "risk_metrics": [],
            }
            for cl in self.var_confidence:
                z = norm.ppf(1 - cl)
                var_pct = -(mu + z * sigma)
                cvar_pct = -(mu - sigma * norm.pdf(norm.ppf(1 - cl)) / (1 - cl))
                entry["risk_metrics"].append({
                    "confidence": cl,
                    "var_pct": round(var_pct, 4),
                    "cvar_pct": round(cvar_pct, 4),
                })
            var_results.append(entry)
        return var_results

    # ── TRANSITION MATRIX ─────────────────────────────────────────────────────

    def _get_transition_matrix(self) -> list[dict]:
        """Transition probabilities in labeled format."""
        tm = self._transition_matrix
        matrix = []
        for i in range(self.k_regimes):
            row = {
                "from": self._label(i),
                "to": {
                    self._label(j): round(float(tm[i, j]), 6)
                    for j in range(self.k_regimes)
                },
            }
            matrix.append(row)
        return matrix

    # ── FILTERED PROBABILITY SERIES ───────────────────────────────────────────

    def _build_prob_series(self, filtered_probs: pd.DataFrame, tail: int = 500) -> list[dict]:
        """Build JSON-serializable filtered probability timeseries."""
        df = filtered_probs.tail(tail)
        series = []
        for idx, row in df.iterrows():
            ts_str = idx.isoformat() if hasattr(idx, "isoformat") else str(idx)
            dominant = int(row.values.argmax())
            proba_dict = {
                self._label(j): round(float(row.values[j]), 4)
                for j in range(self.k_regimes)
            }
            series.append({
                "timestamp": ts_str,
                "regime_id": dominant,
                "regime_name": self._label(dominant),
                "probabilities": proba_dict,
            })
        return series

    # ── FORECAST ──────────────────────────────────────────────────────────────

    def forecast(self, n_days: int = 10, last_price: Optional[float] = None) -> dict:
        """
        Multi-step regime probability + price forecast.

        Parameters
        ----------
        n_days : int
            Number of business days to forecast ahead.
        last_price : float, optional
            Last close price for price cone. If None, returns regime probs only.

        Returns
        -------
        dict with:
            regime_forecast : list of per-step regime probability + expected return
            price_forecast  : (if last_price given) price cone with 95% CI
        """
        if self._result is None:
            raise RuntimeError("Model not fitted. Call fit() first.")

        # Get current state distribution from filtered probs
        filtered_result = MarkovAutoregression(
            self._returns,
            k_regimes=self.k_regimes,
            order=self.ar_order,
            switching_ar=True,
            switching_variance=True,
        ).filter(self._result.params)

        latest_probs = filtered_result.filtered_marginal_probabilities.iloc[-1]
        pi = latest_probs.values.reshape(-1, 1)
        T = self._transition_matrix

        regime_forecast = []
        forecast_returns = []
        forecast_vars = []

        for step in range(1, n_days + 1):
            pi = T @ pi
            pi_vec = pi.flatten()

            exp_ret = sum(
                pi_vec[i] * self._regime_means[i] for i in range(self.k_regimes)
            )
            exp_var = (
                sum(
                    pi_vec[i] * (self._regime_vars[i] + self._regime_means[i] ** 2)
                    for i in range(self.k_regimes)
                )
                - exp_ret ** 2
            )

            forecast_returns.append(exp_ret)
            forecast_vars.append(exp_var)

            proba_dict = {
                self._label(i): round(float(pi_vec[i]), 4)
                for i in range(self.k_regimes)
            }
            regime_forecast.append({
                "step": step,
                "expected_return_pct": round(float(exp_ret), 4),
                "expected_vol_pct": round(float(np.sqrt(max(exp_var, 0))), 4),
                "regime_probabilities": proba_dict,
            })

        result = {
            "n_days": n_days,
            "regime_forecast": regime_forecast,
        }

        # Price cone (if last_price provided)
        if last_price is not None:
            ret_arr = np.array(forecast_returns)
            std_arr = np.sqrt(np.maximum(np.array(forecast_vars), 0))

            cum_log = np.cumsum(ret_arr / 100)
            prices_mid = last_price * np.exp(cum_log)
            prices_upper = last_price * np.exp(
                np.cumsum((ret_arr + 1.96 * std_arr) / 100)
            )
            prices_lower = last_price * np.exp(
                np.cumsum((ret_arr - 1.96 * std_arr) / 100)
            )

            price_series = []
            for d in range(n_days):
                price_series.append({
                    "step": d + 1,
                    "price_mid": round(float(prices_mid[d]), 2),
                    "price_upper_95": round(float(prices_upper[d]), 2),
                    "price_lower_95": round(float(prices_lower[d]), 2),
                })

            result["price_forecast"] = {
                "last_price": last_price,
                "series": price_series,
            }

        return result

    # ── HELPERS ───────────────────────────────────────────────────────────────

    def _label(self, idx: int) -> str:
        return _regime_label(idx, self._bull_regime, self._bear_regime)


# ══════════════════════════════════════════════════════════════════════════════
# CONVENIENCE WRAPPER
# ══════════════════════════════════════════════════════════════════════════════

def run_msar_model(
    returns: pd.Series,
    k_regimes: int = DEFAULT_K_REGIMES,
    ar_order: int = DEFAULT_AR_ORDER,
    var_confidence: list[float] = None,
    forecast_days: int = 10,
    last_price: Optional[float] = None,
) -> dict:
    """
    Convenience wrapper — fit MSAR and return JSON-ready dict.

    Parameters
    ----------
    returns : pd.Series
        Log-returns in percent, DatetimeIndex.
    k_regimes : int
        Number of regimes.
    ar_order : int
        AR order.
    var_confidence : list[float]
        VaR confidence levels.
    forecast_days : int
        Number of days to forecast ahead.
    last_price : float, optional
        Last close price for price cone forecast.

    Returns
    -------
    dict with full MSAR analysis + forecast.
    """
    model = MSARModel(
        k_regimes=k_regimes,
        ar_order=ar_order,
        var_confidence=var_confidence,
    )
    fit_result = model.fit(returns)
    forecast_result = model.forecast(n_days=forecast_days, last_price=last_price)

    return {
        **fit_result,
        "forecast": forecast_result,
    }


# ══════════════════════════════════════════════════════════════════════════════
# SELF-TEST
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json

    # Generate synthetic returns
    np.random.seed(42)
    n = 500
    dates = pd.date_range("2022-01-01", periods=n, freq="B")
    returns_test = pd.Series(np.random.normal(0.05, 1.2, n), index=dates)

    print("=" * 60)
    print("  MSAR SELF-TEST")
    print("=" * 60)

    result = run_msar_model(
        returns=returns_test,
        k_regimes=2,
        ar_order=2,
        forecast_days=10,
        last_price=100.0,
    )

    print(f"  Model: {result['model_spec']['type']}")
    print(f"  Log-L: {result['model_spec']['log_likelihood']}")
    print(f"  AIC:   {result['model_spec']['aic']}")
    print(f"  Current Regime: {result['current_regime']['regime_name']} "
          f"({result['current_regime']['probability']*100:.1f}%)")
    print(f"\n  Regime Summary:")
    for s in result["regime_summary"]:
        print(f"    [{s['regime_id']}] {s['name']:8} | "
              f"Ann.Ret={s['ann_return_pct']:+.2f}% | "
              f"Ann.Vol={s['ann_vol_pct']:.2f}% | "
              f"Sharpe={s['sharpe']:.3f}")
    print(f"\n  Forecast ({result['forecast']['n_days']} days):")
    for f in result["forecast"]["regime_forecast"][:3]:
        print(f"    t+{f['step']}: E[r]={f['expected_return_pct']:.4f}% | {f['regime_probabilities']}")
    print("=" * 60)
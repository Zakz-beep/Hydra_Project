"""
hmm_har_volatility.py
=====================
Combined Engine: HAR-RV + Hidden Markov Model
=============================================

Pipeline:
  1. HAR-RV  → Heterogeneous Autoregressive model untuk forecast Realized Volatility
               (daily / weekly / monthly memory layers via OLS regression)
  2. HMM     → GaussianHMM Market Regime Detection menggunakan 4-dimensional feature:
               [log_return | rolling_vol | dcc_avg_corr | har_rv_forecast]

Reusable module — no subprocess installs, no side-effect charts by default.
Call run_har_rv_model()  → untuk standalone HAR-RV analysis
Call run_hmm_model()     → untuk full HMM regime detection (needs DCC corr input)
Call run_combined()      → pipeline lengkap (HAR-RV → HMM)
"""

import numpy as np
import pandas as pd
import statsmodels.api as sm
from hmmlearn.hmm import GaussianHMM
from typing import Optional
import warnings
warnings.filterwarnings("ignore")

# ── Constants ─────────────────────────────────────────────────────────────────
N_STATES   = 3
SEED       = 42
STATE_NAMES = {
    0: "Bearish / High-Vol",
    1: "Sideways / Neutral",
    2: "Bullish / Low-Vol",
}

# HAR window sizes
HAR_DAILY_LAG   = 1
HAR_WEEKLY_LAG  = 5
HAR_MONTHLY_LAG = 22


# ══════════════════════════════════════════════════════════════════════════════
# PART 1 — HAR-RV MODEL
# ══════════════════════════════════════════════════════════════════════════════

class HARRVModel:
    """
    Heterogeneous Autoregressive model on Realized Volatility.

    Usage
    -----
    model = HARRVModel()
    result = model.fit_predict(rv_series)
    # result is a dict with fitted values, next-bar forecast, OLS params, etc.
    """

    def __init__(
        self,
        daily_lag:   int = HAR_DAILY_LAG,
        weekly_lag:  int = HAR_WEEKLY_LAG,
        monthly_lag: int = HAR_MONTHLY_LAG,
    ):
        self.daily_lag   = daily_lag
        self.weekly_lag  = weekly_lag
        self.monthly_lag = monthly_lag
        self._params: Optional[pd.Series] = None

    # ── feature builder ──────────────────────────────────────────────────────
    @staticmethod
    def _build_har_features(rv: pd.Series, daily_lag: int, weekly_lag: int, monthly_lag: int) -> pd.DataFrame:
        df = pd.DataFrame({"RV": rv})
        df["RV_Daily"]   = df["RV"].shift(daily_lag)
        df["RV_Weekly"]  = df["RV"].shift(daily_lag).rolling(window=weekly_lag).mean()
        df["RV_Monthly"] = df["RV"].shift(daily_lag).rolling(window=monthly_lag).mean()
        return df.dropna()

    def fit_predict(self, rv_series: pd.Series) -> dict:
        """
        Fit OLS HAR-RV and return a result dict.

        Parameters
        ----------
        rv_series : pd.Series
            Realized volatility series (positive floats), DatetimeIndex preferred.

        Returns
        -------
        dict with keys:
            fitted_rv, rv_daily, rv_weekly, rv_monthly,
            har_predict, next_forecast, params, rsquared, dates
        """
        rv = rv_series.copy()
        if rv.index.dtype != "datetime64[ns]":
            try:
                rv.index = pd.to_datetime(rv.index)
            except Exception:
                pass

        df = self._build_har_features(rv, self.daily_lag, self.weekly_lag, self.monthly_lag)

        X = sm.add_constant(df[["RV_Daily", "RV_Weekly", "RV_Monthly"]])
        y = df["RV"]

        ols = sm.OLS(y, X).fit()
        df["HAR_Predict"] = ols.predict(X)
        self._params = ols.params

        # Next-bar forecast
        last_rv    = float(rv.iloc[-1])
        weekly_avg = float(rv.iloc[-self.weekly_lag:].mean())
        monthly_avg = float(rv.iloc[-self.monthly_lag:].mean())
        next_forecast = (
            ols.params["const"]
            + ols.params["RV_Daily"]   * last_rv
            + ols.params["RV_Weekly"]  * weekly_avg
            + ols.params["RV_Monthly"] * monthly_avg
        )
        next_forecast = max(float(next_forecast), 0.0)  # RV ≥ 0

        return {
            "dates":         list(df.index.astype(str)),
            "fitted_rv":     df["RV"].tolist(),
            "rv_daily":      df["RV_Daily"].tolist(),
            "rv_weekly":     df["RV_Weekly"].tolist(),
            "rv_monthly":    df["RV_Monthly"].tolist(),
            "har_predict":   df["HAR_Predict"].tolist(),
            "next_forecast": round(next_forecast, 6),
            "params": {
                "const":      round(float(ols.params["const"]),      6),
                "RV_Daily":   round(float(ols.params["RV_Daily"]),   6),
                "RV_Weekly":  round(float(ols.params["RV_Weekly"]),  6),
                "RV_Monthly": round(float(ols.params["RV_Monthly"]), 6),
            },
            "rsquared":      round(float(ols.rsquared), 6),
            # Aligned HAR-predict Series (for downstream HMM injection)
            "_har_series": df["HAR_Predict"].rename("HAR_RV"),
        }

    def get_forecast_series(self, rv_series: pd.Series) -> pd.Series:
        """
        Return aligned HAR-RV fitted values as a Series (convenient for HMM).
        Calls fit_predict() internally.
        """
        result = self.fit_predict(rv_series)
        return result["_har_series"]


def run_har_rv_model(rv_series: pd.Series) -> dict:
    """Convenience wrapper — fit HAR-RV and return JSON-ready dict."""
    m = HARRVModel()
    result = m.fit_predict(rv_series)
    # Strip internal helper key before returning
    result.pop("_har_series", None)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# PART 2 — HMM REGIME MODEL
# ══════════════════════════════════════════════════════════════════════════════

def _build_hmm_features(
    returns_series:   pd.Series,
    avg_corr_series:  pd.Series,
    har_rv_series:    Optional[pd.Series] = None,
) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """
    Build feature matrix for GaussianHMM.

    Columns (always):
      0 = log-return
      1 = 5-bar rolling vol
      2 = DCC avg_corr

    Optional column (when har_rv_series provided):
      3 = HAR-RV fitted forecast (aligned)

    Returns aligned X array and DatetimeIndex.
    """
    # Sanitise log-returns: accept fraction (e.g. 0.012) or raw pct
    ret = returns_series.copy()
    # Normalise: if values look like raw pct (|max| > 1), convert to fraction
    if ret.abs().max() > 1:
        ret = ret / 100.0

    log_ret     = np.log((ret + 1).clip(lower=0.001))
    rolling_vol = log_ret.rolling(5).std()

    # Align mandatory columns
    idx = (
        log_ret.dropna().index
        .intersection(rolling_vol.dropna().index)
        .intersection(avg_corr_series.dropna().index)
    )

    columns = [
        log_ret.loc[idx].values,
        rolling_vol.loc[idx].values,
        avg_corr_series.loc[idx].values,
    ]

    # Optionally inject HAR-RV forecast
    if har_rv_series is not None:
        aligned_har = har_rv_series.reindex(idx).ffill().bfill()
        columns.append(aligned_har.values)

    X = np.column_stack(columns)
    return X, idx


def _sort_states_by_return(hidden_states: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Sort HMM states by mean return ascending → [bearish=0, neutral=1, bullish=2]."""
    state_means = {s: X[hidden_states == s, 0].mean() for s in range(N_STATES)}
    rank        = sorted(state_means, key=state_means.get)
    label_map   = {rank[i]: i for i in range(N_STATES)}
    states_labeled = np.array([label_map[s] for s in hidden_states])
    return states_labeled, rank


def run_hmm_model(
    returns_series:  pd.Series,
    avg_corr_series: pd.Series,
    tickers:         list[str],
    har_rv_series:   Optional[pd.Series] = None,
) -> dict:
    """
    Fit GaussianHMM and return structured JSON-ready dict.

    Parameters
    ----------
    returns_series  : Daily returns (fraction or %, auto-detected), DatetimeIndex.
    avg_corr_series : DCC dynamic avg_corr, same date range.
    tickers         : List of ticker strings (for labelling in output).
    har_rv_series   : (Optional) HAR-RV fitted values Series — adds a 4th feature
                      dimension to improve regime separation. Use get_forecast_series()
                      from HARRVModel to generate this.

    Returns
    -------
    dict: current_regime, current_regime_name, stay_probability,
          transition_probs, state_series, state_summary,
          transition_matrix, log_likelihood, n_features
    """
    if len(returns_series) < 20:
        raise ValueError("Not enough data for HMM (need ≥ 20 bars).")

    X, dates = _build_hmm_features(returns_series, avg_corr_series, har_rv_series)
    n_features = X.shape[1]

    if len(X) < 15:
        raise ValueError("Feature alignment produced too few samples for HMM.")

    # Normalize features to prevent ill-conditioned covariance matrices
    X_mean = X.mean(axis=0)
    X_std = X.std(axis=0) + 1e-8
    X_scaled = (X - X_mean) / X_std

    # ── Fit GaussianHMM ───────────────────────────────────────────────────────
    model = GaussianHMM(
        n_components=N_STATES,
        covariance_type="diag",
        n_iter=300,
        random_state=SEED,
        tol=1e-4,
    )
    model.fit(X_scaled)
    hidden_states  = model.predict(X_scaled)
    log_likelihood = float(model.score(X_scaled))
    state_proba    = model.predict_proba(X_scaled)   # (T, N_STATES)

    states_labeled, rank = _sort_states_by_return(hidden_states, X)
    tm = model.transmat_

    # ── Per-state summary ─────────────────────────────────────────────────────
    state_summary = []
    for i in range(N_STATES):
        mask  = states_labeled == i
        r     = X[mask, 0]
        v     = X[mask, 1]
        c     = X[mask, 2]
        count = int(mask.sum())
        pct   = float(count / len(states_labeled) * 100)
        sharpe       = float(r.mean() / r.std()) if r.std() > 0 else 0.0
        expected_dd  = float(-3 * v.mean() * (20 ** 0.5)) if len(v) > 0 else 0.0

        row = {
            "state_id":       i,
            "name":           STATE_NAMES[i],
            "count":          count,
            "pct_history":    round(pct, 2),
            "mean_return":    round(float(r.mean() * 100), 4),
            "mean_vol":       round(float(v.mean() * 100), 4),
            "mean_corr":      round(float(c.mean()), 4),
            "max_return":     round(float(r.max() * 100), 4),
            "min_return":     round(float(r.min() * 100), 4),
            "sharpe_proxy":   round(sharpe, 4),
            "expected_dd_pct": round(expected_dd * 100, 2),
        }
        # Include HAR-RV mean if 4th feature exists
        if n_features >= 4:
            har_col = X[mask, 3]
            row["mean_har_rv"] = round(float(har_col.mean()), 6)

        state_summary.append(row)

    # ── Transition matrix ─────────────────────────────────────────────────────
    transition_matrix = []
    sorted_transmat = np.zeros((N_STATES, N_STATES))
    for i in range(N_STATES):
        row = {STATE_NAMES[j]: round(float(tm[rank[i], rank[j]]), 6) for j in range(N_STATES)}
        transition_matrix.append({"from": STATE_NAMES[i], "to": row})
        for j in range(N_STATES):
            sorted_transmat[i, j] = tm[rank[i], rank[j]]

    # ── Current state ─────────────────────────────────────────────────────────
    current_labeled  = int(states_labeled[-1])
    stay_probability = float(tm[rank[current_labeled], rank[current_labeled]])

    transition_probs = [
        {
            "to_state":    STATE_NAMES[j],
            "probability": round(float(tm[rank[current_labeled], rank[j]]), 4),
        }
        for j in range(N_STATES)
    ]

    current_posteriors = {
        STATE_NAMES[j]: round(float(state_proba[-1, rank[j]]), 4)
        for j in range(N_STATES)
    }

    # ── State timeseries ──────────────────────────────────────────────────────
    state_series = []
    for k in range(len(dates)):
        ts     = dates[k]
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        labeled = int(states_labeled[k])
        proba_dict = {
            STATE_NAMES[j]: round(float(state_proba[k, rank[j]]), 4)
            for j in range(N_STATES)
        }
        entry = {
            "timestamp":  ts_str,
            "state_id":   labeled,
            "state_name": STATE_NAMES[labeled],
            "return_pct": round(float(X[k, 0] * 100), 4),
            "vol_pct":    round(float(X[k, 1] * 100), 4),
            "avg_corr":   round(float(X[k, 2]), 4),
            "proba":      proba_dict,
        }
        if n_features >= 4:
            entry["har_rv"] = round(float(X[k, 3]), 6)
        state_series.append(entry)

    return {
        "tickers":             tickers,
        "n_features":          n_features,
        "log_likelihood":      round(log_likelihood, 4),
        "n_states":            N_STATES,
        "current_regime":      current_labeled,
        "current_regime_name": STATE_NAMES[current_labeled],
        "current_posteriors":  current_posteriors,
        "stay_probability":    round(stay_probability, 4),
        "transition_probs":    transition_probs,
        "state_summary":       state_summary,
        "transition_matrix":   transition_matrix,
        "state_series":        state_series,
        "_sorted_transmat":    sorted_transmat, # for monte carlo
    }


# ══════════════════════════════════════════════════════════════════════════════
# PART 3 — COMBINED PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def run_combined(
    rv_series:       pd.Series,
    returns_series:  pd.Series,
    avg_corr_series: pd.Series,
    tickers:         list[str],
    last_price:      float = 100.0,
    use_har_in_hmm:  bool = True,
) -> dict:
    """
    Full pipeline: HAR-RV → (optionally) inject into HMM.

    Parameters
    ----------
    rv_series        : Realized volatility series (positive floats), DatetimeIndex.
    returns_series   : Daily log-returns or pct returns, DatetimeIndex.
    avg_corr_series  : DCC dynamic avg_corr, DatetimeIndex.
    tickers          : Ticker labels.
    use_har_in_hmm   : If True, HAR-RV fitted values become the 4th HMM feature.

    Returns
    -------
    dict with:
        "har_rv"  → result from run_har_rv_model()
        "hmm"     → result from run_hmm_model()
        "meta"    → pipeline metadata
    """
    # Step 1: HAR-RV
    har_model  = HARRVModel()
    har_result = har_model.fit_predict(rv_series)
    har_series = har_result.pop("_har_series") if use_har_in_hmm else None

    # Step 2: HMM (with optional HAR-RV feature injection)
    hmm_result = run_hmm_model(
        returns_series=returns_series,
        avg_corr_series=avg_corr_series,
        tickers=tickers,
        har_rv_series=har_series,
    )

    # Step 3: Regime-Switching Monte Carlo Simulation
    mc_result = run_monte_carlo(
        last_price=last_price,
        current_regime=hmm_result["current_regime"],
        sorted_transmat=hmm_result.pop("_sorted_transmat"),
        state_summary=hmm_result["state_summary"],
        n_days=10,
        n_paths=1000
    )

    return {
        "meta": {
            "tickers":       tickers,
            "use_har_in_hmm": use_har_in_hmm,
            "har_next_forecast": har_result["next_forecast"],
            "hmm_current_regime": hmm_result["current_regime_name"],
            "hmm_n_features": hmm_result["n_features"],
        },
        "har_rv": har_result,
        "hmm":    hmm_result,
        "monte_carlo": mc_result,
    }


# ══════════════════════════════════════════════════════════════════════════════
# PART 4 — MONTE CARLO SIMULATION
# ══════════════════════════════════════════════════════════════════════════════

def run_monte_carlo(
    last_price: float,
    current_regime: int,
    sorted_transmat: np.ndarray,
    state_summary: list[dict],
    n_days: int = 10,
    n_paths: int = 1000
) -> dict:
    """
    Simulates future price paths.
    """
    means = np.array([s["mean_return"] / 100.0 for s in state_summary])
    stds = np.array([s["mean_vol"] / 100.0 for s in state_summary])
    
    prices = np.zeros((n_paths, n_days + 1))
    prices[:, 0] = last_price
    current_states = np.full(n_paths, current_regime)
    
    for d in range(1, n_days + 1):
        next_states = np.zeros(n_paths, dtype=int)
        for i in range(n_paths):
            next_states[i] = np.random.choice(N_STATES, p=sorted_transmat[current_states[i]])
        
        current_states = next_states
        rets = np.random.normal(loc=means[current_states], scale=stds[current_states])
        prices[:, d] = prices[:, d-1] * np.exp(rets)
    
    percentiles = np.percentile(prices, [5, 50, 95], axis=0)
    
    mc_series = []
    for d in range(n_days + 1):
        mc_series.append({
            "day": d,
            "p5": round(float(percentiles[0, d]), 2),
            "p50": round(float(percentiles[1, d]), 2),
            "p95": round(float(percentiles[2, d]), 2),
        })
        
    return {
        "n_days": n_days,
        "n_paths": n_paths,
        "last_price": last_price,
        "series": mc_series
    }


# ══════════════════════════════════════════════════════════════════════════════
# QUICK SELF-TEST (run directly: python hmm_har_volatility.py)
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import json

    np.random.seed(SEED)
    n = 300
    dates = pd.date_range("2024-01-01", periods=n, freq="B")

    # Simulate RV with volatility clustering
    rv = np.zeros(n)
    rv[0] = 0.01
    for t in range(1, n):
        shock = np.random.normal(0, 0.005)
        rv[t] = max(0.001, 0.002 + 0.8 * rv[t-1] + shock)

    rv_series      = pd.Series(rv, index=dates)
    returns_series = pd.Series(np.random.normal(0, 0.012, n), index=dates)
    avg_corr       = pd.Series(0.3 + 0.1 * np.sin(np.linspace(0, 4*np.pi, n)), index=dates)

    print("=" * 60)
    print("  STANDALONE HAR-RV")
    print("=" * 60)
    har_out = run_har_rv_model(rv_series)
    print(f"  Next forecast : {har_out['next_forecast']:.6f}")
    print(f"  R²            : {har_out['rsquared']:.4f}")
    print(f"  Params        : {har_out['params']}")

    print("\n" + "=" * 60)
    print("  COMBINED PIPELINE (HAR-RV -> HMM, 4 features)")
    print("=" * 60)
    combined = run_combined(
        rv_series=rv_series,
        returns_series=returns_series,
        avg_corr_series=avg_corr,
        tickers=["BBCA", "BBRI"],
        use_har_in_hmm=True,
    )
    meta = combined["meta"]
    hmm  = combined["hmm"]
    print(f"  HAR next RV   : {meta['har_next_forecast']:.6f}")
    print(f"  HMM regime    : {meta['hmm_current_regime']}")
    print(f"  HMM features  : {meta['hmm_n_features']}D")
    print(f"  Log-likelihood: {hmm['log_likelihood']}")
    print("\n  State Summary:")
    for s in hmm["state_summary"]:
        print(f"    [{s['state_id']}] {s['name']:22} | {s['pct_history']:5.1f}% | "
              f"ret={s['mean_return']:+.3f}% | vol={s['mean_vol']:.3f}%")
    print("=" * 60)

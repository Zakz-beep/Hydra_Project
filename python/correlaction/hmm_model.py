"""
hmm_model.py
============
Hidden Markov Model — Market Regime Detection
Reusable module for API consumption (no charts, no subprocess installs).

Features used:
  - Log-return (per-bar)
  - 5-bar rolling volatility (realized vol proxy)
  - DCC avg_corr time-series (injected from copula_model output)
  → 3-dimensional feature space: return | vol | systemic-corr
"""

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
import warnings
warnings.filterwarnings("ignore")

# ── Constants ────────────────────────────────────────────────────────────────
N_STATES = 3
SEED = 42
STATE_NAMES = {
    0: "Bearish / High-Vol",
    1: "Sideways / Neutral",
    2: "Bullish / Low-Vol",
}


def _build_features(returns_series: pd.Series, avg_corr_series: pd.Series) -> tuple[np.ndarray, pd.DatetimeIndex]:
    """
    Build 3-feature matrix:
      col0 = log-return
      col1 = 5-bar rolling vol
      col2 = DCC avg_corr (systemic correlation)
    Returns aligned X array and dates index.
    """
    log_ret = np.log(
        (returns_series + 1).clip(lower=0.001)
    ) if returns_series.abs().max() < 1 else returns_series  # handle both fraction and raw

    rolling_vol = log_ret.rolling(5).std()
    idx = log_ret.index.intersection(rolling_vol.dropna().index)
    idx = idx.intersection(avg_corr_series.index)

    X = np.column_stack([
        log_ret.loc[idx].values,
        rolling_vol.loc[idx].values,
        avg_corr_series.loc[idx].values,
    ])
    return X, idx


def _sort_and_label(model: GaussianHMM, hidden_states: np.ndarray, X: np.ndarray) -> tuple[np.ndarray, list[int]]:
    """Sort states by mean return ascending (bearish=0, neutral=1, bullish=2)."""
    state_means = {s: X[hidden_states == s, 0].mean() for s in range(N_STATES)}
    rank = sorted(state_means, key=state_means.get)   # [worst, mid, best] raw state ids
    label_map = {rank[i]: i for i in range(N_STATES)}
    states_labeled = np.array([label_map[s] for s in hidden_states])
    return states_labeled, rank


def run_hmm_model(
    returns_series: pd.Series,
    avg_corr_series: pd.Series,
    tickers: list[str],
) -> dict:
    """
    Fit GaussianHMM and return structured JSON-ready dict.

    Parameters
    ----------
    returns_series : pd.Series
        Daily log-returns (fraction, e.g. 0.012 for +1.2%), indexed by DatetimeIndex.
        Typically the mean return of the portfolio from the DCC backtest.
    avg_corr_series : pd.Series
        DCC dynamic avg_corr, same index as returns_series.
    tickers : list[str]
        The ticker pair being analysed (for labelling).

    Returns
    -------
    dict with keys:
        current_regime, current_regime_name, stay_probability,
        transition_probs, state_series, state_summary,
        transition_matrix, log_likelihood
    """
    if len(returns_series) < 20:
        raise ValueError("Not enough data for HMM (need ≥ 20 bars).")

    X, dates = _build_features(returns_series, avg_corr_series)

    if len(X) < 15:
        raise ValueError("Feature alignment produced too few samples for HMM.")

    # ── Fit ──────────────────────────────────────────────────────────────────
    model = GaussianHMM(
        n_components=N_STATES,
        covariance_type="full",
        n_iter=300,
        random_state=SEED,
        tol=1e-4,
    )
    model.fit(X)
    hidden_states = model.predict(X)
    log_likelihood = float(model.score(X))

    # Posterior probabilities (soft assignments)
    state_proba = model.predict_proba(X)   # shape (T, N_STATES)

    states_labeled, rank = _sort_and_label(model, hidden_states, X)
    tm = model.transmat_

    # ── Per-state summary ────────────────────────────────────────────────────
    state_summary = []
    for i in range(N_STATES):
        mask = states_labeled == i
        r = X[mask, 0]
        v = X[mask, 1]
        c = X[mask, 2]
        count = int(mask.sum())
        pct = float(count / len(states_labeled) * 100)
        sharpe = float(r.mean() / r.std()) if r.std() > 0 else 0.0
        # Expected Max Drawdown proxy: 3 * mean_vol * sqrt(20)
        expected_dd = float(-3 * v.mean() * (20 ** 0.5)) if len(v) > 0 else 0.0
        state_summary.append({
            "state_id": i,
            "name": STATE_NAMES[i],
            "count": count,
            "pct_history": round(pct, 2),
            "mean_return": round(float(r.mean() * 100), 4),
            "mean_vol": round(float(v.mean() * 100), 4),
            "mean_corr": round(float(c.mean()), 4),
            "max_return": round(float(r.max() * 100), 4),
            "min_return": round(float(r.min() * 100), 4),
            "sharpe_proxy": round(sharpe, 4),
            "expected_dd_pct": round(expected_dd * 100, 2),
        })

    # ── Transition matrix ────────────────────────────────────────────────────
    transition_matrix = []
    for i in range(N_STATES):
        row = {}
        for j in range(N_STATES):
            row[STATE_NAMES[j]] = round(float(tm[rank[i], rank[j]]), 6)
        transition_matrix.append({"from": STATE_NAMES[i], "to": row})

    # ── Current state ─────────────────────────────────────────────────────────
    current_labeled = int(states_labeled[-1])
    current_raw = int(hidden_states[-1])
    stay_probability = float(tm[rank[current_labeled], rank[current_labeled]])

    transition_probs = [
        {
            "to_state": STATE_NAMES[j],
            "probability": round(float(tm[rank[current_labeled], rank[j]]), 4),
        }
        for j in range(N_STATES)
    ]

    # Current posterior probs (re-mapped to labeled order)
    current_posteriors = {
        STATE_NAMES[j]: round(float(state_proba[-1, rank[j]]), 4)
        for j in range(N_STATES)
    }

    # ── State timeseries ──────────────────────────────────────────────────────
    state_series = []
    for k in range(len(dates)):
        ts = dates[k]
        ts_str = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
        labeled = int(states_labeled[k])
        # Soft proba re-mapped: proba of each labeled state
        proba_dict = {
            STATE_NAMES[j]: round(float(state_proba[k, rank[j]]), 4)
            for j in range(N_STATES)
        }
        state_series.append({
            "timestamp": ts_str,
            "state_id": labeled,
            "state_name": STATE_NAMES[labeled],
            "return_pct": round(float(X[k, 0] * 100), 4),
            "vol_pct": round(float(X[k, 1] * 100), 4),
            "avg_corr": round(float(X[k, 2]), 4),
            "proba": proba_dict,
        })

    return {
        "tickers": tickers,
        "log_likelihood": round(log_likelihood, 4),
        "n_states": N_STATES,
        "current_regime": current_labeled,
        "current_regime_name": STATE_NAMES[current_labeled],
        "current_posteriors": current_posteriors,
        "stay_probability": round(stay_probability, 4),
        "transition_probs": transition_probs,
        "state_summary": state_summary,
        "transition_matrix": transition_matrix,
        "state_series": state_series,   # last 500 bars sent to frontend
    }

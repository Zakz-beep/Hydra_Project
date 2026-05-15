import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Tuple, Dict, Optional, List

# LightGBM
import lightgbm as lgb

# Sklearn utilities
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.utils.class_weight import compute_class_weight
from sklearn.preprocessing import StandardScaler

# SHAP for interpretability
try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("[WARN] shap not installed — SHAP importance tracking disabled.")

# ── Global config ──────────────────────────────────────────
REGIME_NAMES = {
    0: "Trending Up",
    1: "Trending Down",
    2: "Mean-Reverting",
    3: "Choppy/Low Vol",
}

STRATEGY_MAP = {
    0: "MOMENTUM_LONG",
    1: "MOMENTUM_SHORT",
    2: "MEAN_REVERT",
    3: "FLAT",
}

REGIME_COLORS = {0: "🟢", 1: "🔴", 2: "🔵", 3: "⚪"}

DEFAULT_LGBM_PARAMS = {
    "objective":        "multiclass",
    "num_class":        4,
    "boosting_type":    "gbdt",
    "num_leaves":       63,
    "max_depth":        -1,
    "learning_rate":    0.05,
    "n_estimators":     400,
    "min_child_samples": 30,
    "subsample":        0.8,
    "colsample_bytree": 0.8,
    "reg_alpha":        0.1,
    "reg_lambda":       0.1,
    "random_state":     42,
    "n_jobs":           -1,
    "verbose":          -1,
}


# ============================================================
# SECTION 1 — REGIME LABELING
# ============================================================

def label_regime(
    returns: pd.Series,
    window: int = 20,
    hurst_threshold_trend: float = 0.55,
    hurst_threshold_mr: float = 0.45,
    direction_threshold: float = 1.0,
    vol_percentile: float = 60.0,
) -> pd.Series:
    """
    Algorithmically generate regime labels from a return series.

    Labels are assigned using:
      - A Hurst exponent proxy (R/S statistic on rolling window)
      - A direction score (rolling z-score of cumulative return)
      - A realised volatility percentile filter

    Parameters
    ----------
    returns : pd.Series
        Log returns of the equity index, indexed by datetime.
    window : int
        Rolling window length (bars) for Hurst proxy & direction score.
    hurst_threshold_trend : float
        Hurst proxy above this → persistent/trending behaviour.
    hurst_threshold_mr : float
        Hurst proxy below this → mean-reverting behaviour.
    direction_threshold : float
        |direction_score| must exceed this for trending labels.
    vol_percentile : float
        Percentile above which vol qualifies as "high" for MR regime.

    Returns
    -------
    pd.Series of int
        Regime integer {0, 1, 2, 3} aligned with input index,
        with NaN dropped for the initial burn-in period.

    Notes
    -----
    ALL rolling calculations use .shift(1) so no future data leaks
    into the label of any bar.
    """

    if returns.isnull().all():
        raise ValueError("returns series is entirely NaN — check your data.")

    ret = returns.dropna().copy()

    # ── 1. Hurst proxy via R/S rescaled range ─────────────────
    def hurst_rs(x: np.ndarray) -> float:
        """Compute R/S rescaled range as a Hurst proxy for array x."""
        n = len(x)
        if n < 8:
            return 0.5  # not enough data → neutral

        mean_x = np.mean(x)
        deviations = np.cumsum(x - mean_x)
        R = np.max(deviations) - np.min(deviations)
        S = np.std(x, ddof=1)
        if S == 0:
            return 0.5
        # H ≈ log(R/S) / log(n/2) — simplified Hurst proxy
        rs = R / S
        if rs <= 0:
            return 0.5
        return np.log(rs) / np.log(n / 2)

    hurst_proxy = (
        ret
        .rolling(window)
        .apply(hurst_rs, raw=True)
        .shift(1)   # ← no lookahead: use yesterday's Hurst for today's label
    )

    # ── 2. Direction score (z-score of rolling cumulative return) ─
    roll_cum   = ret.rolling(window).sum()
    roll_mean  = roll_cum.rolling(window).mean()
    roll_std   = roll_cum.rolling(window).std()
    direction_score = ((roll_cum - roll_mean) / roll_std.replace(0, 1e-9)).shift(1)

    # ── 3. Realised vol for MR confirmation ───────────────────
    realised_vol = ret.rolling(window).std().shift(1)
    vol_hi_threshold = realised_vol.rolling(252 * 78).quantile(vol_percentile / 100)
    # fallback for early bars: use expanding
    vol_hi_fallback  = realised_vol.expanding().quantile(vol_percentile / 100)
    vol_hi_threshold = vol_hi_threshold.fillna(vol_hi_fallback)

    # ── 4. Assign labels ──────────────────────────────────────
    regimes = pd.Series(3, index=ret.index, dtype=int)  # default = Choppy

    mask_trend    = hurst_proxy > hurst_threshold_trend
    mask_mr_hurst = hurst_proxy < hurst_threshold_mr
    mask_hi_vol   = realised_vol > vol_hi_threshold
    mask_up       = direction_score > direction_threshold
    mask_down     = direction_score < -direction_threshold

    # Regime 2 — Mean-Reverting (check before trending to avoid conflict)
    regimes[mask_mr_hurst & mask_hi_vol] = 2

    # Regime 0/1 — Trending Up/Down (overwrites MR if trending is stronger)
    regimes[mask_trend & mask_up]   = 0
    regimes[mask_trend & mask_down] = 1

    # Drop burn-in NaN rows (first `window` bars have no valid features)
    valid_mask = hurst_proxy.notna() & direction_score.notna()
    regimes = regimes[valid_mask]

    return regimes


# ============================================================
# SECTION 2 — FEATURE ENGINEERING
# ============================================================

def build_features(
    ohlcv: pd.DataFrame,
    options_data: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """
    Construct a feature matrix from OHLCV and options microstructure data.

    Features are grouped into 4 categories:
      A. Price / Volatility
      B. Microstructure (tick/volume proxy)
      C. Options & GEX
      D. Time / Calendar

    Parameters
    ----------
    ohlcv : pd.DataFrame
        Columns required: ['open', 'high', 'low', 'close', 'volume']
        Index: DatetimeIndex at 5-minute frequency.
    options_data : pd.DataFrame, optional
        Columns (all optional, filled with 0 if absent):
          'atm_iv', 'skew_25d', 'term_slope', 'gex', 'put_call_ratio',
          'vanna_exposure', 'charm_exposure',
          'vix_spot', 'vix9d', 'vix3m', 'vix6m'
        Must share the same DatetimeIndex as ohlcv.

    Returns
    -------
    pd.DataFrame
        Feature matrix (all numeric, no lookahead).
        Rows with NaN dropped (burn-in period).

    Notes
    -----
    Every rolling feature uses .shift(1) before being returned so that
    the feature value for bar t only contains information up to bar t-1.
    """

    required_cols = {"open", "high", "low", "close", "volume"}
    if not required_cols.issubset(ohlcv.columns):
        raise ValueError(f"ohlcv must contain columns: {required_cols}")

    df = ohlcv.copy()
    df.columns = df.columns.str.lower()

    # ── Log returns ───────────────────────────────────────────
    df["log_ret"] = np.log(df["close"] / df["close"].shift(1))

    # ─────────────────────────────────────────────────────────
    # CATEGORY A: PRICE / VOLATILITY FEATURES
    # ─────────────────────────────────────────────────────────

    for w in [5, 12, 26, 78]:  # 25min, 1h, 2.2h, 6.5h (full session)
        tag = f"_{w}"

        # Rolling return & vol
        df[f"ret{tag}"]     = df["log_ret"].rolling(w).sum().shift(1)
        df[f"rvol{tag}"]    = df["log_ret"].rolling(w).std().shift(1)

        # Momentum z-score
        mu   = df[f"ret{tag}"].rolling(w * 4).mean()
        sig  = df[f"ret{tag}"].rolling(w * 4).std()
        df[f"mom_z{tag}"]  = ((df[f"ret{tag}"] - mu) / sig.replace(0, 1e-9)).shift(1)

    # Garman-Klass volatility estimator
    # GK = sqrt((ln(H/L))^2/2 - (2ln2-1)*(ln(C/O))^2) — single bar
    hl   = np.log(df["high"] / df["low"]).clip(lower=0)
    co   = np.log(df["close"] / df["open"])
    gk   = np.sqrt(np.maximum(0.5 * hl**2 - (2 * np.log(2) - 1) * co**2, 0))
    df["gk_vol"]        = gk.rolling(12).mean().shift(1)

    # Range as fraction of open
    df["bar_range_pct"]  = ((df["high"] - df["low"]) / df["open"].replace(0, 1e-9)).shift(1)

    # Volatility ratio (short/long) — regime change signal
    df["vol_ratio_5_26"]  = (df["rvol_5"] / df["rvol_26"].replace(0, 1e-9)).shift(1)

    # Autocorrelation of returns (Hurst signal proxy, cheap)
    df["ret_autocorr"]    = (
        df["log_ret"].rolling(26).apply(lambda x: pd.Series(x).autocorr(lag=1), raw=False)
    ).shift(1)

    # ─────────────────────────────────────────────────────────
    # CATEGORY B: MICROSTRUCTURE FEATURES
    # ─────────────────────────────────────────────────────────

    # Volume z-score (detect absorption / exhaustion)
    v_mu  = df["volume"].rolling(78).mean()
    v_std = df["volume"].rolling(78).std()
    df["vol_z"]          = ((df["volume"] - v_mu) / v_std.replace(0, 1e-9)).shift(1)

    # Volume-weighted price trend (VWAP deviation as mean-revert signal)
    df["vwap_5"]         = (
        (df["close"] * df["volume"]).rolling(5).sum()
        / df["volume"].rolling(5).sum().replace(0, 1e-9)
    )
    df["vwap_dev"]       = ((df["close"] - df["vwap_5"]) / df["vwap_5"].replace(0, 1e-9)).shift(1)

    # Up-volume vs down-volume delta proxy (CVD simplified)
    up_vol   = df["volume"].where(df["close"] >= df["open"], 0.0)
    dn_vol   = df["volume"].where(df["close"] <  df["open"], 0.0)
    df["cvd_delta_5"]    = (up_vol - dn_vol).rolling(5).sum().shift(1)
    df["cvd_delta_26"]   = (up_vol - dn_vol).rolling(26).sum().shift(1)

    # Buying pressure ratio
    df["buy_pct"]        = (up_vol.rolling(12).sum() /
                            df["volume"].rolling(12).sum().replace(0, 1e-9)).shift(1)

    # Amihud illiquidity proxy: |ret| / volume
    df["amihud"]         = (df["log_ret"].abs() /
                            df["volume"].replace(0, 1e-9)).rolling(12).mean().shift(1)

    # ─────────────────────────────────────────────────────────
    # CATEGORY C: OPTIONS & GEX FEATURES
    # ─────────────────────────────────────────────────────────

    if options_data is not None:
        opt = options_data.reindex(df.index).ffill()
    else:
        # Synthetic stub if no real options data provided
        opt = pd.DataFrame(0.0, index=df.index,
                           columns=["atm_iv", "skew_25d", "term_slope", "gex", "put_call_ratio",
                                    "vanna_exposure", "charm_exposure",
                                    "vix_spot", "vix9d", "vix3m", "vix6m"])

    # ATM implied volatility & VRP proxy
    df["atm_iv"]         = opt["atm_iv"].shift(1)
    df["iv_rv_spread"]   = (opt["atm_iv"] - df["rvol_26"] * np.sqrt(252)).shift(1)  # VRP

    # 25-delta skew (put IV - call IV): negative = fear / downside hedging
    df["skew_25d"]       = opt["skew_25d"].shift(1)
    df["skew_z"]         = (
        (opt["skew_25d"] - opt["skew_25d"].rolling(78).mean())
        / opt["skew_25d"].rolling(78).std().replace(0, 1e-9)
    ).shift(1)

    # Term structure slope (front - back): contango vs backwardation
    df["term_slope"]     = opt["term_slope"].shift(1)

    # GEX — positive = dealers long gamma (dampening), negative = short gamma (amplifying)
    df["gex"]            = opt["gex"].shift(1)
    df["gex_z"]          = (
        (opt["gex"] - opt["gex"].rolling(78).mean())
        / opt["gex"].rolling(78).std().replace(0, 1e-9)
    ).shift(1)
    df["gex_sign"]       = np.sign(opt["gex"]).shift(1)  # +1 or -1 qualitative

    # Put/call ratio: > 1 = bearish sentiment, < 1 = bullish
    df["pcr"]            = opt["put_call_ratio"].shift(1)
    df["pcr_z"]          = (
        (opt["put_call_ratio"] - opt["put_call_ratio"].rolling(78).mean())
        / opt["put_call_ratio"].rolling(78).std().replace(0, 1e-9)
    ).shift(1)

    # ─────────────────────────────────────────────────────────
    # CATEGORY C2: VANNA & CHARM EXPOSURE FEATURES
    # ─────────────────────────────────────────────────────────
    # Vanna = dDelta/dVol — measures how dealer hedges shift as
    # IV moves. Positive = bullish hedging pressure when IV rises.
    # Charm = dDelta/dTime — measures delta decay each day (pin risk).

    vanna_raw  = opt.get("vanna_exposure",  pd.Series(0.0, index=df.index))
    charm_raw  = opt.get("charm_exposure",  pd.Series(0.0, index=df.index))

    # Level: raw exposure value (shifted 1 bar, no lookahead)
    df["vanna_exp"]       = vanna_raw.shift(1)
    df["charm_exp"]       = charm_raw.shift(1)

    # Z-scores: detect extreme hedging flows vs recent baseline
    df["vanna_z"]         = (
        (vanna_raw - vanna_raw.rolling(78).mean())
        / vanna_raw.rolling(78).std().replace(0, 1e-9)
    ).shift(1)
    df["charm_z"]         = (
        (charm_raw - charm_raw.rolling(78).mean())
        / charm_raw.rolling(78).std().replace(0, 1e-9)
    ).shift(1)

    # Sign: qualitative direction of hedging pressure
    df["vanna_sign"]      = np.sign(vanna_raw).shift(1)
    df["charm_sign"]      = np.sign(charm_raw).shift(1)

    # Composite: Vanna + Charm combined directional pressure
    # Positive = upward hedging pressure, negative = downward
    vanna_norm = vanna_raw / vanna_raw.abs().rolling(78).max().replace(0, 1e-9)
    charm_norm = charm_raw / charm_raw.abs().rolling(78).max().replace(0, 1e-9)
    df["greek_flow_composite"] = (vanna_norm + charm_norm).shift(1)

    # ─────────────────────────────────────────────────────────
    # CATEGORY C3: VIX TERM STRUCTURE FEATURES
    # ─────────────────────────────────────────────────────────
    # VIX term structure shape signals regime transitions:
    #   Contango  (front < back) → normal, low fear, dampened vol
    #   Backwardation (front > back) → fear, regime flip risk

    vix_spot = opt.get("vix_spot", pd.Series(20.0, index=df.index))
    vix_9d   = opt.get("vix9d",   pd.Series(19.0, index=df.index))
    vix_3m   = opt.get("vix3m",   pd.Series(21.0, index=df.index))
    vix_6m   = opt.get("vix6m",   pd.Series(22.0, index=df.index))

    # Ratio VIX9D / VIX: > 1 → front-end elevated, early fear
    df["vix9d_vix_ratio"]  = (vix_9d / vix_spot.replace(0, 1e-9)).shift(1)

    # Ratio VIX / VIX3M: > 1 → backwardation (fear regime)
    df["vix_vix3m_ratio"]  = (vix_spot / vix_3m.replace(0, 1e-9)).shift(1)

    # Ratio VIX3M / VIX6M: slope of the back end of the curve
    df["vix3m_vix6m_ratio"] = (vix_3m / vix_6m.replace(0, 1e-9)).shift(1)

    # Full term slope: VIX6M - VIX9D (wider = more contango = calmer)
    df["vix_curve_slope"]  = (vix_6m - vix_9d).shift(1)

    # Binary backwardation flag: 1 = stress regime, 0 = normal
    # Defined as VIX > VIX3M (front-end spike above back-end)
    df["vix_backwardation"] = (vix_spot > vix_3m).astype(float).shift(1)

    # VIX level z-score (absolute fear vs rolling baseline)
    df["vix_level_z"]      = (
        (vix_spot - vix_spot.rolling(252 * 78).mean())
        / vix_spot.rolling(252 * 78).std().replace(0, 1e-9)
    ).fillna(
        (vix_spot - vix_spot.expanding().mean())
        / vix_spot.expanding().std().replace(0, 1e-9)
    ).shift(1)

    # VIX momentum: rate-of-change over 12 bars (~1 hour)
    df["vix_roc_12"]       = vix_spot.pct_change(12).shift(1)

    # ─────────────────────────────────────────────────────────
    # CATEGORY D: TIME / CALENDAR FEATURES
    # ─────────────────────────────────────────────────────────

    idx = df.index

    # Time-of-day encoded as fraction [0, 1] over the trading session
    # Assumes NYSE hours 09:30–16:00 = 390 min = 78 five-minute bars
    session_open  = pd.Timestamp("09:30").time()
    session_close = pd.Timestamp("16:00").time()
    session_mins  = 390.0

    def time_of_day_frac(ts: pd.Timestamp) -> float:
        mins = (ts.hour * 60 + ts.minute) - (9 * 60 + 30)
        return np.clip(mins / session_mins, 0.0, 1.0)

    df["tod_frac"]       = [time_of_day_frac(t) for t in idx]

    # Opening and closing auction windows (first/last 30 min)
    df["is_open_window"]  = (df["tod_frac"] <= (30 / 390)).astype(int)
    df["is_close_window"] = (df["tod_frac"] >= (360 / 390)).astype(int)

    # Day-of-week (Monday=0 … Friday=4) — Monday/Friday often different micro
    df["dow"]            = idx.dayofweek

    # Month-end / month-start flag (rebalancing flows)
    df["is_month_start"] = idx.is_month_start.astype(int)
    df["is_month_end"]   = idx.is_month_end.astype(int)

    # Weekly bar count within the session (proxy for OpEx week awareness)
    df["week_of_month"]  = idx.to_series().dt.isocalendar().week.values % 4

    # ─────────────────────────────────────────────────────────
    # DROP NaN ROWS (burn-in) & RETURN
    # ─────────────────────────────────────────────────────────

    feature_cols = [c for c in df.columns if c not in
                    {"open", "high", "low", "close", "volume", "log_ret",
                     "vwap_5"}]  # exclude raw OHLCV from features

    features = df[feature_cols].replace([np.inf, -np.inf], np.nan).dropna()
    return features


# ============================================================
# SECTION 3 — MODEL TRAINING
# ============================================================

def train_model(
    X: pd.DataFrame,
    y: pd.Series,
    params: Optional[Dict] = None,
    n_splits: int = 5,
    gap: int = 48,
) -> Tuple[lgb.LGBMClassifier, Dict]:
    """
    Train a LightGBM multiclass classifier using walk-forward
    TimeSeriesSplit with class-imbalance handling.

    Parameters
    ----------
    X : pd.DataFrame
        Feature matrix (rows = bars, columns = features).
    y : pd.Series
        Regime labels aligned with X.
    params : dict, optional
        LightGBM hyperparameters. Defaults to DEFAULT_LGBM_PARAMS.
    n_splits : int
        Number of cross-validation folds.
    gap : int
        Number of bars to exclude between train and validation sets
        as a lookahead buffer (default 48 = 4 hours at 5-min bars).

    Returns
    -------
    model : lgb.LGBMClassifier
        The final model trained on the full dataset.
    cv_results : dict
        Per-fold accuracy and classification reports.
    """

    if X.shape[0] != len(y):
        raise ValueError(f"X has {X.shape[0]} rows but y has {len(y)} rows.")
    if X.shape[0] < (n_splits + 1) * gap:
        raise ValueError("Not enough data for the requested split/gap configuration.")

    params = params or DEFAULT_LGBM_PARAMS.copy()

    # ── Class weights (handles imbalanced regimes) ────────────
    classes = np.unique(y)
    weights = compute_class_weight("balanced", classes=classes, y=y)
    class_weight_dict = dict(zip(classes, weights))

    # ── Walk-forward cross-validation ─────────────────────────
    tscv = TimeSeriesSplit(n_splits=n_splits, gap=gap)
    cv_results = {"fold_scores": [], "fold_reports": []}

    print(f"\n{'='*60}")
    print(f"  Walk-Forward Cross-Validation ({n_splits} folds, gap={gap} bars)")
    print(f"{'='*60}")

    X_arr = X.values
    y_arr = y.values

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X_arr), 1):
        X_train, X_val = X_arr[train_idx], X_arr[val_idx]
        y_train, y_val = y_arr[train_idx], y_arr[val_idx]

        model_fold = lgb.LGBMClassifier(**params, class_weight=class_weight_dict)
        model_fold.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(50, verbose=False),
                       lgb.log_evaluation(period=-1)],
        )

        preds = model_fold.predict(X_val)
        acc   = np.mean(preds == y_val)
        report = classification_report(y_val, preds, target_names=list(REGIME_NAMES.values()),
                                       zero_division=0)

        cv_results["fold_scores"].append(acc)
        cv_results["fold_reports"].append(report)

        print(f"\n  Fold {fold}: val_bars={len(val_idx):,}  accuracy={acc:.4f}")

    print(f"\n  Mean CV accuracy: {np.mean(cv_results['fold_scores']):.4f}")
    print(f"  Std  CV accuracy: {np.std(cv_results['fold_scores']):.4f}")

    # ── Final model on full data ──────────────────────────────
    print(f"\n  Training final model on full dataset ({len(X_arr):,} bars)…")
    final_model = lgb.LGBMClassifier(**params, class_weight=class_weight_dict)
    final_model.fit(X_arr, y_arr)
    print("  Done.\n")

    return final_model, cv_results


# ============================================================
# SECTION 4 — PREDICTION & CONFIDENCE FILTERING
# ============================================================

def predict_regime(
    model: lgb.LGBMClassifier,
    X_new: pd.DataFrame,
    threshold: float = 0.60,
) -> pd.DataFrame:
    """
    Generate regime predictions with probability vector and
    confidence-based filtering.

    Parameters
    ----------
    model : lgb.LGBMClassifier
        Trained LightGBM classifier.
    X_new : pd.DataFrame
        Feature matrix for new bars (must match training feature schema).
    threshold : float
        Minimum probability for the dominant class before we commit to
        a regime; bars below this are forced to Regime 3 (FLAT/Choppy).

    Returns
    -------
    pd.DataFrame with columns:
        prob_0 … prob_3      — class probability for each regime
        dominant_regime      — argmax regime index
        confidence           — max probability (P of dominant class)
        regime_name          — human-readable label
        high_confidence      — bool: confidence >= threshold
        filtered_regime      — dominant_regime OR 3 if below threshold
    """

    if X_new.empty:
        raise ValueError("X_new is empty — no bars to predict.")

    proba = model.predict_proba(X_new.values)   # shape (n, 4)
    dominant = proba.argmax(axis=1)
    confidence = proba.max(axis=1)

    result = pd.DataFrame(proba, index=X_new.index,
                          columns=["prob_0", "prob_1", "prob_2", "prob_3"])
    result["dominant_regime"] = dominant
    result["confidence"]      = confidence
    result["regime_name"]     = [REGIME_NAMES[r] for r in dominant]
    result["high_confidence"] = confidence >= threshold

    # Confidence filter: if we're not sure, route to FLAT
    result["filtered_regime"] = np.where(
        result["high_confidence"], result["dominant_regime"], 3
    )

    return result


# ============================================================
# SECTION 5 — STRATEGY ROUTER
# ============================================================

def strategy_router(
    regime: int,
    confidence: float,
    confidence_threshold: float = 0.60,
    high_conf_threshold: float = 0.80,
) -> Dict:
    """
    Convert a regime label + confidence into an actionable trading signal.

    Parameters
    ----------
    regime : int
        Filtered regime index {0, 1, 2, 3}.
    confidence : float
        Model confidence (max class probability) for this bar.
    confidence_threshold : float
        Minimum confidence to emit a non-FLAT signal.
    high_conf_threshold : float
        Above this confidence, signal is marked as HIGH_CONVICTION.

    Returns
    -------
    dict with keys:
        signal          — one of MOMENTUM_LONG, MOMENTUM_SHORT,
                          MEAN_REVERT, FLAT
        regime_name     — human-readable regime
        confidence      — raw confidence score
        conviction      — 'HIGH' | 'MEDIUM' | 'LOW'
        position_size   — suggested fractional size multiplier [0.0, 1.0]
        notes           — brief rationale string
    """

    # Default: FLAT if confidence too low
    if confidence < confidence_threshold:
        return {
            "signal":        "FLAT",
            "regime_name":   "Uncertain",
            "confidence":    round(confidence, 4),
            "conviction":    "LOW",
            "position_size": 0.0,
            "notes":         f"Confidence {confidence:.1%} < threshold {confidence_threshold:.0%}. No trade.",
        }

    signal = STRATEGY_MAP[regime]

    # Conviction tier drives position sizing
    if confidence >= high_conf_threshold:
        conviction     = "HIGH"
        position_size  = 1.0
    elif confidence >= confidence_threshold:
        conviction     = "MEDIUM"
        position_size  = 0.6
    else:
        conviction     = "LOW"
        position_size  = 0.0

    notes_map = {
        0: "Trending Up: momentum continuation setup — buy dips, trail stops.",
        1: "Trending Down: momentum continuation setup — fade bounces, trail stops.",
        2: "Mean-Reverting: oscillate around VWAP — fade extremes, tight profit targets.",
        3: "Choppy/Low Vol: no edge — stay flat, wait for regime clarity.",
    }

    return {
        "signal":        signal,
        "regime_name":   REGIME_NAMES[regime],
        "confidence":    round(confidence, 4),
        "conviction":    conviction,
        "position_size": position_size,
        "notes":         notes_map[regime],
    }


# ============================================================
# SECTION 6 — SHAP FEATURE IMPORTANCE
# ============================================================

def compute_shap_importance(
    model: lgb.LGBMClassifier,
    X: pd.DataFrame,
    max_samples: int = 500,
) -> Optional[pd.DataFrame]:
    """
    Compute SHAP feature importance values for the trained model.

    Parameters
    ----------
    model : lgb.LGBMClassifier
        Trained classifier.
    X : pd.DataFrame
        Feature matrix to explain (a sample is used for speed).
    max_samples : int
        Cap on rows sent to SHAP explainer (computational budget).

    Returns
    -------
    pd.DataFrame or None
        Mean |SHAP| value per feature across all classes,
        sorted descending. None if shap is not installed.
    """

    if not SHAP_AVAILABLE:
        print("[WARN] shap not available — skipping SHAP analysis.")
        return None

    X_sample = X.sample(min(max_samples, len(X)), random_state=42)

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_sample)

    # ── Handle both SHAP output formats for multiclass ───────
    # Format A: list of (n_samples, n_features) — one per class
    # Format B: single ndarray of shape (n_samples, n_features, n_classes)
    if isinstance(shap_values, list):
        mean_abs = np.mean([np.abs(sv).mean(axis=0) for sv in shap_values], axis=0)
    elif isinstance(shap_values, np.ndarray) and shap_values.ndim == 3:
        mean_abs = np.abs(shap_values).mean(axis=(0, 2))  # avg over samples & classes
    else:
        print(f"[WARN] Unexpected SHAP values format: {type(shap_values)} — skipping.")
        return None

    importance_df = pd.DataFrame({
        "feature":       X.columns,
        "mean_abs_shap": mean_abs,
    }).sort_values("mean_abs_shap", ascending=False).reset_index(drop=True)

    return importance_df
# ============================================================
# SECTION 7 — WALK-FORWARD BACKTEST WITH MONTHLY RETRAINING
# ============================================================

def walk_forward_backtest(
    ohlcv: pd.DataFrame,
    options_data: Optional[pd.DataFrame] = None,
    retrain_freq: str = "1ME",
    label_window: int = 20,
    confidence_threshold: float = 0.60,
    lgbm_params: Optional[Dict] = None,
    verbose: bool = True,
) -> Dict:
    """
    Run a full walk-forward backtest with monthly model retraining.

    The backtest proceeds as follows:
      1. Build full feature + label dataset (no lookahead).
      2. Split into monthly retraining periods.
      3. For each period: train on all past data, predict on future bars.
      4. Aggregate predictions and compute performance metrics.

    Parameters
    ----------
    ohlcv : pd.DataFrame
        5-minute OHLCV data for the full history.
    options_data : pd.DataFrame, optional
        Options microstructure data aligned with ohlcv.
    retrain_freq : str
        Pandas offset alias for retraining frequency
        ('1ME' = monthly, '2ME' = bi-monthly, etc.).
    label_window : int
        Window passed to label_regime().
    confidence_threshold : float
        Minimum model confidence for non-FLAT signals.
    lgbm_params : dict, optional
        LightGBM hyperparameters.
    verbose : bool
        Print progress updates.

    Returns
    -------
    dict with keys:
        predictions        — full prediction DataFrame
        performance        — per-regime accuracy breakdown
        regime_distribution — count of each regime
        monthly_accuracy   — accuracy by calendar month
        shap_importance    — feature importance (if shap installed)
    """

    print("\n" + "="*60)
    print("  WALK-FORWARD BACKTEST — Monthly Retraining")
    print("="*60)

    # ── Step 1: Build full features & labels ──────────────────
    features_df = build_features(ohlcv, options_data)
    log_ret      = np.log(ohlcv["close"] / ohlcv["close"].shift(1)).reindex(features_df.index)
    labels       = label_regime(log_ret, window=label_window)

    # Align features and labels
    common_idx   = features_df.index.intersection(labels.index)
    X_full       = features_df.loc[common_idx]
    y_full       = labels.loc[common_idx]

    if len(X_full) < 500:
        raise ValueError(f"Only {len(X_full)} aligned bars — need at least 500.")

    if verbose:
        print(f"  Total bars: {len(X_full):,}")
        print(f"  Date range: {X_full.index[0]} → {X_full.index[-1]}")
        print(f"  Regime distribution:\n{y_full.value_counts().to_string()}")

    # ── Step 2: Monthly retraining periods ────────────────────
    retraining_dates = pd.date_range(
        start=X_full.index[0],
        end=X_full.index[-1],
        freq=retrain_freq,
    )

    all_predictions = []
    last_model = None

    for i, retrain_date in enumerate(retraining_dates[:-1]):
        next_date = retraining_dates[i + 1]

        # Train on everything up to retrain_date
        train_mask = X_full.index <= retrain_date
        X_train    = X_full[train_mask]
        y_train    = y_full[train_mask]

        if len(X_train) < 200:
            if verbose:
                print(f"  [SKIP] Period {retrain_date.date()}: not enough training data ({len(X_train)} bars).")
            continue

        # Validation: bars in (retrain_date, next_date]
        val_mask = (X_full.index > retrain_date) & (X_full.index <= next_date)
        X_val    = X_full[val_mask]
        y_val    = y_full[val_mask]

        if len(X_val) == 0:
            continue

        if verbose:
            print(f"\n  Retraining @ {retrain_date.date()} | "
                  f"train={len(X_train):,}  val={len(X_val):,}")

        # Train (suppress per-fold CV output in backtest for cleanliness)
        try:
            model, _ = train_model(X_train, y_train, params=lgbm_params,
                                   n_splits=3, gap=48)
        except Exception as e:
            print(f"  [WARN] Training failed for period {retrain_date.date()}: {e}")
            continue

        last_model = model

        # Predict on val period
        pred_df = predict_regime(model, X_val, threshold=confidence_threshold)
        pred_df["true_regime"]  = y_val.values
        pred_df["correct"]      = pred_df["filtered_regime"] == pred_df["true_regime"]
        pred_df["period_start"] = retrain_date
        all_predictions.append(pred_df)

    # ── Step 3: Aggregate results ─────────────────────────────
    if not all_predictions:
        raise RuntimeError("No predictions were generated — check data length.")

    preds = pd.concat(all_predictions)

    accuracy_overall = preds["correct"].mean()
    accuracy_by_regime = (
        preds.groupby("true_regime")["correct"].mean()
        .rename(index=REGIME_NAMES)
        .to_dict()
    )
    regime_distribution = preds["filtered_regime"].value_counts().to_dict()
    monthly_accuracy = (
        preds.resample("ME")["correct"].mean().to_dict()
    )

    # SHAP on last trained model
    shap_imp = None
    if last_model is not None:
        shap_imp = compute_shap_importance(last_model, X_full.iloc[-500:])

    print(f"\n{'='*60}")
    print(f"  BACKTEST RESULTS")
    print(f"{'='*60}")
    print(f"  Overall accuracy :  {accuracy_overall:.4f}")
    print(f"  Accuracy by regime:")
    for regime, acc in accuracy_by_regime.items():
        icon = REGIME_COLORS.get(list(REGIME_NAMES.values()).index(regime)
                                 if regime in REGIME_NAMES.values() else 3, "⚪")
        print(f"    {icon} {regime:<20}: {acc:.4f}")
    print(f"  Bars predicted   :  {len(preds):,}")
    print(f"  High-conf bars   :  {preds['high_confidence'].sum():,} "
          f"({preds['high_confidence'].mean():.1%})")

    if shap_imp is not None:
        print(f"\n  Top 10 features by SHAP importance:")
        print(shap_imp.head(10).to_string(index=False))

    return {
        "predictions":         preds,
        "performance":         {"overall": accuracy_overall, "by_regime": accuracy_by_regime},
        "regime_distribution": regime_distribution,
        "monthly_accuracy":    monthly_accuracy,
        "shap_importance":     shap_imp,
        "model":               last_model,
    }


def generate_synthetic_data(
    n_days: int = 252,
    bars_per_day: int = 78,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Generate synthetic 5-minute OHLCV and options data for testing.
    """

    rng = np.random.default_rng(seed)
    n_bars = n_days * bars_per_day

    # ── Build DatetimeIndex (5-min bars, NYSE session) ────────
    dates = []
    current = pd.Timestamp("2023-01-03 09:30:00")
    added = 0
    while added < n_bars:
        if current.weekday() < 5:  # Mon–Fri
            for m in range(bars_per_day):
                dates.append(current + pd.Timedelta(minutes=5 * m))
                added += 1
                if added == n_bars:
                    break
        current += pd.Timedelta(days=1)

    index = pd.DatetimeIndex(dates)

    # ── Regime-aware price generation ─────────────────────────
    # Cycle: trending up → trending down → mean-reverting → choppy
    regime_cycle_len = bars_per_day * 10   # ~2 trading weeks per regime
    
    # FIX: use np.repeat so each regime lasts regime_cycle_len bars,
    #      then tile the full block to cover n_bars
    regime_block = np.repeat([0, 1, 2, 3], regime_cycle_len)
    regime_sequence = np.tile(regime_block, n_bars // len(regime_block) + 1)[:n_bars]

    returns = np.zeros(n_bars)
    for i in range(1, n_bars):
        r = regime_sequence[i]
        if r == 0:    # trending up
            drift = 0.00015
            vol   = 0.0008
        elif r == 1:  # trending down
            drift = -0.00015
            vol   = 0.0009
        elif r == 2:  # mean-reverting
            drift = -0.05 * returns[max(0, i-5):i].sum()   # pull-back
            vol   = 0.0012
        else:         # choppy
            drift = 0.0
            vol   = 0.0004

        returns[i] = drift + vol * rng.standard_normal()

    # Reconstruct price series from returns
    price = 4500.0 * np.exp(np.cumsum(returns))

    # OHLCV construction (intrabar simulation)
    noise = rng.uniform(0.0003, 0.0010, n_bars)
    open_  = price * (1 + rng.normal(0, 0.0003, n_bars))
    high   = np.maximum(open_, price) * (1 + noise * 0.5)
    low    = np.minimum(open_, price) * (1 - noise * 0.5)
    close  = price
    volume = (rng.integers(5_000, 50_000, n_bars) *
              (1 + 2.0 * (regime_sequence == 0) + 2.5 * (regime_sequence == 1)))

    ohlcv = pd.DataFrame({
        "open":   open_,
        "high":   high,
        "low":    low,
        "close":  close,
        "volume": volume.astype(float),
    }, index=index)

    # ── Synthetic options data ─────────────────────────────────
    base_iv = 0.18  # 18% annual vol
    iv_noise = rng.normal(0, 0.01, n_bars)
    atm_iv  = (base_iv + np.cumsum(iv_noise * 0.05)).clip(0.08, 0.60)
    atm_iv  = atm_iv / atm_iv[0] * base_iv  # normalise drift

    # ── Synthetic Vanna & Charm ────────────────────────────────
    # Vanna exposure: regime-aware — trending regimes generate stronger
    # directional hedging flows; choppy = near zero.
    vanna_base  = np.where(regime_sequence == 0,  1_500_000,   # Up: +ve hedging
               np.where(regime_sequence == 1, -1_500_000,      # Down: -ve hedging
               np.where(regime_sequence == 2,  rng.uniform(-800_000, 800_000, n_bars),
                                                rng.normal(0, 200_000, n_bars))))  # Choppy
    vanna_exp   = vanna_base + rng.normal(0, 300_000, n_bars)

    # Charm exposure: time-decay pressure, peaks near OpEx (end of week)
    # Simulate weekly OpEx effect: stronger near Friday close
    dow_arr        = np.array([d.dayofweek for d in index])
    opex_multiplier = np.where(dow_arr == 4, 2.5, 1.0)   # Friday = 2.5x charm
    charm_base     = rng.normal(-50_000, 30_000, n_bars) * opex_multiplier
    charm_exp      = np.where(regime_sequence == 2,
                              charm_base * 2.0,   # mean-revert: high charm (pin risk)
                              charm_base)

    # ── Synthetic VIX Term Structure ───────────────────────────
    # Base VIX coupled to realised vol regime
    vix_base = np.where(regime_sequence == 0, 15.0,    # trending up → low VIX
               np.where(regime_sequence == 1, 28.0,    # trending down → high VIX
               np.where(regime_sequence == 2, 35.0,    # mean-reverting → spike VIX
                                               12.0))) # choppy → very low VIX
    vix_noise   = np.cumsum(rng.normal(0, 0.3, n_bars))
    vix_spot    = np.clip(vix_base + vix_noise * 0.5, 8.0, 80.0)

    # VIX9D: slightly leads VIX spot, more reactive
    vix_9d      = np.clip(vix_spot * rng.uniform(0.88, 1.12, n_bars), 7.0, 85.0)

    # VIX3M: smoother, slower-moving (term-premium embedded)
    vix_3m_base = np.clip(vix_spot * 0.95 + rng.normal(0, 1.5, n_bars), 10.0, 75.0)
    vix_3m      = pd.Series(vix_3m_base).rolling(12).mean().fillna(vix_3m_base[0]).values

    # VIX6M: even slower, structural level
    vix_6m      = np.clip(vix_3m * 1.02 + rng.normal(0, 1.0, n_bars), 10.0, 70.0)

    options_data = pd.DataFrame({
        "atm_iv":           atm_iv,
        "skew_25d":         rng.normal(-0.02, 0.005, n_bars),
        "term_slope":       rng.normal(0.01, 0.003, n_bars),
        "gex":              rng.normal(500_000, 200_000, n_bars),
        "put_call_ratio":   np.abs(rng.normal(0.85, 0.15, n_bars)),
        # NEW: Vanna & Charm
        "vanna_exposure":   vanna_exp,
        "charm_exposure":   charm_exp,
        # NEW: VIX Term Structure
        "vix_spot":         vix_spot,
        "vix9d":            vix_9d,
        "vix3m":            vix_3m,
        "vix6m":            vix_6m,
    }, index=index)

    print(f"  Synthetic data generated: {n_bars:,} bars "
          f"({n_days} days × {bars_per_day} bars/day)")
    return ohlcv, options_data
# ============================================================
# SECTION 9 — PRETTY PRINT HELPERS
# ============================================================

def print_prediction_summary(pred_row: pd.Series, signal_dict: Dict) -> None:
    """Print a nicely formatted prediction summary for one bar."""

    bar_time = pred_row.name if hasattr(pred_row, "name") else "N/A"
    regime   = int(pred_row["filtered_regime"])
    icon     = REGIME_COLORS[regime]

    sep = "─" * 60
    print(f"\n{sep}")
    print(f"  BAR PREDICTION SUMMARY   {bar_time}")
    print(f"{sep}")
    print(f"  {'Regime Probabilities'}:")
    for i in range(4):
        bar_len = int(pred_row[f"prob_{i}"] * 30)
        bar_str = "█" * bar_len + "░" * (30 - bar_len)
        marker  = " ◄" if i == regime else ""
        print(f"    {REGIME_COLORS[i]} {REGIME_NAMES[i]:<20} [{bar_str}] "
              f"{pred_row[f'prob_{i}']:.2%}{marker}")

    print(f"\n  {'Dominant Regime':<22}: {icon} {REGIME_NAMES[regime]}")
    print(f"  {'Confidence':<22}: {pred_row['confidence']:.2%}  "
          f"({'✓ HIGH CONF' if pred_row['high_confidence'] else '✗ LOW CONF'})")
    print(f"\n  {'Strategy Signal':<22}: 🎯 {signal_dict['signal']}")
    print(f"  {'Conviction':<22}: {signal_dict['conviction']}")
    print(f"  {'Position Size':<22}: {signal_dict['position_size']:.0%}")
    print(f"  {'Notes':<22}: {signal_dict['notes']}")
    print(f"{sep}\n")


# ============================================================
# SECTION 10 — MAIN DEMO BLOCK
# ============================================================

if __name__ == "__main__":

    print("\n" + "═"*60)
    print("  INTRADAY REGIME CLASSIFIER — Standalone Demo")
    print("  LightGBM | 5-min OHLCV | Equity Index")
    print("═"*60)

    # ── 1. Generate synthetic data ────────────────────────────
    print("\n[1/6] Generating synthetic market data…")
    ohlcv_data, options = generate_synthetic_data(n_days=252, bars_per_day=78)

    # ── 2. Build features ─────────────────────────────────────
    print("\n[2/6] Engineering features…")
    X = build_features(ohlcv_data, options)
    print(f"  Feature matrix shape: {X.shape}  ({X.shape[1]} features)")
    print(f"  Feature names sample: {list(X.columns[:6])} …")

    # ── 3. Label regimes ──────────────────────────────────────
    print("\n[3/6] Labeling regimes…")
    log_returns = np.log(ohlcv_data["close"] / ohlcv_data["close"].shift(1))
    y = label_regime(log_returns, window=20)

    common = X.index.intersection(y.index)
    X, y   = X.loc[common], y.loc[common]

    print(f"  Aligned bars: {len(X):,}")
    print("  Regime distribution:")
    for r, cnt in y.value_counts().sort_index().items():
        print(f"    {REGIME_COLORS[r]} {REGIME_NAMES[r]:<22}: {cnt:>5} bars ({cnt/len(y):.1%})")

    # ── 4. Train model ────────────────────────────────────────
    print("\n[4/6] Training LightGBM classifier (walk-forward CV)…")
    model, cv_results = train_model(X, y, n_splits=4, gap=48)

    # ── 5. Predict on last 5 bars ─────────────────────────────
    print("\n[5/6] Predicting on last 5 bars…")
    X_new = X.iloc[-5:]
    predictions = predict_regime(model, X_new, threshold=0.60)

    # ── 6. Strategy routing for the most recent bar ───────────
    print("\n[6/6] Strategy routing for latest bar…")
    latest = predictions.iloc[-1]
    signal = strategy_router(
        regime=int(latest["filtered_regime"]),
        confidence=latest["confidence"],
        confidence_threshold=0.60,
        high_conf_threshold=0.80,
    )

    print_prediction_summary(latest, signal)

    # ── 7. Optional: SHAP importance on a small sample ────────
    if SHAP_AVAILABLE:
        print("Computing SHAP feature importance (top 15)…")
        shap_df = compute_shap_importance(model, X.iloc[-300:], max_samples=200)
        if shap_df is not None:
            print(shap_df.head(15).to_string(index=False))

    # ── 8. Mini walk-forward backtest (fast: 3 months) ────────
    print("\n" + "─"*60)
    print("  Running mini walk-forward backtest (last 63 trading days)…")
    print("─"*60)

    ohlcv_mini   = ohlcv_data.iloc[-63 * 78:]
    options_mini = options.iloc[-63 * 78:]

    backtest_results = walk_forward_backtest(
        ohlcv=ohlcv_mini,
        options_data=options_mini,
        retrain_freq="1ME",
        label_window=20,
        confidence_threshold=0.60,
        verbose=True,
    )

    print("\n" + "═"*60)
    print("  Demo complete. All components verified.")
    print("═"*60)


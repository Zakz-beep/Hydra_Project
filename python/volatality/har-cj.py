"""
HAR-X Model with LASSO/Elastic Net Regularization
for US Equity Index Volatility Forecasting (S&P 500 / SPX)

Author: Generated via Claude
Description:
    Production-ready implementation of the Heterogeneous Autoregressive (HAR)
    model extended with cross-asset, microstructure, and options-implied features.
    Uses ElasticNetCV with TimeSeriesSplit walk-forward validation.
    Outputs a self-contained interactive Plotly HTML dashboard.

Dependencies:
    yfinance, numpy, pandas, scikit-learn, plotly, scipy, statsmodels
"""

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import yfinance as yf
from sklearn.linear_model import LinearRegression, ElasticNetCV
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from scipy import stats
import statsmodels.api as sm
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.io as pio
import os, sys

# ─────────────────────────────────────────────────────────────
# 0. CONFIGURATION
# ─────────────────────────────────────────────────────────────
TICKERS = {
    "SPY":  "SPY",
    "VIX":  "^VIX",
    "VIX3M":"^VIX3M",
    "TLT":  "TLT",
    "UUP":  "UUP",
    "HYG":  "HYG",
}
START_DATE   = "2010-01-01"
END_DATE     = datetime.today().strftime("%Y-%m-%d")
TRADING_DAYS = 252          # annualization factor
TRAIN_WINDOW = 1260         # 5 years initial training
REFIT_FREQ   = 63           # quarterly refit
L1_RATIOS    = [0.5, 0.7, 0.9, 0.95, 1.0]
CV_SPLITS    = 5
OUTPUT_FILE  = "har_x_dashboard.html"


# ─────────────────────────────────────────────────────────────
# 1. DATA INGESTION
# ─────────────────────────────────────────────────────────────

def fetch_data(tickers: dict, start: str, end: str) -> dict:
    """
    Download OHLCV data for all tickers via yfinance.
    Returns a dict of DataFrames keyed by logical name.
    """
    print("=" * 60)
    print("STEP 1: Downloading market data...")
    print("=" * 60)
    raw = {}
    for name, ticker in tickers.items():
        print(f"  Fetching {ticker}...", end="", flush=True)
        try:
            df = yf.download(ticker, start=start, end=end,
                             auto_adjust=True, progress=False)
            df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
            df.index = pd.to_datetime(df.index)
            if df.empty:
                print(f" FAILED (empty)")
            else:
                raw[name] = df
                print(f" OK ({len(df)} rows)")
        except Exception as e:
            print(f" ERROR: {e}")
    return raw


# ─────────────────────────────────────────────────────────────
# 2. REALIZED MEASURE ESTIMATORS
# ─────────────────────────────────────────────────────────────

def naive_rv(close: pd.Series) -> pd.Series:
    """
    Naive RV: sum of squared daily log-returns.
    Annualized by multiplying by TRADING_DAYS.
    NOTE: This is a daily proxy — true intraday RV unavailable.
    """
    log_ret = np.log(close / close.shift(1))
    return (log_ret ** 2) * TRADING_DAYS


def parkinson_rv(high: pd.Series, low: pd.Series) -> pd.Series:
    """
    Parkinson (1980) estimator using high-low range.
    More efficient than close-to-close estimator.
    Annualized by multiplying by TRADING_DAYS.
    """
    log_hl = np.log(high / low)
    return (log_hl ** 2 / (4 * np.log(2))) * TRADING_DAYS


def garman_klass_rv(open_: pd.Series, high: pd.Series,
                    low: pd.Series, close: pd.Series) -> pd.Series:
    """
    Garman-Klass (1980) OHLC-based estimator.
    Most efficient estimator from OHLC data alone.
    Used as primary RV measure throughout.
    Annualized by multiplying by TRADING_DAYS.

    NOTE: This is an OHLC-based PROXY for true intraday realized variance.
          True intraday RV requires tick/minute-bar data.
    """
    log_hl = np.log(high / low)
    log_co = np.log(close / open_)
    return (0.5 * log_hl**2 - (2 * np.log(2) - 1) * log_co**2) * TRADING_DAYS


def bipower_variation(close: pd.Series) -> pd.Series:
    """
    Barndorff-Nielsen & Shephard (2004) Bipower Variation.
    Jump-robust estimator of continuous quadratic variation.
    Uses pi/2 scaling constant.
    Annualized by multiplying by TRADING_DAYS.
    """
    log_ret = np.log(close / close.shift(1)).abs()
    bpv = (np.pi / 2) * log_ret * log_ret.shift(1)
    return bpv * TRADING_DAYS


def jump_component(rv: pd.Series, bpv: pd.Series) -> pd.Series:
    """
    Jump component: J = max(RV - BPV, 0).
    Isolates the discontinuous (jump) part of quadratic variation.
    """
    return np.maximum(rv - bpv, 0.0)


def continuous_component(rv: pd.Series, jump: pd.Series) -> pd.Series:
    """
    Continuous component: C = RV - J.
    Represents the diffusive part of quadratic variation.
    """
    return rv - jump


def realized_skewness(open_: pd.Series, high: pd.Series,
                       low: pd.Series, close: pd.Series) -> pd.Series:
    """
    Intraday realized skewness approximation from OHLC.
    Uses the signed asymmetry between high/low range and open/close move.
    """
    range_ = np.log(high / low)
    move   = np.log(close / open_)
    skew   = move / (range_ + 1e-10)
    return skew.rolling(5).mean()


def realized_kurtosis_proxy(close: pd.Series) -> pd.Series:
    """
    Rolling realized kurtosis proxy from daily log-returns.
    Uses 22-day window to approximate fourth moment scaling.
    """
    log_ret = np.log(close / close.shift(1))
    roll_kurt = log_ret.rolling(22).kurt()
    return roll_kurt


# ─────────────────────────────────────────────────────────────
# 3. FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────

def build_features(raw: dict) -> pd.DataFrame:
    """
    Build the full HAR-X feature matrix.
    All features are lagged by at least 1 day to prevent look-ahead bias.
    Returns a DataFrame indexed by date.
    """
    print("\n" + "=" * 60)
    print("STEP 2: Engineering features...")
    print("=" * 60)

    spy = raw["SPY"]
    vix = raw["VIX"]["Close"].rename("VIX")
    tlt = raw["TLT"]["Close"].rename("TLT")
    uup = raw["UUP"]["Close"].rename("UUP")
    hyg = raw["HYG"]["Close"].rename("HYG")

    # Align on SPY index
    common_idx = spy.index
    for s in [vix, tlt, uup, hyg]:
        common_idx = common_idx.intersection(s.index)

    spy  = spy.loc[common_idx]
    vix  = vix.loc[common_idx]
    tlt  = tlt.loc[common_idx]
    uup  = uup.loc[common_idx]
    hyg  = hyg.loc[common_idx]

    # VIX3M (optional — fallback to VIX if unavailable)
    if "VIX3M" in raw:
        vix3m = raw["VIX3M"]["Close"].reindex(common_idx).ffill().rename("VIX3M")
    else:
        print("  VIX3M unavailable — using VIX as fallback for term structure")
        vix3m = vix.copy().rename("VIX3M")

    # ── Realized measures (on SPY) ──────────────────────────
    print("  Computing realized measures...")
    rv_naive  = naive_rv(spy["Close"])
    rv_park   = parkinson_rv(spy["High"], spy["Low"])
    rv_gk     = garman_klass_rv(spy["Open"], spy["High"], spy["Low"], spy["Close"])
    bpv       = bipower_variation(spy["Close"])
    J         = jump_component(rv_gk, bpv)
    C         = continuous_component(rv_gk, J)
    r_skew    = realized_skewness(spy["Open"], spy["High"], spy["Low"], spy["Close"])
    r_kurt    = realized_kurtosis_proxy(spy["Close"])

    # Log-returns
    log_ret     = np.log(spy["Close"] / spy["Close"].shift(1))
    spy_ret     = log_ret
    tlt_ret     = np.log(tlt / tlt.shift(1))
    uup_ret     = np.log(uup / uup.shift(1))
    hyg_ret     = np.log(hyg / hyg.shift(1))

    # ── HAR lags: d=daily, w=5-day mean, m=22-day mean ──────
    print("  Building HAR lags...")

    def har_lags(series: pd.Series, prefix: str) -> pd.DataFrame:
        d = series.rename(f"{prefix}_d")
        w = series.rolling(5).mean().rename(f"{prefix}_w")
        m = series.rolling(22).mean().rename(f"{prefix}_m")
        return pd.concat([d, w, m], axis=1)

    C_lags   = har_lags(C, "C")
    J_lags   = har_lags(J, "J")
    VIX_lags = har_lags(vix, "VIX")

    # ── Implied volatility layer ────────────────────────────
    VIX_slope = (vix3m - vix).rename("VIX_slope")

    # Variance Risk Premium: VIX² / 252 − GK_RV_daily
    vix_implied_var = (vix ** 2) / TRADING_DAYS
    VRP             = (vix_implied_var - rv_gk).rename("VRP")
    VRP_w           = VRP.rolling(5).mean().rename("VRP_w")

    # ── Leverage effect ─────────────────────────────────────
    r_neg_d = spy_ret.apply(lambda x: min(x, 0)).rename("r_neg_d")
    r_neg_w = r_neg_d.rolling(5).mean().rename("r_neg_w")

    # ── Cross-asset signals ─────────────────────────────────
    print("  Computing cross-asset signals...")
    eq_bond_corr = spy_ret.rolling(22).corr(tlt_ret).rename("eq_bond_corr")
    DXY_ret      = uup_ret.rename("DXY_ret")
    DXY_vol      = uup_ret.rolling(22).std().mul(np.sqrt(TRADING_DAYS)).rename("DXY_vol")
    HY_ret       = hyg_ret.rename("HY_ret")
    HY_vol_22    = hyg_ret.rolling(22).std().mul(np.sqrt(TRADING_DAYS)).rename("HY_vol_22")

    # ── Microstructure proxies ───────────────────────────────
    print("  Computing microstructure proxies...")
    dollar_vol   = spy["Close"] * spy["Volume"]
    amihud_d     = (spy_ret.abs() / (dollar_vol + 1e-10)).rename("Amihud_d") * 1e9
    amihud_w     = amihud_d.rolling(5).mean().rename("Amihud_w")
    vol_ratio    = (spy["Volume"] / spy["Volume"].rolling(22).mean()).rename("volume_ratio")

    # ── Interaction terms ────────────────────────────────────
    VIX_x_J  = (vix * J).rename("VIX_x_J")
    C_x_VRP   = (C * VRP).rename("C_x_VRP")

    # ── Assemble raw feature frame ───────────────────────────
    feat = pd.concat([
        C_lags, J_lags, VIX_lags,
        VIX_slope, VRP, VRP_w,
        r_neg_d, r_neg_w,
        r_skew.rename("r_skew"), r_kurt.rename("r_kurt"),
        eq_bond_corr, DXY_ret, DXY_vol, HY_ret, HY_vol_22,
        amihud_d, amihud_w, vol_ratio,
        VIX_x_J, C_x_VRP,
    ], axis=1)

    # Target: next-day GK RV (forward 1 day)
    target = rv_gk.shift(-1).rename("RV_target")

    df = pd.concat([feat, target,
                    rv_gk.rename("GK_RV"),
                    rv_naive.rename("Naive_RV"),
                    rv_park.rename("Park_RV"),
                    J.rename("J_raw"),
                    C.rename("C_raw"),
                    vix.rename("VIX_raw"),
                    VRP.rename("VRP_raw"),
                    spy_ret.rename("SPY_ret"),
                   ], axis=1)

    # ── Lag all features by 1 day (no-lookahead) ─────────────
    feature_cols = [c for c in feat.columns]
    df[feature_cols] = df[feature_cols].shift(1)

    # Clean
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df.dropna(inplace=True)

    print(f"  Feature matrix shape: {df.shape}")
    print(f"  Date range: {df.index[0].date()} → {df.index[-1].date()}")
    return df, feature_cols


# ─────────────────────────────────────────────────────────────
# 4. EVALUATION METRICS
# ─────────────────────────────────────────────────────────────

def mse(actual: np.ndarray, forecast: np.ndarray) -> float:
    """Mean Squared Error."""
    return np.mean((actual - forecast) ** 2)


def mae(actual: np.ndarray, forecast: np.ndarray) -> float:
    """Mean Absolute Error."""
    return np.mean(np.abs(actual - forecast))


def qlike(actual: np.ndarray, forecast: np.ndarray) -> float:
    """
    QLIKE loss function — primary metric for volatility models.
    Patton (2011): QL = log(h) + r²/h
    Penalizes underprediction of variance more heavily than overprediction.
    """
    eps = 1e-8
    h = np.maximum(forecast, eps)
    r2 = np.maximum(actual, eps)
    return np.mean(np.log(h) + r2 / h)


def r2_oos(actual: np.ndarray, forecast: np.ndarray) -> float:
    """
    Out-of-sample R² (Campbell & Thompson, 2008).
    R²_OOS = 1 − MSE(model) / MSE(historical_mean_benchmark)
    """
    bench = np.mean(actual)
    ss_res = np.sum((actual - forecast) ** 2)
    ss_tot = np.sum((actual - bench) ** 2)
    return 1 - ss_res / (ss_tot + 1e-12)


def minzl_test(actual: np.ndarray, forecast: np.ndarray) -> dict:
    """
    Mincer-Zarnowitz (1969) regression: actual = a + b*forecast + e
    Unbiased forecast: a=0, b=1 (joint F-test p-value reported).
    """
    X = sm.add_constant(forecast)
    model = sm.OLS(actual, X).fit()
    # Joint test H0: a=0, b=1
    R = np.array([[1, 0], [0, 1]])
    r = np.array([0, 1])
    f_test = model.f_test((R, r))
    return {
        "alpha": model.params[0],
        "beta":  model.params[1],
        "R2":    model.rsquared,
        "MZ_pval": float(f_test.pvalue) if hasattr(f_test, "pvalue") else np.nan,
    }


def diebold_mariano(e1: np.ndarray, e2: np.ndarray,
                    loss: str = "squared", h: int = 1) -> dict:
    """
    Diebold-Mariano (1995) test for equal predictive accuracy.
    H0: equal predictive ability.
    loss: 'squared' or 'absolute'
    Returns test statistic and p-value (two-sided).
    """
    if loss == "squared":
        d = e1**2 - e2**2
    else:
        d = np.abs(e1) - np.abs(e2)

    n = len(d)
    d_bar = np.mean(d)
    # Newey-West variance with lag h-1
    gamma0 = np.var(d, ddof=1)
    gammas = [np.mean((d[k:] - d_bar) * (d[:-k] - d_bar)) for k in range(1, h)]
    nw_var = gamma0 + 2 * sum(gammas) if gammas else gamma0
    se = np.sqrt((nw_var + 1e-12) / n)
    dm_stat = d_bar / se
    p_val = 2 * (1 - stats.norm.cdf(abs(dm_stat)))
    return {"DM_stat": dm_stat, "p_value": p_val, "mean_loss_diff": d_bar}


# ─────────────────────────────────────────────────────────────
# 5. MODEL TRAINING
# ─────────────────────────────────────────────────────────────

def fit_har_cj(X_train: np.ndarray, y_train: np.ndarray,
               feat_names: list, cj_idx: list) -> LinearRegression:
    """
    Baseline HAR-CJ model: OLS on C and J components only.
    cj_idx: indices of [C_d, C_w, C_m, J_d, J_w, J_m] in feature matrix.
    """
    reg = LinearRegression()
    reg.fit(X_train[:, cj_idx], y_train)
    return reg


def fit_har_x_ols(X_train: np.ndarray, y_train: np.ndarray) -> LinearRegression:
    """
    HAR-X OLS: ordinary least squares on all features.
    Included to demonstrate in-sample overfitting.
    """
    reg = LinearRegression()
    reg.fit(X_train, y_train)
    return reg


def fit_har_x_enet(X_train: np.ndarray, y_train: np.ndarray,
                   cv: TimeSeriesSplit) -> ElasticNetCV:
    """
    HAR-X ElasticNet: regularized regression via ElasticNetCV.
    Uses TimeSeriesSplit to preserve temporal ordering.
    l1_ratio grid covers Ridge→LASSO spectrum.
    """
    enet = ElasticNetCV(
        l1_ratio=L1_RATIOS,
        cv=cv,
        max_iter=5000,
        n_jobs=-1,
        random_state=42,
    )
    enet.fit(X_train, y_train)
    return enet


# ─────────────────────────────────────────────────────────────
# 6. WALK-FORWARD VALIDATION
# ─────────────────────────────────────────────────────────────

def walk_forward(df: pd.DataFrame, feature_cols: list) -> dict:
    """
    Walk-forward (expanding window) validation.
    - Initial training: TRAIN_WINDOW days
    - Refit every REFIT_FREQ days
    - Evaluate on out-of-sample predictions
    Returns dict with predictions, metrics, and feature info.
    """
    print("\n" + "=" * 60)
    print("STEP 3: Walk-forward validation...")
    print("=" * 60)

    X_all = df[feature_cols].values
    y_all = df["RV_target"].values
    dates = df.index

    # Identify C/J feature indices for HAR-CJ baseline
    cj_cols = ["C_d", "C_w", "C_m", "J_d", "J_w", "J_m"]
    cj_idx  = [feature_cols.index(c) for c in cj_cols if c in feature_cols]

    n = len(df)
    refit_points = list(range(TRAIN_WINDOW, n - 1, REFIT_FREQ))
    if not refit_points:
        raise ValueError("Not enough data for walk-forward validation.")

    results = {
        "dates": [], "actuals": [],
        "pred_cj": [], "pred_ols": [], "pred_enet": [],
        "coef_history": [],   # list of {window_end: coef_dict}
        "selected_features": [],  # list of feature lists per window
        "alpha_history": [],
        "l1_history": [],
    }

    # TimeSeriesSplit for inner CV
    tscv = TimeSeriesSplit(n_splits=CV_SPLITS)

    scaler = StandardScaler()
    last_refit = TRAIN_WINDOW - 1  # index of last refit point

    for i, start_test in enumerate(refit_points):
        end_test = min(start_test + REFIT_FREQ, n - 1)
        train_slice = slice(0, start_test)

        X_tr = X_all[train_slice]
        y_tr = y_all[train_slice]

        # Standardize
        X_tr_sc = scaler.fit_transform(X_tr)
        X_te    = X_all[start_test:end_test]
        X_te_sc = scaler.transform(X_te)

        # Fit models
        m_cj   = fit_har_cj(X_tr_sc, y_tr, feature_cols, cj_idx)
        m_ols  = fit_har_x_ols(X_tr_sc, y_tr)
        m_enet = fit_har_x_enet(X_tr_sc, y_tr, tscv)

        # Predict
        pred_cj_raw  = m_cj.predict(X_te_sc[:, cj_idx])
        pred_ols_raw = m_ols.predict(X_te_sc)
        pred_enet_raw = m_enet.predict(X_te_sc)

        # Clip to positive (variance must be ≥ 0)
        pred_cj_raw  = np.maximum(pred_cj_raw, 0)
        pred_ols_raw = np.maximum(pred_ols_raw, 0)
        pred_enet_raw= np.maximum(pred_enet_raw, 0)

        actuals = y_all[start_test:end_test]

        results["dates"].extend(dates[start_test:end_test])
        results["actuals"].extend(actuals)
        results["pred_cj"].extend(pred_cj_raw)
        results["pred_ols"].extend(pred_ols_raw)
        results["pred_enet"].extend(pred_enet_raw)

        # Feature selection (non-zero ElasticNet coefficients)
        coef_dict = dict(zip(feature_cols, m_enet.coef_))
        selected  = [k for k, v in coef_dict.items() if abs(v) > 1e-8]
        results["selected_features"].append(selected)
        results["coef_history"].append({
            "window_end": dates[end_test - 1],
            "coefs": coef_dict,
        })
        results["alpha_history"].append(m_enet.alpha_)
        results["l1_history"].append(m_enet.l1_ratio_)

        if (i + 1) % 5 == 0 or i == len(refit_points) - 1:
            n_selected = len(selected)
            print(f"  Window {i+1}/{len(refit_points)} | "
                  f"Train: {start_test} obs | "
                  f"α={m_enet.alpha_:.4f} | "
                  f"l1={m_enet.l1_ratio_:.2f} | "
                  f"Features selected: {n_selected}")

    # Convert to arrays
    for k in ["actuals", "pred_cj", "pred_ols", "pred_enet"]:
        results[k] = np.array(results[k])
    results["dates"] = pd.DatetimeIndex(results["dates"])

    return results


# ─────────────────────────────────────────────────────────────
# 7. EVALUATION SUMMARY
# ─────────────────────────────────────────────────────────────

def evaluate_results(results: dict) -> dict:
    """
    Compute all evaluation metrics and DM test for walk-forward results.
    """
    print("\n" + "=" * 60)
    print("STEP 4: Computing evaluation metrics...")
    print("=" * 60)

    act  = results["actuals"]
    p_cj = results["pred_cj"]
    p_ol = results["pred_ols"]
    p_en = results["pred_enet"]

    def metrics(actual, pred):
        return {
            "MSE":   mse(actual, pred),
            "MAE":   mae(actual, pred),
            "QLIKE": qlike(actual, pred),
            "R2oos": r2_oos(actual, pred),
        }

    m_cj   = metrics(act, p_cj)
    m_ols  = metrics(act, p_ol)
    m_enet = metrics(act, p_en)

    # Diebold-Mariano: HAR-CJ vs HAR-X ElasticNet
    e_cj   = act - p_cj
    e_enet = act - p_en
    dm     = diebold_mariano(e_cj, e_enet, loss="squared")

    # MZ tests
    mz_cj   = minzl_test(act, p_cj)
    mz_enet = minzl_test(act, p_en)

    # Feature selection frequency
    all_selected = [f for window in results["selected_features"]
                    for f in window]
    n_windows = len(results["selected_features"])
    from collections import Counter
    freq = Counter(all_selected)
    sel_freq = {k: v / n_windows for k, v in freq.items()}

    top5 = sorted(sel_freq, key=sel_freq.get, reverse=True)[:5]

    eval_ = {
        "HAR_CJ":   m_cj,
        "HAR_X_OLS": m_ols,
        "HAR_X_EN": m_enet,
        "DM_test":  dm,
        "MZ_cj":    mz_cj,
        "MZ_enet":  mz_enet,
        "sel_freq": sel_freq,
        "top5":     top5,
        "n_windows": n_windows,
        "best_alpha": float(np.median(results["alpha_history"])),
        "best_l1":    float(np.median(results["l1_history"])),
    }

    for name, m in [("HAR-CJ", m_cj), ("HAR-X OLS", m_ols), ("HAR-X EN", m_enet)]:
        print(f"  {name:20s} | MSE={m['MSE']:.4f} | MAE={m['MAE']:.4f} | "
              f"QLIKE={m['QLIKE']:.4f} | R²oos={m['R2oos']:.4f}")
    print(f"  DM stat={dm['DM_stat']:.3f} | p={dm['p_value']:.4f}")

    return eval_


# ─────────────────────────────────────────────────────────────
# 8. ROLLING QLIKE
# ─────────────────────────────────────────────────────────────

def rolling_qlike(actual: np.ndarray, forecast: np.ndarray,
                  window: int = 63) -> np.ndarray:
    """Compute rolling QLIKE loss over a given window."""
    n = len(actual)
    out = np.full(n, np.nan)
    eps = 1e-8
    for i in range(window, n):
        a = actual[i-window:i]
        f = np.maximum(forecast[i-window:i], eps)
        out[i] = np.mean(np.log(f) + a / f)
    return out


# ─────────────────────────────────────────────────────────────
# 9. PLOTLY DASHBOARD
# ─────────────────────────────────────────────────────────────

DARK_BG   = "#0d1117"
DARK_GRID = "#21262d"
ACCENT1   = "#58a6ff"   # blue
ACCENT2   = "#f78166"   # red/orange
ACCENT3   = "#56d364"   # green
ACCENT4   = "#d2a8ff"   # purple
ACCENT5   = "#ffa657"   # amber
TEXT_CLR  = "#c9d1d9"


def build_dashboard(df: pd.DataFrame, results: dict,
                    eval_: dict, feature_cols: list) -> str:
    """
    Build a self-contained Plotly HTML dashboard with 8 panels.
    Returns the HTML string.
    """
    print("\n" + "=" * 60)
    print("STEP 5: Building interactive dashboard...")
    print("=" * 60)

    dates_oos = results["dates"]
    act       = results["actuals"]
    p_cj      = results["pred_cj"]
    p_en      = results["pred_enet"]

    rq_cj = rolling_qlike(act, p_cj)
    rq_en = rolling_qlike(act, p_en)

    # ── Layout: 4×2 grid ────────────────────────────────────
    fig = make_subplots(
        rows=4, cols=2,
        subplot_titles=[
            "1. Realized Volatility History (GK vs VIX, Annualized)",
            "2. Jump & Continuous Component Decomposition",
            "3. Model Comparison: Actual vs HAR-CJ vs HAR-X ElasticNet",
            "4. Rolling 63-Day QLIKE Loss",
            "5. Variance Risk Premium (VRP) with Vol Regime",
            "6. Feature Selection Frequency",
            "7. Coefficient Stability (ElasticNet Walk-Forward)",
            "8. Volatility Signature — GK RV at Different Horizons",
        ],
        vertical_spacing=0.09,
        horizontal_spacing=0.07,
        specs=[
            [{"type": "scatter"}, {"type": "scatter"}],
            [{"type": "scatter"}, {"type": "scatter"}],
            [{"type": "scatter"}, {"type": "bar"}],
            [{"type": "heatmap"},  {"type": "scatter"}],
        ],
    )

    # ── Panel 1: GK RV vs VIX ───────────────────────────────
    gk_ann = df["GK_RV"] * 100     # express as % vol
    vix_ts = df["VIX_raw"]

    fig.add_trace(go.Scatter(
        x=df.index, y=np.sqrt(gk_ann),
        name="GK RV (ann. vol %)", line=dict(color=ACCENT1, width=1.2),
        hovertemplate="%{x|%Y-%m-%d}<br>GK RV: %{y:.2f}%<extra></extra>",
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=df.index, y=vix_ts,
        name="VIX", line=dict(color=ACCENT2, width=1.2, dash="dot"),
        hovertemplate="%{x|%Y-%m-%d}<br>VIX: %{y:.2f}<extra></extra>",
    ), row=1, col=1)

    # ── Panel 2: Jump + Continuous stacked area ──────────────
    fig.add_trace(go.Scatter(
        x=df.index, y=df["C_raw"],
        name="Continuous C", fill="tozeroy",
        line=dict(color=ACCENT3, width=0),
        fillcolor="rgba(86,211,100,0.4)",
        hovertemplate="%{x|%Y-%m-%d}<br>C: %{y:.4f}<extra></extra>",
    ), row=1, col=2)
    fig.add_trace(go.Scatter(
        x=df.index, y=df["C_raw"] + df["J_raw"],
        name="+ Jump J", fill="tonexty",
        line=dict(color=ACCENT2, width=0),
        fillcolor="rgba(247,129,102,0.5)",
        hovertemplate="%{x|%Y-%m-%d}<br>C+J: %{y:.4f}<extra></extra>",
    ), row=1, col=2)

    # ── Panel 3: Model comparison (OOS only) ─────────────────
    fig.add_trace(go.Scatter(
        x=dates_oos, y=act,
        name="Actual RV", line=dict(color=TEXT_CLR, width=1.0),
        hovertemplate="%{x|%Y-%m-%d}<br>Actual: %{y:.4f}<extra></extra>",
    ), row=2, col=1)
    fig.add_trace(go.Scatter(
        x=dates_oos, y=p_cj,
        name="HAR-CJ", line=dict(color=ACCENT4, width=1.0, dash="dash"),
        hovertemplate="%{x|%Y-%m-%d}<br>HAR-CJ: %{y:.4f}<extra></extra>",
    ), row=2, col=1)
    fig.add_trace(go.Scatter(
        x=dates_oos, y=p_en,
        name="HAR-X ElasticNet", line=dict(color=ACCENT5, width=1.5),
        hovertemplate="%{x|%Y-%m-%d}<br>EN: %{y:.4f}<extra></extra>",
    ), row=2, col=1)

    # ── Panel 4: Rolling QLIKE ───────────────────────────────
    fig.add_trace(go.Scatter(
        x=dates_oos, y=rq_cj,
        name="QLIKE HAR-CJ", line=dict(color=ACCENT4, width=1.2),
        hovertemplate="%{x|%Y-%m-%d}<br>QLIKE CJ: %{y:.4f}<extra></extra>",
    ), row=2, col=2)
    fig.add_trace(go.Scatter(
        x=dates_oos, y=rq_en,
        name="QLIKE EN", line=dict(color=ACCENT5, width=1.5),
        hovertemplate="%{x|%Y-%m-%d}<br>QLIKE EN: %{y:.4f}<extra></extra>",
    ), row=2, col=2)

    # ── Panel 5: VRP with vol regime ─────────────────────────
    vrp_ts = df["VRP_raw"]
    high_vol = np.sqrt(df["GK_RV"]) * np.sqrt(TRADING_DAYS) > 0.20  # >20% ann vol

    fig.add_trace(go.Scatter(
        x=df.index, y=vrp_ts,
        name="VRP (daily)", line=dict(color=ACCENT1, width=1.0),
        hovertemplate="%{x|%Y-%m-%d}<br>VRP: %{y:.4f}<extra></extra>",
    ), row=3, col=1)
    # Add zero line
    fig.add_hline(y=0, line=dict(color=TEXT_CLR, dash="dot", width=0.8), row=3, col=1)

    # ── Panel 6: Feature selection bar ───────────────────────
    sel_freq = eval_["sel_freq"]
    feat_sorted = sorted(sel_freq, key=sel_freq.get, reverse=True)[:20]
    colors_bar  = [ACCENT5 if f in eval_["top5"] else ACCENT1
                   for f in feat_sorted]
    fig.add_trace(go.Bar(
        x=[sel_freq[f] for f in feat_sorted],
        y=feat_sorted,
        orientation="h",
        name="Selection Freq",
        marker=dict(color=colors_bar),
        hovertemplate="%{y}<br>Freq: %{x:.1%}<extra></extra>",
    ), row=3, col=2)

    # ── Panel 7: Coefficient heatmap ─────────────────────────
    coef_hist = results["coef_history"]
    win_labels = [str(h["window_end"].date()) for h in coef_hist]
    # Top 15 features by avg abs coef
    all_coefs_df = pd.DataFrame(
        [h["coefs"] for h in coef_hist],
        index=win_labels
    ).fillna(0)
    avg_abs = all_coefs_df.abs().mean().sort_values(ascending=False)
    top15   = avg_abs.head(15).index.tolist()
    hmap    = all_coefs_df[top15].T

    fig.add_trace(go.Heatmap(
        z=hmap.values,
        x=win_labels[::max(1, len(win_labels)//15)],
        y=top15,
        colorscale="RdBu",
        zmid=0,
        name="Coef Stability",
        hovertemplate="Feature: %{y}<br>Window: %{x}<br>Coef: %{z:.4f}<extra></extra>",
    ), row=4, col=1)

    # ── Panel 8: Volatility signature plot ────────────────────
    horizons = [1, 5, 10, 22, 63]
    sig_vals  = []
    for h in horizons:
        rv_h = df["GK_RV"].rolling(h).mean().dropna()
        sig_vals.append(np.sqrt(rv_h.mean() * TRADING_DAYS) * 100)

    fig.add_trace(go.Scatter(
        x=horizons, y=sig_vals,
        mode="lines+markers",
        name="Vol Signature",
        line=dict(color=ACCENT3, width=2),
        marker=dict(size=8, color=ACCENT3),
        hovertemplate="Horizon: %{x}d<br>Ann. Vol: %{y:.2f}%<extra></extra>",
    ), row=4, col=2)
    fig.update_xaxes(title_text="Horizon (trading days)", row=4, col=2)
    fig.update_yaxes(title_text="Ann. Vol (%)", row=4, col=2)

    # ── Global layout ─────────────────────────────────────────
    ann_text = (
        f"<b>OOS Results</b> | "
        f"HAR-CJ QLIKE={eval_['HAR_CJ']['QLIKE']:.4f} | "
        f"EN QLIKE={eval_['HAR_X_EN']['QLIKE']:.4f} | "
        f"EN R²oos={eval_['HAR_X_EN']['R2oos']:.4f} | "
        f"DM p={eval_['DM_test']['p_value']:.4f} | "
        f"Top features: {', '.join(eval_['top5'][:3])}"
    )

    fig.update_layout(
        title=dict(
            text=(
                "HAR-X LASSO/ElasticNet — SPX Volatility Forecasting Dashboard<br>"
                f"<sup>{ann_text}</sup>"
            ),
            font=dict(size=16, color=TEXT_CLR),
            x=0.5,
        ),
        paper_bgcolor=DARK_BG,
        plot_bgcolor=DARK_BG,
        font=dict(color=TEXT_CLR, family="Courier New, monospace", size=11),
        height=1800,
        showlegend=True,
        legend=dict(
            bgcolor="rgba(13,17,23,0.8)",
            bordercolor=DARK_GRID,
            borderwidth=1,
            font=dict(size=10),
        ),
        hovermode="x unified",
    )

    # Style all axes
    for axis in list(fig.layout) :
        if axis.startswith("xaxis") or axis.startswith("yaxis"):
            fig.layout[axis].update(
                gridcolor=DARK_GRID,
                zerolinecolor=DARK_GRID,
                tickfont=dict(color=TEXT_CLR),
                title_font=dict(color=TEXT_CLR),
            )

    # Style subplot titles
    for ann in fig.layout.annotations:
        ann.update(font=dict(color=ACCENT1, size=12))

    html = pio.to_html(fig, full_html=True, include_plotlyjs=True)
    print("  Dashboard built.")
    return html


# ─────────────────────────────────────────────────────────────
# 10. SUMMARY PRINTER
# ─────────────────────────────────────────────────────────────

def print_summary(eval_: dict) -> None:
    """Print final results table to stdout."""
    W = 57
    print("\n" + "═" * W)
    print(" HAR-X LASSO MODEL — OUT-OF-SAMPLE RESULTS")
    print("═" * W)
    header = f" {'Model':<22} {'MSE':>7} {'MAE':>7} {'QLIKE':>7} {'R²oos':>7}"
    print(header)
    print("─" * W)

    rows = [
        ("HAR-CJ (base)",    eval_["HAR_CJ"]),
        ("HAR-X OLS",        eval_["HAR_X_OLS"]),
        ("HAR-X ElasticNet", eval_["HAR_X_EN"]),
    ]
    for name, m in rows:
        print(f" {name:<22} {m['MSE']:>7.4f} {m['MAE']:>7.4f} "
              f"{m['QLIKE']:>7.4f} {m['R2oos']:>7.4f}")

    print("─" * W)
    dm = eval_["DM_test"]
    print(f" Diebold-Mariano (CJ vs EN): stat={dm['DM_stat']:+.3f} | "
          f"p={dm['p_value']:.4f}")
    mz = eval_["MZ_enet"]
    print(f" MZ test (EN):  α={mz['alpha']:.4f} | β={mz['beta']:.4f} | "
          f"R²={mz['R2']:.4f} | p={mz['MZ_pval']:.4f}")
    print("─" * W)
    print(f" Top selected features:  {eval_['top5']}")
    print(f" Best l1_ratio (median): {eval_['best_l1']:.2f}")
    print(f" Best alpha (median):    {eval_['best_alpha']:.4f}")
    print("═" * W)


# ─────────────────────────────────────────────────────────────
# 11. MAIN
# ─────────────────────────────────────────────────────────────

def main():
    print("\n" + "█" * 60)
    print("  HAR-X LASSO/ElasticNet Volatility Forecasting System")
    print("  S&P 500 | OHLC Proxy RV | Walk-Forward OOS Evaluation")
    print("█" * 60 + "\n")

    # 1. Data
    raw = fetch_data(TICKERS, START_DATE, END_DATE)
    if "SPY" not in raw:
        print("FATAL: SPY data unavailable. Exiting.")
        sys.exit(1)

    # 2. Features
    df, feature_cols = build_features(raw)

    # 3. Walk-forward
    results = walk_forward(df, feature_cols)

    # 4. Metrics
    eval_ = evaluate_results(results)

    # 5. Dashboard
    html = build_dashboard(df, results, eval_, feature_cols)

    out_path = os.path.join(os.getcwd(), OUTPUT_FILE)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\n  Dashboard saved → {out_path}")

    # 6. Summary
    print_summary(eval_)

    print(f"\n  Done. Open '{OUTPUT_FILE}' in any browser.\n")


if __name__ == "__main__":
    main()
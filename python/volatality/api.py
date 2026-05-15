"""
api.py  —  Volatility Engine API
=================================
Endpoints for HAR-RV forecasting, HMM Market Regime Detection,
Markov-Switching AR (MSAR) analysis, HAR-CJ Volatility Forecasting,
Kalman HAR-RV-CJ adaptive volatility engine, and LightGBM Regime Classifier.
Runs on port 8006.

Available endpoints:
  POST /api/vol/har            — standalone HAR-RV forecast (from synthetic or real RV)
  POST /api/vol/hmm            — HMM regime detection (needs returns + avg_corr)
  POST /api/vol/combined       — full pipeline: HAR-RV -> HMM (4-feature mode)
  POST /api/vol/msar           — full MSAR analysis (regime + sizing + VaR + forecast)
  POST /api/vol/msar/forecast  — lightweight MSAR regime forecast only
  POST /api/vol/har-cj         — HAR-CJ volatility decomposition + OLS forecast
  POST /api/vol/har-kalman     -- Kalman HAR-RV-CJ with time-varying betas
  POST /api/vol/hybrid-arbitrage -- Hybrid AI-Quant Volatility Arbitrage Engine
  POST /api/vol/lgbm-regime    -- LightGBM Intraday Regime Classifier (Vanna/Charm/VIX TS)
  GET  /api/vol/health         -- health check
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, timezone
from typing import Optional

from hmm_har_volatility import (
    HARRVModel,
    run_har_rv_model,
    run_hmm_model,
    run_combined,
)
from msar import MSARModel, run_msar_model
from har_cj_model import run_har_cj_model
from har_kalman_model import run_kalman_har_cj

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ml_models.hybrid_engine import HybridArbitrageEngine

# LightGBM regime classifier (lazy-loaded)
try:
    from lightgbm_vol import (
        build_features, label_regime, train_model,
        predict_regime, strategy_router, compute_shap_importance,
        REGIME_NAMES, STRATEGY_MAP, REGIME_COLORS,
        DEFAULT_LGBM_PARAMS,
    )
    LGBM_AVAILABLE = True
except ImportError:
    LGBM_AVAILABLE = False

# Singleton engine (caches LSTM model in memory)
_hybrid_engine = HybridArbitrageEngine()

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Volatility Engine API",
    description="HAR-RV + HMM Market Regime Detection",
    version="1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request/Response models ───────────────────────────────────────────────────

class HARRequest(BaseModel):
    ticker: str
    period: str = "2y"          # yfinance period string
    interval: str = "1d"


class HMMRequest(BaseModel):
    tickers: list[str]
    period: str = "2y"
    interval: str = "1d"
    use_har_in_hmm: bool = True


class CombinedRequest(BaseModel):
    tickers: list[str]
    rv_ticker: Optional[str] = None   # which ticker to use as RV proxy (default: first)
    period: str = "2y"
    interval: str = "1d"
    use_har_in_hmm: bool = True


class MSARRequest(BaseModel):
    ticker: str
    period: str = "2y"
    interval: str = "1d"
    k_regimes: int = 2
    ar_order: int = 2
    forecast_days: int = 10
    var_confidence: list[float] = [0.95, 0.99]


class MSARForecastRequest(BaseModel):
    ticker: str
    period: str = "2y"
    interval: str = "1d"
    k_regimes: int = 2
    ar_order: int = 2
    forecast_days: int = 10


class HARCJRequest(BaseModel):
    ticker: str = "SPY"
    period: str = "2y"
    include_cross_asset: bool = True
    k_regimes: int = 2
    ar_order: int = 2
    forecast_days: int = 10


class KalmanHARCJRequest(BaseModel):
    ticker: str = "SPY"
    period: str = "730d"        # needs long history for intraday decomposition
    lookback: int = 120         # days shown in time-series output
    obs_noise: float = 0.01
    trans_noise: float = 1e-4


class HybridArbRequest(BaseModel):
    ticker: str = "SPY"


class LGBMRegimeRequest(BaseModel):
    ticker: str = "SPY"
    period: str = "60d"          # yfinance period for 5-min data
    interval: str = "5m"         # must be 5m for intraday features
    confidence_threshold: float = 0.60
    high_conf_threshold: float  = 0.80
    top_n_shap: int = 10         # number of SHAP features to return


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_prices(tickers: list[str], period: str, interval: str) -> pd.DataFrame:
    """Download OHLCV from yfinance and return a Close price DataFrame."""
    raw = yf.download(tickers, period=period, interval=interval, progress=False, auto_adjust=True)
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"]
    else:
        close = raw[["Close"]] if len(tickers) == 1 else raw
    if isinstance(close, pd.Series):
        close = close.to_frame(name=tickers[0])
    close.dropna(how="all", inplace=True)
    return close


def _build_rv_series(close: pd.DataFrame, ticker: str) -> pd.Series:
    """
    Build a Realized Volatility proxy from close prices:
      RV_t = |log(P_t / P_{t-1})|   (absolute log-return, daily)
    """
    log_ret = np.log(close[ticker] / close[ticker].shift(1)).dropna()
    rv = log_ret.abs()
    rv.name = "RV"
    return rv


def _build_returns_series(close: pd.DataFrame, tickers: list[str]) -> pd.Series:
    """Portfolio-mean log-return series."""
    log_rets = np.log(close[tickers] / close[tickers].shift(1)).dropna()
    return log_rets.mean(axis=1).rename("Mean_Return")


def _build_avg_corr_series(close: pd.DataFrame, tickers: list[str], window: int = 22) -> pd.Series:
    """
    Rolling average pairwise correlation as a DCC avg_corr proxy.
    If only one ticker → constant 0.5.
    """
    log_rets = np.log(close[tickers] / close[tickers].shift(1)).dropna()
    if len(tickers) == 1:
        return pd.Series(0.5, index=log_rets.index, name="Avg_Corr")
    rolling_corr = log_rets.rolling(window).corr()
    avg = rolling_corr.groupby(level=0).mean().mean(axis=1).rename("Avg_Corr")
    # Clip to valid correlation range
    avg = avg.clip(-1, 1).dropna()
    return avg


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/vol/health")
async def health():
    return {"status": "ok", "service": "Volatility Engine API", "port": 8006}


@app.post("/api/vol/har")
async def har_endpoint(req: HARRequest):
    """
    Fit HAR-RV model on a single ticker's price history.

    Returns: fitted values, next-bar RV forecast, OLS params, R^2.
    """
    try:
        close = _fetch_prices([req.ticker], req.period, req.interval)
        if close.empty or req.ticker not in close.columns:
            raise HTTPException(status_code=404, detail=f"No data for ticker: {req.ticker}")

        rv_series = _build_rv_series(close, req.ticker)
        if len(rv_series) < 30:
            raise HTTPException(status_code=400, detail="Not enough price history for HAR-RV (need >= 30 bars).")

        result = run_har_rv_model(rv_series)
        return {"status": "success", "ticker": req.ticker, "har_rv": result}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"HAR-RV error: {str(e)}")


@app.post("/api/vol/hmm")
async def hmm_endpoint(req: HMMRequest):
    """
    Run HMM regime detection on a portfolio of tickers.
    Uses rolling pairwise correlation as avg_corr proxy (no DCC-GARCH needed).

    Optionally injects HAR-RV fitted values as a 4th feature (use_har_in_hmm=True).
    """
    try:
        if len(req.tickers) < 1:
            raise HTTPException(status_code=400, detail="At least 1 ticker required.")

        close = _fetch_prices(req.tickers, req.period, req.interval)
        valid_tickers = [t for t in req.tickers if t in close.columns]
        if not valid_tickers:
            raise HTTPException(status_code=404, detail="No valid tickers found.")

        returns_series  = _build_returns_series(close, valid_tickers)
        avg_corr_series = _build_avg_corr_series(close, valid_tickers)

        # Align
        common = returns_series.index.intersection(avg_corr_series.index)
        returns_series  = returns_series.loc[common]
        avg_corr_series = avg_corr_series.loc[common]

        # Optional: HAR-RV on the first ticker as extra feature
        har_rv_series = None
        if req.use_har_in_hmm:
            try:
                rv_s = _build_rv_series(close, valid_tickers[0])
                har_model = HARRVModel()
                har_rv_series = har_model.get_forecast_series(rv_s)
            except Exception:
                har_rv_series = None   # non-fatal degradation

        hmm_result = run_hmm_model(
            returns_series=returns_series,
            avg_corr_series=avg_corr_series,
            tickers=valid_tickers,
            har_rv_series=har_rv_series,
        )
        # Trim timeseries to last 500 bars
        hmm_result["state_series"] = hmm_result["state_series"][-500:]

        return {
            "status": "success",
            "tickers": valid_tickers,
            "hmm": hmm_result,
        }

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"HMM error: {str(e)}")


@app.post("/api/vol/combined")
async def combined_endpoint(req: CombinedRequest):
    """
    Full combined pipeline: HAR-RV -> HMM (4-feature mode by default).

    - HAR-RV is fit on the RV proxy of rv_ticker (defaults to first ticker).
    - HMM uses portfolio mean return + rolling avg_corr + optionally HAR-RV.
    - Returns both har_rv and hmm sub-results plus a meta summary.
    """
    try:
        if len(req.tickers) < 1:
            raise HTTPException(status_code=400, detail="At least 1 ticker required.")

        close = _fetch_prices(req.tickers, req.period, req.interval)
        valid_tickers = [t for t in req.tickers if t in close.columns]
        if not valid_tickers:
            raise HTTPException(status_code=404, detail="No valid tickers found.")

        rv_ticker = req.rv_ticker if req.rv_ticker in valid_tickers else valid_tickers[0]

        rv_series       = _build_rv_series(close, rv_ticker)
        returns_series  = _build_returns_series(close, valid_tickers)
        avg_corr_series = _build_avg_corr_series(close, valid_tickers)

        # Align all three
        common = (
            rv_series.dropna().index
            .intersection(returns_series.dropna().index)
            .intersection(avg_corr_series.dropna().index)
        )
        rv_series       = rv_series.loc[common]
        returns_series  = returns_series.loc[common]
        avg_corr_series = avg_corr_series.loc[common]

        if len(rv_series) < 30:
            raise HTTPException(status_code=400, detail="Not enough aligned data (need >= 30 bars).")

        result = run_combined(
            rv_series=rv_series,
            returns_series=returns_series,
            avg_corr_series=avg_corr_series,
            tickers=valid_tickers,
            use_har_in_hmm=req.use_har_in_hmm,
        )

        # Trim state_series
        result["hmm"]["state_series"] = result["hmm"]["state_series"][-500:]

        return {
            "status": "success",
            "tickers": valid_tickers,
            "rv_ticker": rv_ticker,
            **result,
        }

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Combined pipeline error: {str(e)}")


# ── MSAR Endpoints ────────────────────────────────────────────────────────────

@app.post("/api/vol/msar")
async def msar_endpoint(req: MSARRequest):
    """
    Full MSAR analysis: MS(K)-AR(p) regime detection, position sizing,
    VaR/CVaR, filtered probabilities, and multi-step forecast.
    """
    try:
        close = _fetch_prices([req.ticker], req.period, req.interval)
        if close.empty or req.ticker not in close.columns:
            raise HTTPException(status_code=404, detail=f"No data for ticker: {req.ticker}")

        # Build log-returns in percent
        prices = close[req.ticker].dropna()
        returns = np.log(prices / prices.shift(1)).dropna() * 100

        if len(returns) < 50:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough data for MSAR (got {len(returns)}, need >= 50 bars).",
            )

        last_price = float(prices.iloc[-1])

        result = run_msar_model(
            returns=returns,
            k_regimes=req.k_regimes,
            ar_order=req.ar_order,
            var_confidence=req.var_confidence,
            forecast_days=req.forecast_days,
            last_price=last_price,
        )

        return {
            "status": "success",
            "ticker": req.ticker,
            "last_price": last_price,
            **result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MSAR error: {str(e)}")


@app.post("/api/vol/msar/forecast")
async def msar_forecast_endpoint(req: MSARForecastRequest):
    """
    Lightweight MSAR endpoint — returns only regime forecast and price cone.
    Faster than full /api/vol/msar because it skips detailed filtered probs.
    """
    try:
        close = _fetch_prices([req.ticker], req.period, req.interval)
        if close.empty or req.ticker not in close.columns:
            raise HTTPException(status_code=404, detail=f"No data for ticker: {req.ticker}")

        prices = close[req.ticker].dropna()
        returns = np.log(prices / prices.shift(1)).dropna() * 100

        if len(returns) < 50:
            raise HTTPException(
                status_code=400,
                detail=f"Not enough data for MSAR forecast (got {len(returns)}, need >= 50).",
            )

        last_price = float(prices.iloc[-1])

        model = MSARModel(k_regimes=req.k_regimes, ar_order=req.ar_order)
        fit_result = model.fit(returns)
        forecast_result = model.forecast(n_days=req.forecast_days, last_price=last_price)

        return {
            "status": "success",
            "ticker": req.ticker,
            "last_price": last_price,
            "current_regime": fit_result["current_regime"],
            "forecast": forecast_result,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MSAR forecast error: {str(e)}")


# ── HAR-CJ Endpoint ───────────────────────────────────────────────────────────

@app.post("/api/vol/har-cj")
async def har_cj_endpoint(req: HARCJRequest):
    """
    HAR-CJ Volatility Forecasting.
    Returns Garman-Klass RV decomposition (Jump + Continuous),
    HAR-CJ OLS model coefficients, R², and next-day RV forecast.
    Optionally includes cross-asset features (VIX, VRP, TLT, HYG, DXY).
    """
    try:
        result = run_har_cj_model(
            ticker=req.ticker,
            period=req.period,
            include_cross_asset=req.include_cross_asset,
        )
        return {
            "status": "success",
            "ticker": req.ticker,
            **result,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"HAR-CJ error: {str(e)}")


# ── Kalman HAR-CJ Endpoint ────────────────────────────────────────────────────

@app.post("/api/vol/har-kalman")
async def kalman_har_cj_endpoint(req: KalmanHARCJRequest):
    """
    Kalman HAR-RV-CJ Volatility Engine.
    State-space model with time-varying betas that adaptively tracks
    continuous vs jump volatility regimes.

    Returns: forecast, metrics, vol time-series, dynamic betas, calibration table.
    """
    try:
        result = run_kalman_har_cj(
            ticker=req.ticker,
            period=req.period,
            lookback=req.lookback,
            obs_noise=req.obs_noise,
            trans_noise=req.trans_noise,
        )
        return {
            "status": "success",
            "ticker": req.ticker,
            **result,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Kalman HAR-CJ error: {str(e)}")


# -- Hybrid AI-Quant Volatility Arbitrage Endpoint --------------------------

@app.post("/api/vol/hybrid-arbitrage")
async def hybrid_arbitrage_endpoint(req: HybridArbRequest):
    """
    Hybrid AI-Quant Volatility Arbitrage Engine.
    Combines LSTM volatility prediction with BSM pricing to find
    mispriced options and calculate delta-neutral hedging actions.

    Requires pre-trained LSTM model for the requested ticker.
    Train first: uv run python -m ml_models.train_lstm --ticker <TICKER>
    """
    try:
        result = _hybrid_engine.scan(ticker=req.ticker)
        return result
    except FileNotFoundError as fe:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Model not trained for '{req.ticker}'. "
                f"Run: uv run python -m ml_models.train_lstm --ticker {req.ticker}"
            ),
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hybrid Arb error: {str(e)}")


# ── LightGBM Regime Classifier Endpoint ──────────────────────────────────────

@app.post("/api/vol/lgbm-regime")
async def lgbm_regime_endpoint(req: LGBMRegimeRequest):
    """
    LightGBM Intraday Regime Classifier.
    Downloads 5-minute OHLCV from yfinance, builds 53-feature matrix
    (price/vol + microstructure + Vanna/Charm + VIX term structure + calendar),
    trains walk-forward LightGBM, and returns:
      - Current regime prediction + probabilities
      - Strategy signal + conviction + position size
      - SHAP feature importance (top N)
      - VIX term structure snapshot
      - Regime distribution over history
    """
    if not LGBM_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="LightGBM not installed. Run: uv pip install lightgbm scikit-learn shap"
        )

    try:
        # ── 1. Fetch intraday OHLCV ─────────────────────────────────
        raw = yf.download(
            req.ticker,
            period=req.period,
            interval=req.interval,
            progress=False,
            auto_adjust=True,
        )
        if raw.empty:
            raise HTTPException(status_code=404, detail=f"No 5-min data for '{req.ticker}'")

        # Flatten multi-index if present
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.get_level_values(0)
        raw.columns = raw.columns.str.lower()

        required = {"open", "high", "low", "close", "volume"}
        if not required.issubset(raw.columns):
            raise HTTPException(status_code=400, detail=f"OHLCV columns missing: {required - set(raw.columns)}")

        ohlcv = raw[["open", "high", "low", "close", "volume"]].dropna()

        if len(ohlcv) < 500:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(ohlcv)} bars available — need ≥500. Try a longer period."
            )

        # ── 2. Fetch VIX term structure from yfinance ───────────────
        vix_tickers = ["^VIX9D", "^VIX", "^VIX3M", "^VIX6M"]
        try:
            vix_raw = yf.download(
                vix_tickers,
                period=req.period,
                interval="5m",
                progress=False,
                auto_adjust=True,
            )
            if isinstance(vix_raw.columns, pd.MultiIndex):
                vix_close = vix_raw["Close"].copy()
                vix_close = vix_close.rename(columns={
                    "^VIX": "vix_spot",
                    "^VIX3M": "vix3m",
                    "^VIX6M": "vix6m",
                    "^VIX9D": "vix9d"
                })
            else:
                vix_close = None
        except Exception:
            vix_close = None

        # Build options_data stub with VIX term structure
        options_data = None
        vix_snapshot = {}
        if vix_close is not None and not vix_close.empty:
            vix_close = vix_close.reindex(ohlcv.index).ffill().bfill()
            options_data = pd.DataFrame({
                "atm_iv":         float("nan"),
                "skew_25d":       0.0,
                "term_slope":     0.0,
                "gex":            0.0,
                "put_call_ratio": 0.85,
                "vanna_exposure": 0.0,
                "charm_exposure": 0.0,
                "vix_spot":       vix_close.get("vix_spot", pd.Series(20.0, index=ohlcv.index)),
                "vix9d":          vix_close.get("vix9d",   pd.Series(19.0, index=ohlcv.index)),
                "vix3m":          vix_close.get("vix3m",   pd.Series(21.0, index=ohlcv.index)),
                "vix6m":          vix_close.get("vix6m",   pd.Series(22.0, index=ohlcv.index)),
            }, index=ohlcv.index)
            options_data["atm_iv"] = 0.20  # placeholder

            # VIX snapshot (latest bar)
            last = vix_close.iloc[-1]
            vix_s   = float(last.get("vix_spot", 20))
            vix_3m  = float(last.get("vix3m",   21))
            vix_9d  = float(last.get("vix9d",   19))
            vix_6m  = float(last.get("vix6m",   22))
            vix_snapshot = {
                "vix9d":          round(vix_9d, 2),
                "vix_spot":       round(vix_s,  2),
                "vix3m":          round(vix_3m, 2),
                "vix6m":          round(vix_6m, 2),
                "vix9d_vix":      round(vix_9d / vix_s,  3) if vix_s else None,
                "vix_vix3m":      round(vix_s  / vix_3m, 3) if vix_3m else None,
                "vix_curve_slope": round(vix_6m - vix_9d, 2),
                "backwardation":  bool(vix_s > vix_3m),
            }
        else:
            vix_snapshot = {"error": "VIX term structure unavailable"}

        # ── 3. Build features ────────────────────────────────────────
        X_full = build_features(ohlcv, options_data)

        # ── 4. Label regimes ─────────────────────────────────────────
        # Compute full log_ret from raw ohlcv, then label, then align
        log_ret = np.log(ohlcv["close"] / ohlcv["close"].shift(1)).dropna()
        y_full  = label_regime(log_ret)
        common  = X_full.index.intersection(y_full.index)
        X_full  = X_full.loc[common]
        y_full  = y_full.loc[common]

        if len(X_full) < 200:
            raise HTTPException(status_code=400, detail="Not enough aligned bars after feature engineering.")

        # Regime distribution
        regime_dist = {
            REGIME_NAMES[r]: int(cnt)
            for r, cnt in y_full.value_counts().sort_index().items()
        }
        total_bars = len(y_full)
        regime_pct  = {
            REGIME_NAMES[r]: round(int(cnt) / total_bars * 100, 1)
            for r, cnt in y_full.value_counts().sort_index().items()
        }

        # ── 5. Train model ───────────────────────────────────────────
        # Use smaller n_splits for speed on intraday data
        n_splits = min(3, max(2, len(X_full) // 1000))
        model, cv_results = train_model(
            X_full, y_full,
            params=DEFAULT_LGBM_PARAMS.copy(),
            n_splits=n_splits,
            gap=48,
        )

        cv_accuracy    = float(np.mean(cv_results["fold_scores"]))
        cv_accuracy_std = float(np.std(cv_results["fold_scores"]))
        fold_scores    = [round(float(s), 4) for s in cv_results["fold_scores"]]

        # ── 6. Predict on last bar ───────────────────────────────────
        X_last  = X_full.iloc[[-1]]
        pred_df = predict_regime(model, X_last, threshold=req.confidence_threshold)
        latest  = pred_df.iloc[-1]

        dominant = int(latest["dominant_regime"])
        filtered = int(latest["filtered_regime"])
        conf     = float(latest["confidence"])

        signal_dict = strategy_router(
            regime=filtered,
            confidence=conf,
            confidence_threshold=req.confidence_threshold,
            high_conf_threshold=req.high_conf_threshold,
        )

        # Regime probabilities
        probs = {
            REGIME_NAMES[i]: round(float(latest[f"prob_{i}"]), 4)
            for i in range(4)
        }

        # ── 7. SHAP importance ───────────────────────────────────────
        shap_importance = []
        try:
            shap_df = compute_shap_importance(model, X_full.iloc[-300:], max_samples=150)
            if shap_df is not None:
                shap_importance = [
                    {"feature": row["feature"], "importance": round(float(row["mean_abs_shap"]), 6)}
                    for _, row in shap_df.head(req.top_n_shap).iterrows()
                ]
        except Exception:
            shap_importance = []

        # ── 8. Recent regime history (last 78 bars = 1 session) ──────
        X_recent  = X_full.iloc[-78:]
        pred_hist = predict_regime(model, X_recent, threshold=req.confidence_threshold)
        regime_history = [
            {
                "timestamp": str(ts),
                "regime":    REGIME_NAMES[int(r)],
                "regime_id": int(r),
                "confidence": round(float(c), 4),
            }
            for ts, r, c in zip(
                pred_hist.index,
                pred_hist["filtered_regime"],
                pred_hist["confidence"],
            )
        ]

        return {
            "status":           "success",
            "ticker":           req.ticker,
            "timestamp":        str(ohlcv.index[-1]),
            "total_bars":       total_bars,
            "n_features":       X_full.shape[1],
            # Current prediction
            "current_regime":        REGIME_NAMES[filtered],
            "current_regime_id":     filtered,
            "dominant_regime":       REGIME_NAMES[dominant],
            "confidence":            round(conf, 4),
            "high_confidence":       bool(latest["high_confidence"]),
            "regime_probabilities":  probs,
            # Strategy signal
            "signal":           signal_dict["signal"],
            "conviction":       signal_dict["conviction"],
            "position_size":    signal_dict["position_size"],
            "signal_notes":     signal_dict["notes"],
            # Model performance
            "cv_accuracy":      round(cv_accuracy, 4),
            "cv_accuracy_std":  round(cv_accuracy_std, 4),
            "fold_scores":      fold_scores,
            # Distribution
            "regime_distribution": regime_dist,
            "regime_pct":          regime_pct,
            # VIX term structure
            "vix_term_structure": vix_snapshot,
            # Feature importance
            "shap_importance":  shap_importance,
            # History (last session)
            "regime_history":   regime_history,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LightGBM regime error: {str(e)}")


# -- Entry point ------------------------------------------------------------────

if __name__ == "__main__":
    print("Starting Volatility Engine API on port 8006...")
    uvicorn.run("api:app", host="0.0.0.0", port=8006, reload=True)

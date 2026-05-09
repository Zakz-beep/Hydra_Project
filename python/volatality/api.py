"""
api.py  —  Volatility Engine API
=================================
Endpoints for HAR-RV forecasting, HMM Market Regime Detection,
Markov-Switching AR (MSAR) analysis, HAR-CJ Volatility Forecasting,
and Kalman HAR-RV-CJ adaptive volatility engine.
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


# -- Entry point ------------------------------------------------------------────

if __name__ == "__main__":
    print("Starting Volatility Engine API on port 8006...")
    uvicorn.run("api:app", host="0.0.0.0", port=8006, reload=True)

"""
api.py  —  Volatility Engine API
=================================
Endpoints for HAR-RV forecasting and HMM Market Regime Detection.
Runs on port 8006.

Available endpoints:
  POST /api/vol/har          — standalone HAR-RV forecast (from synthetic or real RV)
  POST /api/vol/hmm          — HMM regime detection (needs returns + avg_corr)
  POST /api/vol/combined     — full pipeline: HAR-RV -> HMM (4-feature mode)
  GET  /api/vol/health       — health check
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


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Starting Volatility Engine API on port 8006...")
    uvicorn.run("api:app", host="0.0.0.0", port=8006, reload=True)

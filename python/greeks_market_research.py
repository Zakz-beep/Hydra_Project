"""Dated ETF holdings/returns and SPX realized variance research endpoints."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import threading
import time
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from greeks_research_math import daily_close, exposure_summary, holdings_rows, relative_metrics, rv_vix_history

ETFS = ("SPY", "QQQ", "IWM", "DIA", "XLK", "SMH", "XLF", "XLE")
_cache, _locks, _guard = {}, {}, threading.Lock()


def cached(key, loader, ttl=900):
    with _guard:
        lock = _locks.setdefault(key, threading.Lock())
    with lock:
        entry = _cache.get(key)
        if entry and time.time() - entry[0] < ttl:
            return entry[1]
        value = loader()
        _cache[key] = (time.time(), value)
        return value


def close_history(symbol, adjusted=False, period="2y"):
    frame = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=adjusted,
                                      actions=False, raise_errors=True, timeout=12)
    if frame.empty or "Close" not in frame:
        raise ValueError(f"Daily closes unavailable for {symbol}.")
    series = daily_close(frame.Close)
    # Conservatively exclude the current US date, including partially formed daily bars.
    today = pd.Timestamp.now(tz="America/New_York").tz_localize(None).normalize()
    return series.loc[series.index < today]


def volatility_research():
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(close_history, "^GSPC")
        b = pool.submit(close_history, "^VIX")
        spx, vix = a.result(), b.result()
    result = rv_vix_history(spx, vix)
    result.update({"retrieved_at": datetime.now(timezone.utc).isoformat(), "source": "Yahoo Finance daily closes",
                   "underlying": "S&P 500 price index (^GSPC)", "implied": "Cboe VIX (^VIX), from SPX options",
                   "horizon_days": 30, "annual_days": 365,
                   "spx_last_date": str(spx.index[-1].date()), "vix_last_date": str(vix.index[-1].date()),
                   "method": "Daily-close realized variance proxy: sum of squared log returns with close dates inside (t−30d,t], annualized by 365/30. No mean subtraction.",
                   "limitations": [
                       "Daily sampling is a proxy, not continuous/intraday realized variance or a replicating variance-swap payoff. Boundary close-to-close returns are not split.",
                       "Historical RV looks backward; VIX looks forward. Only the matured forward comparison evaluates subsequent outcomes.",
                       "Missing prices or gaps longer than four calendar days invalidate affected RV windows; no price forward fill.",
                       "Current US-date bars are excluded. Same-date VIX and SPX closes can have different publication times; this is an end-of-day comparison, not an executable spread.",
                       "Forward evaluation windows overlap. Sample counts are not independent observations and the gap is not strategy P&L.",
                   ]})
    return result


def constituent_research(etf, window):
    holdings = holdings_rows(yf.Ticker(etf).funds_data.top_holdings)
    parent = close_history(etf, adjusted=True, period="1y")

    def measure(row):
        try:
            prices = close_history(row["symbol"], adjusted=True, period="1y")
            return {**row, **relative_metrics(parent, prices, window), "error": None}
        except Exception:
            return {**row, "beta": None, "correlation": None, "relative_return_20": None,
                    "samples": 0, "asof": None, "error": "Stock price history unavailable; metrics omitted."}

    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = list(pool.map(measure, holdings))
    return {"etf": etf, "rows": rows, "coverage": sum(r["weight"] for r in rows),
            "window": window, "price_asof": str(parent.index[-1].date()),
            "retrieved_at": datetime.now(timezone.utc).isoformat(), "holdings_asof": None,
            "source": "Yahoo Finance fund top holdings and adjusted daily closes",
            "note": "Top holdings only; provider does not supply a holdings effective date here. Retrieval time is not the portfolio as-of date. Beta/correlation are descriptive, not causal transmission estimates."}


def create_research_router(snapshot_loader):
    router = APIRouter(prefix="/api/greeks", tags=["Market research"])

    @router.get("/rv-vix")
    def get_rv_vix():
        try:
            return cached("rv-vix", volatility_research)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="S&P 500 / VIX daily history unavailable. No synthetic fallback is used; retry later.") from exc

    @router.get("/etf-constituents")
    def get_constituents(etf: str = Query("SPY"), window: int = Query(60)):
        etf = etf.strip().upper()
        if etf not in ETFS or window not in (20, 60, 120):
            raise HTTPException(status_code=422, detail="Choose a supported ETF and 20, 60 or 120 return observations.")
        try:
            return cached((etf, window), lambda: constituent_research(etf, window))
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Holdings or price data unavailable for {etf}. No static constituent list was substituted.") from exc

    @router.get("/constituent-exposure")
    def get_exposure(ticker: str = Query("SPY", pattern=r"^[A-Za-z0-9.\-]{1,12}$")):
        return exposure_summary(snapshot_loader(ticker.upper()))

    return router

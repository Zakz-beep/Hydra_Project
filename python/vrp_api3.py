"""
vrp_api_patched.py — vrp_api.py + SQLite Integration
=====================================================
Perubahan dari versi original:

  [+] Import db dari db.py
  [+] _vrp_history & _snapshot_history → pakai DB (persistent)
  [+] HAR rv series → pakai DB (makin akurat seiring waktu)
  [+] Signal change → auto-log ke signal_log table
  [+] 4 endpoint baru:
        GET  /api/backtest?ticker=...         → signal accuracy summary
        GET  /api/signals?ticker=...          → signal change log
        GET  /api/db/stats                    → DB health info
        POST /api/db/evaluate?ticker=...      → trigger outcome evaluation

Cara run:
  uvicorn vrp_api3:app --reload --port 8000
"""

import time
import numpy as np
import pandas as pd
from scipy.stats import norm
import yfinance as yf
import warnings
import requests
import os
from datetime import datetime
from typing import Optional, List
from collections import deque

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── DB import ──────────────────────────────────────────────────
from db import db                   # singleton VRPDatabase
from rv_engine import RVEngine      # realtime RV engine

warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════
# APP INIT + CORS
# ═══════════════════════════════════════════════

app = FastAPI(
    title="VRP Signal Engine",
    description="Volatility Risk Premium API — IV vs RV, HAR-RV, BSM Newton-Raphson + SQLite",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════

class Config(BaseModel):
    ticker:          str   = "^GSPC"
    risk_free_rate:  float = 0.0364
    trading_days:    int   = 252
    min_candles:     int   = 30
    vrp_roll_days:   int   = 60
    har_history:     int   = 22

_config = Config()


# ═══════════════════════════════════════════════
# STATE
# ═══════════════════════════════════════════════

# RV engines per ticker (stateful, cache daily data)
_rv_engines: dict[str, RVEngine] = {}

# VRP history masih di-cache in-memory untuk performa,
# tapi di-seed dari DB saat pertama kali diakses
_vrp_history_cache: dict[str, list[float]] = {}


def _get_vrp_history(ticker: str) -> list[float]:
    """
    Return VRP history untuk ticker.
    Pertama kali → load dari DB. Selanjutnya dari cache.
    """
    if ticker not in _vrp_history_cache:
        # Seed dari DB
        _vrp_history_cache[ticker] = db.get_vrp_history_raw(
            ticker, days=_config.vrp_roll_days
        )
    return _vrp_history_cache[ticker]


def _append_vrp_history(ticker: str, vrp_raw: float):
    """Append ke cache + tidak perlu write ke DB (sudah di-handle insert_snapshot)."""
    history = _get_vrp_history(ticker)
    history.append(vrp_raw)
    if len(history) > _config.vrp_roll_days:
        history.pop(0)


# ═══════════════════════════════════════════════
# MODULE 1: DATA COLLECTION (unchanged)
# ═══════════════════════════════════════════════

def _gen_synthetic_daily(n: int = 130) -> pd.DataFrame:
    np.random.seed(42)
    spot0  = 5200.0
    mu     = 0.08 / 252
    sigma  = 0.18 / np.sqrt(252)
    dates  = pd.bdate_range(end=pd.Timestamp.today(), periods=n)
    closes = [spot0]
    for _ in range(n - 1):
        closes.append(closes[-1] * np.exp(np.random.normal(mu, sigma)))
    opens  = [closes[0]] + [closes[i] * np.exp(np.random.normal(0, sigma * 0.3)) for i in range(n - 1)]
    highs  = [max(o, c) * (1 + abs(np.random.normal(0, sigma * 0.5))) for o, c in zip(opens, closes)]
    lows   = [min(o, c) * (1 - abs(np.random.normal(0, sigma * 0.5))) for o, c in zip(opens, closes)]
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes}, index=dates)


def _gen_synthetic_intraday(spot: float, n: int = 26) -> pd.DataFrame:
    np.random.seed(int(time.time()) % 1000)
    sigma_15m = 0.18 / np.sqrt(252 * 26)
    now   = pd.Timestamp.now().normalize() + pd.Timedelta(hours=9, minutes=30)
    times = [now + pd.Timedelta(minutes=15 * i) for i in range(n)]
    closes = [spot]
    for _ in range(n - 1):
        closes.append(closes[-1] * np.exp(np.random.normal(0, sigma_15m)))
    opens = [closes[0]] + closes[:-1]
    highs = [max(o, c) * (1 + abs(np.random.normal(0, sigma_15m * 0.4))) for o, c in zip(opens, closes)]
    lows  = [min(o, c) * (1 - abs(np.random.normal(0, sigma_15m * 0.4))) for o, c in zip(opens, closes)]
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes}, index=times)


def _gen_synthetic_vix(n: int = 130, base_vix: float = 0.19) -> pd.Series:
    np.random.seed(7)
    dates = pd.bdate_range(end=pd.Timestamp.today(), periods=n)
    vix = [base_vix]
    kappa, theta, sv = 0.1, base_vix, 0.02
    for _ in range(n - 1):
        dv = kappa * (theta - vix[-1]) + sv * np.random.normal()
        vix.append(max(0.05, vix[-1] + dv))
    return pd.Series(vix, index=dates)


def fetch_daily_ohlc(ticker: str) -> tuple[pd.DataFrame, bool]:
    try:
        df = yf.download(ticker, period="6mo", interval="1d", progress=False, auto_adjust=True)
        df.dropna(inplace=True)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        if len(df) < 20:
            raise ValueError("Too few rows")
        return df, True
    except Exception:
        return _gen_synthetic_daily(), False


def fetch_intraday_ohlc(ticker: str, spot: float) -> pd.DataFrame:
    try:
        df = yf.download(ticker, period="5d", interval="15m", progress=False, auto_adjust=True)
        df.dropna(inplace=True)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        if not df.empty:
            last_date = df.index[-1].date()
            df = df[df.index.date == last_date]
        if df.empty:
            raise ValueError("Empty")
        return df
    except Exception:
        return _gen_synthetic_intraday(spot)


def fetch_vix(n_daily: int) -> pd.Series:
    try:
        vix = yf.download("^VIX", period="6mo", interval="1d", progress=False, auto_adjust=True)
        vix.columns = [c[0] if isinstance(c, tuple) else c for c in vix.columns]
        iv = vix["Close"] / 100.0
        if iv.empty:
            raise ValueError("Empty")
        return iv
    except Exception:
        return _gen_synthetic_vix(n_daily)


# ═══════════════════════════════════════════════
# MODULE 2–4: RV, HAR, BSM (unchanged)
# ═══════════════════════════════════════════════

def rv_garman_klass(df: pd.DataFrame, trading_days: int = 252) -> float:
    opens  = df["Open"].values
    highs  = df["High"].values
    lows   = df["Low"].values
    closes = df["Close"].values
    hl = 0.5 * np.log(highs / lows) ** 2
    co = (2 * np.log(2) - 1) * np.log(closes / opens) ** 2
    return np.sqrt(trading_days * np.mean(hl - co))


def rv_blended(rv_intraday: float, hv20: float, n_candles: int, min_candles: int = 30) -> float:
    w = min(n_candles / min_candles, 1.0)
    return w * rv_intraday + (1 - w) * hv20


def hv20_from_daily(df: pd.DataFrame, trading_days: int = 252) -> float:
    closes  = df["Close"].values[-21:]
    returns = np.diff(np.log(closes))
    return np.std(returns, ddof=1) * np.sqrt(trading_days)


def build_rv_history(df_daily: pd.DataFrame, trading_days: int = 252) -> np.ndarray:
    """
    [UPDATED] Prioritize DB data for HAR training.
    Fallback ke compute dari yfinance kalau DB kosong.
    """
    ticker = _config.ticker

    # Coba ambil dari DB dulu
    db_rv = db.get_har_rv_array(ticker, days=252)
    if len(db_rv) >= 25:
        return db_rv

    # Fallback: compute dari daily OHLC (squared returns, bukan absolute)
    closes  = df_daily["Close"].values
    returns = np.diff(np.log(closes))
    rv_arr  = np.sqrt(returns ** 2 * trading_days)

    # Seed ke DB untuk future use
    dates = df_daily.index[-len(returns):]
    records = [
        {
            "date":     d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10],
            "rv_daily": float(rv),
            "close":    float(df_daily["Close"].iloc[-(len(returns) - i)]),
            "source":   "bootstrap",
        }
        for i, (d, rv) in enumerate(zip(dates, rv_arr))
    ]
    db.upsert_daily_rv_batch(ticker, records)

    return rv_arr


def har_rv_predict(rv_history: np.ndarray) -> float:
    if len(rv_history) < 22:
        return float(rv_history[-1])
    rv_d = rv_history[-1]
    rv_w = np.mean(rv_history[-5:])
    rv_m = np.mean(rv_history[-22:])
    return 0.0001 + 0.35 * rv_d + 0.25 * rv_w + 0.30 * rv_m


def bsm_price(S, K, T, r, sigma, option_type="call") -> float:
    if T <= 0 or sigma <= 0:
        return max(0.0, S - K) if option_type == "call" else max(0.0, K - S)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    if option_type == "call":
        return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)


def bsm_vega(S, K, T, r, sigma) -> float:
    if T <= 0 or sigma <= 0:
        return 1e-10
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    return S * norm.pdf(d1) * np.sqrt(T)


def implied_vol_newton(market_price, S, K, T, r, option_type="call") -> float:
    sigma = max(0.01, min((market_price / S) * np.sqrt(2 * np.pi / max(T, 1e-6)), 5.0))
    for _ in range(100):
        price = bsm_price(S, K, T, r, sigma, option_type)
        vega  = bsm_vega(S, K, T, r, sigma)
        diff  = price - market_price
        if abs(diff) < 1e-6 or abs(vega) < 1e-10:
            break
        sigma -= diff / vega
        sigma = max(0.001, min(sigma, 5.0))
    return sigma


def iv_from_straddle(call_price, put_price, S, K, T, r) -> float:
    iv_call = implied_vol_newton(call_price, S, K, T, r, "call")
    iv_put  = implied_vol_newton(put_price,  S, K, T, r, "put")
    return (iv_call + iv_put) / 2


# ═══════════════════════════════════════════════
# MODULE 5: VRP CALCULATOR + SIGNAL (unchanged)
# ═══════════════════════════════════════════════

def calculate_vrp(iv: float, rv: float, vrp_history: list) -> tuple[float, float]:
    vrp_raw = iv - rv
    if len(vrp_history) >= 10:
        mu         = np.mean(vrp_history)
        sigma      = np.std(vrp_history) + 1e-10
        vrp_zscore = (vrp_raw - mu) / sigma
    else:
        vrp_zscore = 0.0
    return vrp_raw, vrp_zscore


def vrp_signal(vrp_z: float) -> tuple[str, str]:
    if vrp_z > 1.5:
        return ("STRONG_SHORT_VOL", "IV sangat mahal relatif ke RV → jual volatilitas")
    elif vrp_z > 0.5:
        return ("MILD_SHORT_VOL",   "IV sedikit elevated → potensi short vol")
    elif vrp_z < -1.5:
        return ("STRONG_LONG_VOL",  "IV sangat murah relatif ke RV → beli volatilitas")
    elif vrp_z < -0.5:
        return ("MILD_LONG_VOL",    "IV sedikit murah → potensi long vol")
    return ("NEUTRAL",              "IV fairly priced, tidak ada sinyal kuat")


# ═══════════════════════════════════════════════
# CORE COMPUTE  [UPDATED]
# ═══════════════════════════════════════════════

def compute_vrp_result(ticker: str) -> dict:
    cfg = _config

    # ── Fetch data ───────────────────────────────
    df_daily, is_live = fetch_daily_ohlc(ticker)
    spot_init         = float(df_daily["Close"].iloc[-1])
    df_intraday       = fetch_intraday_ohlc(ticker, spot_init)
    iv_series         = fetch_vix(len(df_daily))

    # ── RV Engine (Approach 2 & 3) ───────────────
    if ticker not in _rv_engines:
        _rv_engines[ticker] = RVEngine(ticker=ticker)
    rv_engine_data = _rv_engines[ticker].compute_dict()

    # ── Baselines ────────────────────────────────
    hv20           = hv20_from_daily(df_daily, cfg.trading_days)
    rv_history_all = build_rv_history(df_daily, cfg.trading_days)  # DB-aware
    rv_history_22  = rv_history_all[-cfg.har_history:]

    # ── VRP history: load dari DB ─────────────────
    vrp_history = _get_vrp_history(ticker)

    # Bootstrap VRP history kalau kosong
    if len(vrp_history) == 0:
        iv_aligned = iv_series.reindex(df_daily.index, method="ffill").dropna()
        rv_60      = rv_history_all[-cfg.vrp_roll_days:]
        min_len    = min(len(rv_60), len(iv_aligned))
        for i in range(min_len):
            vrp_history.append(
                float(iv_aligned.iloc[-(min_len - i)]) - rv_60[-(min_len - i)]
            )
        _vrp_history_cache[ticker] = vrp_history

    # ── Spot ─────────────────────────────────────
    try:
        spot = float(yf.Ticker(ticker).fast_info["last_price"])
    except Exception:
        spot = spot_init

    # ── RV: pakai rv_engine (Approach 2) ─────────
    n_candles = len(df_intraday)
    rv        = rv_engine_data.get("rv_blended", 0) or \
                rv_blended(
                    rv_garman_klass(df_intraday, cfg.trading_days) if n_candles >= 2 else hv20,
                    hv20, n_candles, cfg.min_candles
                )

    # ── HAR: pakai rv_engine (Approach 3) ────────
    rv_har = rv_engine_data.get("rv_har_updated", 0) or har_rv_predict(rv_history_22)

    # ── IV ───────────────────────────────────────
    iv_current = float(iv_series.iloc[-1])
    T          = 30 / 365
    r          = cfg.risk_free_rate
    K          = round(spot)
    call_p     = bsm_price(spot, K, T, r, iv_current, "call")
    put_p      = bsm_price(spot, K, T, r, iv_current, "put")
    iv         = iv_from_straddle(call_p, put_p, spot, K, T, r)

    # ── VRP ──────────────────────────────────────
    vrp_raw, vrp_z = calculate_vrp(iv, rv, vrp_history)
    vrp_vs_har     = iv - rv_har
    signal, desc   = vrp_signal(vrp_z)

    # ── Update VRP history cache ──────────────────
    _append_vrp_history(ticker, vrp_raw)

    # ── Update HAR DB: simpan RV hari ini ─────────
    today = datetime.now().strftime("%Y-%m-%d")
    db.upsert_daily_rv(ticker, today, rv, close_price=spot, source="live" if is_live else "synthetic")

    result = {
        "ticker":      ticker,
        "spot":        round(spot, 2),
        "timestamp":   datetime.now().isoformat(),
        "data_source": "live" if is_live else "synthetic",

        "iv":          round(iv,      6),
        "rv":          round(rv,      6),
        "rv_har":      round(rv_har,  6),
        "hv20":        round(hv20,    6),
        "n_candles":   n_candles,

        "vrp_raw":     round(vrp_raw,    6),
        "vrp_z":       round(vrp_z,      4),
        "vrp_vs_har":  round(vrp_vs_har, 6),

        "signal":      signal,
        "signal_desc": desc,

        "iv_pct":      round(iv  * 100, 2),
        "rv_pct":      round(rv  * 100, 2),
        "rv_har_pct":  round(rv_har  * 100, 2),
        "hv20_pct":    round(hv20 * 100, 2),
        "vrp_raw_pct": round(vrp_raw * 100, 2),

        # rv_engine detail (Approach 2 & 3)
        "rv_engine":   rv_engine_data,
    }

    return result


# ═══════════════════════════════════════════════
# ENDPOINTS — original
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status":  "ok",
        "service": "VRP Signal Engine",
        "version": "2.0.0",
        "docs":    "/docs",
        "db":      db.get_db_stats(),
    }


@app.get("/api/vrp")
def get_vrp(ticker: str = Query(default="^GSPC")):
    """
    Hitung VRP terkini.
    [UPDATED] Persistent ke SQLite + auto signal change log.
    """
    # Reset engine state kalau ticker berubah
    if _config.ticker != ticker:
        _config.ticker = ticker
        _vrp_history_cache.pop(ticker, None)

    try:
        result = compute_vrp_result(ticker)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # ── Persist snapshot ke DB ────────────────────
    db.insert_snapshot(result)

    # ── Log signal change ─────────────────────────
    prev_signal = db.get_last_signal(ticker)
    if result["signal"] != prev_signal:
        db.log_signal_change(
            ticker      = ticker,
            signal      = result["signal"],
            prev_signal = prev_signal,
            vrp_z       = result["vrp_z"],
            spot        = result["spot"],
            iv          = result["iv"],
            rv          = result["rv"],
        )

    # ── History dari DB (ganti in-memory deque) ───
    result["history"] = db.get_snapshot_history(ticker, n=50)

    return result


@app.get("/api/vrp/history")
def get_history(
    ticker: str = Query(default="^GSPC"),
    n:      int = Query(default=20, ge=1, le=200),
    from_ts: Optional[str] = Query(default=None, description="ISO8601, e.g. 2024-11-01T00:00:00"),
    to_ts:   Optional[str] = Query(default=None),
):
    """[UPDATED] History dari DB, bukan in-memory."""
    history = db.get_snapshot_history(ticker, n=n, from_ts=from_ts, to_ts=to_ts)
    return {"ticker": ticker, "n": len(history), "history": history}


@app.get("/api/config")
def get_config():
    return _config.model_dump()


@app.post("/api/config")
def update_config(new_config: Config):
    global _config
    _config = new_config
    _vrp_history_cache.clear()
    return {"status": "updated", "config": _config.model_dump()}


# ═══════════════════════════════════════════════
# ENDPOINTS — NEW (SQLite powered)
# ═══════════════════════════════════════════════

@app.get("/api/backtest")
def get_backtest(ticker: str = Query(default="^GSPC")):
    """
    [NEW] Signal accuracy summary untuk ticker.
    Trigger evaluate_signal_outcomes() dulu, lalu return summary.

    Return:
      win_rate per horizon (1d, 5d, 20d)
      win_rate per signal type
    """
    evaluated = db.evaluate_signal_outcomes(ticker)
    summary   = db.get_backtest_summary(ticker)
    return {**summary, "newly_evaluated": evaluated}


@app.get("/api/signals")
def get_signals(
    ticker: str = Query(default="^GSPC"),
    n:      int = Query(default=30, ge=1, le=200),
):
    """
    [NEW] Log semua signal change events untuk ticker.
    Include outcome kalau sudah dievaluasi.
    """
    logs = db.get_signal_log(ticker, n=n)
    return {"ticker": ticker, "n": len(logs), "signals": logs}


@app.get("/api/har/data")
def get_har_data(
    ticker: str = Query(default="^GSPC"),
    days:   int = Query(default=252, ge=30, le=1000),
):
    """
    [NEW] Return HAR training data dari DB.
    Berguna untuk validasi dan export ke notebook.
    """
    series = db.get_har_rv_series(ticker, days=days)
    count  = db.count_har_records(ticker)
    return {
        "ticker":        ticker,
        "total_records": count,
        "requested":     len(series),
        "series":        series,
    }


@app.get("/api/db/stats")
def get_db_stats():
    """[NEW] DB health check — row counts, file size, tickers."""
    return db.get_db_stats()


@app.post("/api/db/evaluate")
def trigger_evaluate(ticker: str = Query(default="^GSPC")):
    """[NEW] Manually trigger signal outcome evaluation untuk ticker."""
    count = db.evaluate_signal_outcomes(ticker)
    return {"ticker": ticker, "evaluated": count}


@app.delete("/api/db/cleanup")
def cleanup_db(
    ticker:    str = Query(default="^GSPC"),
    keep_days: int = Query(default=90, ge=7),
):
    """[NEW] Hapus snapshot lama. Default: simpan 90 hari terakhir."""
    db.cleanup_old_snapshots(ticker, keep_days=keep_days)
    return {"status": "ok", "ticker": ticker, "kept_days": keep_days}


@app.get("/api/tickers")
def get_tickers():
    """[NEW] Get list of mini tickers for MarketOverview widget."""
    tickers = db.get_mini_tickers()
    return {"tickers": tickers}

class TickerItem(BaseModel):
    symbol: str
    name: str

class TickersList(BaseModel):
    tickers: List[TickerItem]

@app.post("/api/tickers")
def update_tickers(data: TickersList):
    """[NEW] Update list of mini tickers for MarketOverview widget."""
    db.save_mini_tickers([t.model_dump() for t in data.tickers])
    return {"status": "ok"}


# ═══════════════════════════════════════════════
# FRED MACRO ENDPOINTS
# ═══════════════════════════════════════════════

def get_fred_api_key():
    try:
        with open("api.txt", "r") as f:
            lines = f.readlines()
            for line in lines:
                line = line.strip()
                if len(line) == 32 and line.islower() and line.isalnum():
                    return line
    except Exception:
        pass
    return "84c73e43c5492ddd3379cc77e29207c5"

@app.get("/api/fred/yield-curve")
def get_yield_curve():
    """[NEW] Fetch Treasury Yield Spreads (10Y-2Y & 10Y-3M) from FRED API"""
    api_key = get_fred_api_key()
    base_url = "https://api.stlouisfed.org/fred/series/observations"
    
    # 1. Fetch 10Y-2Y
    res_10y2y = requests.get(base_url, params={
        "series_id": "T10Y2Y",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    # 2. Fetch 10Y-3M
    res_10y3m = requests.get(base_url, params={
        "series_id": "T10Y3M",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    if not res_10y2y.ok or not res_10y3m.ok:
        raise HTTPException(status_code=500, detail="Failed to fetch data from FRED")
        
    data_10y2y = res_10y2y.json().get("observations", [])
    data_10y3m = res_10y3m.json().get("observations", [])
    
    # Convert to dict mapped by date
    merged = {}
    
    for obs in data_10y2y:
        val = obs.get("value")
        if val != ".":
            merged[obs["date"]] = {"time": obs["date"], "T10Y2Y": float(val)}
            
    for obs in data_10y3m:
        val = obs.get("value")
        if val != "." and obs["date"] in merged:
            merged[obs["date"]]["T10Y3M"] = float(val)
        elif val != "." and obs["date"] not in merged:
            merged[obs["date"]] = {"time": obs["date"], "T10Y3M": float(val)}
            
    # Convert to sorted list
    sorted_dates = sorted(merged.keys())
    final_data = []
    
    # Forward fill missing data
    last_10y2y = 0.0
    last_10y3m = 0.0
    
    for d in sorted_dates:
        row = merged[d]
        if "T10Y2Y" in row:
            last_10y2y = row["T10Y2Y"]
        if "T10Y3M" in row:
            last_10y3m = row["T10Y3M"]
            
        final_data.append({
            "time": row["time"],
            "T10Y2Y": last_10y2y,
            "T10Y3M": last_10y3m
        })
        
    return {"data": final_data}


@app.get("/api/fred/real-yield")
def get_real_yield():
    """[NEW] Fetch Real Yield (DFII10) and Term Premium (THREEFYTP10) from FRED API"""
    api_key = get_fred_api_key()
    base_url = "https://api.stlouisfed.org/fred/series/observations"
    
    # 1. Fetch DFII10 (Real Yield TIPS)
    res_dfii10 = requests.get(base_url, params={
        "series_id": "DFII10",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    # 2. Fetch THREEFYTP10 (Term Premium 10Y)
    res_tp10 = requests.get(base_url, params={
        "series_id": "THREEFYTP10",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    if not res_dfii10.ok or not res_tp10.ok:
        raise HTTPException(status_code=500, detail="Failed to fetch real yield data from FRED")
        
    data_dfii10 = res_dfii10.json().get("observations", [])
    data_tp10 = res_tp10.json().get("observations", [])
    
    # Convert to dict mapped by date
    merged = {}
    
    for obs in data_dfii10:
        val = obs.get("value")
        if val != ".":
            merged[obs["date"]] = {"time": obs["date"], "DFII10": float(val)}
            
    for obs in data_tp10:
        val = obs.get("value")
        if val != "." and obs["date"] in merged:
            merged[obs["date"]]["THREEFYTP10"] = float(val)
        elif val != "." and obs["date"] not in merged:
            merged[obs["date"]] = {"time": obs["date"], "THREEFYTP10": float(val)}
            
    # Convert to sorted list
    sorted_dates = sorted(merged.keys())
    final_data = []
    
    # Forward fill missing data
    last_dfii10 = 0.0
    last_tp10 = 0.0
    
    for d in sorted_dates:
        row = merged[d]
        if "DFII10" in row:
            last_dfii10 = row["DFII10"]
        if "THREEFYTP10" in row:
            last_tp10 = row["THREEFYTP10"]
            
        final_data.append({
            "time": row["time"],
            "DFII10": last_dfii10,
            "THREEFYTP10": last_tp10
        })
        
    return {"data": final_data}


@app.get("/api/fred/net-liquidity")
def get_net_liquidity():
    """[NEW] Fetch Global Net Liquidity from FRED API (WALCL - WTREGEN - RRPONTSYD)"""
    api_key = get_fred_api_key()
    base_url = "https://api.stlouisfed.org/fred/series/observations"
    
    # 1. Fetch WALCL (Federal Reserve Total Assets) - Weekly, Millions of USD
    res_walcl = requests.get(base_url, params={
        "series_id": "WALCL",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    # 2. Fetch WTREGEN (Treasury General Account) - Weekly, Millions of USD
    res_tga = requests.get(base_url, params={
        "series_id": "WTREGEN",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    # 3. Fetch RRPONTSYD (Overnight Reverse Repurchase Agreements) - Daily, Billions of USD
    res_rrp = requests.get(base_url, params={
        "series_id": "RRPONTSYD",
        "api_key": api_key,
        "file_type": "json",
        "sort_order": "asc"
    })
    
    if not res_walcl.ok or not res_tga.ok or not res_rrp.ok:
        raise HTTPException(status_code=500, detail="Failed to fetch net liquidity data from FRED")
        
    data_walcl = res_walcl.json().get("observations", [])
    data_tga = res_tga.json().get("observations", [])
    data_rrp = res_rrp.json().get("observations", [])
    
    merged = {}
    
    for obs in data_walcl:
        val = obs.get("value")
        if val != ".":
            merged[obs["date"]] = {"time": obs["date"], "WALCL": float(val)}
            
    for obs in data_tga:
        val = obs.get("value")
        if val != ".":
            if obs["date"] not in merged:
                merged[obs["date"]] = {"time": obs["date"]}
            merged[obs["date"]]["WTREGEN"] = float(val)
            
    for obs in data_rrp:
        val = obs.get("value")
        if val != ".":
            if obs["date"] not in merged:
                merged[obs["date"]] = {"time": obs["date"]}
            merged[obs["date"]]["RRPONTSYD"] = float(val)
            
    # Convert to sorted list
    sorted_dates = sorted(merged.keys())
    final_data = []
    
    # Forward fill missing data
    last_walcl = 0.0
    last_tga = 0.0
    last_rrp = 0.0
    
    for d in sorted_dates:
        row = merged[d]
        if "WALCL" in row:
            last_walcl = row["WALCL"]
        if "WTREGEN" in row:
            last_tga = row["WTREGEN"]
        if "RRPONTSYD" in row:
            last_rrp = row["RRPONTSYD"]
            
        # Ensure we have some data before calculating
        if last_walcl > 0:
            # Net Liquidity = WALCL - WTREGEN - RRPONTSYD
            # WALCL and WTREGEN are in Millions, RRPONTSYD is in Billions
            # Convert all to Billions
            walcl_b = last_walcl / 1000.0
            tga_b = last_tga / 1000.0
            rrp_b = last_rrp
            
            net_liquidity = walcl_b - tga_b - rrp_b
            
            final_data.append({
                "time": row["time"],
                "WALCL": walcl_b,
                "WTREGEN": tga_b,
                "RRPONTSYD": rrp_b,
                "NetLiquidity": net_liquidity
            })
        
    return {"data": final_data}
# LEGA & TRUU / YIELD MODULE
# ═══════════════════════════════════════════════

def _get_legatruu_module():
    import sys
    if "legatruu" in sys.modules:
        return sys.modules["legatruu"]
    
    import importlib.util
    import os
    base_dir = os.path.dirname(os.path.abspath(__file__))
    legatruu_path = os.path.join(base_dir, "yield", "legatruu.py")
    
    if not os.path.exists(legatruu_path):
        raise HTTPException(status_code=404, detail="legatruu.py module not found")
        
    spec = importlib.util.spec_from_file_location("legatruu", legatruu_path)
    legatruu = importlib.util.module_from_spec(spec)
    sys.modules["legatruu"] = legatruu
    spec.loader.exec_module(legatruu)
    return legatruu

@app.get("/api/legatruu/snapshot")
def get_legatruu_snapshot():
    """Get the latest yield proxy snapshot and regime data"""
    try:
        import traceback
        legatruu = _get_legatruu_module()
        return legatruu.get_snapshot()
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/legatruu/history")
def get_legatruu_history(tail: int = Query(default=30, ge=1)):
    """Get historical yield proxy data"""
    try:
        import traceback
        legatruu = _get_legatruu_module()
        return {"data": legatruu.get_history(tail=tail)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ═══════════════════════════════════════════════
# PAPER TRADING API
# ═══════════════════════════════════════════════

class PaperTradeRequest(BaseModel):
    ticker: str
    mode: str
    entry_price: float
    margin: float
    leverage: int
    qty: float
    tp_price: Optional[float] = None
    sl_price: Optional[float] = None

class PaperCloseRequest(BaseModel):
    id: str
    close_price: float
    close_reason: str

class PaperBalanceRequest(BaseModel):
    balance: float

@app.get("/api/paper/state")
def get_paper_state():
    try:
        balance = db.get_paper_balance()
        positions = db.get_paper_positions()
        history = db.get_paper_history(limit=50)
        return {
            "balance": balance,
            "positions": positions,
            "history": history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/paper/balance")
def set_paper_balance(req: PaperBalanceRequest):
    try:
        db.update_paper_balance(req.balance)
        return {"status": "success", "new_balance": req.balance}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/paper/trade")
def open_paper_trade(req: PaperTradeRequest):
    try:
        import uuid
        balance = db.get_paper_balance()
        if req.margin > balance:
            raise HTTPException(status_code=400, detail="Insufficient balance")
        
        # Deduct margin
        new_balance = balance - req.margin
        db.update_paper_balance(new_balance)
        
        # Create position
        pos_id = str(uuid.uuid4())
        pos = {
            "id": pos_id,
            "ticker": req.ticker,
            "mode": req.mode,
            "entry_price": req.entry_price,
            "tp_price": req.tp_price,
            "sl_price": req.sl_price,
            "margin": req.margin,
            "leverage": req.leverage,
            "qty": req.qty,
            "created_at": datetime.now().isoformat()
        }
        db.save_paper_position(pos)
        
        return {"status": "success", "position": pos, "new_balance": new_balance}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/paper/close")
def close_paper_trade(req: PaperCloseRequest):
    try:
        positions = db.get_paper_positions()
        pos = next((p for p in positions if p["id"] == req.id), None)
        if not pos:
            raise HTTPException(status_code=404, detail="Position not found")
            
        # Calculate PNL
        price_diff = req.close_price - pos["entry_price"]
        raw_pnl = pos["qty"] * price_diff
        final_pnl = raw_pnl if pos["mode"] == "long" else -raw_pnl
        
        # Update balance
        balance = db.get_paper_balance()
        new_balance = balance + pos["margin"] + final_pnl
        db.update_paper_balance(new_balance)
        
        # Save to history
        history_entry = {
            **pos,
            "close_price": req.close_price,
            "close_reason": req.close_reason,
            "pnl": final_pnl,
            "opened_at": pos["created_at"],
            "closed_at": datetime.now().isoformat()
        }
        db.save_paper_history(history_entry)
        
        # Delete active position
        db.delete_paper_position(pos["id"])
        
        return {"status": "success", "pnl": final_pnl, "new_balance": new_balance}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("vrp_api_patched:app", host="0.0.0.0", port=8000, reload=True)


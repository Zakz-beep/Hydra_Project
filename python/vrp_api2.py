"""
vrp_api.py — FastAPI Backend untuk VRP Model
=============================================
Semua logic dari vrp_model.py tetap utuh,
dibungkus jadi REST API yang bisa di-consume Next.js frontend.

Endpoints:
  GET  /                         → health check
  GET  /api/vrp?ticker=XXXX      → hasil VRP terkini
  GET  /api/vrp/history?ticker=XXXX&n=20  → history snapshot
  POST /api/config               → update config (ticker, interval, dll)
  GET  /api/config               → lihat config aktif

Cara run:
  uvicorn vrp_api2:app --reload --port 8000

Lalu di Next.js, fetch ke:
  http://localhost:8000/api/vrp?ticker=^GSPC
"""

import time
import numpy as np
import pandas as pd
from scipy.stats import norm
import yfinance as yf
import warnings
from datetime import datetime
from typing import Optional, List
from collections import deque
from rv_engine import RVEngine

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

warnings.filterwarnings("ignore")


# ═══════════════════════════════════════════════
# APP INIT + CORS
# ═══════════════════════════════════════════════

app = FastAPI(
    title="VRP Signal Engine",
    description="Volatility Risk Premium API — IV vs RV, HAR-RV, BSM Newton-Raphson",
    version="1.0.0",
)

# Izinkan Next.js frontend (localhost:3000) akses API ini
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
_rv_engine = RVEngine(ticker="^GSPC")


# ═══════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════

class Config(BaseModel):
    ticker:          str   = "^GSPC"
    risk_free_rate:  float = 0.05
    trading_days:    int   = 252
    min_candles:     int   = 30
    vrp_roll_days:   int   = 60
    har_history:     int   = 22

_config = Config()


# ═══════════════════════════════════════════════
# STATE (in-memory rolling history)
# ═══════════════════════════════════════════════

_vrp_history:      List[float] = []
_snapshot_history: deque       = deque(maxlen=50)   # max 50 snapshot per ticker


# ═══════════════════════════════════════════════
# MODULE 1: DATA COLLECTION
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
    """Return (df, is_live). Falls back ke synthetic kalau Yahoo gagal."""
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
# MODULE 2 & 3: RV ESTIMATORS & HAR-RV MODEL
# (Telah dipindahkan & di-handle oleh rv_engine.py)
# ═══════════════════════════════════════════════


# ═══════════════════════════════════════════════
# MODULE 4: BSM + NEWTON-RAPHSON IV
# ═══════════════════════════════════════════════

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
# MODULE 5: VRP CALCULATOR + SIGNAL
# ═══════════════════════════════════════════════

def calculate_vrp(iv: float, rv: float, vrp_history: list) -> tuple[float, float]:
    vrp_raw = iv - rv
    if len(vrp_history) >= 10:
        mu        = np.mean(vrp_history)
        sigma     = np.std(vrp_history) + 1e-10
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
# CORE COMPUTE
# ═══════════════════════════════════════════════

def compute_vrp_result(ticker: str) -> dict:
    global _vrp_history, _rv_engine

    cfg = _config

    # Gunakan RVEngine untuk update ticker (hanya jika berubah)
    if _rv_engine.ticker != ticker:
        _rv_engine = RVEngine(ticker=ticker)

    # ── Fetch & Compute RV Data via RVEngine ─────
    rv_data = _rv_engine.compute_dict()
    spot    = rv_data["spot"]
    rv      = rv_data["rv_blended"]
    rv_har  = rv_data["rv_har_updated"]
    hv20    = rv_data["hv20"]
    n_candles = rv_data["n_candles_5m"]
    is_live = rv_data["data_source"] == "live"

    # Akses state history dari engine
    rv_history_all = _rv_engine._state.daily_rv_history
    df_daily_cache = _rv_engine._state.df_daily_cache

    n_daily = len(rv_history_all) if len(rv_history_all) > 0 else 130
    iv_series = fetch_vix(n_daily)

    # Bootstrap VRP history sekali
    if len(_vrp_history) == 0:
        if df_daily_cache is not None:
            iv_aligned = iv_series.reindex(df_daily_cache.index, method="ffill").dropna()
        else:
            iv_aligned = iv_series

        rv_60      = rv_history_all[-cfg.vrp_roll_days:] if len(rv_history_all) > 0 else []
        min_len    = min(len(rv_60), len(iv_aligned))
        for i in range(min_len):
            _vrp_history.append(
                float(iv_aligned.iloc[-(min_len - i)]) - float(rv_60[-(min_len - i)])
            )

    # ── IV ───────────────────────────────────────
    iv_current = float(iv_series.iloc[-1])
    T          = 30 / 365
    r          = cfg.risk_free_rate
    K          = round(spot)
    call_p     = bsm_price(spot, K, T, r, iv_current, "call")
    put_p      = bsm_price(spot, K, T, r, iv_current, "put")
    iv         = iv_from_straddle(call_p, put_p, spot, K, T, r)

    # ── VRP ──────────────────────────────────────
    vrp_raw, vrp_z = calculate_vrp(iv, rv, _vrp_history)
    vrp_vs_har     = iv - rv_har
    signal, desc   = vrp_signal(vrp_z)

    # Update rolling history
    _vrp_history.append(vrp_raw)
    if len(_vrp_history) > cfg.vrp_roll_days:
        _vrp_history.pop(0)

    result = {
        "ticker":      ticker,
        "spot":        round(spot, 2),
        "timestamp":   datetime.now().isoformat(),
        "data_source": "live" if is_live else "synthetic",

        # Volatility metrics
        "iv":          round(iv,      6),
        "rv":          round(rv,      6),
        "rv_har":      round(rv_har,  6),
        "hv20":        round(hv20,    6),
        "n_candles":   n_candles,

        # VRP
        "vrp_raw":     round(vrp_raw,    6),
        "vrp_z":       round(vrp_z,      4),
        "vrp_vs_har":  round(vrp_vs_har, 6),

        # Signal
        "signal":      signal,
        "signal_desc": desc,

        # Pct formatted (buat display langsung)
        "iv_pct":      round(iv  * 100, 2),
        "rv_pct":      round(rv  * 100, 2),
        "rv_har_pct":  round(rv_har  * 100, 2),
        "hv20_pct":    round(hv20 * 100, 2),
        "vrp_raw_pct": round(vrp_raw * 100, 2),
        "rv_engine":   rv_data,
    }

    return result


# ═══════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status":  "ok",
        "service": "VRP Signal Engine",
        "version": "1.0.0",
        "docs":    "/docs",
    }


@app.get("/api/vrp")
def get_vrp(ticker: str = Query(default="^GSPC", description="Ticker symbol, e.g. ^GSPC, BBRI.JK")):
    """
    Hitung dan return VRP result terkini untuk ticker yang diminta.
    Juga menyimpan snapshot ke history.
    """
    global _vrp_history, _snapshot_history, _rv_engine

    # Reset state kalau ticker berubah
    if _config.ticker != ticker:
        _config.ticker = ticker
        _vrp_history   = []
        _snapshot_history.clear()
        _rv_engine = RVEngine(ticker=ticker)

    try:
        result = compute_vrp_result(ticker)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Simpan ke history
    snapshot = {
        "time":   datetime.now().strftime("%H:%M:%S"),
        "iv":     result["iv_pct"],
        "rv":     result["rv_pct"],
        "vrp":    result["vrp_raw_pct"],
        "signal": result["signal"],
    }
    _snapshot_history.append(snapshot)
    result["history"] = list(_snapshot_history)

    return result


@app.get("/api/vrp/history")
def get_history(
    ticker: str = Query(default="^GSPC"),
    n: int      = Query(default=20, ge=1, le=50, description="Jumlah snapshot terakhir")
):
    """Return history snapshots saja (untuk chart)."""
    history = list(_snapshot_history)[-n:]
    return {
        "ticker":  ticker,
        "n":       len(history),
        "history": history,
    }


@app.get("/api/config")
def get_config():
    return _config.model_dump()


@app.post("/api/config")
def update_config(new_config: Config):
    global _config, _vrp_history, _snapshot_history, _rv_engine
    _config           = new_config
    _vrp_history      = []   # reset state saat config berubah
    _snapshot_history.clear()
    if _rv_engine.ticker != new_config.ticker:
        _rv_engine = RVEngine(ticker=new_config.ticker)
    return {"status": "updated", "config": _config.model_dump()}


# ═══════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("vrp_api:app", host="0.0.0.0", port=8000, reload=True)

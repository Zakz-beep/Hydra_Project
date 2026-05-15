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
  uvicorn vrp_api:app --reload --port 8000

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
# MODULE 2: RV ESTIMATORS
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


# ═══════════════════════════════════════════════
# MODULE 3: HAR-RV MODEL
# ═══════════════════════════════════════════════

def build_rv_history(df_daily: pd.DataFrame, trading_days: int = 252) -> np.ndarray:
    closes  = df_daily["Close"].values
    returns = np.diff(np.log(closes))
    return np.array([abs(r) * np.sqrt(trading_days) for r in returns])


def har_rv_predict(rv_history: np.ndarray) -> float:
    if len(rv_history) < 22:
        return float(rv_history[-1])
    rv_d = rv_history[-1]
    rv_w = np.mean(rv_history[-5:])
    rv_m = np.mean(rv_history[-22:])
    return 0.0001 + 0.35 * rv_d + 0.25 * rv_w + 0.30 * rv_m


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
    global _vrp_history

    cfg = _config

    # ── Fetch data ───────────────────────────────
    df_daily, is_live = fetch_daily_ohlc(ticker)
    spot_init         = float(df_daily["Close"].iloc[-1])
    df_intraday       = fetch_intraday_ohlc(ticker, spot_init)
    iv_series         = fetch_vix(len(df_daily))

    # ── Baselines ────────────────────────────────
    hv20           = hv20_from_daily(df_daily, cfg.trading_days)
    rv_history_all = build_rv_history(df_daily, cfg.trading_days)
    rv_history_22  = rv_history_all[-cfg.har_history:]

    # Bootstrap VRP history sekali
    if len(_vrp_history) == 0:
        iv_aligned = iv_series.reindex(df_daily.index, method="ffill").dropna()
        rv_60      = rv_history_all[-cfg.vrp_roll_days:]
        min_len    = min(len(rv_60), len(iv_aligned))
        for i in range(min_len):
            _vrp_history.append(
                float(iv_aligned.iloc[-(min_len - i)]) - rv_60[-(min_len - i)]
            )

    # ── Spot ─────────────────────────────────────
    try:
        spot = float(yf.Ticker(ticker).fast_info["last_price"])
    except Exception:
        spot = spot_init

    # ── RV ───────────────────────────────────────
    n_candles = len(df_intraday)
    rv_raw    = rv_garman_klass(df_intraday, cfg.trading_days) if n_candles >= 2 else hv20
    rv        = rv_blended(rv_raw, hv20, n_candles, cfg.min_candles)
    rv_har    = har_rv_predict(rv_history_22)

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
    global _vrp_history, _snapshot_history

    # Reset state kalau ticker berubah
    if _config.ticker != ticker:
        _config.ticker = ticker
        _vrp_history   = []
        _snapshot_history.clear()

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
    global _config, _vrp_history, _snapshot_history
    _config           = new_config
    _vrp_history      = []   # reset state saat config berubah
    _snapshot_history.clear()
    return {"status": "updated", "config": _config.model_dump()}


# ═══════════════════════════════════════════════
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
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("vrp_api:app", host="0.0.0.0", port=8000, reload=True)

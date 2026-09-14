"""
market_mcp_server.py — Market Data & Price Action MCP Server
=============================================================
MCP server for AI agents to fetch market data, price action,
and market structure analysis.

Tools:
  - get_price            : Current OHLCV snapshot (single ticker)
  - get_multi_price      : Multiple tickers at once
  - get_ohlcv            : Historical candlestick data
  - get_technicals       : MA, RSI, MACD, Bollinger Bands, ATR
  - get_market_structure : Swing H/L, trend, BOS/CHOCH, FVGs
  - get_support_resistance : Key S/R levels, pivots, POC
  - get_volume_analysis  : Volume profile, RVOL, OBV, CVD-approx
  - get_relative_strength: RS vs benchmark (SPY/QQQ), sector RS
  - get_market_breadth   : Advance/decline, sector heatmap, fear/greed
  - get_economic_context : VIX, DXY, TNX, Gold, Futures overview

Run:
  uv run mcp run market_mcp_server.py
  uv run python market_mcp_server.py

Claude Desktop config:
{
  "mcpServers": {
    "market-data": {
      "command": "C:\\\\Users\\\\Akbar Alviansyah\\\\.local\\\\bin\\\\uv.exe",
      "args": ["run", "mcp", "run",
               "C:\\\\Users\\\\Akbar Alviansyah\\\\Downloads\\\\vrp-dashboard\\\\python\\\\market_mcp_server.py"],
      "cwd": "C:\\\\Users\\\\Akbar Alviansyah\\\\Downloads\\\\vrp-dashboard\\\\python"
    }
  }
}
"""

import sys
import math
import logging
import pathlib
from datetime import datetime, timedelta
from typing import Optional, List

LOG_FILE = pathlib.Path(__file__).parent / "market_mcp_server.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("market-mcp")
log.info("=" * 60)
log.info("Market MCP Server starting...")
log.info(f"Python: {sys.version}")

try:
    import yfinance as yf
    import pandas as pd
    import numpy as np
    log.info("Dependencies OK: yfinance, pandas, numpy")
except ImportError as e:
    log.error(f"Missing dependency: {e}. Run: uv pip install yfinance pandas numpy")
    sys.exit(1)

from mcp.server.fastmcp import FastMCP

log.info("Initializing FastMCP...")
mcp = FastMCP("Market Data & Price Action")
log.info("FastMCP initialized.")


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

INTERVAL_PERIOD_MAP = {
    "1m":  "1d",
    "2m":  "1d",
    "5m":  "5d",
    "15m": "5d",
    "30m": "1mo",
    "1h":  "1mo",
    "4h":  "3mo",
    "1d":  "1y",
    "1wk": "5y",
    "1mo": "10y",
}

def _fetch_ohlcv(ticker: str, period: str = "3mo", interval: str = "1d") -> Optional[pd.DataFrame]:
    """Fetch OHLCV from yfinance, flatten MultiIndex columns."""
    try:
        df = yf.download(ticker.upper(), period=period, interval=interval,
                         progress=False, auto_adjust=True)
        if df is None or df.empty:
            return None
        if hasattr(df.columns, "levels"):
            df.columns = df.columns.get_level_values(0)
        df = df.dropna(subset=["Close"])
        return df
    except Exception as e:
        log.error(f"yfinance fetch error {ticker}: {e}")
        return None


def _df_to_records(df: pd.DataFrame, limit: int = 200) -> List[dict]:
    """Convert OHLCV DataFrame to list of dicts (most recent last)."""
    df = df.tail(limit)
    records = []
    for ts, row in df.iterrows():
        records.append({
            "time":   str(ts)[:19],
            "open":   round(float(row.get("Open",  row.get("open",  0))), 4),
            "high":   round(float(row.get("High",  row.get("high",  0))), 4),
            "low":    round(float(row.get("Low",   row.get("low",   0))), 4),
            "close":  round(float(row.get("Close", row.get("close", 0))), 4),
            "volume": int(row.get("Volume", row.get("volume", 0))),
        })
    return records


def _sma(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(n).mean()


def _ema(series: pd.Series, n: int) -> pd.Series:
    return series.ewm(span=n, adjust=False).mean()


def _rsi(series: pd.Series, n: int = 14) -> pd.Series:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(n).mean()
    loss  = (-delta.clip(upper=0)).rolling(n).mean()
    rs    = gain / loss.replace(0, float("nan"))
    return 100 - 100 / (1 + rs)


def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def _macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast   = _ema(series, fast)
    ema_slow   = _ema(series, slow)
    macd_line  = ema_fast - ema_slow
    signal_line = _ema(macd_line, signal)
    histogram  = macd_line - signal_line
    return macd_line, signal_line, histogram


def _bollinger(series: pd.Series, n=20, k=2):
    mid  = _sma(series, n)
    std  = series.rolling(n).std()
    upper = mid + k * std
    lower = mid - k * std
    return upper, mid, lower


def _detect_swing_highs_lows(df: pd.DataFrame, lookback: int = 5):
    """Find local swing highs and lows."""
    highs = df["High"].values
    lows  = df["Low"].values
    times = df.index

    swing_highs = []
    swing_lows  = []

    for i in range(lookback, len(df) - lookback):
        # Swing high: highest in surrounding lookback bars
        if highs[i] == max(highs[i - lookback: i + lookback + 1]):
            swing_highs.append({
                "time":  str(times[i])[:19],
                "price": round(float(highs[i]), 4),
                "index": i,
            })
        # Swing low: lowest in surrounding lookback bars
        if lows[i] == min(lows[i - lookback: i + lookback + 1]):
            swing_lows.append({
                "time":  str(times[i])[:19],
                "price": round(float(lows[i]), 4),
                "index": i,
            })

    return swing_highs, swing_lows


def _detect_fvg(df: pd.DataFrame, min_gap_pct: float = 0.1) -> List[dict]:
    """
    Detect Fair Value Gaps (FVG / Imbalances).
    Bullish FVG: candle[i-1].high < candle[i+1].low
    Bearish FVG: candle[i-1].low  > candle[i+1].high
    """
    fvgs = []
    highs  = df["High"].values
    lows   = df["Low"].values
    closes = df["Close"].values
    times  = df.index

    for i in range(1, len(df) - 1):
        spot = closes[i]

        # Bullish FVG
        gap_low  = highs[i - 1]
        gap_high = lows[i + 1]
        if gap_high > gap_low:
            gap_pct = (gap_high - gap_low) / spot * 100
            if gap_pct >= min_gap_pct:
                fvgs.append({
                    "type":     "bullish",
                    "time":     str(times[i])[:19],
                    "gap_low":  round(float(gap_low),  4),
                    "gap_high": round(float(gap_high), 4),
                    "gap_pct":  round(gap_pct, 3),
                    "filled":   False,  # would need forward-check
                })

        # Bearish FVG
        gap_high2 = lows[i - 1]
        gap_low2  = highs[i + 1]
        if gap_high2 > gap_low2:
            gap_pct = (gap_high2 - gap_low2) / spot * 100
            if gap_pct >= min_gap_pct:
                fvgs.append({
                    "type":     "bearish",
                    "time":     str(times[i])[:19],
                    "gap_high": round(float(gap_high2), 4),
                    "gap_low":  round(float(gap_low2),  4),
                    "gap_pct":  round(gap_pct, 3),
                    "filled":   False,
                })

    return fvgs[-20:]  # return most recent 20


def _classify_trend(swing_highs: List[dict], swing_lows: List[dict]) -> dict:
    """Classify trend based on swing high/low structure."""
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        return {"trend": "INSUFFICIENT_DATA", "structure": "N/A"}

    last_highs = [sh["price"] for sh in swing_highs[-3:]]
    last_lows  = [sl["price"] for sl in swing_lows[-3:]]

    hh = last_highs[-1] > last_highs[-2] if len(last_highs) >= 2 else None
    hl = last_lows[-1]  > last_lows[-2]  if len(last_lows)  >= 2 else None
    lh = last_highs[-1] < last_highs[-2] if len(last_highs) >= 2 else None
    ll = last_lows[-1]  < last_lows[-2]  if len(last_lows)  >= 2 else None

    if hh and hl:
        trend = "UPTREND"
        structure = "HH + HL (Higher Highs, Higher Lows)"
    elif lh and ll:
        trend = "DOWNTREND"
        structure = "LH + LL (Lower Highs, Lower Lows)"
    elif hh and ll:
        trend = "DISTRIBUTION"
        structure = "HH + LL (Expanding range / volatile)"
    elif lh and hl:
        trend = "CONSOLIDATION"
        structure = "LH + HL (Contracting range / coiling)"
    else:
        trend = "MIXED"
        structure = "No clear pattern"

    return {
        "trend": trend,
        "structure": structure,
        "last_3_highs": [round(h, 4) for h in last_highs],
        "last_3_lows":  [round(l, 4) for l in last_lows],
    }


def _pivot_points(df: pd.DataFrame) -> dict:
    """Classic pivot points from previous day/week high/low/close."""
    if len(df) < 2:
        return {}
    prev = df.iloc[-2]
    H = float(prev["High"])
    L = float(prev["Low"])
    C = float(prev["Close"])
    P = (H + L + C) / 3  # Pivot
    return {
        "pivot":  round(P, 4),
        "R1":     round(2 * P - L, 4),
        "R2":     round(P + (H - L), 4),
        "R3":     round(H + 2 * (P - L), 4),
        "S1":     round(2 * P - H, 4),
        "S2":     round(P - (H - L), 4),
        "S3":     round(L - 2 * (H - P), 4),
    }


# ═════════════════════════════════════════════════════════════
# TOOL 1: CURRENT PRICE SNAPSHOT
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_price(ticker: str) -> dict:
    """
    Get current price snapshot for a ticker.

    Returns:
    - price:         current price (last close or real-time)
    - open, high, low, close, volume (today's session)
    - prev_close:    previous session close
    - change:        $ change from previous close
    - change_pct:    % change from previous close
    - day_range:     today's high-low range
    - week_52_high, week_52_low: 52-week extremes
    - avg_volume_10: 10-day average volume
    - rvol:          relative volume (today / 10d avg)
    - market_cap:    market capitalization
    - beta:          beta vs S&P 500

    Compatible with: SPY, QQQ, AAPL, TSLA, BTC-USD, EUR=X, GC=F, ^VIX, etc.
    """
    t = ticker.upper()
    try:
        tkr  = yf.Ticker(t)
        info = tkr.fast_info

        # Fast info attributes
        current = getattr(info, "last_price",       None) or getattr(info, "regularMarketPrice", None)
        prev_c  = getattr(info, "previous_close",   None) or getattr(info, "regularMarketPreviousClose", None)
        day_hi  = getattr(info, "day_high",          None)
        day_lo  = getattr(info, "day_low",           None)
        yr_hi   = getattr(info, "year_high",         None)
        yr_lo   = getattr(info, "year_low",          None)
        vol     = getattr(info, "last_volume",       None)
        mktcap  = getattr(info, "market_cap",        None)

        change     = round(current - prev_c, 4) if current and prev_c else None
        change_pct = round((change / prev_c) * 100, 3) if change and prev_c else None

        # 10-day volume average from history
        hist_10 = _fetch_ohlcv(t, period="1mo", interval="1d")
        avg_vol10 = None
        rvol      = None
        if hist_10 is not None and len(hist_10) >= 5:
            avg_vol10 = int(hist_10["Volume"].iloc[:-1].tail(10).mean())
            if avg_vol10 and vol:
                rvol = round(vol / avg_vol10, 3)

        # Try full info for beta/sector
        full_info = {}
        try:
            full_info = tkr.info or {}
        except Exception:
            pass

        return {
            "ticker":        t,
            "price":         round(current, 4) if current else None,
            "open":          round(float(hist_10["Open"].iloc[-1]),  4) if hist_10 is not None else None,
            "high":          round(day_hi, 4) if day_hi else None,
            "low":           round(day_lo, 4) if day_lo else None,
            "close":         round(current, 4) if current else None,
            "volume":        vol,
            "prev_close":    round(prev_c, 4) if prev_c else None,
            "change":        change,
            "change_pct":    change_pct,
            "day_range":     round(day_hi - day_lo, 4) if day_hi and day_lo else None,
            "week_52_high":  round(yr_hi, 4) if yr_hi else None,
            "week_52_low":   round(yr_lo, 4) if yr_lo else None,
            "avg_volume_10": avg_vol10,
            "rvol":          rvol,
            "market_cap":    mktcap,
            "beta":          full_info.get("beta"),
            "sector":        full_info.get("sector"),
            "industry":      full_info.get("industry"),
            "currency":      full_info.get("currency", "USD"),
            "exchange":      full_info.get("exchange"),
        }
    except Exception as e:
        log.error(f"get_price error {t}: {e}")
        return {"ticker": t, "error": str(e)}


# ═════════════════════════════════════════════════════════════
# TOOL 2: MULTI-TICKER PRICE
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_multi_price(tickers: str) -> dict:
    """
    Get current price for multiple tickers at once.

    Args:
        tickers: Comma-separated ticker symbols.
                 e.g. "SPY,QQQ,IWM,AAPL,TSLA,GLD,BTC-USD"

    Returns a dict keyed by ticker, each with:
    price, change_pct, volume, rvol, week_52_high, week_52_low

    Useful for scanning a watchlist or comparing sector ETFs.
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    results = {}

    for t in ticker_list[:20]:  # max 20 tickers
        try:
            tkr  = yf.Ticker(t)
            info = tkr.fast_info
            current = getattr(info, "last_price",      None)
            prev_c  = getattr(info, "previous_close",  None)
            vol     = getattr(info, "last_volume",      None)
            yr_hi   = getattr(info, "year_high",        None)
            yr_lo   = getattr(info, "year_low",         None)

            change_pct = None
            if current and prev_c and prev_c != 0:
                change_pct = round((current - prev_c) / prev_c * 100, 3)

            results[t] = {
                "price":        round(current, 4) if current else None,
                "change_pct":   change_pct,
                "volume":       vol,
                "week_52_high": round(yr_hi, 4) if yr_hi else None,
                "week_52_low":  round(yr_lo, 4) if yr_lo else None,
                "pct_from_52h": round((current / yr_hi - 1) * 100, 2) if current and yr_hi else None,
                "pct_from_52l": round((current / yr_lo - 1) * 100, 2) if current and yr_lo else None,
            }
        except Exception as e:
            results[t] = {"error": str(e)}

    return {"tickers": ticker_list, "data": results, "count": len(results)}


# ═════════════════════════════════════════════════════════════
# TOOL 3: HISTORICAL OHLCV
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_ohlcv(
    ticker: str,
    interval: str = "1d",
    period: str = "3mo",
    limit: int = 100
) -> dict:
    """
    Historical OHLCV candlestick data.

    Args:
        ticker:   Ticker symbol (SPY, AAPL, BTC-USD, ^VIX, GC=F, etc.)
        interval: Bar size: 1m, 2m, 5m, 15m, 30m, 1h, 4h, 1d, 1wk, 1mo
        period:   Lookback: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y
                  Note: intraday (≤1h) limited to 60 days max by Yahoo.
        limit:    Max candles to return (default 100, max 500)

    Returns:
    - candles: list of {time, open, high, low, close, volume}
    - summary: first/last price, total range, avg volume

    INTERVALS GUIDE:
      Scalping:    1m, 5m, 15m
      Day trading: 15m, 30m, 1h
      Swing:       4h, 1d
      Position:    1wk, 1mo
    """
    t = ticker.upper()
    limit = min(max(limit, 1), 500)

    df = _fetch_ohlcv(t, period=period, interval=interval)
    if df is None or df.empty:
        return {"ticker": t, "error": "No data returned. Check ticker/interval/period."}

    candles = _df_to_records(df, limit=limit)
    if not candles:
        return {"ticker": t, "error": "Empty candles after processing."}

    first_close = candles[0]["close"]
    last_close  = candles[-1]["close"]
    period_chg  = round((last_close / first_close - 1) * 100, 3) if first_close else None
    all_highs   = [c["high"]   for c in candles]
    all_lows    = [c["low"]    for c in candles]
    all_vols    = [c["volume"] for c in candles]

    return {
        "ticker":   t,
        "interval": interval,
        "period":   period,
        "count":    len(candles),
        "summary": {
            "first_close":    first_close,
            "last_close":     last_close,
            "period_change_pct": period_chg,
            "period_high":    max(all_highs),
            "period_low":     min(all_lows),
            "period_range_pct": round((max(all_highs) / min(all_lows) - 1) * 100, 3) if min(all_lows) else None,
            "avg_volume":     int(sum(all_vols) / len(all_vols)) if all_vols else 0,
        },
        "candles": candles,
    }


# ═════════════════════════════════════════════════════════════
# TOOL 4: TECHNICAL INDICATORS
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_technicals(
    ticker: str,
    interval: str = "1d",
    period: str = "1y"
) -> dict:
    """
    Comprehensive technical indicators for a ticker.

    Returns (current bar values + last N readings):
    - Moving Averages: SMA 9/20/50/200, EMA 9/21/50/200
    - RSI (14): overbought >70, oversold <30
    - MACD (12/26/9): line, signal, histogram, crossover status
    - Bollinger Bands (20, 2σ): upper, mid, lower, %B, squeeze
    - ATR (14): average true range (volatility measure)
    - Stochastic (14/3): %K, %D
    - Volume: OBV trend, volume SMA 20

    MA confluence analysis:
    - How many MAs are above/below current price
    - Distance from each key MA (%, useful for mean reversion)

    Args:
        ticker:   Ticker symbol
        interval: Bar interval (1d recommended for reliability)
        period:   Lookback period (1y recommended for SMA 200)
    """
    t = ticker.upper()
    df = _fetch_ohlcv(t, period=period, interval=interval)
    if df is None or df.empty:
        return {"ticker": t, "error": "No data returned."}
    if len(df) < 30:
        return {"ticker": t, "error": f"Insufficient data ({len(df)} bars). Need at least 30."}

    c = df["Close"]
    h = df["High"]
    l = df["Low"]
    v = df["Volume"]

    # Moving averages
    sma9   = _sma(c, 9)
    sma20  = _sma(c, 20)
    sma50  = _sma(c, 50)
    sma200 = _sma(c, 200)
    ema9   = _ema(c, 9)
    ema21  = _ema(c, 21)
    ema50  = _ema(c, 50)
    ema200 = _ema(c, 200)

    # RSI
    rsi14  = _rsi(c, 14)

    # MACD
    macd_l, macd_s, macd_h = _macd(c)

    # Bollinger
    bb_up, bb_mid, bb_lo = _bollinger(c)
    bb_pct_b = (c - bb_lo) / (bb_up - bb_lo)  # %B: 0=lower, 1=upper, >1=breakout

    # ATR
    atr14 = _atr(df, 14)

    # Stochastic
    low14  = l.rolling(14).min()
    high14 = h.rolling(14).max()
    stoch_k = 100 * (c - low14) / (high14 - low14)
    stoch_d = stoch_k.rolling(3).mean()

    # OBV
    obv = (np.sign(c.diff()) * v).fillna(0).cumsum()

    # Volume SMA
    vol_sma20 = _sma(v, 20)

    price = float(c.iloc[-1])

    def _r(val, n=4):
        try:
            f = float(val)
            if math.isnan(f):
                return None
            return round(f, n)
        except Exception:
            return None

    def _pct_from(ma_val):
        """% distance of price from MA."""
        try:
            v2 = float(ma_val)
            if math.isnan(v2) or v2 == 0:
                return None
            return round((price / v2 - 1) * 100, 3)
        except Exception:
            return None

    # Squeeze: BB width / SMA20 < threshold
    bb_width = float((bb_up - bb_lo).iloc[-1]) if not math.isnan(float((bb_up - bb_lo).iloc[-1])) else None
    bb_width_pct = round(bb_width / price * 100, 3) if bb_width else None
    squeeze = bb_width_pct is not None and bb_width_pct < 3.0  # <3% = squeeze

    # MA above/below price count
    ma_values = {
        "sma9": _r(sma9.iloc[-1]),  "sma20": _r(sma20.iloc[-1]),
        "sma50": _r(sma50.iloc[-1]), "sma200": _r(sma200.iloc[-1]),
        "ema9": _r(ema9.iloc[-1]),   "ema21": _r(ema21.iloc[-1]),
        "ema50": _r(ema50.iloc[-1]), "ema200": _r(ema200.iloc[-1]),
    }
    mas_below = sum(1 for v2 in ma_values.values() if v2 and price > v2)
    mas_above = sum(1 for v2 in ma_values.values() if v2 and price < v2)

    # MACD crossover
    macd_prev = float(macd_l.iloc[-2]) if len(macd_l) > 1 else 0
    sig_prev  = float(macd_s.iloc[-2]) if len(macd_s) > 1 else 0
    macd_cur  = float(macd_l.iloc[-1])
    sig_cur   = float(macd_s.iloc[-1])
    if macd_prev < sig_prev and macd_cur >= sig_cur:
        macd_cross = "BULLISH_CROSS"
    elif macd_prev > sig_prev and macd_cur <= sig_cur:
        macd_cross = "BEARISH_CROSS"
    else:
        macd_cross = "NO_CROSS"

    # RSI regime
    rsi_val = _r(rsi14.iloc[-1], 2)
    if rsi_val:
        if rsi_val >= 70:   rsi_regime = "OVERBOUGHT"
        elif rsi_val <= 30: rsi_regime = "OVERSOLD"
        elif rsi_val >= 60: rsi_regime = "BULLISH"
        elif rsi_val <= 40: rsi_regime = "BEARISH"
        else:               rsi_regime = "NEUTRAL"
    else:
        rsi_regime = "N/A"

    return {
        "ticker":   t,
        "interval": interval,
        "price":    round(price, 4),
        "timestamp": str(df.index[-1])[:19],

        "moving_averages": {
            **ma_values,
            "price_vs_mas": {
                "mas_below_price": mas_below,  # price above this many MAs
                "mas_above_price": mas_above,  # price below this many MAs
                "pct_from_sma20":  _pct_from(sma20.iloc[-1]),
                "pct_from_sma50":  _pct_from(sma50.iloc[-1]),
                "pct_from_sma200": _pct_from(sma200.iloc[-1]),
                "golden_cross": _r(sma50.iloc[-1]) > _r(sma200.iloc[-1]) if _r(sma50.iloc[-1]) and _r(sma200.iloc[-1]) else None,
                "death_cross":  _r(sma50.iloc[-1]) < _r(sma200.iloc[-1]) if _r(sma50.iloc[-1]) and _r(sma200.iloc[-1]) else None,
            }
        },

        "rsi": {
            "rsi14":  rsi_val,
            "regime": rsi_regime,
        },

        "macd": {
            "line":      _r(macd_l.iloc[-1]),
            "signal":    _r(macd_s.iloc[-1]),
            "histogram": _r(macd_h.iloc[-1]),
            "crossover": macd_cross,
            "above_zero": float(macd_l.iloc[-1]) > 0 if not math.isnan(float(macd_l.iloc[-1])) else None,
        },

        "bollinger": {
            "upper":     _r(bb_up.iloc[-1]),
            "middle":    _r(bb_mid.iloc[-1]),
            "lower":     _r(bb_lo.iloc[-1]),
            "pct_b":     _r(bb_pct_b.iloc[-1], 3),
            "width_pct": bb_width_pct,
            "squeeze":   squeeze,
            "position":  "ABOVE_UPPER" if price > _r(bb_up.iloc[-1]) else
                         "BELOW_LOWER" if price < _r(bb_lo.iloc[-1]) else "INSIDE",
        },

        "atr": {
            "atr14":     _r(atr14.iloc[-1]),
            "atr_pct":   round(float(atr14.iloc[-1]) / price * 100, 3) if not math.isnan(float(atr14.iloc[-1])) else None,
        },

        "stochastic": {
            "k":       _r(stoch_k.iloc[-1], 2),
            "d":       _r(stoch_d.iloc[-1], 2),
            "regime":  "OVERBOUGHT" if stoch_k.iloc[-1] > 80 else
                       "OVERSOLD"   if stoch_k.iloc[-1] < 20 else "NEUTRAL",
        },

        "volume": {
            "current":    int(v.iloc[-1]),
            "sma20":      int(vol_sma20.iloc[-1]) if not math.isnan(float(vol_sma20.iloc[-1])) else None,
            "rvol":       round(float(v.iloc[-1]) / float(vol_sma20.iloc[-1]), 3) if not math.isnan(float(vol_sma20.iloc[-1])) else None,
            "obv":        int(obv.iloc[-1]),
            "obv_trend":  "UP" if obv.iloc[-1] > obv.iloc[-5] else "DOWN" if len(obv) > 5 else "N/A",
        },
    }


# ═════════════════════════════════════════════════════════════
# TOOL 5: MARKET STRUCTURE
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_market_structure(
    ticker: str,
    interval: str = "1d",
    period: str = "6mo",
    swing_lookback: int = 5,
    fvg_min_gap_pct: float = 0.1
) -> dict:
    """
    Market structure analysis — SMC / ICT / Price Action style.

    Detects:
    1. TREND: Uptrend (HH+HL), Downtrend (LH+LL), Consolidation (LH+HL), Distribution (HH+LL)
    2. SWING HIGHS/LOWS: Key structural pivots
    3. BOS (Break of Structure): When price breaks above last swing high (bullish) or below swing low (bearish)
    4. CHOCH (Change of Character): Opposite structure break = potential trend reversal
    5. FVGs (Fair Value Gaps): Price imbalances (liquidity gaps) that price tends to revisit
    6. KEY LEVELS: Recent swing highs/lows acting as S/R

    Args:
        ticker:          Ticker symbol
        interval:        Bar size (1d for swing, 1h for intraday structure)
        period:          Lookback period
        swing_lookback:  Bars on each side to confirm a swing (default 5)
        fvg_min_gap_pct: Minimum gap size % to qualify as FVG (default 0.1%)

    Returns:
    - trend:          current trend classification
    - swing_highs:    list of confirmed swing highs
    - swing_lows:     list of confirmed swing lows
    - bos:            Break of Structure events
    - fvgs:           Fair Value Gaps (bullish and bearish)
    - key_levels:     most recent S/R levels from swings
    """
    t = ticker.upper()
    df = _fetch_ohlcv(t, period=period, interval=interval)
    if df is None or df.empty:
        return {"ticker": t, "error": "No data."}
    if len(df) < swing_lookback * 3:
        return {"ticker": t, "error": f"Need at least {swing_lookback * 3} bars."}

    swing_highs, swing_lows = _detect_swing_highs_lows(df, lookback=swing_lookback)
    trend_info = _classify_trend(swing_highs, swing_lows)
    fvgs = _detect_fvg(df, min_gap_pct=fvg_min_gap_pct)

    price = float(df["Close"].iloc[-1])

    # BOS / CHOCH detection
    bos_events = []
    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        last_sh = swing_highs[-1]["price"]
        last_sl = swing_lows[-1]["price"]
        prev_sh = swing_highs[-2]["price"]
        prev_sl = swing_lows[-2]["price"]

        if price > last_sh and last_sh > prev_sh:
            bos_events.append({"type": "BOS_BULLISH", "level": last_sh,
                                "desc": "Break of Structure — price broke above last swing high (bullish continuation)"})
        elif price < last_sl and last_sl < prev_sl:
            bos_events.append({"type": "BOS_BEARISH", "level": last_sl,
                                "desc": "Break of Structure — price broke below last swing low (bearish continuation)"})

        if price > last_sh and last_sh < prev_sh:
            bos_events.append({"type": "CHOCH_BULLISH", "level": last_sh,
                                "desc": "Change of Character — broke bearish structure high (potential reversal UP)"})
        elif price < last_sl and last_sl > prev_sl:
            bos_events.append({"type": "CHOCH_BEARISH", "level": last_sl,
                                "desc": "Change of Character — broke bullish structure low (potential reversal DOWN)"})

    # Key levels (nearest swing highs/lows to current price)
    resistance_levels = sorted(
        [sh for sh in swing_highs if sh["price"] > price],
        key=lambda x: x["price"]
    )[:5]
    support_levels = sorted(
        [sl for sl in swing_lows if sl["price"] < price],
        key=lambda x: x["price"],
        reverse=True
    )[:5]

    # Nearest unfilled FVGs
    bull_fvgs = [f for f in fvgs if f["type"] == "bullish" and f["gap_high"] < price]
    bear_fvgs = [f for f in fvgs if f["type"] == "bearish" and f["gap_low"]  > price]

    return {
        "ticker":   t,
        "interval": interval,
        "price":    round(price, 4),
        "timestamp": str(df.index[-1])[:19],

        "trend": trend_info,

        "structure_events": bos_events,

        "key_levels": {
            "nearest_resistance": resistance_levels[:3],
            "nearest_support":    support_levels[:3],
            "last_swing_high":    swing_highs[-1] if swing_highs else None,
            "last_swing_low":     swing_lows[-1]  if swing_lows  else None,
        },

        "swing_highs": swing_highs[-10:],  # last 10
        "swing_lows":  swing_lows[-10:],

        "fair_value_gaps": {
            "total":         len(fvgs),
            "bullish_below": bull_fvgs[-3:],  # below price (potential support magnets)
            "bearish_above": bear_fvgs[:3],   # above price (potential resistance magnets)
        },
    }


# ═════════════════════════════════════════════════════════════
# TOOL 6: SUPPORT & RESISTANCE
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_support_resistance(
    ticker: str,
    interval: str = "1d",
    period: str = "1y"
) -> dict:
    """
    Key support and resistance levels from multiple methodologies.

    Methods included:
    1. Pivot Points (classic): P, R1-R3, S1-S3 (from prev session)
    2. Swing High/Low levels: Structural price memory
    3. Round numbers: Psychological levels (nearest $1, $5, $10, $50, $100)
    4. 52-week high/low: Yearly extreme levels
    5. YTD high/low: Year-to-date extremes
    6. Moving average levels: SMA 20/50/200 as dynamic S/R

    Each level includes:
    - price: the level
    - type: category (pivot/swing/round/yearly/MA)
    - distance_pct: % distance from current price
    - above: true if above current price (resistance), false if below (support)
    """
    t = ticker.upper()
    df = _fetch_ohlcv(t, period=period, interval=interval)
    if df is None or df.empty:
        return {"ticker": t, "error": "No data."}

    price = float(df["Close"].iloc[-1])
    levels = []

    def add_level(p, ltype, desc):
        if p and p > 0:
            levels.append({
                "price":        round(p, 4),
                "type":         ltype,
                "description":  desc,
                "distance_pct": round((p / price - 1) * 100, 3),
                "above":        p > price,
            })

    # 1. Pivot points
    pivots = _pivot_points(df)
    for key, val in pivots.items():
        add_level(val, "pivot", f"Classic Pivot {key}")

    # 2. Swing highs/lows
    swing_highs, swing_lows = _detect_swing_highs_lows(df, lookback=5)
    for sh in swing_highs[-8:]:
        add_level(sh["price"], "swing_high", f"Swing High ({sh['time'][:10]})")
    for sl in swing_lows[-8:]:
        add_level(sl["price"], "swing_low", f"Swing Low ({sl['time'][:10]})")

    # 3. Round numbers (psychological levels)
    if price >= 100:
        step = 50 if price >= 500 else 25 if price >= 200 else 10
    elif price >= 10:
        step = 5 if price >= 50 else 1
    else:
        step = 0.5 if price >= 1 else 0.1

    lo_rnd = math.floor(price / step) * step
    for mult in range(-3, 4):
        rnd_level = lo_rnd + mult * step
        if abs(rnd_level - price) / price < 0.15:  # within 15%
            add_level(rnd_level, "round_number", f"Psychological level ${rnd_level}")

    # 4. 52W high/low
    if len(df) >= 50:
        yr_df = df.tail(252)
        add_level(float(yr_df["High"].max()), "52w_high", "52-Week High")
        add_level(float(yr_df["Low"].min()),  "52w_low",  "52-Week Low")

    # 5. YTD high/low
    ytd_start = datetime(datetime.now().year, 1, 1)
    ytd_df = df[df.index >= str(ytd_start)]
    if not ytd_df.empty:
        add_level(float(ytd_df["High"].max()), "ytd_high", "YTD High")
        add_level(float(ytd_df["Low"].min()),  "ytd_low",  "YTD Low")

    # 6. Moving average levels
    c = df["Close"]
    for n, name in [(20, "SMA20"), (50, "SMA50"), (200, "SMA200")]:
        if len(c) >= n:
            ma_val = float(_sma(c, n).iloc[-1])
            if not math.isnan(ma_val):
                add_level(ma_val, "moving_average", f"{name} ({round(ma_val, 2)})")

    # Sort all levels by distance from price
    levels.sort(key=lambda x: abs(x["distance_pct"]))
    resistances = [l for l in levels if l["above"]]
    supports    = [l for l in levels if not l["above"]]
    resistances.sort(key=lambda x: x["price"])
    supports.sort(key=lambda x: x["price"], reverse=True)

    return {
        "ticker":      t,
        "price":       round(price, 4),
        "timestamp":   str(df.index[-1])[:19],
        "pivot_points": pivots,
        "resistances": resistances[:10],
        "supports":    supports[:10],
        "all_levels":  sorted(levels, key=lambda x: x["price"]),
    }


# ═════════════════════════════════════════════════════════════
# TOOL 7: VOLUME ANALYSIS
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_volume_analysis(
    ticker: str,
    interval: str = "1d",
    period: str = "3mo"
) -> dict:
    """
    Volume analysis — institutional footprint and accumulation/distribution.

    Returns:
    - rvol:          Relative Volume vs 20-day average
    - rvol_regime:   LOW | NORMAL | HIGH | EXTREME
    - volume_trend:  Rising or falling volume trend (5-day vs 20-day avg)
    - obv:           On-Balance Volume (cumulative buying vs selling pressure)
    - obv_trend:     OBV direction vs 10 bars ago
    - cmf:           Chaikin Money Flow (-1 to +1, positive = accumulation)
    - vwap:          Volume Weighted Average Price (intraday reference)
    - high_vol_days: Days with RVOL > 2x (institutional activity days)
    - volume_profile_approx: Price buckets with most volume (approx POC)

    CMF interpretation:
    - CMF > +0.1:  Accumulation (buying pressure)
    - CMF < -0.1:  Distribution (selling pressure)
    - CMF ≈ 0:     Neutral / balanced
    """
    t = ticker.upper()
    df = _fetch_ohlcv(t, period=period, interval=interval)
    if df is None or df.empty:
        return {"ticker": t, "error": "No data."}
    if len(df) < 10:
        return {"ticker": t, "error": "Insufficient data."}

    c = df["Close"]
    h = df["High"]
    l = df["Low"]
    v = df["Volume"]
    price = float(c.iloc[-1])

    # RVOL
    vol_sma20 = _sma(v, 20)
    current_vol = int(v.iloc[-1])
    avg_vol20   = int(vol_sma20.iloc[-1]) if not math.isnan(float(vol_sma20.iloc[-1])) else None
    rvol = round(current_vol / avg_vol20, 3) if avg_vol20 else None
    if rvol:
        if rvol >= 2.5:   rvol_regime = "EXTREME"
        elif rvol >= 1.5: rvol_regime = "HIGH"
        elif rvol >= 0.7: rvol_regime = "NORMAL"
        else:             rvol_regime = "LOW"
    else:
        rvol_regime = "N/A"

    # Volume trend (5d vs 20d avg)
    avg5  = float(v.tail(5).mean())
    avg20 = float(v.tail(20).mean())
    vol_trend = "RISING" if avg5 > avg20 * 1.1 else "FALLING" if avg5 < avg20 * 0.9 else "STABLE"

    # OBV
    obv = (np.sign(c.diff()) * v).fillna(0).cumsum()
    obv_current = int(obv.iloc[-1])
    obv_10ago   = int(obv.iloc[-11]) if len(obv) > 10 else obv_current
    obv_trend   = "UP" if obv_current > obv_10ago else "DOWN"

    # CMF (Chaikin Money Flow)
    mfm = ((c - l) - (h - c)) / (h - l).replace(0, float("nan"))
    mfv = mfm * v
    cmf = float(mfv.rolling(20).sum() / v.rolling(20).sum().replace(0, float("nan"))).real
    cmf_val = round(float(mfv.rolling(20).sum().iloc[-1] / v.rolling(20).sum().iloc[-1]), 4)
    if cmf_val > 0.1:    cmf_signal = "ACCUMULATION"
    elif cmf_val < -0.1: cmf_signal = "DISTRIBUTION"
    else:                cmf_signal = "NEUTRAL"

    # VWAP (approximate for the period)
    typical_price = (h + l + c) / 3
    vwap = float((typical_price * v).sum() / v.sum())

    # High volume days (RVOL > 2x)
    high_vol_days = []
    for ts, row in df.tail(30).iterrows():
        avg_at_ts = float(vol_sma20.loc[ts]) if ts in vol_sma20.index and not math.isnan(float(vol_sma20.loc[ts])) else None
        if avg_at_ts and float(row["Volume"]) > avg_at_ts * 2:
            high_vol_days.append({
                "date":    str(ts)[:10],
                "volume":  int(row["Volume"]),
                "avg_vol": int(avg_at_ts),
                "rvol":    round(float(row["Volume"]) / avg_at_ts, 2),
                "close":   round(float(row["Close"]), 4),
                "change_pct": round((float(row["Close"]) / float(row["Open"]) - 1) * 100, 2),
            })

    # Approximate POC (price bucket with most volume)
    if len(df) >= 5:
        bins = 20
        price_range = float(h.max() - l.min())
        bin_size = price_range / bins if price_range > 0 else 1
        buckets = {}
        for i, row in df.iterrows():
            bucket_idx = int((float(row["Close"]) - float(l.min())) / bin_size)
            bucket_idx = min(bucket_idx, bins - 1)
            price_level = round(float(l.min()) + bucket_idx * bin_size, 4)
            buckets[price_level] = buckets.get(price_level, 0) + float(row["Volume"])
        poc_price = max(buckets, key=buckets.get)
        top_buckets = sorted(buckets.items(), key=lambda x: x[1], reverse=True)[:5]
    else:
        poc_price = price
        top_buckets = []

    return {
        "ticker":     t,
        "price":      round(price, 4),
        "interval":   interval,

        "rvol":        rvol,
        "rvol_regime": rvol_regime,
        "current_volume": current_vol,
        "avg_volume_20":  avg_vol20,
        "volume_trend":   vol_trend,

        "obv":       obv_current,
        "obv_trend": obv_trend,

        "cmf":        cmf_val,
        "cmf_signal": cmf_signal,

        "vwap": round(vwap, 4),
        "vwap_dist_pct": round((price / vwap - 1) * 100, 3),

        "high_volume_days": high_vol_days[-5:],  # last 5 high vol events

        "volume_profile_approx": {
            "poc":         round(poc_price, 4),
            "poc_dist_pct": round((price / poc_price - 1) * 100, 3) if poc_price else None,
            "top_buckets": [{"price": p, "volume": int(v2)} for p, v2 in top_buckets],
        },
    }


# ═════════════════════════════════════════════════════════════
# TOOL 8: RELATIVE STRENGTH
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_relative_strength(
    ticker: str,
    benchmark: str = "SPY",
    period: str = "3mo"
) -> dict:
    """
    Relative Strength analysis vs a benchmark.

    Returns:
    - rs_ratio:        ticker return / benchmark return over period
    - outperformance:  % alpha vs benchmark
    - rs_1w, rs_1mo, rs_3mo, rs_6mo, rs_ytd: rolling RS periods
    - rs_trend:        is RS improving or deteriorating?
    - correlation:     correlation coefficient with benchmark (1=perfectly correlated)
    - beta:            beta vs benchmark (computed from returns)
    - alpha:           Jensen's alpha (excess return per unit of risk)

    Args:
        ticker:    Target ticker (e.g. AAPL, QQQ, TSLA)
        benchmark: Reference benchmark (default SPY, can use QQQ, IWM, GLD, etc.)
        period:    Lookback period (3mo, 6mo, 1y)

    Use cases:
    - 'Is NVDA outperforming QQQ right now?'
    - 'What sectors are showing relative strength vs SPY?'
    - 'Is IWM (small caps) leading or lagging SPY?'
    """
    t   = ticker.upper()
    bm  = benchmark.upper()

    df_t  = _fetch_ohlcv(t,  period=period, interval="1d")
    df_bm = _fetch_ohlcv(bm, period=period, interval="1d")

    if df_t is None or df_bm.empty:
        return {"ticker": t, "error": f"No data for {t}."}
    if df_bm is None or df_bm.empty:
        return {"ticker": t, "error": f"No data for benchmark {bm}."}

    # Align on common dates
    common_idx = df_t.index.intersection(df_bm.index)
    if len(common_idx) < 5:
        return {"ticker": t, "error": "Insufficient overlapping dates."}

    t_close  = df_t.loc[common_idx, "Close"].astype(float)
    bm_close = df_bm.loc[common_idx, "Close"].astype(float)

    def _period_return(series, n_days):
        if len(series) < n_days:
            return None
        return round((float(series.iloc[-1]) / float(series.iloc[-n_days]) - 1) * 100, 3)

    t_ret  = _period_return(t_close, len(t_close))
    bm_ret = _period_return(bm_close, len(bm_close))

    rs_ratio = round(t_ret / bm_ret, 4) if bm_ret and bm_ret != 0 else None
    alpha    = round(t_ret - bm_ret, 3) if t_ret is not None and bm_ret is not None else None

    # Rolling RS (RS line = ticker/benchmark price ratio)
    rs_line = t_close / bm_close
    rs_trend = "IMPROVING" if float(rs_line.iloc[-1]) > float(rs_line.iloc[-min(20, len(rs_line))]) else "DETERIORATING"

    # Correlation & Beta
    t_ret_daily  = t_close.pct_change().dropna()
    bm_ret_daily = bm_close.pct_change().dropna()
    common_ret   = pd.concat([t_ret_daily, bm_ret_daily], axis=1).dropna()

    corr = None
    beta_calc = None
    if len(common_ret) >= 10:
        corr = round(float(common_ret.iloc[:, 0].corr(common_ret.iloc[:, 1])), 4)
        cov  = float(common_ret.iloc[:, 0].cov(common_ret.iloc[:, 1]))
        var  = float(common_ret.iloc[:, 1].var())
        beta_calc = round(cov / var, 4) if var != 0 else None

    return {
        "ticker":    t,
        "benchmark": bm,
        "period":    period,

        "returns": {
            "ticker_return_pct":    t_ret,
            "benchmark_return_pct": bm_ret,
            "alpha_pct":            alpha,
            "rs_ratio":             rs_ratio,
        },

        "rolling_rs": {
            "rs_5d":  round(_period_return(t_close, 5)  - _period_return(bm_close, 5),  3)  if _period_return(t_close, 5)  and _period_return(bm_close, 5)  else None,
            "rs_1mo": round(_period_return(t_close, 21) - _period_return(bm_close, 21), 3)  if _period_return(t_close, 21) and _period_return(bm_close, 21) else None,
            "rs_3mo": round(_period_return(t_close, 63) - _period_return(bm_close, 63), 3)  if _period_return(t_close, 63) and _period_return(bm_close, 63) else None,
        },

        "rs_trend":    rs_trend,
        "correlation": corr,
        "beta":        beta_calc,

        "rs_line": {
            "current": round(float(rs_line.iloc[-1]), 6),
            "1mo_ago": round(float(rs_line.iloc[-min(21, len(rs_line))]), 6),
            "3mo_ago": round(float(rs_line.iloc[-min(63, len(rs_line))]), 6),
        }
    }


# ═════════════════════════════════════════════════════════════
# TOOL 9: MARKET CONTEXT (VIX, Futures, Macro)
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_market_context() -> dict:
    """
    Broad market context snapshot — macro environment overview.

    Fetches in parallel:
    - VIX:   CBOE Volatility Index (fear gauge)
    - DXY:   US Dollar Index (DX-Y.NYB)
    - TNX:   10-Year Treasury Yield (^TNX)
    - TYX:   30-Year Treasury Yield (^TYX)
    - GOLD:  Gold spot (GC=F)
    - OIL:   Crude Oil WTI (CL=F)
    - BTC:   Bitcoin (BTC-USD)
    - SPY:   S&P 500 ETF
    - QQQ:   Nasdaq-100 ETF
    - IWM:   Russell 2000 ETF (risk-on gauge)
    - HYG:   High Yield Credit ETF (credit risk gauge)
    - TLT:   Long Bond ETF (flight to safety gauge)

    VIX interpretation:
    - VIX > 30:  HIGH FEAR — large hedging demand, negative gamma likely
    - VIX 20-30: ELEVATED — caution, potential volatility
    - VIX 12-20: NORMAL — typical bull market vol
    - VIX < 12:  COMPLACENCY — risk of vol spike (short squeeze)

    Returns change% for all assets + regime tags.
    """
    tickers_map = {
        "VIX":   "^VIX",
        "DXY":   "DX-Y.NYB",
        "TNX":   "^TNX",
        "TYX":   "^TYX",
        "GOLD":  "GC=F",
        "OIL":   "CL=F",
        "BTC":   "BTC-USD",
        "SPY":   "SPY",
        "QQQ":   "QQQ",
        "IWM":   "IWM",
        "HYG":   "HYG",
        "TLT":   "TLT",
    }

    results = {}
    for name, sym in tickers_map.items():
        try:
            tkr   = yf.Ticker(sym)
            info  = tkr.fast_info
            price = getattr(info, "last_price",     None)
            prev  = getattr(info, "previous_close", None)
            chg_pct = round((price - prev) / prev * 100, 3) if price and prev and prev != 0 else None
            results[name] = {
                "symbol":     sym,
                "price":      round(price, 4) if price else None,
                "change_pct": chg_pct,
            }
        except Exception as e:
            results[name] = {"symbol": sym, "error": str(e)}

    # VIX regime
    vix = results.get("VIX", {}).get("price")
    if vix:
        if vix >= 30:   vix_regime = "HIGH_FEAR"
        elif vix >= 20: vix_regime = "ELEVATED"
        elif vix >= 12: vix_regime = "NORMAL"
        else:           vix_regime = "COMPLACENCY"
        results["VIX"]["regime"] = vix_regime

    # Risk-on/off assessment
    spy_chg = results.get("SPY",  {}).get("change_pct", 0) or 0
    tlt_chg = results.get("TLT",  {}).get("change_pct", 0) or 0
    hyg_chg = results.get("HYG",  {}).get("change_pct", 0) or 0
    iwm_chg = results.get("IWM",  {}).get("change_pct", 0) or 0
    dxy_chg = results.get("DXY",  {}).get("change_pct", 0) or 0

    risk_score = spy_chg + hyg_chg + iwm_chg - tlt_chg - dxy_chg
    if risk_score > 1.5:   risk_mode = "RISK_ON"
    elif risk_score < -1.5: risk_mode = "RISK_OFF"
    else:                   risk_mode = "NEUTRAL"

    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "assets":    results,
        "market_regime": {
            "risk_mode":  risk_mode,
            "risk_score": round(risk_score, 3),
            "vix_regime": vix_regime if vix else "N/A",
            "desc": (
                "Equities + credit leading up, bonds/dollar down → RISK ON environment" if risk_mode == "RISK_ON" else
                "Bonds/dollar leading up, equities/credit down → RISK OFF environment"  if risk_mode == "RISK_OFF" else
                "Mixed signals — no clear risk-on/off bias"
            )
        }
    }


# ═════════════════════════════════════════════════════════════
# TOOL 10: SECTOR HEATMAP
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_sector_performance(period: str = "1d") -> dict:
    """
    US Equity Sector ETF performance heatmap.

    Tracks all 11 GICS sectors via SPDR ETFs:
    XLK (Tech), XLV (Healthcare), XLF (Financials), XLC (Comm Services),
    XLY (Consumer Disc), XLP (Consumer Staples), XLE (Energy),
    XLI (Industrials), XLB (Materials), XLRE (Real Estate), XLU (Utilities)

    Plus factor ETFs: QQQ (growth), IWM (small cap), GLD (gold), TLT (bonds)

    Returns:
    - Each sector's price, change_pct, and volume
    - Leading sectors (top 3 by change)
    - Lagging sectors (bottom 3 by change)
    - Sector rotation signal (which areas showing strength)

    Args:
        period: '1d' for today, '1wk' for week, '1mo' for month
    """
    sectors = {
        "XLK":  "Technology",
        "XLV":  "Healthcare",
        "XLF":  "Financials",
        "XLC":  "Comm Services",
        "XLY":  "Consumer Disc",
        "XLP":  "Consumer Staples",
        "XLE":  "Energy",
        "XLI":  "Industrials",
        "XLB":  "Materials",
        "XLRE": "Real Estate",
        "XLU":  "Utilities",
    }
    extras = {
        "QQQ": "Nasdaq-100 (Growth)",
        "IWM": "Russell 2000 (Small Cap)",
        "GLD": "Gold",
        "TLT": "Long Bonds",
        "HYG": "High Yield Credit",
    }
    all_etfs = {**sectors, **extras}

    results = {}
    errors  = []
    for sym, name in all_etfs.items():
        try:
            tkr   = yf.Ticker(sym)
            info  = tkr.fast_info
            price = getattr(info, "last_price",     None)
            prev  = getattr(info, "previous_close", None)
            vol   = getattr(info, "last_volume",    None)
            chg_pct = round((price - prev) / prev * 100, 3) if price and prev and prev != 0 else None

            results[sym] = {
                "name":       name,
                "price":      round(price, 2) if price else None,
                "change_pct": chg_pct,
                "volume":     vol,
            }
        except Exception as e:
            errors.append(f"{sym}: {e}")

    # Sort by performance
    sortable = [(sym, d) for sym, d in results.items() if d.get("change_pct") is not None]
    sortable.sort(key=lambda x: x[1]["change_pct"], reverse=True)

    leaders  = sortable[:3]
    laggards = sortable[-3:]

    # Risk-on/off signal
    defensive  = ["XLU", "XLP", "XLV", "TLT", "GLD"]
    aggressive = ["XLK", "XLY", "XLE", "QQQ", "IWM"]

    def_avg = sum(results[s]["change_pct"] for s in defensive if s in results and results[s].get("change_pct")) / len(defensive)
    agg_avg = sum(results[s]["change_pct"] for s in aggressive if s in results and results[s].get("change_pct")) / len(aggressive)

    if agg_avg > def_avg + 0.3:   rotation = "RISK_ON — Aggressive sectors leading"
    elif def_avg > agg_avg + 0.3: rotation = "RISK_OFF — Defensive sectors leading"
    else:                          rotation = "MIXED — No clear sector rotation"

    return {
        "period":   period,
        "sectors":  results,
        "ranking":  [(sym, d["change_pct"]) for sym, d in sortable],
        "leaders":  [(sym, d["name"], d["change_pct"]) for sym, d in leaders],
        "laggards": [(sym, d["name"], d["change_pct"]) for sym, d in laggards],
        "sector_rotation": rotation,
        "defensive_avg_pct":  round(def_avg, 3),
        "aggressive_avg_pct": round(agg_avg, 3),
        "errors": errors,
    }


# ═════════════════════════════════════════════════════════════
# ENTRY POINT
# ═════════════════════════════════════════════════════════════

log.info("All tools registered. Server ready.")

if __name__ == "__main__":
    mcp.run()

"""
data_layer.py
=============
Fetch, clean, dan preprocess OHLCV data dari Yahoo Finance.
Output: return series siap pakai untuk Phase 2 modeling.

Dependencies:
    pip install yfinance pandas numpy scipy
"""

import yfinance as yf
import pandas as pd
import numpy as np
from scipy import stats
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
import warnings
warnings.filterwarnings("ignore")


# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

SESSION_CUTS = {
    "pre_market":  ("04:00", "09:29"),
    "ny_open":     ("09:30", "11:59"),
    "midday":      ("12:00", "13:59"),
    "power_hour":  ("14:00", "16:00"),
}


# ─────────────────────────────────────────────
# 1. FETCH DATA
# ─────────────────────────────────────────────

def fetch_data(
    ticker: str,
    period: str = "5y",
    interval: str = "1d",
) -> pd.DataFrame:
    """
    Fetch OHLCV dari Yahoo Finance.

    Args:
        ticker   : ticker symbol, e.g. "NQ=F", "^GSPC", "SPY", "QQQ"
        period   : "1y", "2y", "5y", "10y", "max"
        interval : "1m","5m","15m","1h","1d" — intraday max 60 hari di yfinance
    
    Returns:
        DataFrame dengan kolom Open, High, Low, Close, Volume
    """
    print(f"[DataLayer] Fetching {ticker} | period={period} | interval={interval}")
    
    raw = yf.download(ticker, period=period, interval=interval, auto_adjust=True, progress=False)
    
    if raw.empty:
        raise ValueError(f"Tidak ada data untuk ticker '{ticker}'. Cek simbol.")
    
    # Flatten multi-level columns kalau ada
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    
    df = raw[["Open", "High", "Low", "Close", "Volume"]].copy()
    df.index = pd.to_datetime(df.index)
    df.dropna(inplace=True)
    
    print(f"[DataLayer] Data fetched: {len(df)} bars | {df.index[0].date()} → {df.index[-1].date()}")
    return df


# ─────────────────────────────────────────────
# 1B. FETCH ECONOMIC CALENDAR
# ─────────────────────────────────────────────

def fetch_economic_calendar() -> pd.DataFrame:
    """
    Fetch kalender ekonomi mingguan dari sumber gratis (ForexFactory XML feed).
    Feed URL: https://nfs.faireconomy.media/ff_calendar_thisweek.xml
    """
    try:
        url = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        
        root = ET.fromstring(resp.content)
        events = []
        for item in root.findall('event'):
            title = item.find('title').text if item.find('title') is not None else ""
            country = item.find('country').text if item.find('country') is not None else ""
            date_str = item.find('date').text if item.find('date') is not None else ""
            time_str = item.find('time').text if item.find('time') is not None else ""
            impact = item.find('impact').text if item.find('impact') is not None else "Low"
            forecast = item.find('forecast').text if item.find('forecast') is not None else ""
            previous = item.find('previous').text if item.find('previous') is not None else ""
            
            # Handling format waktu
            dt_str = f"{date_str} {time_str}"
            try:
                # Format: "04-26-2026 8:30am" atau sejenisnya
                dt = datetime.strptime(dt_str.strip(), "%m-%d-%Y %I:%M%p")
            except ValueError:
                dt = None
            
            events.append({
                "datetime": dt,
                "country": country,
                "title": title,
                "impact": impact,
                "forecast": forecast,
                "previous": previous
            })
            
        df = pd.DataFrame(events)
        if not df.empty:
            df.dropna(subset=['datetime'], inplace=True)
            df.sort_values("datetime", inplace=True)
            df.set_index("datetime", inplace=True)
            
        print(f"[DataLayer] Econ Calendar fetched: {len(df)} events this week.")
        return df
        
    except Exception as e:
        print(f"[DataLayer] Gagal fetch Economic Calendar: {e}")
        return pd.DataFrame()


# ─────────────────────────────────────────────
# 2. RETURN SERIES
# ─────────────────────────────────────────────

def compute_log_returns(df: pd.DataFrame, price_col: str = "Close") -> pd.Series:
    """
    Hitung log returns dari price series.
    Log returns: r_t = ln(P_t / P_{t-1})
    Additive across time dan lebih well-behaved secara statistik vs arithmetic.
    """
    prices = df[price_col].dropna()
    log_ret = np.log(prices / prices.shift(1)).dropna()
    log_ret.name = "log_return"
    return log_ret


def split_by_session(df: pd.DataFrame) -> dict[str, pd.Series]:
    """
    Split intraday data ke session-session berbeda.
    Hanya relevan kalau interval < 1d.
    Kalau daily data, return dict dengan key 'full'.
    """
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index)
    
    # Cek apakah data intraday
    if (df.index.hour == 0).all():
        # Daily data — return langsung
        log_ret = compute_log_returns(df)
        return {"full": log_ret}
    
    sessions = {}
    for name, (start, end) in SESSION_CUTS.items():
        mask = (df.index.time >= pd.Timestamp(start).time()) & \
               (df.index.time <= pd.Timestamp(end).time())
        slice_df = df[mask]
        if len(slice_df) > 0:
            sessions[name] = compute_log_returns(slice_df)
    
    return sessions


# ─────────────────────────────────────────────
# 3. FEATURE ENGINEERING
# ─────────────────────────────────────────────

def engineer_features(df: pd.DataFrame, log_returns: pd.Series) -> pd.DataFrame:
    """
    Construct features untuk regime classifier:
    - Realized volatility (rolling 5d, 20d, 60d)
    - ATR normalized
    - Volume ratio
    - Bid-ask spread proxy (High-Low / Close)
    - Return autocorrelation rolling
    - Skewness rolling 20d
    """
    feat = pd.DataFrame(index=df.index)
    
    # Align log_returns ke df index
    ret = log_returns.reindex(df.index)
    
    # Realized volatility (annualized, sqrt(252) untuk daily)
    feat["rvol_5d"]  = ret.rolling(5).std()  * np.sqrt(252)
    feat["rvol_20d"] = ret.rolling(20).std() * np.sqrt(252)
    feat["rvol_60d"] = ret.rolling(60).std() * np.sqrt(252)
    
    # ATR normalized
    high_low   = df["High"] - df["Low"]
    high_close = (df["High"] - df["Close"].shift(1)).abs()
    low_close  = (df["Low"]  - df["Close"].shift(1)).abs()
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    feat["atr_norm"] = true_range.rolling(14).mean() / df["Close"]
    
    # Volume ratio (current vs 20d avg)
    feat["vol_ratio"] = df["Volume"] / df["Volume"].rolling(20).mean()
    
    # Bid-ask spread proxy
    feat["spread_proxy"] = (df["High"] - df["Low"]) / df["Close"]
    
    # Return autocorrelation rolling (trend vs mean-revert signal)
    feat["autocorr_5d"] = ret.rolling(10).apply(
        lambda x: x.autocorr(lag=1) if len(x) > 2 else np.nan, raw=False
    )
    
    # Rolling skewness (fear indicator)
    feat["skew_20d"] = ret.rolling(20).skew()
    
    feat.dropna(inplace=True)
    
    print(f"[DataLayer] Features engineered: {feat.shape[1]} features | {len(feat)} bars")
    return feat


# ─────────────────────────────────────────────
# 4. OUTLIER HANDLING
# ─────────────────────────────────────────────

def flag_outliers(log_returns: pd.Series, z_thresh: float = 5.0) -> pd.DataFrame:
    """
    Flag outlier di return series.
    - z_thresh > 5σ: kandidat data error
    - Bedakan error vs genuine fat tail event — disini hanya di-flag, bukan dihapus.
    
    Returns:
        DataFrame dengan kolom: log_return, z_score, is_outlier
    """
    z = stats.zscore(log_returns.dropna())
    result = pd.DataFrame({
        "log_return": log_returns,
        "z_score": pd.Series(z, index=log_returns.index),
        "is_outlier": pd.Series(np.abs(z) > z_thresh, index=log_returns.index),
    })
    
    n_outliers = result["is_outlier"].sum()
    print(f"[DataLayer] Outliers flagged (|z| > {z_thresh}): {n_outliers} bars")
    return result


# ─────────────────────────────────────────────
# 5. MASTER PIPELINE
# ─────────────────────────────────────────────

def build_dataset(
    ticker: str,
    period: str = "5y",
    interval: str = "1d",
    outlier_thresh: float = 5.0,
    include_calendar: bool = True,
) -> dict:
    """
    Master pipeline: fetch → compute returns → feature engineering → outlier flagging.
    
    Returns dict dengan keys:
        'raw_df'       : raw OHLCV DataFrame
        'log_returns'  : log return Series (full, outliers masih ada — genuine fat tail)
        'returns_flagged': DataFrame dengan z_score dan is_outlier flag
        'sessions'     : dict of session-split return series
        'features'     : engineered feature DataFrame
        'calendar'     : economic calendar DataFrame
        'ticker'       : ticker symbol
        'interval'     : interval yang dipakai
    """
    raw_df       = fetch_data(ticker, period=period, interval=interval)
    log_returns  = compute_log_returns(raw_df)
    ret_flagged  = flag_outliers(log_returns, z_thresh=outlier_thresh)
    sessions     = split_by_session(raw_df)
    features     = engineer_features(raw_df, log_returns)
    calendar_df  = fetch_economic_calendar() if include_calendar else pd.DataFrame()
    
    print(f"[DataLayer] Dataset built successfully for {ticker}.")
    
    return {
        "ticker":           ticker,
        "interval":         interval,
        "raw_df":           raw_df,
        "log_returns":      log_returns,
        "returns_flagged":  ret_flagged,
        "sessions":         sessions,
        "features":         features,
        "calendar":         calendar_df,
    }

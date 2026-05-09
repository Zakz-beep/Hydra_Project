import numpy as np
import pandas as pd
import yfinance as yf
from dataclasses import dataclass, asdict
from typing import Optional

# ── CONFIG ───────────────────────────────────────────────────
START        = "2010-01-01"
LOOKBACK_VOL = 60
ZSCORE_WIN   = 252

COMPONENTS = {
    "SHY":  {"weight": 0.10, "dur": 1.9,  "label": "1-3Y Treasury"},
    "IEF":  {"weight": 0.20, "dur": 7.5,  "label": "7-10Y Treasury"},
    "TLT":  {"weight": 0.12, "dur": 17.0, "label": "20Y+ Treasury"},
    "LQD":  {"weight": 0.18, "dur": 8.5,  "label": "IG Corporate"},
    "MBB":  {"weight": 0.13, "dur": 6.0,  "label": "MBS"},
    "IGOV": {"weight": 0.15, "dur": 8.0,  "label": "Intl Government"},
    "BWX":  {"weight": 0.07, "dur": 7.2,  "label": "Intl Treasury"},
    "AGG":  {"weight": 0.05, "dur": 6.3,  "label": "US Aggregate"},
}

BENCHMARK  = "AGG"
EQUITY_REF = "SPY"

# ── DATACLASSES (struktur output) ────────────────────────────
@dataclass
class RegimeData:
    label: str
    bond_equity_corr: float
    roc_20d: float
    roc_60d: float
    momentum_signal: str     # "accelerating" | "fading" | "reversing"
    hedge_active: bool        # apakah bonds masih jadi safe haven

@dataclass
class PerformanceData:
    effective_duration: float
    annual_return_pct: float
    annual_vol_pct: float
    sharpe_ratio: float
    max_drawdown_pct: float
    tracking_error_pct: float
    corr_vs_benchmark: float

@dataclass
class ProxySnapshot:
    timestamp: str
    index_value: float
    daily_return_pct: float
    regime: RegimeData
    performance: PerformanceData

# ── CORE FUNCTIONS ───────────────────────────────────────────
def fetch_data(start: str = START) -> dict[str, pd.Series]:
    tickers = list(COMPONENTS.keys()) + [BENCHMARK, EQUITY_REF]
    raw = yf.download(tickers, start=start, auto_adjust=True, progress=False)["Close"]
    raw.dropna(how="all", inplace=True)
    raw.ffill(inplace=True)
    return {t: raw[t] for t in tickers}

def build_proxy(data: dict[str, pd.Series]) -> tuple[pd.Series, pd.Series]:
    prices  = pd.DataFrame({k: data[k] for k in COMPONENTS})
    returns = prices.pct_change().dropna()
    w = pd.Series({k: v["weight"] for k, v in COMPONENTS.items()})
    w = w / w.sum()
    proxy_ret   = returns[list(COMPONENTS.keys())].dot(w)
    proxy_index = (1 + proxy_ret).cumprod() * 100
    return proxy_ret, proxy_index

def compute_performance(
    proxy_ret:   pd.Series,
    proxy_index: pd.Series,
    bench_ret:   pd.Series
) -> PerformanceData:
    dur    = pd.Series({k: v["dur"] for k, v in COMPONENTS.items()})
    w      = pd.Series({k: v["weight"] for k, v in COMPONENTS.items()})
    w      = w / w.sum()
    eff_dur = (w * dur).sum()

    aligned      = pd.concat([proxy_ret, bench_ret], axis=1).dropna()
    track_err    = (aligned.iloc[:,0] - aligned.iloc[:,1]).std() * np.sqrt(252) * 100
    annual_ret   = proxy_ret.mean() * 252 * 100
    annual_vol   = proxy_ret.std()  * np.sqrt(252) * 100
    sharpe       = annual_ret / annual_vol if annual_vol != 0 else 0.0
    max_dd       = ((proxy_index / proxy_index.cummax()) - 1).min() * 100
    corr_bench   = aligned.iloc[:,0].corr(aligned.iloc[:,1])

    return PerformanceData(
        effective_duration  = round(eff_dur, 2),
        annual_return_pct   = round(annual_ret, 4),
        annual_vol_pct      = round(annual_vol, 4),
        sharpe_ratio        = round(sharpe, 4),
        max_drawdown_pct    = round(max_dd, 4),
        tracking_error_pct  = round(track_err, 4),
        corr_vs_benchmark   = round(corr_bench, 4),
    )

def classify_regime(corr: float, roc_20d: float, roc_60d: float) -> RegimeData:
    if corr < -0.3 and roc_20d > 0:
        label = "RISK_OFF"
    elif corr > 0.3 and roc_20d < 0:
        label = "INFLATION_SHOCK"
    elif corr > 0.3 and roc_20d > 0:
        label = "REFLATION"
    else:
        label = "NEUTRAL"

    if roc_20d > roc_60d and roc_20d > 0:
        momentum = "accelerating"
    elif roc_20d < roc_60d and roc_20d > 0:
        momentum = "fading"
    elif roc_20d < 0:
        momentum = "reversing"
    else:
        momentum = "fading"

    return RegimeData(
        label            = label,
        bond_equity_corr = round(corr, 4),
        roc_20d          = round(roc_20d, 4),
        roc_60d          = round(roc_60d, 4),
        momentum_signal  = momentum,
        hedge_active     = corr < -0.2,
    )

def compute_regime(
    proxy_ret:   pd.Series,
    proxy_index: pd.Series,
    equity_ret:  pd.Series,
) -> RegimeData:
    equity_aligned = equity_ret.reindex(proxy_ret.index).ffill()
    corr    = proxy_ret.rolling(LOOKBACK_VOL).corr(equity_aligned).iloc[-1]
    roc_20d = proxy_index.pct_change(20).iloc[-1] * 100
    roc_60d = proxy_index.pct_change(60).iloc[-1] * 100
    return classify_regime(float(corr), float(roc_20d), float(roc_60d))

# ── MAIN ENTRY POINT ─────────────────────────────────────────
def get_snapshot(start: str = START) -> dict:
    data        = fetch_data(start)
    proxy_ret, proxy_index = build_proxy(data)
    bench_ret   = data[BENCHMARK].pct_change().dropna()
    equity_ret  = data[EQUITY_REF].pct_change().dropna()

    regime      = compute_regime(proxy_ret, proxy_index, equity_ret)
    performance = compute_performance(proxy_ret, proxy_index, bench_ret)

    snapshot = ProxySnapshot(
        timestamp       = pd.Timestamp.now().isoformat(),
        index_value     = round(float(proxy_index.iloc[-1]), 4),
        daily_return_pct= round(float(proxy_ret.iloc[-1]) * 100, 4),
        regime          = regime,
        performance     = performance,
    )
    return asdict(snapshot)

def get_history(start: str = START, tail: Optional[int] = None) -> list[dict]:
    data        = fetch_data(start)
    proxy_ret, proxy_index = build_proxy(data)
    equity_ret  = data[EQUITY_REF].pct_change().dropna()
    equity_al   = equity_ret.reindex(proxy_ret.index).ffill()

    roll_corr   = proxy_ret.rolling(LOOKBACK_VOL).corr(equity_al)
    roc_20      = proxy_index.pct_change(20) * 100
    roc_60      = proxy_index.pct_change(60) * 100

    df = pd.DataFrame({
        "date":       proxy_index.index,
        "index_value": proxy_index.values,
        "daily_return": proxy_ret.values * 100,
        "corr":        roll_corr.values,
        "roc_20d":     roc_20.values,
        "roc_60d":     roc_60.values,
    }).dropna()

    df["regime"] = df.apply(
        lambda r: classify_regime(r["corr"], r["roc_20d"], r["roc_60d"]).label, axis=1
    )
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")

    if tail:
        df = df.tail(tail)

    return df.round(4).to_dict(orient="records")

# ── USAGE EXAMPLE ────────────────────────────────────────────
if __name__ == "__main__":
    import json

    # Latest snapshot (untuk endpoint /snapshot)
    snap = get_snapshot()
    print(json.dumps(snap, indent=2))

    # History 30 hari terakhir (untuk endpoint /history)
    hist = get_history(tail=30)
    print(json.dumps(hist[-3:], indent=2))  # preview 3 terakhir
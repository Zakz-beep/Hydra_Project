"""Pure research calculations; no synthetic prices, weights or dealer positions."""
import math
import numpy as np
import pandas as pd


def finite(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (ValueError, TypeError):
        return None


def daily_close(series):
    result = pd.to_numeric(series, errors="coerce").copy()
    index = pd.DatetimeIndex(result.index)
    if index.tz is not None:
        index = index.tz_convert("America/New_York").tz_localize(None)
    result.index = index.normalize()
    result = result.loc[~result.index.duplicated(keep="last")].sort_index()
    return result.where(np.isfinite(result) & (result > 0))


def rv_vix_history(spx, vix):
    """30 calendar day daily-close proxy: 100 sqrt(365/30 * sum(log returns²)).

    Return endpoints belong to (start, end]. Boundary returns are not split.
    Forward outcomes are published only once the complete target window has elapsed
    in the supplied SPX history. Trailing values never use a future return.
    """
    prices, implied = daily_close(spx), daily_close(vix)
    if len(prices) < 35 or prices.dropna().empty:
        raise ValueError("At least 35 daily S&P 500 observations are required.")
    returns = np.log(prices / prices.shift(1))
    gaps = prices.index.to_series().diff().dt.days.gt(4)
    bad = returns.isna() | gaps
    variance = returns.pow(2).fillna(0).cumsum()
    invalid = bad.astype(int).cumsum()
    dates = prices.index

    def window(start, end):
        if start < dates[0] or end > dates[-1]:
            return None, 0
        left, right = int(dates.searchsorted(start, side="right")), int(dates.searchsorted(end, side="right"))
        if right <= left:
            return None, 0
        count_bad = int(invalid.iloc[right - 1] - (invalid.iloc[left - 1] if left else 0))
        if count_bad:
            return None, right - left
        total = float(variance.iloc[right - 1] - (variance.iloc[left - 1] if left else 0))
        return 100 * math.sqrt(max(0, total) * 365 / 30), right - left

    rows = []
    for date in dates.intersection(implied.index):
        vix_value = finite(implied.loc[date])
        if vix_value is None:
            continue
        trailing, n = window(date - pd.Timedelta(days=30), date)
        target = date + pd.Timedelta(days=30)
        forward, m = window(date, target)
        rows.append({
            "date": date.strftime("%Y-%m-%d"), "vix": vix_value,
            "rv_trailing": trailing, "rv_forward": forward,
            "trailing_returns": n, "forward_returns": m,
            "forward_target": target.strftime("%Y-%m-%d"),
            "vol_spread": vix_value - trailing if trailing is not None else None,
            "variance_spread": vix_value ** 2 - trailing ** 2 if trailing is not None else None,
            "forward_variance_gap": vix_value ** 2 - forward ** 2 if forward is not None else None,
        })
    if not rows:
        raise ValueError("No common dated S&P 500 and VIX observations.")
    matured = [row for row in rows if row["rv_forward"] is not None]
    return {"rows": rows, "latest": rows[-1], "evaluation": {
        "samples": len(matured),
        "mean_forward_variance_gap": float(np.mean([r["forward_variance_gap"] for r in matured])) if matured else None,
        "vix_above_forward_pct": 100 * sum(r["vix"] > r["rv_forward"] for r in matured) / len(matured) if matured else None,
    }}


def relative_metrics(etf, stock, window=60):
    """Pair only one-day returns with identical start AND end dates."""
    a, b = daily_close(etf), daily_close(stock)
    a_start, b_start = a.index.to_series().shift(1), b.index.to_series().shift(1)
    paired = pd.concat({"etf": a.pct_change(fill_method=None), "stock": b.pct_change(fill_method=None),
                        "a_start": a_start, "b_start": b_start}, axis=1)
    paired = paired.loc[paired.a_start == paired.b_start].dropna().tail(window)
    output = {"samples": len(paired), "beta": None, "correlation": None, "relative_return_20": None, "asof": None}
    if not paired.empty:
        output["asof"] = paired.index[-1].strftime("%Y-%m-%d")
    if len(paired) >= 20:
        variance = paired.etf.var(ddof=1)
        output["beta"] = finite(paired.stock.cov(paired.etf) / variance) if variance > 0 else None
        output["correlation"] = finite(paired.stock.corr(paired.etf)) if paired.stock.std() > 0 and variance > 0 else None
    prices = pd.concat({"etf": a, "stock": b}, axis=1).dropna().tail(21)
    if len(prices) == 21:
        output["relative_return_20"] = float(((prices.stock.iloc[-1] / prices.stock.iloc[0]) /
                                             (prices.etf.iloc[-1] / prices.etf.iloc[0]) - 1) * 100)
    return output


def holdings_rows(frame):
    rows, seen = [], set()
    for symbol, row in frame.iterrows():
        symbol = str(symbol).strip().upper().replace(".", "-")
        weight = finite(row.get("Holding Percent"))
        if not symbol or symbol in seen or weight is None or not 0 < weight <= 1:
            continue
        seen.add(symbol)
        rows.append({"symbol": symbol, "name": str(row.get("Name") or symbol), "weight": weight})
    rows.sort(key=lambda r: r["weight"], reverse=True)
    rows = rows[:10]
    if not rows or sum(r["weight"] for r in rows) > 1.001:
        raise ValueError("Provider holdings are missing or their weights are invalid.")
    return rows


def exposure_summary(snapshot):
    live = snapshot.get("data_source") == "live"
    provenance = snapshot.get('provenance', {})
    net = finite(snapshot.get("total_net_gex")) if live else None
    gross = finite(snapshot.get("total_gross_gex")) if live else None
    return {"ticker": snapshot.get("ticker"), "source": f"{provenance['provider']} / {provenance.get('feed', 'unknown')}" if provenance.get('provider') else snapshot.get("data_source", "unknown"),
            "provenance": provenance,
            "timestamp": snapshot.get("timestamp"), "stale": bool(snapshot.get("cache", {}).get("stale")),
            "net_gex": net * 1e7 if net is not None else None,
            "gross_gex": gross * 1e7 if gross is not None else None,
            "balance": net / gross if net is not None and gross and gross > 0 else None,
            "gamma_flip": finite(snapshot.get("gamma_flip")) if live else None,
            "spot": finite(snapshot.get("spot")) if live else None,
            "note": ("Call-positive / put-negative model; not observed dealer inventory. " + ("Indicative quotes are modified; this is not executable OPRA pricing." if provenance.get('feed')=='indicative' else "")) if live else "Synthetic or mixed chain excluded from comparison."}

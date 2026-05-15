"""
dispersion_engine.py — Dispersion Trading & Implied Correlation Calculator
===========================================================================
Menghitung Implied Correlation dari harga opsi index vs konstituen,
Realized Correlation dari return historis, dan sinyal Dispersion Trading.

Teori Dispersion Trading:
    σ²_index ≈ Σᵢ wᵢ²σᵢ² + 2·Σᵢ<ⱼ wᵢwⱼσᵢσⱼ·ρᵢⱼ

Dalam bentuk disederhanakan (single avg correlation):
    σ²_index ≈ (Σᵢ wᵢσᵢ)² · ρ_avg  +  Σᵢ wᵢ²σᵢ² · (1 - ρ_avg)

Dari sini kita isolasi ρ_implied:
    ρ_implied = (σ²_index - Σᵢ wᵢ²σᵢ²) / [(Σᵢ wᵢσᵢ)² - Σᵢ wᵢ²σᵢ²]

Spread = ρ_implied - ρ_realized
  → Positif tinggi: Index vol overpriced → SHORT Dispersion
  → Negatif ekstrem: Index vol underpriced → LONG Dispersion
"""

import numpy as np
import yfinance as yf
import time
import threading
from typing import Optional
from datetime import datetime

# Import SVI model untuk SVI-Smoothed IV
from svi_model import fit_svi, svi_iv

# ═══════════════════════════════════════════════
# STATIC FALLBACK CONFIGURATION
# ═══════════════════════════════════════════════

# Hanya dipakai jika dynamic fetch gagal total
DEFAULT_INDEX_CONFIG = {
    "SPY": {
        "constituents": ["XLK", "XLF", "XLV", "XLC", "XLY", "XLP", "XLE", "XLI", "XLRE", "XLB", "XLU"],
        "weights":      [0.310, 0.130, 0.120, 0.090, 0.100, 0.060, 0.035, 0.085, 0.025, 0.025, 0.025],
    },
    "QQQ": {
        "constituents": ["AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "AVGO", "TSLA", "COST", "NFLX"],
        "weights":      [0.090, 0.080, 0.075, 0.055, 0.050, 0.050, 0.040, 0.035, 0.030, 0.025],
    },
    "IWM": {
        "constituents": ["XLK", "XLF", "XLV", "XLC", "XLY", "XLP", "XLE", "XLI", "XLRE", "XLB", "XLU"],
        "weights":      [0.150, 0.160, 0.140, 0.040, 0.100, 0.040, 0.060, 0.140, 0.060, 0.050, 0.060],
    },
}


# ═══════════════════════════════════════════════
# DYNAMIC SECTOR PROXY + MARKET-CAP WEIGHTING
# ═══════════════════════════════════════════════

# 11 Select Sector SPDR ETFs — dekomposisi 100% dari S&P 500
# Setiap ETF ini melacak satu sektor dari S&P 500.
# Gabungan ke-11 ETF = SPY secara utuh.
SPY_SECTOR_ETFS = [
    {"ticker": "XLK",  "name": "Technology"},
    {"ticker": "XLF",  "name": "Financials"},
    {"ticker": "XLV",  "name": "Health Care"},
    {"ticker": "XLC",  "name": "Comm Services"},
    {"ticker": "XLY",  "name": "Consumer Disc"},
    {"ticker": "XLP",  "name": "Consumer Staples"},
    {"ticker": "XLE",  "name": "Energy"},
    {"ticker": "XLI",  "name": "Industrials"},
    {"ticker": "XLRE", "name": "Real Estate"},
    {"ticker": "XLB",  "name": "Materials"},
    {"ticker": "XLU",  "name": "Utilities"},
]

# IWM juga bisa di-proxy dengan sector ETFs (approx, karena weight sektor berbeda)
IWM_SECTOR_ETFS = SPY_SECTOR_ETFS  # Sama ETF-nya, tapi bobot akan berbeda via market cap

# Top 10 Nasdaq-100 holdings by market cap (~55% coverage QQQ)
QQQ_TOP_HOLDINGS = ["AAPL", "MSFT", "NVDA", "AMZN", "META",
                    "GOOGL", "AVGO", "TSLA", "COST", "NFLX"]

# Semua indeks yang didukung
SUPPORTED_INDICES = ["SPY", "QQQ", "IWM"]


# ═══════════════════════════════════════════════
# DYNAMIC WEIGHT CACHE (1 jam TTL)
# ═══════════════════════════════════════════════

_weight_cache: dict = {}
_weight_cache_ts: dict = {}
WEIGHT_CACHE_TTL = 3600  # 1 jam — bobot sektor stabil intraday


def _fetch_dynamic_weights(
    tickers: list[str],
    use_total_assets: bool = False,
) -> Optional[dict]:
    """
    Fetch Market Cap (untuk saham) atau Total Assets/AUM (untuk ETF)
    secara paralel, lalu hitung bobot dinamis.

    Args:
        tickers         : list ticker untuk di-fetch
        use_total_assets: True  → pakai totalAssets (untuk ETF)
                          False → pakai marketCap (untuk saham individual)

    Returns:
        dict {
            "constituents": [ticker_sorted_by_weight_desc],
            "weights":      [normalized_weight],
            "market_caps":  {ticker: cap_value},
            "total":        total_cap,
        }
        atau None jika gagal
    """
    cache_key = f"wt_{'etf' if use_total_assets else 'mc'}_{'_'.join(sorted(tickers))}"
    now = time.time()

    if cache_key in _weight_cache and (now - _weight_cache_ts.get(cache_key, 0)) < WEIGHT_CACHE_TTL:
        return _weight_cache[cache_key]

    caps: dict[str, float] = {}
    lock = threading.Lock()

    def _worker(tkr: str):
        try:
            info = yf.Ticker(tkr).info
            if use_total_assets:
                # ETF: totalAssets (AUM) lebih representatif
                val = info.get("totalAssets") or info.get("marketCap") or 0
            else:
                # Saham: marketCap
                val = info.get("marketCap") or info.get("totalAssets") or 0
            if val and val > 0:
                with lock:
                    caps[tkr] = float(val)
        except Exception:
            pass

    threads = [threading.Thread(target=_worker, args=(t,), daemon=True) for t in tickers]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    if len(caps) < 2:
        return None

    total = sum(caps.values())
    if total <= 0:
        return None

    # Sort by weight descending (sektor terbesar di atas)
    sorted_items = sorted(caps.items(), key=lambda x: x[1], reverse=True)

    result = {
        "constituents": [tkr for tkr, _ in sorted_items],
        "weights":      [cap / total for _, cap in sorted_items],
        "market_caps":  {tkr: cap for tkr, cap in sorted_items},
        "total":        total,
    }

    _weight_cache[cache_key] = result
    _weight_cache_ts[cache_key] = now
    return result


def get_dynamic_index_config(index: str) -> Optional[dict]:
    """
    Entry point utama: ambil konfigurasi konstituen + bobot dinamis.

    SPY → 11 SPDR Sector ETFs (100% coverage, Sector Proxy)
    QQQ → Top 10 Nasdaq-100 holdings (Market-Cap weighted)
    IWM → 11 Sector ETFs (approx proxy, bobot berbeda dari SPY)

    Falls back ke DEFAULT_INDEX_CONFIG jika fetch gagal.

    Returns:
        dict {
            "constituents":  [tickers],
            "weights":       [normalized_weights],
            "method":        "sector_proxy" | "market_cap_top10" | "static_fallback",
            "coverage":      "~100%" | "~55%" | "~25%",
            "sector_names":  {ticker: name} (hanya untuk sector proxy),
            "market_caps":   {ticker: value} (jika dynamic berhasil),
        }
    """
    index = index.upper()

    if index == "SPY":
        sector_tickers = [s["ticker"] for s in SPY_SECTOR_ETFS]
        dynamic = _fetch_dynamic_weights(sector_tickers, use_total_assets=True)

        if dynamic:
            name_map = {s["ticker"]: s["name"] for s in SPY_SECTOR_ETFS}
            return {
                "constituents": dynamic["constituents"],
                "weights":      dynamic["weights"],
                "method":       "sector_proxy",
                "coverage":     "~100%",
                "sector_names": {tkr: name_map.get(tkr, tkr) for tkr in dynamic["constituents"]},
                "market_caps":  dynamic["market_caps"],
            }

    elif index == "QQQ":
        dynamic = _fetch_dynamic_weights(QQQ_TOP_HOLDINGS, use_total_assets=False)

        if dynamic:
            return {
                "constituents": dynamic["constituents"],
                "weights":      dynamic["weights"],
                "method":       "market_cap_top10",
                "coverage":     "~55%",
                "market_caps":  dynamic["market_caps"],
            }

    elif index == "IWM":
        sector_tickers = [s["ticker"] for s in IWM_SECTOR_ETFS]
        dynamic = _fetch_dynamic_weights(sector_tickers, use_total_assets=True)

        if dynamic:
            name_map = {s["ticker"]: s["name"] for s in IWM_SECTOR_ETFS}
            return {
                "constituents": dynamic["constituents"],
                "weights":      dynamic["weights"],
                "method":       "sector_proxy",
                "coverage":     "~85%",
                "sector_names": {tkr: name_map.get(tkr, tkr) for tkr in dynamic["constituents"]},
                "market_caps":  dynamic["market_caps"],
            }

    # ─── Fallback: static config ───
    static = DEFAULT_INDEX_CONFIG.get(index)
    if static:
        return {
            "constituents": static["constituents"],
            "weights":      static["weights"],
            "method":       "static_fallback",
            "coverage":     "~25%",
        }

    return None

# ═══════════════════════════════════════════════
# IV DATA FETCHER (dari yfinance langsung)
# ═══════════════════════════════════════════════

# Cache sederhana untuk menghindari rate limit yfinance
_iv_cache: dict = {}
_iv_cache_ts: dict = {}
IV_CACHE_TTL = 300  # 5 menit

def _fetch_atm_iv_yf(ticker: str, dte_target: int = 30) -> Optional[float]:
    """
    Ambil ATM IV dari yfinance options chain untuk ticker tertentu,
    untuk expiry yang paling mendekati dte_target hari.

    Returns: IV annualized (desimal, mis. 0.18 = 18%), atau None jika gagal.
    """
    cache_key = f"{ticker}_{dte_target}"
    now = time.time()

    # Kembalikan cache jika masih fresh
    if cache_key in _iv_cache and (now - _iv_cache_ts.get(cache_key, 0)) < IV_CACHE_TTL:
        return _iv_cache[cache_key]

    try:
        tkr = yf.Ticker(ticker)
        spot_hist = tkr.history(period="1d", interval="1m")
        if spot_hist.empty:
            return None
        spot = float(spot_hist["Close"].iloc[-1])

        expirations = tkr.options
        if not expirations:
            return None

        # Pilih expiry terdekat ke dte_target
        today = datetime.now().date()
        best_expiry = None
        best_diff = float("inf")

        for exp_str in expirations:
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d").date()
            diff = abs((exp_date - today).days - dte_target)
            if diff < best_diff:
                best_diff = diff
                best_expiry = exp_str

        if not best_expiry:
            return None

        chain = tkr.option_chain(best_expiry)
        calls = chain.calls[chain.calls["impliedVolatility"] > 0.01].copy()
        puts  = chain.puts[chain.puts["impliedVolatility"] > 0.01].copy()

        # Gabungkan calls dan puts
        all_opts = []
        for _, row in calls.iterrows():
            all_opts.append({"strike": float(row["strike"]), "iv": float(row["impliedVolatility"]), "oi": int(row.get("openInterest", 0) or 0)})
        for _, row in puts.iterrows():
            all_opts.append({"strike": float(row["strike"]), "iv": float(row["impliedVolatility"]), "oi": int(row.get("openInterest", 0) or 0)})

        if not all_opts:
            return None

        # Filter: strike 70% – 130% dari spot
        all_opts = [o for o in all_opts if spot * 0.70 <= o["strike"] <= spot * 1.30]

        # Ambil IV terbaik per strike (preferensi OI lebih besar)
        strike_iv_map = {}
        for o in all_opts:
            s = o["strike"]
            if s not in strike_iv_map or o["oi"] > strike_iv_map[s]["oi"]:
                strike_iv_map[s] = o

        sorted_strikes = sorted(strike_iv_map.values(), key=lambda x: x["strike"])
        if len(sorted_strikes) < 4:
            return None

        strikes = np.array([o["strike"] for o in sorted_strikes])
        ivs = np.array([o["iv"] for o in sorted_strikes])

        # Hitung Time to Expiry (T)
        actual_dte = (datetime.strptime(best_expiry, "%Y-%m-%d").date() - today).days
        T = max(actual_dte, 1) / 365.0

        # Fitting SVI
        fit_result = fit_svi(strikes=strikes, ivs=ivs, spot=spot, T=T)
        params = fit_result["params"]

        # Hitung ATM IV dari kurva SVI (k=0 karena log(spot/spot) = 0)
        # SVI menghasilkan variance w(k). ATM IV = sqrt(w(0)/T)
        # svi_iv array shape, jadi kita ambil index 0
        k_atm = np.array([0.0])
        atm_iv_smoothed = float(svi_iv(k_atm, T, params["a"], params["b"], params["rho"], params["m"], params["sigma"])[0])

        _iv_cache[cache_key] = atm_iv_smoothed
        _iv_cache_ts[cache_key] = now
        return atm_iv_smoothed

    except Exception:
        return None


def fetch_multi_atm_iv(tickers: list[str], dte_target: int = 30) -> dict[str, Optional[float]]:
    """
    Fetch ATM IV untuk banyak ticker secara paralel menggunakan thread pool.
    Returns: dict {ticker: iv_desimal}
    """
    results: dict[str, Optional[float]] = {}
    lock = threading.Lock()

    def _worker(tkr):
        iv = _fetch_atm_iv_yf(tkr, dte_target)
        with lock:
            results[tkr] = iv

    threads = []
    for tkr in tickers:
        t = threading.Thread(target=_worker, args=(tkr,), daemon=True)
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=30)

    return results


# ═══════════════════════════════════════════════
# IMPLIED CORRELATION CALCULATOR
# ═══════════════════════════════════════════════

def calc_implied_correlation(
    index_iv: float,
    constituent_ivs: dict[str, float],
    weights: list[float],
    constituents: list[str],
) -> Optional[float]:
    """
    Hitung Implied Correlation rata-rata dari opsi index vs konstituen.

    Formula (simplified):
        ρ_implied = (σ²_idx - Σ wᵢ²σᵢ²) / ((Σ wᵢσᵢ)² - Σ wᵢ²σᵢ²)

    Args:
        index_iv         : IV index (desimal)
        constituent_ivs  : dict {ticker: IV desimal}
        weights          : list bobot konstituen (harus sum ≈ 1)
        constituents     : list ticker konstituen (urutan sama dengan weights)

    Returns:
        ρ_implied clamped ke [0, 1], atau None jika data tidak cukup
    """
    # Kumpulkan hanya data yang valid
    valid_data = []
    for tkr, w in zip(constituents, weights):
        iv = constituent_ivs.get(tkr)
        if iv is not None and iv > 0.01:
            valid_data.append((w, iv))

    if len(valid_data) < 2:
        return None

    total_w = sum(w for w, _ in valid_data)
    if total_w <= 0:
        return None

    # Normalisasi bobot
    valid_data = [(w / total_w, iv) for w, iv in valid_data]

    sigma_idx = index_iv
    sigma_idx_sq = sigma_idx ** 2

    # Σ wᵢ²σᵢ²
    sum_wi2_si2 = sum(w**2 * iv**2 for w, iv in valid_data)

    # (Σ wᵢσᵢ)²
    sum_wi_si_sq = sum(w * iv for w, iv in valid_data) ** 2

    denom = sum_wi_si_sq - sum_wi2_si2
    if abs(denom) < 1e-10:
        return None

    rho = (sigma_idx_sq - sum_wi2_si2) / denom

    # Clamp ke [0, 1] — korelasi tidak bisa negatif dalam konteks ini
    return float(np.clip(rho, 0.0, 1.0))


# ═══════════════════════════════════════════════
# REALIZED CORRELATION CALCULATOR
# ═══════════════════════════════════════════════

def calc_realized_correlation(
    index_ticker: str,
    constituent_tickers: list[str],
    weights: list[float],
    window: int = 30,
) -> Optional[float]:
    """
    Hitung Realized Correlation (bobot-tertimbang) dari return historis.
    Menggunakan matriks korelasi dan mengambil rata-rata korelasi antar
    konstituen yang dibobot.

    Args:
        index_ticker        : ticker index (tidak dipakai langsung, tapi untuk referensi)
        constituent_tickers : list ticker konstituen
        weights             : bobot konstituen
        window              : jumlah hari historis

    Returns:
        ρ_realized float [0, 1], atau None jika fetch gagal
    """
    try:
        all_tickers = constituent_tickers
        period = f"{max(window + 20, 60)}d"
        data = yf.download(all_tickers, period=period, interval="1d",
                           auto_adjust=True, progress=False)

        if hasattr(data.columns, "levels"):
            closes = data["Close"]
        else:
            closes = data

        # Return log harian
        returns = closes.pct_change().dropna()

        # Ambil window terakhir
        returns = returns.tail(window)

        if returns.shape[0] < 10:
            return None

        # Filter kolom dengan data cukup
        valid_cols = returns.columns[returns.notna().sum() > 5].tolist()
        if len(valid_cols) < 2:
            return None

        returns_clean = returns[valid_cols].fillna(0)

        # Matriks korelasi
        corr_matrix = returns_clean.corr()

        # Ambil bobot konstituen yang valid
        valid_weights = []
        for tkr, w in zip(constituent_tickers, weights):
            if tkr in valid_cols:
                valid_weights.append((tkr, w))

        if len(valid_weights) < 2:
            return None

        total_w = sum(w for _, w in valid_weights)
        if total_w <= 0:
            return None
        valid_weights = [(t, w / total_w) for t, w in valid_weights]

        # Rata-rata korelasi berbobot antar pasang konstituen
        numerator = 0.0
        denominator = 0.0

        for i, (ti, wi) in enumerate(valid_weights):
            for j, (tj, wj) in enumerate(valid_weights):
                if i >= j:
                    continue
                if ti in corr_matrix and tj in corr_matrix[ti]:
                    r = corr_matrix.loc[ti, tj]
                    if np.isfinite(r):
                        w_pair = wi * wj
                        numerator += w_pair * float(r)
                        denominator += w_pair

        if denominator <= 0:
            return None

        realized_corr = numerator / denominator
        return float(np.clip(realized_corr, 0.0, 1.0))

    except Exception:
        return None


# ═══════════════════════════════════════════════
# SPREAD & SIGNAL GENERATOR
# ═══════════════════════════════════════════════

def calc_dispersion_spread(
    implied_corr: Optional[float],
    realized_corr: Optional[float],
) -> Optional[float]:
    """
    Hitung Dispersion Spread = ρ_implied - ρ_realized.
    Positif → Index vol relative overpriced (peluang Short Dispersion).
    Negatif → Index vol relative underpriced (peluang Long Dispersion).
    """
    if implied_corr is None or realized_corr is None:
        return None
    return float(implied_corr - realized_corr)


def generate_dispersion_signal(
    spread: Optional[float],
    implied_corr: Optional[float],
    realized_corr: Optional[float],
    index_iv: Optional[float],
    constituent_ivs: dict[str, Optional[float]],
    index_ticker: str,
    constituents: list[str],
    weights: list[float],
) -> dict:
    """
    Buat sinyal lengkap Dispersion Trading beserta trade blueprint.

    Returns:
        dict dengan signal, spread_zscore (approx), tesis, dan blueprint trade.
    """
    if spread is None:
        return {
            "signal": "NO_DATA",
            "signal_strength": 0,
            "spread": None,
            "implied_corr": implied_corr,
            "realized_corr": realized_corr,
            "description": "Data tidak cukup untuk menghasilkan sinyal.",
            "trade_blueprint": None,
        }

    # Threshold sinyal (bisa dikalibrasi lebih lanjut dengan history)
    if spread >= 0.15:
        signal = "SHORT_DISPERSION"
        strength = min(100, int((spread / 0.30) * 100))
        desc = (
            f"Implied Correlation ({implied_corr:.1%}) jauh di atas Realized "
            f"Correlation ({realized_corr:.1%}). Pasar opsi memprice-in korelasi "
            f"yang berlebihan → {index_ticker} Index Vol OVERPRICED relatif terhadap konstituen."
        )
        blueprint = _build_short_blueprint(index_ticker, constituents, weights,
                                           constituent_ivs, index_iv, spread)
    elif spread <= -0.10:
        signal = "LONG_DISPERSION"
        strength = min(100, int((abs(spread) / 0.25) * 100))
        desc = (
            f"Implied Correlation ({implied_corr:.1%}) jauh di bawah Realized "
            f"Correlation ({realized_corr:.1%}). Pasar opsi meremehkan risiko sistemik → "
            f"{index_ticker} Index Vol UNDERPRICED relatif terhadap konstituen."
        )
        blueprint = _build_long_blueprint(index_ticker, constituents, weights,
                                          constituent_ivs, index_iv, spread)
    else:
        signal = "NEUTRAL"
        strength = 0
        desc = (
            f"Spread korelasi ({spread:+.2%}) berada dalam batas normal. "
            f"Implied vs Realized Correlation tidak menunjukkan mispricing yang signifikan."
        )
        blueprint = None

    return {
        "signal": signal,
        "signal_strength": strength,
        "spread": float(spread),
        "spread_pct": round(spread * 100, 2),
        "implied_corr": implied_corr,
        "realized_corr": realized_corr,
        "description": desc,
        "trade_blueprint": blueprint,
    }


def _build_short_blueprint(index_ticker, constituents, weights, constituent_ivs,
                            index_iv, spread) -> dict:
    """Blueprint untuk SHORT Dispersion (short index vol, long single-stock vol)."""
    legs = []
    for tkr, w in zip(constituents, weights):
        iv = constituent_ivs.get(tkr)
        if iv:
            legs.append({
                "ticker": tkr,
                "action": "BUY",
                "instrument": "30DTE ATM Straddle",
                "weight": round(w, 3),
                "atm_iv": round(iv * 100, 1),
                "rationale": "Long vol konstituen individu",
            })
    return {
        "strategy": "Short Dispersion",
        "index_leg": {
            "ticker": index_ticker,
            "action": "SELL",
            "instrument": "30DTE ATM Straddle",
            "atm_iv": round((index_iv or 0) * 100, 1),
            "rationale": "Short index vol yang overpriced",
        },
        "constituent_legs": legs,
        "profit_condition": "Saham-saham konstituen bergerak liar (disperse) tapi TIDAK searah → Index diam, Single-stocks volatile",
        "risk": "Systematic event (crash/rally bersamaan) → semua bergerak searah = loss",
        "spread_edge": f"{spread:.1%}",
    }


def _build_long_blueprint(index_ticker, constituents, weights, constituent_ivs,
                           index_iv, spread) -> dict:
    """Blueprint untuk LONG Dispersion (long index vol, short single-stock vol)."""
    legs = []
    for tkr, w in zip(constituents, weights):
        iv = constituent_ivs.get(tkr)
        if iv:
            legs.append({
                "ticker": tkr,
                "action": "SELL",
                "instrument": "30DTE ATM Straddle",
                "weight": round(w, 3),
                "atm_iv": round(iv * 100, 1),
                "rationale": "Short vol konstituen (collect premium)",
            })
    return {
        "strategy": "Long Dispersion",
        "index_leg": {
            "ticker": index_ticker,
            "action": "BUY",
            "instrument": "30DTE ATM Straddle",
            "atm_iv": round((index_iv or 0) * 100, 1),
            "rationale": "Long index vol yang underpriced",
        },
        "constituent_legs": legs,
        "profit_condition": "Market crash/rally sistemik → semua saham bergerak searah = Index vol meledak",
        "risk": "Saham-saham tetap disperse tanpa korelasi → Index diam = loss",
        "spread_edge": f"{abs(spread):.1%}",
    }

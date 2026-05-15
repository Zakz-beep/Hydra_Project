"""
api.py — Dispersion Trading & SVI Surface Fitting API
======================================================
FastAPI server untuk Dispersion Engine.

Endpoints:
  GET  /api/dispersion/svi         → SVI fitting untuk satu ticker + DTE
  GET  /api/dispersion/correlation → Implied vs Realized correlation
  GET  /api/dispersion/signal      → Sinyal Dispersion Trading lengkap
  GET  /api/dispersion/scan        → Scan multi-index sekaligus

Cara run (manual):
  uvicorn api:app --host 0.0.0.0 --port 8009 --reload

Cara run (via start_servers.py):
  Sudah diregistrasi di start_servers.py
"""

import numpy as np
import yfinance as yf
import time
import threading
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from svi_model import fit_svi, generate_svi_curve, svi_iv
from dispersion_engine import (
    DEFAULT_INDEX_CONFIG,
    SUPPORTED_INDICES,
    get_dynamic_index_config,
    fetch_multi_atm_iv,
    calc_implied_correlation,
    calc_realized_correlation,
    calc_dispersion_spread,
    generate_dispersion_signal,
    _fetch_atm_iv_yf,
)

# ═══════════════════════════════════════════════
# APP INIT
# ═══════════════════════════════════════════════

app = FastAPI(
    title="Dispersion Trading & SVI API",
    description=(
        "Stochastic Volatility Inspired (SVI) Surface Fitting "
        "dan Dispersion Trading Implied Correlation Engine. "
        "Mendeteksi arbitrase volatilitas antara Index vs Konstituen."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ═══════════════════════════════════════════════
# CACHE LAYER
# ═══════════════════════════════════════════════

_cache: dict = {}
_cache_ts: dict = {}
CACHE_TTL = 300  # 5 menit

def _get_cached(key: str):
    now = time.time()
    if key in _cache and (now - _cache_ts.get(key, 0)) < CACHE_TTL:
        return _cache[key]
    return None

def _set_cached(key: str, val):
    _cache[key] = val
    _cache_ts[key] = time.time()


# ═══════════════════════════════════════════════
# HELPER: Fetch options chain untuk SVI fitting
# ═══════════════════════════════════════════════

def _fetch_options_for_svi(ticker: str, dte_target: int = 30) -> Optional[dict]:
    """
    Ambil options chain lengkap untuk SVI fitting.
    Returns dict dengan strikes, ivs, spot, T, expiry_used.
    """
    cache_key = f"opts_{ticker}_{dte_target}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    try:
        tkr = yf.Ticker(ticker)
        hist = tkr.history(period="1d", interval="1m")
        if hist.empty:
            return None
        spot = float(hist["Close"].iloc[-1])

        expirations = tkr.options
        if not expirations:
            return None

        today = datetime.now().date()
        best_expiry = min(
            expirations,
            key=lambda e: abs((datetime.strptime(e, "%Y-%m-%d").date() - today).days - dte_target)
        )

        exp_date = datetime.strptime(best_expiry, "%Y-%m-%d").date()
        actual_dte = (exp_date - today).days
        T = max(actual_dte, 1) / 365.0

        chain = tkr.option_chain(best_expiry)
        calls = chain.calls[chain.calls["impliedVolatility"] > 0.01].copy()
        puts  = chain.puts[chain.puts["impliedVolatility"] > 0.01].copy()

        # Gabungkan calls dan puts
        all_opts = []
        for _, row in calls.iterrows():
            all_opts.append({"strike": float(row["strike"]), "iv": float(row["impliedVolatility"]), "type": "call", "oi": int(row.get("openInterest", 0) or 0)})
        for _, row in puts.iterrows():
            all_opts.append({"strike": float(row["strike"]), "iv": float(row["impliedVolatility"]), "type": "put", "oi": int(row.get("openInterest", 0) or 0)})

        if not all_opts:
            return None

        # Filter: strike 70% – 130% dari spot
        all_opts = [o for o in all_opts if spot * 0.70 <= o["strike"] <= spot * 1.30]

        # Ambil IV terbaik per strike (preferensi OI lebih besar)
        strike_iv_map: dict[float, dict] = {}
        for o in all_opts:
            s = o["strike"]
            if s not in strike_iv_map or o["oi"] > strike_iv_map[s]["oi"]:
                strike_iv_map[s] = o

        sorted_strikes = sorted(strike_iv_map.values(), key=lambda x: x["strike"])

        result = {
            "ticker": ticker,
            "spot": spot,
            "expiry": best_expiry,
            "dte": actual_dte,
            "T": T,
            "strikes": np.array([o["strike"] for o in sorted_strikes]),
            "ivs": np.array([o["iv"] for o in sorted_strikes]),
            "market_points": [
                {"strike": o["strike"], "market_iv": round(o["iv"] * 100, 4), "type": o["type"], "oi": o["oi"]}
                for o in sorted_strikes
            ],
        }

        _set_cached(cache_key, result)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Options fetch error: {str(e)}")


# ═══════════════════════════════════════════════
# HELPER: Get config (dynamic → static fallback)
# ═══════════════════════════════════════════════

def _resolve_config(index: str) -> dict:
    """
    Ambil konfigurasi konstituen + bobot.
    Coba dynamic (market cap realtime) dulu, fallback ke static.
    """
    dynamic = get_dynamic_index_config(index)
    if dynamic:
        return dynamic
    static = DEFAULT_INDEX_CONFIG.get(index)
    if static:
        return {
            "constituents": static["constituents"],
            "weights": static["weights"],
            "method": "static_fallback",
            "coverage": "~25%",
        }
    return None


# ═══════════════════════════════════════════════
# HEALTH CHECK
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "Dispersion Trading & SVI API",
        "version": "2.0.0",
        "docs": "/docs",
        "features": ["dynamic_market_cap_weights", "svi_surface", "dispersion_signal"],
        "endpoints": [
            "/api/dispersion/svi",
            "/api/dispersion/correlation",
            "/api/dispersion/signal",
            "/api/dispersion/scan",
            "/api/dispersion/weights",
        ],
    }


# ═══════════════════════════════════════════════
# ENDPOINT 1: SVI FITTING
# ═══════════════════════════════════════════════

@app.get("/api/dispersion/svi")
def get_svi_fit(
    ticker: str = Query(default="SPY", description="Ticker symbol"),
    dte:    int = Query(default=30, ge=1, le=90, description="Target DTE untuk expiry"),
    force:  bool = Query(default=False),
):
    """
    Fitting SVI Volatility Surface untuk ticker dan DTE tertentu.

    Returns:
      - params: 5 parameter SVI (a, b, rho, m, sigma)
      - curve_points: titik kurva mulus untuk divisualisasikan di chart
      - market_points: data IV mentah dari pasar (scatter)
      - fit_quality: EXCELLENT / GOOD / FAIR / POOR
      - rmse: kesalahan fitting dalam satuan IV
      - is_arbitrage_free: boolean
    """
    cache_key = f"svi_{ticker}_{dte}"
    if not force:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    opts = _fetch_options_for_svi(ticker.upper(), dte)
    if not opts:
        raise HTTPException(status_code=404, detail=f"Tidak ada options data untuk {ticker}")

    fit_result = fit_svi(
        strikes=opts["strikes"],
        ivs=opts["ivs"],
        spot=opts["spot"],
        T=opts["T"],
        forward=opts["spot"],
    )

    # Generate kurva SVI yang mulus
    curve_points = generate_svi_curve(
        params=fit_result["params"],
        spot=opts["spot"],
        T=opts["T"],
        n_points=120,
        moneyness_range=0.25,
    )

    response = {
        "timestamp": datetime.now().isoformat(),
        "ticker": ticker.upper(),
        "spot": opts["spot"],
        "expiry": opts["expiry"],
        "dte": opts["dte"],
        "T": opts["T"],
        "params": fit_result["params"],
        "rmse": fit_result["rmse"],
        "fit_quality": fit_result["fit_quality"],
        "is_arbitrage_free": fit_result["is_arbitrage_free"],
        "n_market_points": fit_result["n_points"],
        "market_points": opts["market_points"],
        "curve_points": curve_points,
    }

    _set_cached(cache_key, response)
    return response


# ═══════════════════════════════════════════════
# ENDPOINT 2: CORRELATION (Implied vs Realized)
# ═══════════════════════════════════════════════

@app.get("/api/dispersion/correlation")
def get_correlation(
    index:  str = Query(default="SPY", description="Index ticker (SPY, QQQ, IWM)"),
    dte:    int = Query(default=30, ge=1, le=90),
    window: int = Query(default=30, ge=10, le=90, description="Hari historis untuk realized corr"),
    force:  bool = Query(default=False),
):
    """
    Hitung Implied Correlation vs Realized Correlation untuk index.

    Returns:
      - implied_correlation: dari harga opsi
      - realized_correlation: dari return historis
      - spread: ρ_implied - ρ_realized
      - constituent_ivs: IV per konstituen
    """
    index = index.upper()
    cache_key = f"corr_{index}_{dte}_{window}"
    if not force:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    config = _resolve_config(index)
    if not config:
        raise HTTPException(status_code=400, detail=f"Index {index} tidak didukung. Pilih: {SUPPORTED_INDICES}")

    constituents = config["constituents"]
    weights = config["weights"]
    weights_method = config.get("method", "unknown")
    coverage = config.get("coverage", "N/A")
    market_caps = config.get("market_caps", {})
    sector_names = config.get("sector_names", {})

    # Ambil IV secara paralel
    all_tickers = [index] + constituents
    iv_map = fetch_multi_atm_iv(all_tickers, dte_target=dte)

    index_iv = iv_map.get(index)
    constituent_ivs = {tkr: iv_map.get(tkr) for tkr in constituents}

    # Hitung Implied Correlation
    implied_corr = calc_implied_correlation(
        index_iv=index_iv or 0,
        constituent_ivs=constituent_ivs,
        weights=weights,
        constituents=constituents,
    ) if index_iv else None

    # Hitung Realized Correlation
    realized_corr = calc_realized_correlation(
        index_ticker=index,
        constituent_tickers=constituents,
        weights=weights,
        window=window,
    )

    spread = calc_dispersion_spread(implied_corr, realized_corr)

    # Format constituent data (enriched with market cap)
    constituent_data = []
    for tkr, w in zip(constituents, weights):
        iv = constituent_ivs.get(tkr)
        constituent_data.append({
            "ticker": tkr,
            "weight": w,
            "weight_pct": round(w * 100, 2),
            "atm_iv": round(iv * 100, 2) if iv else None,
            "contribution": round(w * (iv or 0) * 100, 3),
            "market_cap": market_caps.get(tkr),
            "sector_name": sector_names.get(tkr),
        })

    response = {
        "timestamp": datetime.now().isoformat(),
        "index": index,
        "dte": dte,
        "window_days": window,
        "index_atm_iv": round(index_iv * 100, 2) if index_iv else None,
        "implied_correlation": round(implied_corr, 4) if implied_corr is not None else None,
        "realized_correlation": round(realized_corr, 4) if realized_corr is not None else None,
        "spread": round(spread, 4) if spread is not None else None,
        "spread_pct": round(spread * 100, 2) if spread is not None else None,
        "weights_method": weights_method,
        "coverage": coverage,
        "constituents": constituent_data,
    }

    _set_cached(cache_key, response)
    return response


# ═══════════════════════════════════════════════
# ENDPOINT 3: DISPERSION SIGNAL
# ═══════════════════════════════════════════════

@app.get("/api/dispersion/signal")
def get_dispersion_signal(
    index:  str = Query(default="SPY"),
    dte:    int = Query(default=30, ge=1, le=90),
    window: int = Query(default=30, ge=10, le=90),
    force:  bool = Query(default=False),
):
    """
    Sinyal Dispersion Trading lengkap dengan trade blueprint.

    Returns:
      - signal: SHORT_DISPERSION / LONG_DISPERSION / NEUTRAL / NO_DATA
      - signal_strength: 0–100
      - spread: ρ_implied - ρ_realized
      - description: tesis trade
      - trade_blueprint: panduan eksekusi
    """
    cache_key = f"signal_{index}_{dte}_{window}"
    if not force:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    index = index.upper()
    config = _resolve_config(index)
    if not config:
        raise HTTPException(status_code=400, detail=f"Index {index} tidak didukung. Pilih: {SUPPORTED_INDICES}")

    constituents = config["constituents"]
    weights = config["weights"]
    weights_method = config.get("method", "unknown")
    coverage = config.get("coverage", "N/A")

    # Ambil semua IV
    all_tickers = [index] + constituents
    iv_map = fetch_multi_atm_iv(all_tickers, dte_target=dte)
    index_iv = iv_map.get(index)
    constituent_ivs = {tkr: iv_map.get(tkr) for tkr in constituents}

    implied_corr = calc_implied_correlation(
        index_iv=index_iv or 0,
        constituent_ivs=constituent_ivs,
        weights=weights,
        constituents=constituents,
    ) if index_iv else None

    realized_corr = calc_realized_correlation(
        index_ticker=index,
        constituent_tickers=constituents,
        weights=weights,
        window=window,
    )

    spread = calc_dispersion_spread(implied_corr, realized_corr)

    signal_data = generate_dispersion_signal(
        spread=spread,
        implied_corr=implied_corr,
        realized_corr=realized_corr,
        index_iv=index_iv,
        constituent_ivs=constituent_ivs,
        index_ticker=index,
        constituents=constituents,
        weights=weights,
    )

    response = {
        "timestamp": datetime.now().isoformat(),
        "index": index,
        "dte": dte,
        "window_days": window,
        "index_atm_iv": round(index_iv * 100, 2) if index_iv else None,
        "weights_method": weights_method,
        "coverage": coverage,
        **signal_data,
    }

    _set_cached(cache_key, response)
    return response


# ═══════════════════════════════════════════════
# ENDPOINT 4: MULTI-INDEX SCAN
# ═══════════════════════════════════════════════

@app.get("/api/dispersion/scan")
def get_dispersion_scan(
    dte:    int = Query(default=30, ge=1, le=90),
    window: int = Query(default=30, ge=10, le=90),
    force:  bool = Query(default=False),
):
    """
    Scan semua index yang didukung (SPY, QQQ, IWM) sekaligus.
    Berguna untuk membandingkan dan menemukan peluang terkuat.

    Returns:
      - list hasil scan per index, diurutkan berdasarkan |spread| terbesar
    """
    cache_key = f"scan_{dte}_{window}"
    if not force:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    results = []
    lock = threading.Lock()

    def _scan_one(idx: str):
        try:
            config = _resolve_config(idx)
            if not config:
                return
            constituents = config["constituents"]
            weights = config["weights"]
            weights_method = config.get("method", "unknown")
            coverage = config.get("coverage", "N/A")

            all_tickers = [idx] + constituents
            iv_map = fetch_multi_atm_iv(all_tickers, dte_target=dte)
            index_iv = iv_map.get(idx)
            constituent_ivs = {tkr: iv_map.get(tkr) for tkr in constituents}

            implied_corr = calc_implied_correlation(
                index_iv=index_iv or 0,
                constituent_ivs=constituent_ivs,
                weights=weights,
                constituents=constituents,
            ) if index_iv else None

            realized_corr = calc_realized_correlation(
                index_ticker=idx,
                constituent_tickers=constituents,
                weights=weights,
                window=window,
            )

            spread = calc_dispersion_spread(implied_corr, realized_corr)
            signal_data = generate_dispersion_signal(
                spread=spread,
                implied_corr=implied_corr,
                realized_corr=realized_corr,
                index_iv=index_iv,
                constituent_ivs=constituent_ivs,
                index_ticker=idx,
                constituents=constituents,
                weights=weights,
            )

            with lock:
                results.append({
                    "index": idx,
                    "index_atm_iv": round(index_iv * 100, 2) if index_iv else None,
                    "implied_correlation": round(implied_corr, 4) if implied_corr is not None else None,
                    "realized_correlation": round(realized_corr, 4) if realized_corr is not None else None,
                    "spread": round(spread, 4) if spread is not None else None,
                    "signal": signal_data["signal"],
                    "signal_strength": signal_data["signal_strength"],
                    "description": signal_data["description"],
                    "weights_method": weights_method,
                    "coverage": coverage,
                })
        except Exception:
            pass

    threads = [threading.Thread(target=_scan_one, args=(idx,), daemon=True)
               for idx in SUPPORTED_INDICES]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    # Sort by |spread| terbesar
    results.sort(key=lambda x: abs(x.get("spread") or 0), reverse=True)

    response = {
        "timestamp": datetime.now().isoformat(),
        "dte": dte,
        "window_days": window,
        "scan_results": results,
        "n_results": len(results),
    }

    _set_cached(cache_key, response)
    return response


# ═══════════════════════════════════════════════
# ENDPOINT 5: DYNAMIC WEIGHTS / MARKET CAP
# ═══════════════════════════════════════════════

@app.get("/api/dispersion/weights")
def get_dynamic_weights(
    index: str = Query(default="SPY", description="Index ticker (SPY, QQQ, IWM)"),
    force: bool = Query(default=False),
):
    """
    Ambil real-time dynamic market cap weights untuk konstituen index.

    Returns:
      - constituents: list {ticker, weight, weight_pct, market_cap, sector_name}
      - method: sector_proxy | market_cap_top10 | static_fallback
      - coverage: persentase coverage index
      - total_market_cap: total market cap konstituen (jika dynamic)
    """
    index = index.upper()
    cache_key = f"weights_{index}"
    if not force:
        cached = _get_cached(cache_key)
        if cached:
            return cached

    config = _resolve_config(index)
    if not config:
        raise HTTPException(status_code=400, detail=f"Index {index} tidak didukung. Pilih: {SUPPORTED_INDICES}")

    constituents = config["constituents"]
    weights = config["weights"]
    method = config.get("method", "unknown")
    coverage = config.get("coverage", "N/A")
    market_caps = config.get("market_caps", {})
    sector_names = config.get("sector_names", {})

    # Format per-constituent data
    constituents_data = []
    total_cap = sum(market_caps.values()) if market_caps else None

    for tkr, w in zip(constituents, weights):
        cap = market_caps.get(tkr)
        constituents_data.append({
            "ticker": tkr,
            "weight": round(w, 6),
            "weight_pct": round(w * 100, 2),
            "market_cap": cap,
            "market_cap_fmt": _fmt_cap(cap) if cap else None,
            "sector_name": sector_names.get(tkr),
        })

    response = {
        "timestamp": datetime.now().isoformat(),
        "index": index,
        "method": method,
        "method_label": {
            "sector_proxy": "Sector ETF Proxy (Dynamic AUM)",
            "market_cap_top10": "Top 10 Holdings (Dynamic Market Cap)",
            "static_fallback": "Static Fallback (Hardcoded)",
        }.get(method, method),
        "coverage": coverage,
        "n_constituents": len(constituents),
        "total_market_cap": total_cap,
        "total_market_cap_fmt": _fmt_cap(total_cap) if total_cap else None,
        "constituents": constituents_data,
    }

    _set_cached(cache_key, response)
    return response


def _fmt_cap(val: float | None) -> str | None:
    """Format market cap ke human-readable string."""
    if val is None:
        return None
    if val >= 1e12:
        return f"${val / 1e12:.2f}T"
    if val >= 1e9:
        return f"${val / 1e9:.2f}B"
    if val >= 1e6:
        return f"${val / 1e6:.1f}M"
    return f"${val:,.0f}"

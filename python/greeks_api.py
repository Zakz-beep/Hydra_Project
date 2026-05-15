"""
greeks_api.py — Options Inventory / Greeks API
===============================================
Endpoint FastAPI untuk Options Inventory Engine (Greeks.py).

Semua endpoint di-prefix /api/greeks/ agar TIDAK bentrok
dengan vrp_api3.py yang pakai /api/vrp, /api/config, dll.

Endpoints:
  GET  /                              → health check
  GET  /api/greeks                    → full snapshot (semua bucket)
  GET  /api/greeks/summary            → aggregate only (tanpa per-strike)
  GET  /api/greeks/gex                → GEX-specific (net, gross, regime, flip)
  GET  /api/greeks/expiry/{bucket}    → data satu DTE bucket (0,1,7,14,30)
  GET  /api/greeks/strikes            → per-strike breakdown (paginated)
  GET  /api/greeks/signals            → market structure signals saja
  GET  /api/greeks/maxpain            → max pain per expiry bucket
  GET  /api/greeks/vanna-charm        → vanna & charm exposure detail

Cara run:
 uvicorn greeks_api:app --host 0.0.0.0 --port 8001 --reload
"""

import time
import math
from datetime import datetime
from typing import Optional

import yfinance as yf
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
 
from Greeks import OptionsInventoryEngine
from greeks_db import greeks_db

# ═══════════════════════════════════════════════
# APP INIT
# ═══════════════════════════════════════════════

app = FastAPI(
    title="Options Inventory Engine API",
    description=(
        "GEX · Vanna · Charm · DAI · VEX — "
        "Options Greeks aggregate per expiry bucket (0DTE–30DTE). "
        "Data: yfinance (live) dengan synthetic fallback."
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
# ENGINE CACHE  (satu instance per ticker, TTL 3 mnt)
# ═══════════════════════════════════════════════

import threading

_engines:  dict[str, OptionsInventoryEngine] = {}
_cache:    dict[str, dict] = {}          # ticker → last result
_cache_ts: dict[str, float] = {}        # ticker → timestamp
_warming:  set[str] = set()             # tickers being background-warmed
CACHE_TTL  = 180  # detik — 3 menit (options OI tidak berubah per detik)


def _warm_ticker_bg(ticker: str) -> None:
    """Background thread: compute options engine for ticker, populate cache."""
    if ticker in _warming:
        return
    _warming.add(ticker)
    try:
        if ticker not in _engines:
            _engines[ticker] = OptionsInventoryEngine(ticker=ticker)
        result = _engines[ticker].compute_dict()
        _cache[ticker]    = result
        _cache_ts[ticker] = time.time()
    except Exception:
        pass
    finally:
        _warming.discard(ticker)


def _get_snapshot(ticker: str, force: bool = False) -> dict:
    """
    Return cached snapshot kalau masih fresh,
    atau compute ulang kalau sudah expired / force=True.

    Stale-while-revalidate: kalau cache ada tapi expired,
    return stale data segera + trigger background refresh.
    """
    now = time.time()
    is_fresh = (
        ticker in _cache
        and (now - _cache_ts.get(ticker, 0)) < CACHE_TTL
    )

    if not force and is_fresh:
        return _cache[ticker]

    # Kalau ada stale cache tapi tidak force → return stale + revalidate bg
    if not force and ticker in _cache and ticker not in _warming:
        threading.Thread(target=_warm_ticker_bg, args=(ticker,), daemon=True).start()
        return _cache[ticker]  # return stale immediately

    # No cache OR force=True → blocking compute
    if ticker not in _engines:
        _engines[ticker] = OptionsInventoryEngine(ticker=ticker)

    try:
        result = _engines[ticker].compute_dict()
    except Exception as e:
        # Kalau ada stale, return stale daripada error
        if ticker in _cache:
            return _cache[ticker]
        raise HTTPException(status_code=500, detail=f"Engine error: {e}")

    _cache[ticker]    = result
    _cache_ts[ticker] = now
    return result


# ═══════════════════════════════════════════════
# HELPER: strip per-strike data (buat summary)
# ═══════════════════════════════════════════════

def _strip_strikes(by_expiry: dict) -> dict:
    """Return by_expiry tapi tanpa array 'strikes' (lebih ringan)."""
    lite = {}
    for bucket_key, inv in by_expiry.items():
        inv_copy = {k: v for k, v in inv.items() if k != "strikes"}
        inv_copy["n_strikes"] = inv.get("n_strikes", 0)
        lite[bucket_key] = inv_copy
    return lite


# ═══════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status":  "ok",
        "service": "Options Inventory Engine API",
        "version": "1.0.0",
        "docs":    "/docs",
        "db":      greeks_db.get_db_stats(),
        "endpoints": [
            "/api/greeks",
            "/api/greeks/summary",
            "/api/greeks/gex",
            "/api/greeks/expiry/{bucket}",
            "/api/greeks/strikes",
            "/api/greeks/signals",
            "/api/greeks/maxpain",
            "/api/greeks/vanna-charm",
            "/api/greeks/history",
            "/api/greeks/gex/timeseries",
            "/api/greeks/signals/log",
            "/api/greeks/backtest",
            "/api/greeks/db/stats",
        ],
    }


# ── 0b. CACHE WARM (fire-and-forget) ──────────────────────

@app.post("/api/greeks/warm")
def warm_cache(ticker: str = Query(default="SPY")):
    """
    Trigger background pre-warm untuk ticker tertentu.
    Frontend bisa panggil ini saat user hover ticker pill,
    supaya cache sudah siap sebelum user fetch greeks.
    Returns immediately — compute jalan di background thread.
    """
    t = ticker.upper()
    already_cached = (
        t in _cache
        and (time.time() - _cache_ts.get(t, 0)) < CACHE_TTL
    )
    if already_cached:
        return {"status": "already_cached", "ticker": t}
    if t in _warming:
        return {"status": "warming", "ticker": t}
    threading.Thread(target=_warm_ticker_bg, args=(t,), daemon=True).start()
    return {"status": "warming_started", "ticker": t}


# ── 1. FULL SNAPSHOT ─────────────────────────────────────

@app.get("/api/greeks")
def get_greeks(
    ticker: str  = Query(default="SPY", description="Ticker symbol (e.g. SPY, QQQ, IWM)"),
    force:  bool = Query(default=False, description="Force re-compute, bypass cache"),
):
    """
    Full Options Inventory snapshot — semua expiry bucket,
    termasuk per-strike breakdown.

    ⚠️ Response bisa besar (ratusan strikes). Gunakan /summary
    untuk versi lebih ringan.

    [DB] Otomatis persist snapshot + detect signal changes.
    """
    result = _get_snapshot(ticker.upper(), force=force)

    # ── Persist ke DB ────────────────────────────────
    greeks_db.insert_snapshot(result)

    # ── Auto-detect signal changes ───────────────────
    greeks_db.detect_and_log_changes(
        ticker=result["ticker"],
        spot=result["spot"],
        gex=result.get("total_net_gex", 0),
        signals=result.get("signals", {}),
    )

    return result


# ── 2. SUMMARY (tanpa per-strike) ────────────────────────

@app.get("/api/greeks/summary")
def get_greeks_summary(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Aggregate Greeks summary (ringan).
    Sama seperti /api/greeks tapi tanpa array strikes per-expiry.
    Cocok untuk dashboard cards / overview.
    """
    snap = _get_snapshot(ticker.upper(), force=force)
    return {
        "timestamp":        snap["timestamp"],
        "ticker":           snap["ticker"],
        "spot":             snap["spot"],
        "data_source":      snap["data_source"],
        "total_net_gex":    snap["total_net_gex"],
        "total_net_vanna":  snap["total_net_vanna"],
        "total_net_charm":  snap["total_net_charm"],
        "total_net_dai":    snap["total_net_dai"],
        "total_net_vex":    snap["total_net_vex"],
        "total_gross_gex":  snap.get("total_gross_gex", 0),
        "gex_regime":       snap["gex_regime"],
        "gamma_flip":       snap["gamma_flip"],
        "signals":          snap["signals"],
        "by_expiry":        _strip_strikes(snap.get("by_expiry", {})),
    }


# ── 3. GEX-SPECIFIC ──────────────────────────────────────

@app.get("/api/greeks/gex")
def get_gex(
    ticker: str = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    GEX (Gamma Exposure) detail:
      - Total net/gross GEX
      - GEX regime (positive / negative / neutral)
      - Gamma flip level
      - Per-bucket GEX breakdown
      - Top strikes by absolute GEX
    """
    snap = _get_snapshot(ticker.upper(), force=force)

    # Top strikes by |GEX| (across all buckets)
    all_strikes = []
    for bucket_data in snap.get("by_expiry", {}).values():
        for s in bucket_data.get("strikes", []):
            all_strikes.append(s)

    top_gex_strikes = sorted(
        all_strikes,
        key=lambda x: abs(x.get("gex_spotgamma", 0)),
        reverse=True,
    )[:20]

    per_bucket_gex = {}
    for bk, inv in snap.get("by_expiry", {}).items():
        per_bucket_gex[bk] = {
            "net_gex_spotgamma":   inv.get("net_gex_spotgamma", 0),
            "gross_gex":           inv.get("gross_gex", 0),
            "largest_gex_strike":  inv.get("largest_gex_strike"),
            "largest_gex_value":   inv.get("largest_gex_value"),
            "gamma_flip":          inv.get("gamma_flip"),
        }

    return {
        "timestamp":     snap["timestamp"],
        "ticker":        snap["ticker"],
        "spot":          snap["spot"],
        "data_source":   snap["data_source"],
        "total_net_gex": snap["total_net_gex"],
        "gex_regime":    snap["gex_regime"],
        "gamma_flip":    snap["gamma_flip"],
        "per_bucket":    per_bucket_gex,
        "top_strikes":   top_gex_strikes,
    }


# ── 4. SINGLE EXPIRY BUCKET ──────────────────────────────

@app.get("/api/greeks/expiry/{bucket}")
def get_expiry_bucket(
    bucket: int,
    ticker: str = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Data untuk satu DTE bucket tertentu.
    Bucket valid: 0 (0DTE), 1 (1DTE), 7 (7DTE), 14 (14DTE), 30 (30DTE).
    Termasuk per-strike breakdown.
    """
    valid_buckets = [0, 1, 7, 14, 30]
    if bucket not in valid_buckets:
        raise HTTPException(
            status_code=400,
            detail=f"Bucket invalid. Valid: {valid_buckets}",
        )

    snap = _get_snapshot(ticker.upper(), force=force)
    bucket_key = str(bucket)
    by_expiry  = snap.get("by_expiry", {})

    if bucket_key not in by_expiry:
        return {
            "ticker":     snap["ticker"],
            "spot":       snap["spot"],
            "dte_bucket": bucket,
            "message":    f"Tidak ada data untuk {bucket}DTE bucket saat ini",
            "data":       None,
        }

    return {
        "ticker":     snap["ticker"],
        "spot":       snap["spot"],
        "dte_bucket": bucket,
        "data":       by_expiry[bucket_key],
    }


# ── 5. PER-STRIKE BREAKDOWN ──────────────────────────────

@app.get("/api/greeks/strikes")
def get_strikes(
    ticker:      str           = Query(default="SPY"),
    bucket:      Optional[int] = Query(default=None, description="Filter DTE bucket (0,1,7,14,30). Omit untuk semua."),
    option_type: Optional[str] = Query(default=None, description="Filter: 'call' atau 'put'"),
    sort_by:     str           = Query(default="gex_spotgamma", description="Sort field"),
    limit:       int           = Query(default=50, ge=1, le=500),
    force:       bool          = Query(default=False),
):
    """
    Per-strike Greeks breakdown. Paginated dan sortable.
    Sortable fields: gex_spotgamma, delta, gamma, vanna, charm, vega, oi, iv.
    """
    snap = _get_snapshot(ticker.upper(), force=force)

    all_strikes = []
    for bk, inv in snap.get("by_expiry", {}).items():
        if bucket is not None and bk != str(bucket):
            continue
        for s in inv.get("strikes", []):
            all_strikes.append(s)

    # Filter option type
    if option_type and option_type.lower() in ("call", "put"):
        all_strikes = [s for s in all_strikes if s.get("option_type") == option_type.lower()]

    # Sort
    valid_sort_fields = [
        "gex_spotgamma", "delta", "gamma", "vanna", "charm",
        "vega", "theta", "oi", "iv", "strike", "vanna_exp",
        "charm_exp", "delta_exp", "vega_exp",
    ]
    if sort_by not in valid_sort_fields:
        sort_by = "gex_spotgamma"

    all_strikes.sort(key=lambda x: abs(x.get(sort_by, 0)), reverse=True)

    return {
        "ticker":     snap["ticker"],
        "spot":       snap["spot"],
        "total":      len(all_strikes),
        "showing":    min(limit, len(all_strikes)),
        "sort_by":    sort_by,
        "filter":     {"bucket": bucket, "option_type": option_type},
        "strikes":    all_strikes[:limit],
    }


# ── 6. MARKET STRUCTURE SIGNALS ───────────────────────────

@app.get("/api/greeks/signals")
def get_signals(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Market structure signals berdasarkan aggregate Greeks.
    Sinyal mencakup: GEX regime, vanna bias, charm direction,
    DAI (dealer directional), VEX (IV sensitivity), dan 0DTE impact.
    """
    snap = _get_snapshot(ticker.upper(), force=force)
    return {
        "timestamp":  snap["timestamp"],
        "ticker":     snap["ticker"],
        "spot":       snap["spot"],
        "gex_regime": snap["gex_regime"],
        "gamma_flip": snap["gamma_flip"],
        "signals":    snap["signals"],
    }


# ── 7. MAX PAIN PER BUCKET ───────────────────────────────

@app.get("/api/greeks/maxpain")
def get_maxpain(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Max Pain levels per expiry bucket.
    Max Pain = strike di mana total kerugian options buyers paling besar
    (titik gravitasi harga menjelang expiry).
    """
    snap = _get_snapshot(ticker.upper(), force=force)

    maxpain_data = {}
    for bk, inv in snap.get("by_expiry", {}).items():
        maxpain_data[bk] = {
            "dte_bucket":     inv.get("dte_bucket"),
            "expiry_dates":   inv.get("expiry_dates", []),
            "max_pain":       inv.get("max_pain"),
            "gamma_flip":     inv.get("gamma_flip"),
            "pcr_oi":         inv.get("pcr_oi"),
            "total_oi_calls": inv.get("total_oi_calls"),
            "total_oi_puts":  inv.get("total_oi_puts"),
        }

    return {
        "timestamp": snap["timestamp"],
        "ticker":    snap["ticker"],
        "spot":      snap["spot"],
        "by_expiry": maxpain_data,
    }


# ── 8. VANNA & CHARM DETAIL ──────────────────────────────

@app.get("/api/greeks/vanna-charm")
def get_vanna_charm(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Vanna & Charm exposure detail per expiry bucket.
      - Vanna: dDelta/dIV → prediksi dampak perubahan IV terhadap delta dealer
      - Charm: dDelta/dTime → prediksi delta decay harian (relevan menjelang OPEX)
    """
    snap = _get_snapshot(ticker.upper(), force=force)

    vc_data = {}
    for bk, inv in snap.get("by_expiry", {}).items():
        vc_data[bk] = {
            "dte_bucket":   inv.get("dte_bucket"),
            "expiry_dates": inv.get("expiry_dates", []),
            "net_vanna":    inv.get("net_vanna"),
            "gross_vanna":  inv.get("gross_vanna"),
            "net_charm":    inv.get("net_charm"),
            "gross_charm":  inv.get("gross_charm"),
            "net_dai":      inv.get("net_dai"),
        }

    # Top vanna strikes
    all_strikes = []
    for inv in snap.get("by_expiry", {}).values():
        all_strikes.extend(inv.get("strikes", []))

    top_vanna = sorted(all_strikes, key=lambda x: abs(x.get("vanna_exp", 0)), reverse=True)[:15]
    top_charm = sorted(all_strikes, key=lambda x: abs(x.get("charm_exp", 0)), reverse=True)[:15]

    return {
        "timestamp":       snap["timestamp"],
        "ticker":          snap["ticker"],
        "spot":            snap["spot"],
        "total_net_vanna": snap["total_net_vanna"],
        "total_net_charm": snap["total_net_charm"],
        "signals": {
            "vanna": snap["signals"].get("vanna_signal"),
            "vanna_desc": snap["signals"].get("vanna_desc"),
            "charm": snap["signals"].get("charm_signal"),
            "charm_desc": snap["signals"].get("charm_desc"),
        },
        "per_bucket":      vc_data,
        "top_vanna_strikes": top_vanna,
        "top_charm_strikes": top_charm,
    }


# ═══════════════════════════════════════════════
# ENDPOINTS — DB-POWERED (SQLite)
# ═══════════════════════════════════════════════

@app.get("/api/greeks/history")
def get_greeks_history(
    ticker: str = Query(default="SPY"),
    n:      int = Query(default=50, ge=1, le=500),
    from_ts: Optional[str] = Query(default=None, description="ISO8601, e.g. 2024-11-01T00:00:00"),
    to_ts:   Optional[str] = Query(default=None),
):
    """[DB] History of Greeks snapshots. Oldest first for charting."""
    history = greeks_db.get_snapshot_history(ticker.upper(), n=n, from_ts=from_ts, to_ts=to_ts)
    return {"ticker": ticker, "n": len(history), "history": history}


@app.get("/api/greeks/gex/timeseries")
def get_gex_timeseries(
    ticker: str = Query(default="SPY"),
    n:      int = Query(default=100, ge=1, le=1000),
):
    """[DB] GEX time series — total_net_gex, regime, gamma_flip over time."""
    series = greeks_db.get_gex_timeseries(ticker.upper(), n=n)
    return {"ticker": ticker, "n": len(series), "series": series}


@app.get("/api/greeks/expiry/history/{bucket}")
def get_expiry_history(
    bucket: int,
    ticker: str = Query(default="SPY"),
    n:      int = Query(default=50, ge=1, le=200),
):
    """[DB] Historical per-expiry inventory for one DTE bucket."""
    valid = [0, 1, 7, 14, 30]
    if bucket not in valid:
        raise HTTPException(status_code=400, detail=f"Bucket invalid. Valid: {valid}")
    history = greeks_db.get_expiry_history(ticker.upper(), dte_bucket=bucket, n=n)
    return {"ticker": ticker, "dte_bucket": bucket, "n": len(history), "history": history}


@app.get("/api/greeks/signals/log")
def get_signal_log(
    ticker:      str           = Query(default="SPY"),
    n:           int           = Query(default=50, ge=1, le=500),
    signal_type: Optional[str] = Query(default=None, description="Filter: gex_regime, vanna_signal, charm_signal, dai_bias, vex_signal"),
):
    """[DB] Log of all signal change events for ticker."""
    logs = greeks_db.get_signal_log(ticker.upper(), n=n, signal_type=signal_type)
    return {"ticker": ticker, "n": len(logs), "signals": logs}


@app.get("/api/greeks/backtest")
def get_backtest(
    ticker: str = Query(default="SPY"),
):
    """
    [DB] GEX regime signal accuracy backtest.
    Evaluates whether positive gamma → low vol, negative gamma → high vol.
    """
    evaluated = greeks_db.evaluate_signal_outcomes(ticker.upper())
    summary   = greeks_db.get_backtest_summary(ticker.upper())
    return {**summary, "newly_evaluated": evaluated}


@app.get("/api/greeks/db/stats")
def get_db_stats():
    """[DB] Greeks DB health check — row counts, file size, tickers."""
    return greeks_db.get_db_stats()


@app.delete("/api/greeks/db/cleanup")
def cleanup_db(
    ticker:    str = Query(default="SPY"),
    keep_days: int = Query(default=90, ge=7),
):
    """[DB] Hapus snapshots lama. Default: simpan 90 hari terakhir."""
    greeks_db.cleanup_old_snapshots(ticker.upper(), keep_days=keep_days)
    return {"status": "ok", "ticker": ticker, "kept_days": keep_days}



# ═══════════════════════════════════════════════
# ENDPOINT — EXPECTED MOVE VISUALIZER
# ═══════════════════════════════════════════════

@app.get("/api/greeks/expected-move")
def get_expected_move(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Expected Move — menghitung range pergerakan harga yang "diizinkan"
    oleh options market berdasarkan implied volatility.

    Formula:  EM = Spot × (IV/100) × √(DTE/252)   [trading days]

    Returns:
      - Standard period EMs (1D, 1W, 2W, 1M, 1Q)
      - Per-expiry EMs (dari ATM IV di setiap DTE bucket)
      - Overextension score (actual move vs 1D EM)
      - Upper/lower bounds (1σ = 68%, 2σ = 95%)
    """
    snap = _get_snapshot(ticker.upper(), force=force)
    spot = snap["spot"]

    # ── 1. Get previous close + high/low for actual move ──
    prev_close = spot
    day_high = spot
    day_low = spot
    try:
        hist = yf.download(ticker.upper(), period="5d", interval="1d",
                           progress=False, auto_adjust=True)
        if hasattr(hist.columns, 'levels'):
            hist.columns = hist.columns.get_level_values(0)
        if len(hist) >= 2:
            prev_close = float(hist["Close"].iloc[-2])
            day_high = float(hist["High"].iloc[-1])
            day_low = float(hist["Low"].iloc[-1])
    except Exception:
        pass

    actual_move = spot - prev_close
    actual_move_pct = (actual_move / prev_close) * 100 if prev_close else 0
    actual_range = day_high - day_low
    actual_range_pct = (actual_range / prev_close) * 100 if prev_close else 0

    # ── 2. Extract ATM IV per expiry bucket ───────────────
    # We need annualized IV. Strike IV in the snapshot is already annualized (decimal).
    by_expiry_em = []
    atm_ivs = []  # collect for weighted average

    DTE_LABELS = {
        "0": "0DTE", "1": "1DTE", "7": "1W", "14": "2W", "30": "1M"
    }

    for bucket_key, inv in snap.get("by_expiry", {}).items():
        strikes = inv.get("strikes", [])
        if not strikes:
            continue

        dte_bucket = inv.get("dte_bucket", int(bucket_key))

        # Find ATM strike (closest to spot, prefer calls for IV)
        atm_candidates = [
            s for s in strikes
            if s.get("iv", 0) > 0.01 and s.get("option_type") == "call"
        ]
        if not atm_candidates:
            atm_candidates = [s for s in strikes if s.get("iv", 0) > 0.01]
        if not atm_candidates:
            continue

        atm = min(atm_candidates, key=lambda s: abs(s["strike"] - spot))
        iv_ann = atm["iv"]  # annualized IV (decimal, e.g. 0.18 = 18%)
        actual_dte = atm.get("dte", dte_bucket) or max(dte_bucket, 1)

        if iv_ann <= 0.01:
            continue

        # EM formula: spot × IV × √(DTE/252)
        em_1s = spot * iv_ann * (actual_dte / 252) ** 0.5
        em_2s = em_1s * 2

        label = DTE_LABELS.get(bucket_key, f"{dte_bucket}DTE")
        by_expiry_em.append({
            "bucket":       bucket_key,
            "label":        label,
            "dte":          actual_dte,
            "atm_strike":   atm["strike"],
            "atm_iv":       round(iv_ann * 100, 2),  # percentage
            "em_1sigma":    round(em_1s, 2),
            "em_2sigma":    round(em_2s, 2),
            "em_1sigma_pct": round((em_1s / spot) * 100, 3),
            "em_2sigma_pct": round((em_2s / spot) * 100, 3),
            "upper_1s":     round(spot + em_1s, 2),
            "lower_1s":     round(spot - em_1s, 2),
            "upper_2s":     round(spot + em_2s, 2),
            "lower_2s":     round(spot - em_2s, 2),
        })
        atm_ivs.append((actual_dte, iv_ann))

    by_expiry_em.sort(key=lambda x: x["dte"])

    # ── 3. Determine best annualized IV ───────────────────
    # Use shortest-term expiry IV as best proxy, or weighted blend
    annualized_iv = 0.0
    if atm_ivs:
        # Weight by inverse DTE (short-term IV gets more weight)
        weights = [1.0 / max(d, 0.5) for d, _ in atm_ivs]
        total_w = sum(weights)
        annualized_iv = sum(iv * w for (_, iv), w in zip(atm_ivs, weights)) / total_w

    # ── 4. Standard period expected moves ─────────────────
    standard_periods = []
    for label, trading_days in [
        ("1 Day", 1), ("1 Week", 5), ("2 Weeks", 10),
        ("1 Month", 21), ("1 Quarter", 63),
    ]:
        if annualized_iv > 0:
            em = spot * annualized_iv * (trading_days / 252) ** 0.5
            standard_periods.append({
                "label":        label,
                "trading_days": trading_days,
                "iv_used":      round(annualized_iv * 100, 2),
                "em_1sigma":    round(em, 2),
                "em_2sigma":    round(em * 2, 2),
                "em_1sigma_pct": round((em / spot) * 100, 3),
                "em_2sigma_pct": round((em * 2 / spot) * 100, 3),
                "upper_1s":     round(spot + em, 2),
                "lower_1s":     round(spot - em, 2),
                "upper_2s":     round(spot + em * 2, 2),
                "lower_2s":     round(spot - em * 2, 2),
            })

    # ── 5. Overextension analysis ─────────────────────────
    # Compare actual move vs 1D expected move
    overextension = 0.0
    overextension_regime = "WITHIN_RANGE"
    em_1d = 0.0
    if standard_periods:
        em_1d = standard_periods[0]["em_1sigma"]
        if em_1d > 0:
            overextension = abs(actual_move) / em_1d
            if overextension >= 2.0:
                overextension_regime = "EXTREME"      # >2σ, mean reversion likely
            elif overextension >= 1.5:
                overextension_regime = "EXTENDED"      # 1.5-2σ, stretched
            elif overextension >= 1.0:
                overextension_regime = "AT_BOUNDARY"   # at 1σ boundary
            else:
                overextension_regime = "WITHIN_RANGE"  # inside expected

    # Range analysis (high-low vs EM)
    range_utilization = 0.0
    if em_1d > 0:
        range_utilization = actual_range / (em_1d * 2)  # vs full 2σ range

    return {
        "timestamp":            snap["timestamp"],
        "ticker":               snap["ticker"],
        "spot":                 spot,
        "prev_close":           round(prev_close, 2),
        "day_high":             round(day_high, 2),
        "day_low":              round(day_low, 2),
        "actual_move":          round(actual_move, 2),
        "actual_move_pct":      round(actual_move_pct, 3),
        "actual_range":         round(actual_range, 2),
        "actual_range_pct":     round(actual_range_pct, 3),
        "annualized_iv":        round(annualized_iv * 100, 2),
        "em_1d":                round(em_1d, 2),
        "overextension":        round(overextension, 3),
        "overextension_regime": overextension_regime,
        "range_utilization":    round(range_utilization, 3),
        "standard_periods":     standard_periods,
        "by_expiry":            by_expiry_em,
    }


# ═══════════════════════════════════════════════
# ENDPOINT — GAMMA BOUNCE SCORE (GBS)
# ═══════════════════════════════════════════════

@app.get("/api/greeks/gbs")
def get_gamma_bounce_score(
    ticker: str  = Query(default="SPY"),
    force:  bool = Query(default=False),
):
    """
    Gamma Bounce Score (GBS) — mengukur seberapa kuat Market Maker
    akan melakukan hedging sehingga harga memantul dari suatu level.

    Komponen score (total 100 + penalty):
      - GEX Magnitude  (40 pts): semakin besar |GEX| di level = dinding lebih kuat
      - OI Density     (20 pts): semakin tebal OI = semakin banyak kontrak yang perlu di-hedge
      - Proximity      (25 pts): semakin dekat spot ke wall = hedging pressure lebih imminent
      - Vanna Boost    (15 pts): kalau GEX positif + VIX turun → vanna unwind = bullish tailwind
      - RVOL Penalty   (0–20 pts penalty): RVOL tinggi = momentum kuat, bisa tembus wall

    Score:
      80–100 → EXTREME — bounce hampir pasti, MM hedging sangat agresif
      60–79  → STRONG  — high probability bounce, dinding solid
      40–59  → MODERATE — ada resistensi tapi bisa ditembus dengan high RVOL
      20–39  → WEAK    — dinding tipis, momentum bisa breakout
      0–19   → MINIMAL — hampir tidak ada GEX support/resistance
    """
    snap = _get_snapshot(ticker.upper(), force=force)
    spot = snap["spot"]

    # ── 1a. Fetch VIX untuk Vanna Bonus ──────────────────
    vix_change = 0.0
    try:
        vix_hist = yf.download("^VIX", period="2d", interval="1d",
                               progress=False, auto_adjust=True)
        # yfinance bisa return MultiIndex columns, flatten dulu
        if hasattr(vix_hist.columns, 'levels'):
            vix_hist.columns = vix_hist.columns.get_level_values(0)
        if len(vix_hist) >= 2 and "Close" in vix_hist.columns:
            vix_today = float(vix_hist["Close"].iloc[-1])
            vix_prev  = float(vix_hist["Close"].iloc[-2])
            vix_change = vix_today - vix_prev
    except Exception:
        pass

    # ── 1b. Fetch RVOL (Relative Volume) ─────────────────
    # RVOL = volume hari ini / rata-rata volume 20 hari
    # RVOL > 1.5 = above-average activity = bisa tembus wall
    rvol = 1.0  # default netral
    rvol_regime = "NORMAL"
    today_volume = 0
    avg_volume_20 = 0
    try:
        _ticker_sym = ticker.upper()
        vol_hist = yf.download(_ticker_sym, period="25d", interval="1d",
                               progress=False, auto_adjust=True)
        # yfinance bisa return MultiIndex columns, flatten dulu
        if hasattr(vol_hist.columns, 'levels'):
            vol_hist.columns = vol_hist.columns.get_level_values(0)
        if len(vol_hist) >= 5 and "Volume" in vol_hist.columns:
            volumes = vol_hist["Volume"].dropna()
            today_volume = int(volumes.iloc[-1])
            avg_volume_20 = int(volumes.iloc[:-1].tail(20).mean()) if len(volumes) > 1 else 1
            if avg_volume_20 > 0:
                rvol = today_volume / avg_volume_20
                if rvol >= 2.0:
                    rvol_regime = "EXTREME_VOL"
                elif rvol >= 1.5:
                    rvol_regime = "HIGH"
                elif rvol >= 0.8:
                    rvol_regime = "NORMAL"
                else:
                    rvol_regime = "LOW"
    except Exception:
        pass

    # ── 2. Aggregate GEX + OI per strike (semua bucket) ──
    strike_map: dict[float, dict] = {}
    for bk, inv in snap.get("by_expiry", {}).items():
        for s in inv.get("strikes", []):
            k = s["strike"]
            if k not in strike_map:
                strike_map[k] = {
                    "strike": k,
                    "total_gex": 0.0,
                    "total_oi":  0,
                    "net_vanna": 0.0,
                    "net_charm": 0.0,
                    "option_type": s["option_type"],  # dominant
                }
            strike_map[k]["total_gex"] += s.get("gex_spotgamma", 0)
            strike_map[k]["total_oi"]  += s.get("oi", 0)
            strike_map[k]["net_vanna"] += s.get("vanna_exp", 0)
            strike_map[k]["net_charm"] += s.get("charm_exp", 0)

    # ── 3. Filter strikes ±15% dari spot ─────────────────
    nearby = [
        v for v in strike_map.values()
        if spot * 0.85 <= v["strike"] <= spot * 1.15
        and abs(v["total_gex"]) > 0.01  # filter noise
    ]

    if not nearby:
        return {
            "ticker": snap["ticker"], "spot": spot,
            "overall_score": 0, "regime": "MINIMAL",
            "vix_change": round(vix_change, 3),
            "walls": [], "message": "Tidak ada GEX levels signifikan di sekitar spot"
        }

    # Normalize: max |GEX| dan max OI untuk scoring
    max_abs_gex = max(abs(v["total_gex"]) for v in nearby) or 1
    max_oi      = max(v["total_oi"] for v in nearby) or 1

    walls = []
    for w in nearby:
        dist_pct = abs(spot - w["strike"]) / spot * 100  # % distance

        # Component 1: GEX Magnitude (0–40)
        gex_score = (abs(w["total_gex"]) / max_abs_gex) * 40

        # Component 2: OI Density (0–20)
        oi_score = min(w["total_oi"] / max_oi, 1.0) * 20

        # Component 3: Proximity (0–25) — full at <0.5%, zero at >5%
        prox_score = max(0.0, (5.0 - dist_pct) / 5.0) * 25

        # Component 4: Vanna Boost (0–15)
        # Positif GEX + VIX turun → dealer unwind call hedge → beli spot → support
        # Negatif GEX + VIX naik  → dealer beli put hedge → jual spot → wall lebih kuat
        vanna_bonus = 0.0
        if w["total_gex"] > 0 and vix_change < -0.3:
            vanna_bonus = 15.0  # bullish vanna tailwind
        elif w["total_gex"] < 0 and vix_change > 0.3:
            vanna_bonus = 10.0  # bearish vanna amplifier

        # Component 5: RVOL Penalty (0–20) — KONTRA-INDIKATOR
        # RVOL tinggi = momentum kuat = bisa tembus GEX wall
        rvol_penalty = 0.0
        if rvol >= 2.0:
            rvol_penalty = 20.0  # extreme volume, wall sangat rentan ditembus
        elif rvol >= 1.5:
            rvol_penalty = 12.0  # above-average, wall bisa ditembus
        elif rvol >= 1.2:
            rvol_penalty = 5.0   # sedikit di atas normal

        raw_score = gex_score + oi_score + prox_score + vanna_bonus - rvol_penalty
        score = round(max(0.0, min(100.0, raw_score)), 1)

        # Hedging behavior
        is_positive_gex = w["total_gex"] > 0
        if is_positive_gex:
            wall_type      = "CALL_WALL"
            behavior       = "MM JUAL saat harga naik → Resistance / Mean-Reversion"
            price_action   = "BOUNCE_DOWN"
        else:
            wall_type      = "PUT_WALL"
            behavior       = "MM BELI saat harga turun → Support / Floor"
            price_action   = "BOUNCE_UP"

        walls.append({
            "strike":        w["strike"],
            "dist_pct":      round(dist_pct, 2),
            "total_gex":     round(w["total_gex"], 4),
            "total_oi":      w["total_oi"],
            "net_vanna":     round(w["net_vanna"], 4),
            "wall_type":     wall_type,
            "behavior":      behavior,
            "price_action":  price_action,
            "score":         score,
            "components": {
                "gex_score":    round(gex_score, 1),
                "oi_score":     round(oi_score, 1),
                "prox_score":   round(prox_score, 1),
                "vanna_bonus":  round(vanna_bonus, 1),
                "rvol_penalty": round(rvol_penalty, 1),
            }
        })

    # Sort: nearest walls first, then by score
    walls.sort(key=lambda x: (x["dist_pct"], -x["score"]))

    # ── 4. Overall Hedging Pressure Score ─────────────────
    # Weighted average: closest 3 walls dengan bobot proximity
    top3 = walls[:3]
    if top3:
        weights = [max(0, 5 - w["dist_pct"]) + 0.1 for w in top3]
        total_w = sum(weights)
        overall = sum(w["score"] * wt for w, wt in zip(top3, weights)) / total_w
    else:
        overall = 0.0
    overall = round(min(100.0, overall), 1)

    if overall >= 80:
        regime = "EXTREME"
    elif overall >= 60:
        regime = "STRONG"
    elif overall >= 40:
        regime = "MODERATE"
    elif overall >= 20:
        regime = "WEAK"
    else:
        regime = "MINIMAL"

    # Nearest support + resistance
    above_walls = [w for w in walls if w["strike"] >= spot]
    below_walls = [w for w in walls if w["strike"] < spot]
    nearest_resistance = above_walls[0] if above_walls else None
    nearest_support    = below_walls[-1] if below_walls else None

    return {
        "timestamp":           snap["timestamp"],
        "ticker":              snap["ticker"],
        "spot":                spot,
        "total_net_gex":       snap["total_net_gex"],
        "gex_regime":          snap["gex_regime"],
        "overall_score":       overall,
        "regime":              regime,
        "vix_change":          round(vix_change, 3),
        "rvol":                round(rvol, 3),
        "rvol_regime":         rvol_regime,
        "today_volume":        today_volume,
        "avg_volume_20":       avg_volume_20,
        "total_net_vanna":     snap["total_net_vanna"],
        "total_net_charm":     snap["total_net_charm"],
        "nearest_resistance":  nearest_resistance,
        "nearest_support":     nearest_support,
        "walls":               walls[:25],  # top 25 nearest walls
    }


# ═══════════════════════════════════════════════
# UNUSUAL OPTIONS FLOW SCANNER
# ═══════════════════════════════════════════════

@app.get("/api/greeks/unusual-flow")
def get_unusual_flow(
    ticker: str = Query(default="SPY", description="Ticker to scan"),
    min_vol_oi_ratio: float = Query(default=1.5, description="Min Vol/OI ratio to flag"),
    min_volume: int = Query(default=100, description="Min option volume"),
    top_n: int = Query(default=30, description="Max number of unusual contracts to return"),
):
    """
    Unusual Options Flow Scanner.

    Scans all options strikes for a ticker and flags contracts where:
    - Volume/OI ratio is high (institutions opening new positions)
    - Deep OTM with unexpected volume (directional bets)
    - IV Rank spike (volatility expansion expected)

    Returns top_n most anomalous contracts sorted by Vol/OI ratio.
    """
    import math

    t = ticker.upper()
    snap = _get_snapshot(t)
    spot = snap.get("spot", 0)
    by_expiry = snap.get("by_expiry", {})

    flows = []

    for bucket_key, bucket in by_expiry.items():
        dte = bucket.get("dte_bucket", 0)
        strikes = bucket.get("strikes", [])
        for s in strikes:
            vol = s.get("volume", 0) or 0
            oi  = s.get("oi", 0) or 0
            iv  = s.get("iv", 0) or 0
            strike = s.get("strike", 0)
            otype  = s.get("option_type", "").lower()

            if vol < min_volume or oi <= 0:
                continue

            ratio = vol / oi

            if ratio < min_vol_oi_ratio:
                continue

            # Moneyness: how far OTM is this?
            if spot > 0:
                if otype == "call":
                    moneyness_pct = round((strike - spot) / spot * 100, 2)
                else:
                    moneyness_pct = round((spot - strike) / spot * 100, 2)
            else:
                moneyness_pct = 0.0

            # OTM flag: more than 3% from spot
            is_otm = moneyness_pct > 3.0

            # Sentiment: call = bullish, put = bearish
            sentiment = "BULL" if otype == "call" else "BEAR"

            # Signal score (higher = more unusual)
            score = ratio * math.log1p(vol)
            if is_otm:
                score *= 1.4  # boost OTM anomalies

            flows.append({
                "ticker":         t,
                "type":           otype.upper(),
                "strike":         strike,
                "expiry_dte":     int(dte),
                "volume":         int(vol),
                "open_interest":  int(oi),
                "vol_oi_ratio":   round(ratio, 2),
                "iv_pct":         round(iv * 100, 2),
                "moneyness_pct":  moneyness_pct,
                "is_otm":         is_otm,
                "sentiment":      sentiment,
                "score":          round(score, 2),
            })

    # Sort by score descending, return top_n
    flows.sort(key=lambda x: x["score"], reverse=True)

    return {
        "ticker":    t,
        "spot":      spot,
        "timestamp": snap.get("timestamp", ""),
        "count":     len(flows[:top_n]),
        "flows":     flows[:top_n],
    }


# ═══════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("greeks_api:app", host="0.0.0.0", port=8001, reload=True)

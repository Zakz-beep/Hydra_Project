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
from datetime import datetime
from typing import Optional

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
# ENGINE CACHE  (satu instance per ticker, TTL 5 mnt)
# ═══════════════════════════════════════════════

_engines: dict[str, OptionsInventoryEngine] = {}
_cache:   dict[str, dict] = {}          # ticker → last result
_cache_ts: dict[str, float] = {}        # ticker → timestamp
CACHE_TTL = 60  # detik — greeks update cukup per menit


def _get_snapshot(ticker: str, force: bool = False) -> dict:
    """
    Return cached snapshot kalau masih fresh,
    atau compute ulang kalau sudah expired / force=True.
    """
    now = time.time()
    if (
        not force
        and ticker in _cache
        and (now - _cache_ts.get(ticker, 0)) < CACHE_TTL
    ):
        return _cache[ticker]

    if ticker not in _engines:
        _engines[ticker] = OptionsInventoryEngine(ticker=ticker)

    try:
        result = _engines[ticker].compute_dict()
    except Exception as e:
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
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("greeks_api:app", host="0.0.0.0", port=8001, reload=True)

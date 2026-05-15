"""
COT API — FastAPI server (port 8008)
Endpoint prefix: /api/cot/...

Endpoint:
  GET /api/cot/assets          → Daftar aset yang tersedia
  GET /api/cot/latest          → Ringkasan posisi & signal semua aset (bulk)
  GET /api/cot/asset/{key}     → Detail historical satu aset
  POST /api/cot/refresh        → Paksa refresh cache
  GET /api/cot/status          → Status cache (loaded assets, waktu refresh)
"""

import sys

# Fix Windows cp1252 encoding BEFORE importing cot_model (which prints on import/threads).
# reconfigure() is safe even under uvicorn's stream wrappers.
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass  # Stream wrapper doesn't support reconfigure; ASCII fallback via errors='replace' in cot_model

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import asyncio
import threading
import time

from cot_model import COTAnalyzer, ASSET_REGISTRY

# ──────────────────────────────────────────────
# App setup
# ──────────────────────────────────────────────

app = FastAPI(title="COT API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ──────────────────────────────────────────────
# In-memory cache
# ──────────────────────────────────────────────

class COTCache:
    def __init__(self):
        self.analyzer = COTAnalyzer()
        self.last_refresh: Optional[datetime] = None
        self.is_loading: bool = False
        self.loaded_assets: List[str] = []
        self.last_error: Optional[str] = None
        self._lock = threading.Lock()

    def _do_refresh(self, keys: List[str], start_year: int):
        import traceback as _tb
        with self._lock:
            self.is_loading = True
            self.last_error = None
        try:
            data = self.analyzer.run(keys, start_year=start_year, verbose=False)
            with self._lock:
                self.loaded_assets = list(data.keys())
                self.last_refresh = datetime.now()
                self.last_error = None if data else "fetch completed but 0 assets loaded"
        except Exception as e:
            err = _tb.format_exc()
            print(f"[COT] _do_refresh ERROR:\n{err}", flush=True)
            with self._lock:
                self.last_error = f"{type(e).__name__}: {e}"
        finally:
            with self._lock:
                self.is_loading = False

    def refresh_background(self, keys: List[str], start_year: int = 2022):
        t = threading.Thread(target=self._do_refresh, args=(keys, start_year), daemon=True)
        t.start()

    def get_latest(self) -> List[Dict[str, Any]]:
        df = self.analyzer.analisis_terbaru()
        if df.empty:
            return []
        df['Date'] = df['Date'].astype(str)
        # Replace NaN with None for JSON serialization
        df = df.where(df.notna(), other=None)
        return df.to_dict(orient='records')

    def get_asset_history(self, key: str, limit: int = 52) -> Optional[List[Dict[str, Any]]]:
        key = key.upper()
        if key not in self.analyzer.data:
            return None
        df = self.analyzer.data[key].tail(limit).copy()
        df['date'] = df['date'].astype(str)
        df = df.where(df.notna(), other=None)
        return df.to_dict(orient='records')


cache = COTCache()

# ──────────────────────────────────────────────
# Default assets to load on startup
# ──────────────────────────────────────────────

DEFAULT_ASSETS = [
    "GOLD", "SILVER", "CRUDE_OIL", "NAT_GAS",
    "ES", "NQ", "RTY",
    "EUR", "JPY", "GBP", "AUD", "USD_IDX",
    "T_BOND", "T_NOTE_10",
    "BTC", "ETH",
]

@app.on_event("startup")
async def startup_event():
    """Mulai loading COT data di background saat server start."""
    print("[COT API] Starting background data load...")
    cache.refresh_background(DEFAULT_ASSETS, start_year=2022)


# ──────────────────────────────────────────────
# Request / Response models
# ──────────────────────────────────────────────

class RefreshRequest(BaseModel):
    assets: Optional[List[str]] = None
    start_year: Optional[int] = 2022


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────

@app.get("/api/cot/assets")
def list_assets():
    """Daftar semua aset yang tersedia di registry dan status cache-nya."""
    result = []
    for key, name in ASSET_REGISTRY.items():
        result.append({
            "key": key,
            "name": name,
            "loaded": key in cache.loaded_assets,
        })
    return {
        "assets": result,
        "total_registry": len(ASSET_REGISTRY),
        "total_loaded": len(cache.loaded_assets),
    }


@app.get("/api/cot/status")
def get_status():
    """Status cache: apakah sedang loading, kapan terakhir refresh, aset apa saja yang sudah loaded."""
    return {
        "is_loading": cache.is_loading,
        "last_refresh": cache.last_refresh.isoformat() if cache.last_refresh else None,
        "loaded_assets": cache.loaded_assets,
        "loaded_count": len(cache.loaded_assets),
        "last_error": cache.last_error,
    }


@app.get("/api/cot/latest")
def get_latest(assets: Optional[str] = Query(None, description="Comma-separated asset keys, e.g. GOLD,BTC,EUR")):
    """
    Ringkasan posisi & signal terbaru semua aset yang sudah di-cache.
    Bisa difilter dengan query param ?assets=GOLD,BTC
    """
    if cache.is_loading:
        raise HTTPException(status_code=503, detail="Data masih loading, coba lagi beberapa menit.")

    if not cache.loaded_assets:
        raise HTTPException(
            status_code=503,
            detail="COT data belum tersedia. Tunggu background fetch selesai, atau POST /api/cot/refresh."
        )

    try:
        rows = cache.get_latest()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saat membaca cache: {type(e).__name__}: {e}")

    if assets:
        requested = [a.strip().upper() for a in assets.split(",")]
        rows = [r for r in rows if r.get("Asset") in requested]

    return {
        "data": rows,
        "count": len(rows),
        "last_refresh": cache.last_refresh.isoformat() if cache.last_refresh else None,
    }


@app.get("/api/cot/asset/{key}")
def get_asset_history(
    key: str,
    limit: int = Query(52, ge=1, le=500, description="Jumlah minggu terakhir yang dikembalikan"),
):
    """
    Historical data mingguan untuk satu aset.
    Includes: date, Open_Interest, HedgeFund_Net, Commercial_Net, HF_COT_Index, COT_Bias, Signal, dll.
    """
    key = key.upper()

    if key not in ASSET_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Aset '{key}' tidak dikenal. Gunakan GET /api/cot/assets untuk melihat daftar.")

    if key not in cache.loaded_assets:
        if cache.is_loading:
            raise HTTPException(status_code=503, detail=f"Data untuk '{key}' sedang loading.")
        raise HTTPException(status_code=404, detail=f"Data '{key}' belum di-load. Gunakan POST /api/cot/refresh untuk memuat.")

    rows = cache.get_asset_history(key, limit=limit)
    if rows is None:
        raise HTTPException(status_code=500, detail="Gagal mengambil data dari cache.")

    return {
        "asset": key,
        "name": ASSET_REGISTRY[key],
        "data": rows,
        "count": len(rows),
        "last_refresh": cache.last_refresh.isoformat() if cache.last_refresh else None,
    }


@app.post("/api/cot/refresh")
def trigger_refresh(req: RefreshRequest):
    """
    Paksa refresh data COT dari server CFTC.
    Jika `assets` tidak diisi, akan refresh semua default assets.
    """
    if cache.is_loading:
        return {"status": "already_loading", "message": "Refresh sedang berjalan, tunggu sebentar."}

    keys = req.assets if req.assets else DEFAULT_ASSETS
    keys = [k.upper() for k in keys if k.upper() in ASSET_REGISTRY]

    if not keys:
        raise HTTPException(status_code=400, detail="Tidak ada aset valid yang diberikan.")

    cache.refresh_background(keys, start_year=req.start_year or 2022)

    return {
        "status": "started",
        "assets": keys,
        "start_year": req.start_year or 2022,
        "message": f"Refresh dimulai untuk {len(keys)} aset. Pantau via GET /api/cot/status.",
    }

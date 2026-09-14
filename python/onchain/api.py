# python/onchain/api.py
# FastAPI server untuk On-Chain Analysis (port 8014)

import logging
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional, AsyncGenerator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Import engine modules
from live_feed import (
    fetch_latest_blocks,
    get_network_stats,
    get_current_eth_price,
    process_block,
)
from rpc_client import get_latest_block_number, get_block, hex_to_int
from db import (
    get_recent_whale_txs,
    get_recent_live_txs,
    get_recent_block_stats,
    init_db,
)

# ─── Setup ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="On-Chain Analysis API",
    description="Live Ethereum transaction feed dan on-chain analytics",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Background Task State ────────────────────────────────────────────────────
_background_cache: dict = {
    "latest_blocks": [],
    "last_update": None,
    "network_stats": {},
    "whale_count_session": 0,
}


@app.on_event("startup")
async def startup_event():
    """Inisialisasi DB dan mulai background polling loop."""
    init_db()
    logger.info("[API] On-Chain API started on port 8014")
    # Jalankan background polling
    asyncio.create_task(_background_poller())


async def _background_poller():
    """
    Background task yang polling blockchain setiap 12 detik (≈ 1 blok).
    Menyimpan hasil ke cache dan SQLite agar endpoint bisa serve data cepat.
    """
    while True:
        try:
            logger.debug("[POLLER] Polling new blocks...")
            results = await asyncio.to_thread(fetch_latest_blocks, 2)
            if results:
                _background_cache["latest_blocks"] = results
                _background_cache["last_update"] = datetime.now(timezone.utc).isoformat()
                whale_count = sum(len(r.get("whales", [])) for r in results)
                _background_cache["whale_count_session"] += whale_count
                logger.info(f"[POLLER] Processed {len(results)} new blocks")
            
            # Update network stats setiap 30 detik
            stats = await asyncio.to_thread(get_network_stats)
            _background_cache["network_stats"] = stats

        except Exception as e:
            logger.error(f"[POLLER] Error: {e}")

        await asyncio.sleep(12)  # 12 detik = ~1 blok Ethereum


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/api/onchain/live")
async def get_live_transactions(
    limit: int = Query(50, ge=1, le=200, description="Jumlah transaksi yang diambil"),
    whale_only: bool = Query(False, description="Hanya tampilkan transaksi whale"),
):
    """
    Endpoint utama untuk Live Transaction Feed.
    Mengembalikan transaksi terbaru dari SQLite cache.
    Diupdate setiap ~12 detik oleh background poller.
    """
    try:
        txs = await asyncio.to_thread(get_recent_live_txs, limit * 2)
        
        if whale_only:
            txs = [t for t in txs if t.get("is_whale", 0) == 1]
        
        txs = txs[:limit]
        
        # Statistik session
        total_eth = sum(t.get("value_eth", 0) for t in txs)
        whale_count = sum(1 for t in txs if t.get("is_whale", 0) == 1)

        return {
            "status": "ok",
            "count": len(txs),
            "last_update": _background_cache.get("last_update"),
            "session_stats": {
                "total_eth_in_feed": round(total_eth, 4),
                "whale_count": whale_count,
                "session_whale_count": _background_cache.get("whale_count_session", 0),
            },
            "transactions": txs,
        }
    except Exception as e:
        logger.error(f"[API] /live error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onchain/whales")
async def get_whale_transactions(
    limit: int = Query(20, ge=1, le=100),
):
    """
    Ambil riwayat transaksi whale yang tersimpan di SQLite.
    Whale = transfer ≥ 50 ETH atau ≥ $500,000 nilai token.
    """
    try:
        whales = await asyncio.to_thread(get_recent_whale_txs, limit)
        return {
            "status": "ok",
            "count": len(whales),
            "whales": whales,
        }
    except Exception as e:
        logger.error(f"[API] /whales error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onchain/stats")
async def get_stats():
    """
    Statistik jaringan Ethereum saat ini + ringkasan blok terbaru.
    """
    try:
        network = _background_cache.get("network_stats") or await asyncio.to_thread(
            get_network_stats
        )
        block_stats = await asyncio.to_thread(get_recent_block_stats, 10)

        total_tx = sum(b.get("tx_count", 0) for b in block_stats)
        total_eth = sum(b.get("total_eth_moved", 0) for b in block_stats)
        total_whales = sum(b.get("whale_count", 0) for b in block_stats)
        avg_gas = (
            sum(b.get("avg_gas_gwei", 0) for b in block_stats) / len(block_stats)
            if block_stats
            else 0
        )

        return {
            "status": "ok",
            "network": network,
            "last_update": _background_cache.get("last_update"),
            "eth_price_usd": get_current_eth_price(),
            "recent_10_blocks": {
                "total_transactions": total_tx,
                "total_eth_moved": round(total_eth, 4),
                "total_usd_moved": round(total_eth * get_current_eth_price(), 0),
                "whale_count": total_whales,
                "avg_gas_gwei": round(avg_gas, 2),
            },
            "block_history": block_stats,
        }
    except Exception as e:
        logger.error(f"[API] /stats error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onchain/block/{block_number}")
async def get_block_detail(block_number: int):
    """
    Detail satu blok Ethereum secara langsung dari RPC.
    Termasuk proses enrichment semua transaksinya.
    """
    try:
        result = await asyncio.to_thread(process_block, block_number)
        if not result:
            raise HTTPException(
                status_code=404, detail=f"Block #{block_number} tidak ditemukan"
            )
        return {"status": "ok", **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] /block/{block_number} error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onchain/latest-block")
async def get_latest_block_info():
    """Ambil informasi blok terbaru dari RPC secara real-time."""
    try:
        latest_num = await asyncio.to_thread(get_latest_block_number)
        block_data = await asyncio.to_thread(get_block, latest_num, False)  # No full tx
        
        if not block_data:
            raise HTTPException(status_code=503, detail="Tidak bisa ambil data blok")

        timestamp = hex_to_int(block_data.get("timestamp", "0x0"))
        tx_count = len(block_data.get("transactions", []))
        base_fee = hex_to_int(block_data.get("baseFeePerGas", "0x0")) / 1e9

        return {
            "status": "ok",
            "block_number": latest_num,
            "timestamp": datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(),
            "tx_count": tx_count,
            "base_fee_gwei": round(base_fee, 2),
            "gas_limit": hex_to_int(block_data.get("gasLimit", "0x0")),
            "gas_used": hex_to_int(block_data.get("gasUsed", "0x0")),
            "miner": block_data.get("miner", ""),
            "difficulty": hex_to_int(block_data.get("difficulty", "0x0")),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[API] /latest-block error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/onchain/stream")
async def sse_stream():
    """
    Server-Sent Events (SSE) endpoint untuk streaming real-time.
    Frontend bisa subscribe ke endpoint ini dan menerima update
    setiap kali ada blok baru (tanpa perlu polling manual).
    
    Usage di frontend:
    const es = new EventSource('/api/onchain/stream');
    es.onmessage = (e) => console.log(JSON.parse(e.data));
    """
    async def event_generator() -> AsyncGenerator[str, None]:
        last_sent_block = 0
        
        while True:
            try:
                # Kirim event jika ada data baru
                cached = _background_cache.get("latest_blocks", [])
                if cached:
                    latest_block_num = cached[-1].get("block_number", 0) if cached else 0
                    
                    if latest_block_num > last_sent_block:
                        # Ambil transaksi terbaru dari DB
                        txs = await asyncio.to_thread(get_recent_live_txs, 30)
                        payload = {
                            "event": "new_block",
                            "block_number": latest_block_num,
                            "timestamp": _background_cache.get("last_update"),
                            "transactions": txs[:20],
                            "stats": _background_cache.get("network_stats", {}),
                        }
                        last_sent_block = latest_block_num
                        yield f"data: {json.dumps(payload)}\n\n"
                
                # Heartbeat setiap 15 detik agar koneksi tidak putus
                yield f": heartbeat\n\n"
                await asyncio.sleep(12)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[SSE] Error: {e}")
                yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
                await asyncio.sleep(5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/onchain/health")
async def health_check():
    """Health check endpoint."""
    try:
        latest = await asyncio.to_thread(get_latest_block_number)
        return {
            "status": "ok",
            "service": "on-chain-analysis",
            "port": 8014,
            "latest_block": latest,
            "eth_price_usd": get_current_eth_price(),
            "last_poll": _background_cache.get("last_update"),
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}

# python/onchain/live_feed.py
# Engine utama: polling Ethereum RPC, parsing transaksi, whale detection

import logging
import time
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Optional

from config import (
    WHALE_ETH_THRESHOLD,
    WHALE_TOKEN_USD_THRESHOLD,
    EXCHANGE_LABELS,
    KNOWN_TOKENS,
    DEFAULT_ETH_PRICE_USD,
    COINGECKO_PRICE_URL,
    TX_BATCH_LIMIT,
    MAX_BLOCKS_PER_FETCH,
    RPC_TIMEOUT,
)
from rpc_client import (
    get_latest_block_number,
    get_block,
    get_gas_price,
    hex_to_int,
    wei_to_eth,
    ERC20_TRANSFER_TOPIC,
)
from decoder import (
    decode_method_id,
    decode_erc20_transfer,
    decode_erc20_log,
    classify_transaction,
    format_address,
    gwei_from_hex,
)
from db import save_whale_tx, save_live_tx, save_block_stats, prune_live_txs, init_db

logger = logging.getLogger(__name__)


# ─── State ────────────────────────────────────────────────────────────────────
_last_processed_block: int = 0
_eth_price_usd: float = DEFAULT_ETH_PRICE_USD
_last_price_update: float = 0.0
_PRICE_UPDATE_INTERVAL = 120  # Update harga ETH setiap 2 menit


# ─── ETH Price Fetcher ────────────────────────────────────────────────────────

def _update_eth_price() -> None:
    """Fetch harga ETH dari CoinGecko (dengan cache 2 menit)."""
    global _eth_price_usd, _last_price_update
    now = time.time()
    if now - _last_price_update < _PRICE_UPDATE_INTERVAL:
        return

    try:
        req = urllib.request.Request(
            COINGECKO_PRICE_URL,
            headers={"Accept": "application/json", "User-Agent": "vrp-dashboard/1.0"},
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _eth_price_usd = data["ethereum"]["usd"]
            _last_price_update = now
            logger.info(f"[FEED] ETH price updated: ${_eth_price_usd:,.2f}")
    except Exception as e:
        logger.warning(f"[FEED] Gagal fetch ETH price, pakai fallback ${_eth_price_usd}: {e}")


# ─── Exchange Label Lookup ────────────────────────────────────────────────────

def get_exchange_label(address: Optional[str]) -> Optional[str]:
    """Cari nama exchange untuk alamat ini, jika ada di registry."""
    if not address:
        return None
    return EXCHANGE_LABELS.get(address.lower())


# ─── Transaction Enrichment ───────────────────────────────────────────────────

def enrich_transaction(tx: dict, block_timestamp: int, block_number: int) -> dict:
    """
    Mengambil transaksi mentah dan menambahkan informasi yang sudah di-decode:
    - Nilai dalam ETH dan USD
    - Label exchange (jika dikenal)
    - Nama method yang dipanggil
    - Tipe transaksi
    - Flag is_whale
    - Timestamp yang bisa dibaca manusia
    
    Args:
        tx: Raw transaction dict dari RPC
        block_timestamp: Unix timestamp blok (integer)
        block_number: Nomor blok
        
    Returns:
        Dict transaksi yang sudah di-enrich lengkap
    """
    from_addr = tx.get("from", "")
    to_addr = tx.get("to", "") or ""  # None untuk contract creation
    input_data = tx.get("input", "0x")
    
    # Nilai ETH
    value_wei = hex_to_int(tx.get("value", "0x0"))
    value_eth = wei_to_eth(value_wei)
    value_usd = value_eth * _eth_price_usd

    # Gas
    gas_price_hex = tx.get("gasPrice", "0x0")
    gas_price_gwei = round(gwei_from_hex(gas_price_hex), 2)

    # Method decoding
    method_info = decode_method_id(input_data)
    method_name = method_info["method_name"]

    # Classifikasi tipe
    tx_type = classify_transaction(tx, value_eth)

    # Label exchange
    from_label = get_exchange_label(from_addr)
    to_label = get_exchange_label(to_addr)

    # Cek whale
    is_whale = False
    if tx_type in ("whale_eth",) or value_eth >= WHALE_ETH_THRESHOLD:
        is_whale = True

    # Timestamp
    dt = datetime.fromtimestamp(block_timestamp, tz=timezone.utc)
    timestamp_iso = dt.isoformat()
    timestamp_display = dt.strftime("%H:%M:%S")

    enriched = {
        "hash": tx.get("hash", ""),
        "block_number": block_number,
        "timestamp": timestamp_iso,
        "timestamp_display": timestamp_display,
        "from": from_addr.lower(),
        "to": to_addr.lower() if to_addr else None,
        "from_short": format_address(from_addr),
        "to_short": format_address(to_addr) if to_addr else "Contract Creation",
        "from_label": from_label,
        "to_label": to_label,
        "value_eth": round(value_eth, 6),
        "value_usd": round(value_usd, 2),
        "value_display": _format_value_display(value_eth, value_usd),
        "gas_price_gwei": gas_price_gwei,
        "method_name": method_name,
        "tx_type": tx_type,
        "is_whale": is_whale,
        "nonce": hex_to_int(tx.get("nonce", "0x0")),
    }

    # ERC-20 Transfer decoding
    if method_info["method_id"] == "0xa9059cbb":
        decoded_erc20 = decode_erc20_transfer(input_data)
        if decoded_erc20 and to_addr:
            token_info = KNOWN_TOKENS.get(to_addr.lower())
            if token_info:
                amount = decoded_erc20["amount_raw"] / (10 ** token_info["decimals"])
                token_usd = _estimate_token_usd(token_info["symbol"], amount)
                enriched["token_symbol"] = token_info["symbol"]
                enriched["token_amount"] = round(amount, 2)
                enriched["token_usd"] = round(token_usd, 2)
                # Update whale status untuk token
                if token_usd >= WHALE_TOKEN_USD_THRESHOLD:
                    enriched["is_whale"] = True
                    enriched["tx_type"] = "whale_erc20"

    return enriched


def _format_value_display(value_eth: float, value_usd: float) -> str:
    """Format nilai untuk display di UI."""
    if value_eth == 0:
        return "0 ETH"
    if value_eth >= 1000:
        return f"${value_usd/1_000_000:.1f}M ({value_eth:,.0f} ETH)"
    elif value_eth >= 1:
        return f"${value_usd:,.0f} ({value_eth:.2f} ETH)"
    elif value_usd >= 1:
        return f"${value_usd:.2f} ({value_eth:.4f} ETH)"
    else:
        return f"{value_eth:.6f} ETH"


def _estimate_token_usd(symbol: str, amount: float) -> float:
    """Estimasi nilai USD token stablecoin (untuk whale detection)."""
    STABLECOINS = {"USDT", "USDC", "DAI", "BUSD", "TUSD"}
    if symbol in STABLECOINS:
        return amount
    if symbol == "WBTC":
        return amount * 67000  # Approx
    if symbol == "WETH":
        return amount * _eth_price_usd
    return 0  # Unknown token, tidak hitung USD-nya


# ─── Block Processing ─────────────────────────────────────────────────────────

def process_block(block_number: int) -> dict:
    """
    Fetch dan proses satu blok Ethereum:
    1. Ambil data blok + semua transaksi
    2. Enrich setiap transaksi (decode, label, whale check)
    3. Simpan ke SQLite
    4. Return summary + transaksi yang sudah di-enrich
    
    Args:
        block_number: Nomor blok yang akan diproses
        
    Returns:
        {
            block_number, timestamp, tx_count, 
            avg_gas_gwei, total_eth_moved, whale_count,
            transactions: [list of enriched tx],
            whales: [list of whale tx only]
        }
    """
    logger.info(f"[FEED] Processing block #{block_number}")

    block_data = get_block(block_number, full_transactions=True)
    if not block_data:
        logger.warning(f"[FEED] Block #{block_number} tidak ditemukan")
        return {}

    # Parse block header
    block_timestamp = hex_to_int(block_data.get("timestamp", "0x0"))
    base_fee_hex = block_data.get("baseFeePerGas", "0x0")
    base_fee_gwei = round(gwei_from_hex(base_fee_hex), 2)

    txs_raw = block_data.get("transactions", [])
    
    # Batasi jumlah tx yang diproses per blok
    txs_to_process = txs_raw[:TX_BATCH_LIMIT]
    
    enriched_txs = []
    whale_txs = []
    total_eth_moved = 0.0
    total_gas = 0.0
    whale_count = 0

    for tx in txs_to_process:
        try:
            enriched = enrich_transaction(tx, block_timestamp, block_number)
            enriched_txs.append(enriched)
            
            total_eth_moved += enriched["value_eth"]
            total_gas += enriched["gas_price_gwei"]
            
            # Simpan ke live cache
            save_live_tx(enriched)
            
            # Proses whale
            if enriched["is_whale"]:
                whale_count += 1
                whale_txs.append(enriched)
                save_whale_tx(enriched)
                logger.info(
                    f"[FEED] 🐋 WHALE: {enriched['value_display']} "
                    f"from {enriched['from_short']} to {enriched['to_short']}"
                )
        except Exception as e:
            logger.error(f"[FEED] Error processing tx {tx.get('hash', 'unknown')}: {e}")
            continue

    avg_gas = round(total_gas / len(txs_to_process), 2) if txs_to_process else 0

    # Simpan statistik blok
    block_stats = {
        "block_number": block_number,
        "timestamp": datetime.fromtimestamp(block_timestamp, tz=timezone.utc).isoformat(),
        "tx_count": len(txs_raw),  # Total tx di blok (termasuk yang tidak diproses)
        "avg_gas_gwei": avg_gas,
        "total_eth_moved": round(total_eth_moved, 4),
        "whale_count": whale_count,
        "base_fee_gwei": base_fee_gwei,
    }
    save_block_stats(block_stats)

    # Bersihkan cache lama
    prune_live_txs(keep=500)

    return {
        **block_stats,
        "base_fee_gwei": base_fee_gwei,
        "transactions": enriched_txs,
        "whales": whale_txs,
        "processed_count": len(enriched_txs),
    }


# ─── Main Polling Engine ──────────────────────────────────────────────────────

def fetch_latest_blocks(n: int = MAX_BLOCKS_PER_FETCH) -> list[dict]:
    """
    Fetch N blok terbaru yang belum diproses.
    Digunakan oleh API endpoint untuk polling mode.
    
    Returns:
        List hasil process_block() untuk setiap blok baru
    """
    global _last_processed_block

    _update_eth_price()  # Update harga ETH jika sudah expired

    try:
        latest = get_latest_block_number()
    except Exception as e:
        logger.error(f"[FEED] Gagal ambil latest block: {e}")
        return []

    if _last_processed_block == 0:
        # Pertama kali: mulai dari blok terbaru
        _last_processed_block = latest - 1

    # Hitung blok yang perlu diproses
    from_block = _last_processed_block + 1
    to_block = min(latest, from_block + n - 1)

    if from_block > latest:
        logger.debug("[FEED] Tidak ada blok baru")
        return []

    results = []
    for block_num in range(from_block, to_block + 1):
        try:
            result = process_block(block_num)
            if result:
                results.append(result)
        except Exception as e:
            logger.error(f"[FEED] Error processing block #{block_num}: {e}")

    if results:
        _last_processed_block = to_block
        logger.info(
            f"[FEED] Processed blocks #{from_block}-#{to_block} "
            f"({sum(r.get('processed_count', 0) for r in results)} tx)"
        )

    return results


def get_current_eth_price() -> float:
    """Getter untuk harga ETH saat ini."""
    _update_eth_price()
    return _eth_price_usd


def get_network_stats() -> dict:
    """Ambil statistik jaringan Ethereum saat ini."""
    try:
        latest_block = get_latest_block_number()
        gas_price = get_gas_price()
        return {
            "latest_block": latest_block,
            "gas_price_gwei": gas_price,
            "eth_price_usd": _eth_price_usd,
            "network": "Ethereum Mainnet",
            "chain_id": 1,
        }
    except Exception as e:
        logger.error(f"[FEED] Error getting network stats: {e}")
        return {
            "latest_block": 0,
            "gas_price_gwei": 0,
            "eth_price_usd": _eth_price_usd,
            "network": "Ethereum Mainnet (offline)",
            "chain_id": 1,
        }


# ─── Module Init ─────────────────────────────────────────────────────────────
# Inisialisasi DB saat module pertama kali di-import
try:
    init_db()
    logger.info("[FEED] On-chain engine initialized")
except Exception as e:
    logger.error(f"[FEED] Failed to init DB: {e}")

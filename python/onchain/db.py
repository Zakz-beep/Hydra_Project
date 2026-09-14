# python/onchain/db.py
# SQLite helper untuk menyimpan riwayat transaksi on-chain (whale alerts, dll)

import sqlite3
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from config import DB_PATH

logger = logging.getLogger(__name__)


# ─── Schema ───────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS whale_transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash         TEXT UNIQUE NOT NULL,
    block_number    INTEGER NOT NULL,
    timestamp       TEXT NOT NULL,       -- ISO 8601 UTC
    tx_type         TEXT NOT NULL,       -- 'whale_eth', 'whale_erc20', dll
    from_address    TEXT NOT NULL,
    to_address      TEXT,
    from_label      TEXT,               -- Nama exchange/entity jika dikenal
    to_label        TEXT,
    value_eth       REAL DEFAULT 0,
    value_usd       REAL DEFAULT 0,
    token_symbol    TEXT,               -- Null jika pure ETH
    token_amount    REAL DEFAULT 0,
    gas_price_gwei  REAL DEFAULT 0,
    method_name     TEXT,
    raw_data        TEXT                -- JSON seluruh tx untuk referensi
);

CREATE INDEX IF NOT EXISTS idx_whale_tx_timestamp ON whale_transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_whale_tx_block ON whale_transactions(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_whale_tx_type ON whale_transactions(tx_type);

CREATE TABLE IF NOT EXISTS block_stats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    block_number    INTEGER UNIQUE NOT NULL,
    timestamp       TEXT NOT NULL,
    tx_count        INTEGER DEFAULT 0,
    avg_gas_gwei    REAL DEFAULT 0,
    total_eth_moved REAL DEFAULT 0,
    whale_count     INTEGER DEFAULT 0,
    base_fee_gwei   REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_block_stats_number ON block_stats(block_number DESC);

CREATE TABLE IF NOT EXISTS live_transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash         TEXT UNIQUE NOT NULL,
    block_number    INTEGER NOT NULL,
    timestamp       TEXT NOT NULL,
    tx_type         TEXT NOT NULL,
    from_address    TEXT NOT NULL,
    to_address      TEXT,
    from_label      TEXT,
    to_label        TEXT,
    value_eth       REAL DEFAULT 0,
    value_usd       REAL DEFAULT 0,
    gas_price_gwei  REAL DEFAULT 0,
    method_name     TEXT,
    is_whale        INTEGER DEFAULT 0   -- Boolean: 1 = whale
);

CREATE INDEX IF NOT EXISTS idx_live_tx_timestamp ON live_transactions(timestamp DESC);
"""


def get_conn() -> sqlite3.Connection:
    """Buat koneksi SQLite dengan row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging untuk performance
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    """Inisialisasi database dan buat tabel jika belum ada."""
    conn = get_conn()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
        logger.info(f"[DB] On-chain database initialized: {DB_PATH}")
    finally:
        conn.close()


# ─── Whale Transactions ───────────────────────────────────────────────────────

def save_whale_tx(tx_data: dict) -> bool:
    """
    Simpan transaksi whale ke database.
    
    Args:
        tx_data: Dict berisi semua informasi transaksi yang sudah di-enrich
        
    Returns:
        True jika berhasil disimpan, False jika sudah ada (duplicate)
    """
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO whale_transactions (
                tx_hash, block_number, timestamp, tx_type,
                from_address, to_address, from_label, to_label,
                value_eth, value_usd, token_symbol, token_amount,
                gas_price_gwei, method_name, raw_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tx_data.get("hash", ""),
                tx_data.get("block_number", 0),
                tx_data.get("timestamp", datetime.now(timezone.utc).isoformat()),
                tx_data.get("tx_type", "unknown"),
                tx_data.get("from", ""),
                tx_data.get("to", ""),
                tx_data.get("from_label"),
                tx_data.get("to_label"),
                tx_data.get("value_eth", 0),
                tx_data.get("value_usd", 0),
                tx_data.get("token_symbol"),
                tx_data.get("token_amount", 0),
                tx_data.get("gas_price_gwei", 0),
                tx_data.get("method_name"),
                json.dumps(tx_data),
            ),
        )
        conn.commit()
        return conn.execute(
            "SELECT changes()"
        ).fetchone()[0] > 0
    except sqlite3.Error as e:
        logger.error(f"[DB] Error saving whale tx: {e}")
        return False
    finally:
        conn.close()


def get_recent_whale_txs(limit: int = 50) -> list[dict]:
    """Ambil transaksi whale terbaru dari database."""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM whale_transactions
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


# ─── Live Transactions ────────────────────────────────────────────────────────

def save_live_tx(tx_data: dict) -> None:
    """Simpan transaksi ke tabel live_transactions (cache untuk feed)."""
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT OR IGNORE INTO live_transactions (
                tx_hash, block_number, timestamp, tx_type,
                from_address, to_address, from_label, to_label,
                value_eth, value_usd, gas_price_gwei, method_name, is_whale
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tx_data.get("hash", ""),
                tx_data.get("block_number", 0),
                tx_data.get("timestamp", datetime.now(timezone.utc).isoformat()),
                tx_data.get("tx_type", "unknown"),
                tx_data.get("from", ""),
                tx_data.get("to", ""),
                tx_data.get("from_label"),
                tx_data.get("to_label"),
                tx_data.get("value_eth", 0),
                tx_data.get("value_usd", 0),
                tx_data.get("gas_price_gwei", 0),
                tx_data.get("method_name"),
                1 if tx_data.get("is_whale") else 0,
            ),
        )
        conn.commit()
    except sqlite3.Error as e:
        logger.error(f"[DB] Error saving live tx: {e}")
    finally:
        conn.close()


def get_recent_live_txs(limit: int = 100) -> list[dict]:
    """Ambil transaksi live terbaru dari cache."""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM live_transactions
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def prune_live_txs(keep: int = 500) -> None:
    """Hapus transaksi lama dari live_transactions, simpan hanya N terbaru."""
    conn = get_conn()
    try:
        conn.execute(
            """
            DELETE FROM live_transactions
            WHERE id NOT IN (
                SELECT id FROM live_transactions
                ORDER BY timestamp DESC
                LIMIT ?
            )
            """,
            (keep,),
        )
        conn.commit()
    finally:
        conn.close()


# ─── Block Stats ──────────────────────────────────────────────────────────────

def save_block_stats(stats: dict) -> None:
    """Simpan statistik blok."""
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO block_stats (
                block_number, timestamp, tx_count, avg_gas_gwei,
                total_eth_moved, whale_count, base_fee_gwei
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                stats.get("block_number", 0),
                stats.get("timestamp", ""),
                stats.get("tx_count", 0),
                stats.get("avg_gas_gwei", 0),
                stats.get("total_eth_moved", 0),
                stats.get("whale_count", 0),
                stats.get("base_fee_gwei", 0),
            ),
        )
        conn.commit()
    except sqlite3.Error as e:
        logger.error(f"[DB] Error saving block stats: {e}")
    finally:
        conn.close()


def get_recent_block_stats(limit: int = 20) -> list[dict]:
    """Ambil statistik blok terbaru."""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM block_stats
            ORDER BY block_number DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()

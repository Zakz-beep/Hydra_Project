"""
db.py — SQLite3 Database Layer untuk VRP Signal Engine
=======================================================
Handles tiga fitur utama:

  1. Persistent Snapshots
     Ganti in-memory deque → SQLite. Data tidak hilang saat server restart.
     Table: vrp_snapshots, rv_engine_snapshots

  2. HAR Training Data
     Simpan daily RV series per ticker → HAR model makin akurat seiring waktu.
     Table: har_daily_rv

  3. Backtesting Signal Accuracy
     Track setiap signal change + mark outcome setelah N hari.
     Table: signal_log, signal_outcomes

DB path: ./data/vrp.db (auto-created kalau belum ada)

Cara pakai di vrp_api.py:
  from db import VRPDatabase
  db = VRPDatabase()
  db.insert_snapshot(result)
  history = db.get_snapshot_history("^GSPC", n=50)
"""

import sqlite3
import os
import json
import threading
from datetime import datetime, timedelta
from typing import Optional
from contextlib import contextmanager


# ════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════

DB_DIR  = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DB_DIR, "vrp.db")


# ════════════════════════════════════════════════════════
# SCHEMA
# ════════════════════════════════════════════════════════

SCHEMA = """
-- ── 1. VRP Snapshots ───────────────────────────────────────────
-- Setiap kali /api/vrp dipanggil, satu row di-insert.
-- Replaces in-memory _snapshot_history deque.
CREATE TABLE IF NOT EXISTS vrp_snapshots (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,               -- ISO8601
    ticker      TEXT    NOT NULL,
    spot        REAL    NOT NULL,
    data_source TEXT    NOT NULL DEFAULT 'live',

    -- Volatility
    iv          REAL    NOT NULL,
    rv          REAL    NOT NULL,
    rv_har      REAL    NOT NULL,
    hv20        REAL    NOT NULL,
    n_candles   INTEGER NOT NULL DEFAULT 0,

    -- VRP
    vrp_raw     REAL    NOT NULL,
    vrp_z       REAL    NOT NULL,
    vrp_vs_har  REAL    NOT NULL,

    -- Signal
    signal      TEXT    NOT NULL,
    signal_desc TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_vrp_ticker_ts
    ON vrp_snapshots (ticker, timestamp DESC);


-- ── 2. RV Engine Snapshots ─────────────────────────────────────
-- Detail dari rv_engine (Approach 2 & 3).
-- Foreign key ke vrp_snapshots.id (optional, join by timestamp+ticker).
CREATE TABLE IF NOT EXISTS rv_engine_snapshots (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp            TEXT    NOT NULL,
    ticker               TEXT    NOT NULL,
    is_market_open       INTEGER NOT NULL DEFAULT 0,  -- boolean
    session_elapsed_pct  REAL    NOT NULL DEFAULT 0,
    n_candles_5m         INTEGER NOT NULL DEFAULT 0,
    n_candles_15m        INTEGER NOT NULL DEFAULT 0,

    -- RV components
    rv_intraday_raw      REAL    NOT NULL DEFAULT 0,
    rv_yesterday         REAL    NOT NULL DEFAULT 0,
    hv20                 REAL    NOT NULL DEFAULT 0,
    blend_weight         REAL    NOT NULL DEFAULT 0,
    rv_blended           REAL    NOT NULL DEFAULT 0,

    -- HAR
    rv_har_base          REAL    NOT NULL DEFAULT 0,
    rv_har_updated       REAL    NOT NULL DEFAULT 0,
    har_r2               REAL,                        -- NULL kalau belum fitted
    har_coefs_json       TEXT,                        -- JSON string of coefficients

    -- Display
    rv_display_15m       REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rve_ticker_ts
    ON rv_engine_snapshots (ticker, timestamp DESC);


-- ── 3. HAR Daily RV ────────────────────────────────────────────
-- Simpan daily RV per ticker untuk HAR model training.
-- Satu row per (ticker, date). UPSERT jika tanggal sama.
CREATE TABLE IF NOT EXISTS har_daily_rv (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker      TEXT    NOT NULL,
    date        TEXT    NOT NULL,       -- YYYY-MM-DD
    rv_daily    REAL    NOT NULL,       -- squared log return × 252
    close_price REAL,
    source      TEXT    NOT NULL DEFAULT 'live',
    UNIQUE (ticker, date)               -- prevent duplicate dates
);

CREATE INDEX IF NOT EXISTS idx_har_ticker_date
    ON har_daily_rv (ticker, date DESC);


-- ── 4. Signal Log ──────────────────────────────────────────────
-- Catat setiap kali signal berubah state.
-- Basis untuk backtesting accuracy.
CREATE TABLE IF NOT EXISTS signal_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    ticker          TEXT    NOT NULL,
    signal          TEXT    NOT NULL,
    prev_signal     TEXT,               -- signal sebelumnya
    vrp_z           REAL    NOT NULL,
    spot_at_signal  REAL    NOT NULL,
    iv_at_signal    REAL    NOT NULL,
    rv_at_signal    REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signal_ticker_ts
    ON signal_log (ticker, timestamp DESC);


-- ── 5. Signal Outcomes ─────────────────────────────────────────
-- Mark hasil dari setiap signal setelah N hari.
-- Di-update secara batch oleh /api/backtest atau background job.
CREATE TABLE IF NOT EXISTS signal_outcomes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_log_id   INTEGER NOT NULL REFERENCES signal_log(id),
    horizon_days    INTEGER NOT NULL,   -- 1, 5, 20 hari ke depan
    spot_at_close   REAL,               -- harga saat horizon tercapai
    rv_realized     REAL,               -- RV yang terealisasi
    iv_at_signal    REAL,
    outcome         TEXT,               -- 'correct', 'incorrect', 'neutral'
    pnl_pct         REAL,               -- simplified: IV - RV_realized (dalam %)
    evaluated_at    TEXT,
    UNIQUE (signal_log_id, horizon_days)
);

-- ── 6. Mini Tickers ─────────────────────────────────────────
-- Simpan daftar ticker untuk MarketOverview widget.
CREATE TABLE IF NOT EXISTS mini_tickers (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0
);
-- ── 7. Paper Trading ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_balance (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance REAL NOT NULL DEFAULT 10000.0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS paper_positions (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    mode TEXT NOT NULL,
    entry_price REAL NOT NULL,
    tp_price REAL,
    sl_price REAL,
    margin REAL NOT NULL,
    leverage INTEGER NOT NULL,
    qty REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_history (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    mode TEXT NOT NULL,
    entry_price REAL NOT NULL,
    close_price REAL NOT NULL,
    close_reason TEXT NOT NULL,
    pnl REAL NOT NULL,
    margin REAL NOT NULL,
    leverage INTEGER NOT NULL,
    qty REAL NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT NOT NULL
);
"""


# ════════════════════════════════════════════════════════
# DATABASE CLASS
# ════════════════════════════════════════════════════════

class VRPDatabase:
    """
    Thread-safe SQLite3 wrapper untuk VRP Signal Engine.

    Semua public methods aman dipanggil dari multiple FastAPI workers
    karena pakai threading.Lock() + WAL mode.

    Usage:
        db = VRPDatabase()                    # singleton via module-level _db
        db.insert_snapshot(vrp_result_dict)
        history = db.get_snapshot_history("^GSPC", n=50)
    """

    def __init__(self, db_path: str = DB_PATH):
        if db_path != ":memory:":
            os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._path = db_path
        self._lock = threading.Lock()
        self._init_db()

    # ─────────────────────────────────────────────────
    # Internal helpers
    # ─────────────────────────────────────────────────

    @contextmanager
    def _conn(self):
        """Context manager: buka koneksi, commit, tutup. Thread-safe via lock."""
        with self._lock:
            conn = getattr(self, "_mem_conn", None) or sqlite3.connect(self._path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            if self._path != ":memory:":
                conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            try:
                yield conn
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            finally:
                if self._path != ":memory:":
                    conn.close()

    def _init_db(self):
        """Create tables kalau belum ada."""
        if self._path == ":memory:":
            self._mem_conn = sqlite3.connect(":memory:", check_same_thread=False)
            self._mem_conn.row_factory = sqlite3.Row
            self._mem_conn.executescript(SCHEMA)
            self._mem_conn.commit()
        else:
            with self._conn() as conn:
                conn.executescript(SCHEMA)

    # ─────────────────────────────────────────────────
    # FEATURE 1: Persistent Snapshots
    # ─────────────────────────────────────────────────

    def insert_snapshot(self, result: dict) -> int:
        """
        Insert satu VRP result snapshot ke DB.
        Return row id.

        Expects dict dari compute_vrp_result() di vrp_api.py.
        """
        with self._conn() as conn:
            cur = conn.execute("""
                INSERT INTO vrp_snapshots
                    (timestamp, ticker, spot, data_source,
                     iv, rv, rv_har, hv20, n_candles,
                     vrp_raw, vrp_z, vrp_vs_har,
                     signal, signal_desc)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                result.get("timestamp", datetime.now().isoformat()),
                result["ticker"],
                result["spot"],
                result.get("data_source", "live"),
                result["iv"],
                result["rv"],
                result["rv_har"],
                result["hv20"],
                result.get("n_candles", 0),
                result["vrp_raw"],
                result["vrp_z"],
                result["vrp_vs_har"],
                result["signal"],
                result.get("signal_desc", ""),
            ))
            snap_id = cur.lastrowid

            # Kalau ada rv_engine data, insert juga
            rv = result.get("rv_engine")
            if rv:
                self._insert_rv_engine_snapshot(conn, rv)

        return snap_id

    def _insert_rv_engine_snapshot(self, conn: sqlite3.Connection, rv: dict):
        """Insert rv_engine detail. Dipanggil dari insert_snapshot."""
        coefs = rv.get("har_coefficients", {})
        conn.execute("""
            INSERT INTO rv_engine_snapshots
                (timestamp, ticker, is_market_open, session_elapsed_pct,
                 n_candles_5m, n_candles_15m,
                 rv_intraday_raw, rv_yesterday, hv20, blend_weight, rv_blended,
                 rv_har_base, rv_har_updated, har_r2, har_coefs_json,
                 rv_display_15m)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            rv.get("timestamp", datetime.now().isoformat()),
            rv["ticker"],
            int(rv.get("is_market_open", False)),
            rv.get("session_elapsed_pct", 0),
            rv.get("n_candles_5m", 0),
            rv.get("n_candles_15m", 0),
            rv.get("rv_intraday_raw", 0),
            rv.get("rv_yesterday", 0),
            rv.get("hv20", 0),
            rv.get("blend_weight", 0),
            rv.get("rv_blended", 0),
            rv.get("rv_har_base", 0),
            rv.get("rv_har_updated", 0),
            coefs.get("r2"),
            json.dumps(coefs),
            rv.get("rv_display_15m", 0),
        ))

    def get_snapshot_history(
        self,
        ticker: str,
        n: int = 50,
        from_ts: Optional[str] = None,
        to_ts:   Optional[str] = None,
    ) -> list[dict]:
        """
        Ambil N snapshot terakhir untuk ticker.
        Optional filter by timestamp range (ISO8601 string).

        Return format sama dengan in-memory _snapshot_history
        supaya kompatibel dengan existing frontend.
        """
        params: list = [ticker]
        where_clauses = ["ticker = ?"]

        if from_ts:
            where_clauses.append("timestamp >= ?")
            params.append(from_ts)
        if to_ts:
            where_clauses.append("timestamp <= ?")
            params.append(to_ts)

        where = " AND ".join(where_clauses)
        params.append(n)

        with self._conn() as conn:
            rows = conn.execute(f"""
                SELECT timestamp, iv*100 AS iv, rv*100 AS rv,
                       vrp_raw*100 AS vrp, signal,
                       spot, vrp_z, signal_desc
                FROM vrp_snapshots
                WHERE {where}
                ORDER BY timestamp DESC
                LIMIT ?
            """, params).fetchall()

        # Return dalam urutan ascending (oldest first) untuk charting
        result = [dict(r) for r in reversed(rows)]

        # Format time field biar kompatibel sama frontend
        for r in result:
            try:
                dt = datetime.fromisoformat(r["timestamp"])
                r["time"] = dt.strftime("%H:%M:%S")
            except Exception:
                r["time"] = r["timestamp"]

        return result

    def get_latest_snapshot(self, ticker: str) -> Optional[dict]:
        """Ambil snapshot terbaru untuk ticker."""
        with self._conn() as conn:
            row = conn.execute("""
                SELECT * FROM vrp_snapshots
                WHERE ticker = ?
                ORDER BY timestamp DESC
                LIMIT 1
            """, (ticker,)).fetchone()
        return dict(row) if row else None

    def get_vrp_history_raw(self, ticker: str, days: int = 60) -> list[float]:
        """
        Return list of vrp_raw values untuk rolling z-score calculation.
        Replaces in-memory _vrp_history list di vrp_api.py.
        """
        since = (datetime.now() - timedelta(days=days)).isoformat()
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT vrp_raw FROM vrp_snapshots
                WHERE ticker = ? AND timestamp >= ?
                ORDER BY timestamp ASC
            """, (ticker, since)).fetchall()
        return [r["vrp_raw"] for r in rows]

    # ─────────────────────────────────────────────────
    # FEATURE 2: HAR Training Data
    # ─────────────────────────────────────────────────

    def upsert_daily_rv(self, ticker: str, date: str, rv_daily: float,
                        close_price: Optional[float] = None,
                        source: str = "live"):
        """
        Insert atau update satu baris daily RV.
        Dipanggil setiap hari setelah market close.

        date format: 'YYYY-MM-DD'
        rv_daily: squared log return × 252 (annualized)
        """
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO har_daily_rv (ticker, date, rv_daily, close_price, source)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(ticker, date) DO UPDATE SET
                    rv_daily    = excluded.rv_daily,
                    close_price = excluded.close_price,
                    source      = excluded.source
            """, (ticker, date, rv_daily, close_price, source))

    def upsert_daily_rv_batch(self, ticker: str, records: list[dict]):
        """
        Batch upsert daily RV dari yfinance historical data.
        records: list of {'date': 'YYYY-MM-DD', 'rv_daily': float, 'close': float}

        Dipanggil saat RVEngine pertama kali init untuk seed DB.
        """
        with self._conn() as conn:
            conn.executemany("""
                INSERT INTO har_daily_rv (ticker, date, rv_daily, close_price, source)
                VALUES (:ticker, :date, :rv_daily, :close, :source)
                ON CONFLICT(ticker, date) DO UPDATE SET
                    rv_daily    = excluded.rv_daily,
                    close_price = excluded.close_price
            """, [
                {
                    "ticker":   ticker,
                    "date":     r["date"],
                    "rv_daily": r["rv_daily"],
                    "close":    r.get("close"),
                    "source":   r.get("source", "live"),
                }
                for r in records
            ])

    def get_har_rv_series(self, ticker: str, days: int = 252) -> list[dict]:
        """
        Ambil historical daily RV series untuk HAR model fitting.
        Return list of {'date': str, 'rv_daily': float}
        Sorted ascending (oldest first).

        Makin banyak data → HAR model makin akurat.
        """
        since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT date, rv_daily, close_price
                FROM har_daily_rv
                WHERE ticker = ? AND date >= ?
                ORDER BY date ASC
            """, (ticker, since)).fetchall()
        return [dict(r) for r in rows]

    def get_har_rv_array(self, ticker: str, days: int = 252):
        """
        Return numpy array of rv_daily values, untuk langsung di-feed ke fit_har_model().
        """
        import numpy as np
        records = self.get_har_rv_series(ticker, days)
        if not records:
            return np.array([])
        return np.array([r["rv_daily"] for r in records])

    def count_har_records(self, ticker: str) -> int:
        """Berapa banyak daily RV records yang sudah tersimpan untuk ticker ini."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM har_daily_rv WHERE ticker = ?",
                (ticker,)
            ).fetchone()
        return row["n"] if row else 0

    # ─────────────────────────────────────────────────
    # FEATURE 3: Signal Log + Backtesting
    # ─────────────────────────────────────────────────

    def log_signal_change(
        self,
        ticker:       str,
        signal:       str,
        prev_signal:  Optional[str],
        vrp_z:        float,
        spot:         float,
        iv:           float,
        rv:           float,
    ) -> int:
        """
        Catat signal change event.
        Hanya dipanggil kalau signal berubah dari sebelumnya.
        Return log id.
        """
        with self._conn() as conn:
            cur = conn.execute("""
                INSERT INTO signal_log
                    (timestamp, ticker, signal, prev_signal,
                     vrp_z, spot_at_signal, iv_at_signal, rv_at_signal)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().isoformat(),
                ticker, signal, prev_signal,
                vrp_z, spot, iv, rv,
            ))
        return cur.lastrowid

    def get_last_signal(self, ticker: str) -> Optional[str]:
        """Return signal terakhir yang tercatat untuk ticker ini."""
        with self._conn() as conn:
            row = conn.execute("""
                SELECT signal FROM signal_log
                WHERE ticker = ?
                ORDER BY timestamp DESC
                LIMIT 1
            """, (ticker,)).fetchone()
        return row["signal"] if row else None

    def evaluate_signal_outcomes(
        self,
        ticker:        str,
        horizons:      list[int] = [1, 5, 20],
    ) -> int:
        """
        Update signal_outcomes untuk semua signal yang belum dievaluasi
        dan horizon-nya sudah tercapai.

        Logic:
          - Ambil signal_log entries yang belum punya outcome untuk horizon N
          - Cari snapshot VRP di tanggal (signal_ts + N hari)
          - Hitung: outcome = 'correct' kalau IV > RV_realized untuk SHORT_VOL signal
                             = 'correct' kalau IV < RV_realized untuk LONG_VOL signal
          - Simpan ke signal_outcomes

        Return: jumlah outcomes yang baru dievaluasi.
        """
        count = 0
        with self._conn() as conn:
            # Ambil semua signal logs yang belum punya outcomes lengkap
            logs = conn.execute("""
                SELECT sl.id, sl.timestamp, sl.signal,
                       sl.spot_at_signal, sl.iv_at_signal, sl.rv_at_signal
                FROM signal_log sl
                WHERE sl.ticker = ?
                ORDER BY sl.timestamp ASC
            """, (ticker,)).fetchall()

            for log in logs:
                signal_ts = datetime.fromisoformat(log["timestamp"])

                for horizon in horizons:
                    # Skip kalau outcome sudah ada
                    existing = conn.execute("""
                        SELECT id FROM signal_outcomes
                        WHERE signal_log_id = ? AND horizon_days = ?
                    """, (log["id"], horizon)).fetchone()
                    if existing:
                        continue

                    # Target date
                    target_ts = (signal_ts + timedelta(days=horizon)).isoformat()

                    # Kalau target belum tercapai, skip
                    if target_ts > datetime.now().isoformat():
                        continue

                    # Cari snapshot terdekat di target date
                    future_snap = conn.execute("""
                        SELECT rv, iv FROM vrp_snapshots
                        WHERE ticker = ? AND timestamp >= ?
                        ORDER BY timestamp ASC
                        LIMIT 1
                    """, (ticker, target_ts)).fetchone()

                    if not future_snap:
                        continue

                    rv_realized = future_snap["rv"]
                    iv_at_sig   = log["iv_at_signal"]
                    signal      = log["signal"]

                    # Determine outcome
                    vrp_realized = iv_at_sig - rv_realized
                    if "SHORT_VOL" in signal:
                        # Short vol correct kalau IV > RV (premium ada)
                        outcome = "correct" if vrp_realized > 0 else "incorrect"
                    elif "LONG_VOL" in signal:
                        # Long vol correct kalau IV < RV
                        outcome = "correct" if vrp_realized < 0 else "incorrect"
                    else:
                        outcome = "neutral"

                    pnl_pct = vrp_realized * 100  # simplified P&L proxy

                    conn.execute("""
                        INSERT OR IGNORE INTO signal_outcomes
                            (signal_log_id, horizon_days, spot_at_close,
                             rv_realized, iv_at_signal, outcome, pnl_pct, evaluated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        log["id"], horizon,
                        future_snap["rv"],  # spot not available, store rv
                        rv_realized,
                        iv_at_sig,
                        outcome,
                        pnl_pct,
                        datetime.now().isoformat(),
                    ))
                    count += 1

        return count

    def get_backtest_summary(self, ticker: str) -> dict:
        """
        Return backtesting summary untuk ticker.

        Format:
        {
          "ticker": "^GSPC",
          "total_signals": 42,
          "by_horizon": {
            1:  {"total": 40, "correct": 28, "win_rate": 0.70, "avg_pnl": 0.42},
            5:  {...},
            20: {...},
          },
          "by_signal_type": {
            "STRONG_SHORT_VOL": {"total": 10, "correct": 8, "win_rate": 0.80},
            ...
          }
        }
        """
        with self._conn() as conn:
            total_signals = conn.execute(
                "SELECT COUNT(*) AS n FROM signal_log WHERE ticker = ?",
                (ticker,)
            ).fetchone()["n"]

            # By horizon
            by_horizon = {}
            for horizon in [1, 5, 20]:
                rows = conn.execute("""
                    SELECT outcome, COUNT(*) AS n, AVG(pnl_pct) AS avg_pnl
                    FROM signal_outcomes so
                    JOIN signal_log sl ON sl.id = so.signal_log_id
                    WHERE sl.ticker = ? AND so.horizon_days = ?
                    GROUP BY outcome
                """, (ticker, horizon)).fetchall()

                total = sum(r["n"] for r in rows)
                correct = next((r["n"] for r in rows if r["outcome"] == "correct"), 0)
                avg_pnl = next((r["avg_pnl"] for r in rows if r["outcome"] == "correct"), 0.0)

                by_horizon[horizon] = {
                    "total":    total,
                    "correct":  correct,
                    "win_rate": round(correct / total, 4) if total > 0 else None,
                    "avg_pnl":  round(avg_pnl or 0, 4),
                }

            # By signal type
            signal_rows = conn.execute("""
                SELECT sl.signal, so.outcome, COUNT(*) AS n
                FROM signal_outcomes so
                JOIN signal_log sl ON sl.id = so.signal_log_id
                WHERE sl.ticker = ?
                GROUP BY sl.signal, so.outcome
            """, (ticker,)).fetchall()

            by_signal: dict = {}
            for r in signal_rows:
                sig = r["signal"]
                if sig not in by_signal:
                    by_signal[sig] = {"total": 0, "correct": 0}
                by_signal[sig]["total"] += r["n"]
                if r["outcome"] == "correct":
                    by_signal[sig]["correct"] += r["n"]

            for sig in by_signal:
                t = by_signal[sig]["total"]
                c = by_signal[sig]["correct"]
                by_signal[sig]["win_rate"] = round(c / t, 4) if t > 0 else None

        return {
            "ticker":         ticker,
            "total_signals":  total_signals,
            "by_horizon":     by_horizon,
            "by_signal_type": by_signal,
        }

    def get_signal_log(self, ticker: str, n: int = 50) -> list[dict]:
        """Return N signal change events terakhir."""
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT sl.*, so_1.outcome  AS outcome_1d,
                             so_5.outcome  AS outcome_5d,
                             so_20.outcome AS outcome_20d
                FROM signal_log sl
                LEFT JOIN signal_outcomes so_1
                    ON so_1.signal_log_id = sl.id AND so_1.horizon_days = 1
                LEFT JOIN signal_outcomes so_5
                    ON so_5.signal_log_id = sl.id AND so_5.horizon_days = 5
                LEFT JOIN signal_outcomes so_20
                    ON so_20.signal_log_id = sl.id AND so_20.horizon_days = 20
                WHERE sl.ticker = ?
                ORDER BY sl.timestamp DESC
                LIMIT ?
            """, (ticker, n)).fetchall()
        return [dict(r) for r in rows]

    # ─────────────────────────────────────────────────
    # Utility
    # ─────────────────────────────────────────────────

    def get_db_stats(self) -> dict:
        """Return info tentang isi DB — untuk health check / debug."""
        with self._conn() as conn:
            tables = ["vrp_snapshots", "rv_engine_snapshots",
                      "har_daily_rv", "signal_log", "signal_outcomes"]
            stats = {}
            for t in tables:
                row = conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()
                stats[t] = row["n"]

            # Tickers yang ada
            tickers = conn.execute(
                "SELECT DISTINCT ticker FROM vrp_snapshots"
            ).fetchall()
            stats["tickers"] = [r["ticker"] for r in tickers]

            # DB file size
            stats["db_size_kb"] = round(os.path.getsize(self._path) / 1024, 1) if self._path != ":memory:" else 0

        return stats

    def cleanup_old_snapshots(self, ticker: str, keep_days: int = 90):
        """
        Hapus snapshots yang lebih tua dari keep_days.
        Jalankan secara periodik (misal tiap hari) untuk jaga ukuran DB.
        """
        cutoff = (datetime.now() - timedelta(days=keep_days)).isoformat()
        with self._conn() as conn:
            conn.execute("""
                DELETE FROM vrp_snapshots
                WHERE ticker = ? AND timestamp < ?
            """, (ticker, cutoff))
            conn.execute("""
                DELETE FROM rv_engine_snapshots
                WHERE ticker = ? AND timestamp < ?
            """, (ticker, cutoff))

    # ─────────────────────────────────────────────────
    # FEATURE 4: Mini Tickers
    # ─────────────────────────────────────────────────

    def get_mini_tickers(self) -> list[dict]:
        """Ambil daftar ticker untuk MarketOverview widget."""
        with self._conn() as conn:
            rows = conn.execute("SELECT symbol, name FROM mini_tickers ORDER BY sort_order ASC").fetchall()
        
        # Jika kosong, return default
        if not rows:
            return [
                {'symbol': '^GSPC', 'name': 'S&P 500'},
                {'symbol': 'QQQ', 'name': 'QQQ'},
                {'symbol': '^DJI', 'name': 'Dow 30'},
                {'symbol': '^IXIC', 'name': 'NASDAQ'},
                {'symbol': 'BTC-USD', 'name': 'Bitcoin'},
                {'symbol': 'ETH-USD', 'name': 'Ethereum'},
                {'symbol': 'GC=F', 'name': 'Gold'},
                {'symbol': 'CL=F', 'name': 'Crude Oil'},
            ]
        return [dict(r) for r in rows]

    def save_mini_tickers(self, tickers: list[dict]):
        """Simpan daftar ticker. Replace semua data yang ada."""
        with self._conn() as conn:
            conn.execute("DELETE FROM mini_tickers")
            for i, t in enumerate(tickers):
                conn.execute(
                    "INSERT INTO mini_tickers (symbol, name, sort_order) VALUES (?, ?, ?)",
                    (t["symbol"], t.get("name", t["symbol"]), i)
                )

    # ── 7. Paper Trading ───────────────────────────────────────────────

    def get_paper_balance(self) -> float:
        query = "SELECT balance FROM paper_balance WHERE id = 1"
        with self._conn() as conn:
            row = conn.execute(query).fetchone()
            if row:
                return row["balance"]
            else:
                conn.execute("INSERT INTO paper_balance (id, balance, updated_at) VALUES (1, 10000.0, ?)", (datetime.now().isoformat(),))
                return 10000.0

    def update_paper_balance(self, new_balance: float):
        query = "UPDATE paper_balance SET balance = ?, updated_at = ? WHERE id = 1"
        with self._conn() as conn:
            conn.execute(query, (new_balance, datetime.now().isoformat()))

    def get_paper_positions(self) -> list:
        query = "SELECT * FROM paper_positions ORDER BY created_at DESC"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query).fetchall()]

    def save_paper_position(self, pos: dict):
        query = """
        INSERT OR REPLACE INTO paper_positions 
        (id, ticker, mode, entry_price, tp_price, sl_price, margin, leverage, qty, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        with self._conn() as conn:
            conn.execute(query, (
                pos['id'], pos['ticker'], pos['mode'], pos['entry_price'], 
                pos.get('tp_price'), pos.get('sl_price'), pos['margin'], 
                pos['leverage'], pos['qty'], pos.get('created_at', datetime.now().isoformat())
            ))

    def delete_paper_position(self, pos_id: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM paper_positions WHERE id = ?", (pos_id,))

    def get_paper_history(self, limit=50) -> list:
        query = "SELECT * FROM paper_history ORDER BY closed_at DESC LIMIT ?"
        with self._conn() as conn:
            return [dict(r) for r in conn.execute(query, (limit,)).fetchall()]

    def save_paper_history(self, history: dict):
        query = """
        INSERT INTO paper_history
        (id, ticker, mode, entry_price, close_price, close_reason, pnl, margin, leverage, qty, opened_at, closed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        with self._conn() as conn:
            conn.execute(query, (
                history['id'], history['ticker'], history['mode'], history['entry_price'],
                history['close_price'], history['close_reason'], history['pnl'],
                history['margin'], history['leverage'], history['qty'],
                history['opened_at'], history.get('closed_at', datetime.now().isoformat())
            ))

# ════════════════════════════════════════════════════════
# MODULE-LEVEL SINGLETON
# ════════════════════════════════════════════════════════

# Import ini di vrp_api.py:
#   from db import db
# Langsung pakai tanpa instantiate ulang.

db = VRPDatabase()


# ════════════════════════════════════════════════════════
# STANDALONE TEST
# ════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json

    print("=" * 55)
    print("VRP Database — Standalone Test")
    print("=" * 55)

    test_db = VRPDatabase(":memory:")   # pakai in-memory DB untuk test

    # ── Test 1: Insert snapshot ──────────────────────
    fake_result = {
        "ticker":      "^GSPC",
        "spot":        5250.0,
        "timestamp":   datetime.now().isoformat(),
        "data_source": "synthetic",
        "iv":          0.185,
        "rv":          0.142,
        "rv_har":      0.150,
        "hv20":        0.148,
        "n_candles":   26,
        "vrp_raw":     0.043,
        "vrp_z":       1.72,
        "vrp_vs_har":  0.035,
        "signal":      "STRONG_SHORT_VOL",
        "signal_desc": "IV sangat mahal",
        "rv_engine": {
            "timestamp":           datetime.now().isoformat(),
            "ticker":              "^GSPC",
            "is_market_open":      True,
            "session_elapsed_pct": 0.65,
            "n_candles_5m":        51,
            "n_candles_15m":       17,
            "rv_intraday_raw":     0.138,
            "rv_yesterday":        0.145,
            "hv20":                0.148,
            "blend_weight":        0.65,
            "rv_blended":          0.142,
            "rv_har_base":         0.152,
            "rv_har_updated":      0.150,
            "rv_display_15m":      0.141,
            "har_coefficients":    {"c": 0.0001, "beta_d": 0.33, "beta_w": 0.24, "beta_m": 0.29, "r2": 0.47},
        }
    }

    snap_id = test_db.insert_snapshot(fake_result)
    print(f"\n✓ insert_snapshot → id={snap_id}")

    # ── Test 2: Get history ──────────────────────────
    history = test_db.get_snapshot_history("^GSPC", n=10)
    print(f"✓ get_snapshot_history → {len(history)} rows")
    if history:
        print(f"  sample: {history[0]}")

    # ── Test 3: HAR daily RV ─────────────────────────
    test_db.upsert_daily_rv("^GSPC", "2024-11-01", 0.142, close_price=5200.0)
    test_db.upsert_daily_rv("^GSPC", "2024-11-04", 0.138, close_price=5210.0)
    test_db.upsert_daily_rv("^GSPC", "2024-11-01", 0.145, close_price=5200.0)  # update
    n = test_db.count_har_records("^GSPC")
    print(f"\n✓ upsert_daily_rv (with dedup) → {n} records")

    # ── Test 4: Signal log ───────────────────────────
    log_id = test_db.log_signal_change(
        ticker="^GSPC", signal="STRONG_SHORT_VOL", prev_signal="NEUTRAL",
        vrp_z=1.72, spot=5250.0, iv=0.185, rv=0.142
    )
    print(f"\n✓ log_signal_change → id={log_id}")

    last_sig = test_db.get_last_signal("^GSPC")
    print(f"✓ get_last_signal → {last_sig}")

    # ── Test 5: DB stats ─────────────────────────────
    stats = test_db.get_db_stats()
    print(f"\n✓ get_db_stats:")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    print("\n✅ All tests passed")
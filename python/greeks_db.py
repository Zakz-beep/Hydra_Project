"""
greeks_db.py — SQLite3 Database Layer untuk Options Inventory Engine
=====================================================================
Logic & pattern identik dengan db.py (VRP), tapi schema di-design
untuk data Greeks / Options Inventory.

Handles empat fitur utama:

  1. Persistent Snapshots (greeks_snapshots)
     Simpan aggregate snapshot setiap kali /api/greeks dipanggil.

  2. Per-Expiry Inventory (greeks_expiry_inventory)
     Detail per DTE bucket (0, 1, 7, 14, 30).

  3. Signal Log (greeks_signal_log)
     Track perubahan GEX regime, vanna bias, charm direction, dll.

  4. Strike-level Archive (greeks_strike_archive)
     Opsional: simpan per-strike data untuk analisis historis.

DB path: ./data/greeks.db (auto-created, terpisah dari vrp.db)

Cara pakai di greeks_api.py:
  from greeks_db import greeks_db
  greeks_db.insert_snapshot(result_dict)
  history = greeks_db.get_snapshot_history("SPY", n=50)
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
DB_PATH = os.path.join(DB_DIR, "greeks.db")


# ════════════════════════════════════════════════════════
# SCHEMA
# ════════════════════════════════════════════════════════

SCHEMA = """
-- ── 1. Greeks Snapshots ─────────────────────────────────────────
-- Aggregate snapshot per compute() call.
-- Setiap kali /api/greeks dipanggil → satu row.
CREATE TABLE IF NOT EXISTS greeks_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,               -- ISO8601
    ticker          TEXT    NOT NULL,
    spot            REAL    NOT NULL,
    data_source     TEXT    NOT NULL DEFAULT 'live',

    -- Aggregate Greeks (total semua bucket)
    total_net_gex   REAL    NOT NULL DEFAULT 0,
    total_net_vanna REAL    NOT NULL DEFAULT 0,
    total_net_charm REAL    NOT NULL DEFAULT 0,
    total_net_dai   REAL    NOT NULL DEFAULT 0,
    total_net_vex   REAL    NOT NULL DEFAULT 0,

    -- GEX Regime
    gex_regime      TEXT    NOT NULL DEFAULT 'neutral',
    gamma_flip      REAL,                            -- bisa NULL

    -- Signals summary (JSON)
    signals_json    TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_greeks_ticker_ts
    ON greeks_snapshots (ticker, timestamp DESC);


-- ── 2. Per-Expiry Inventory ─────────────────────────────────────
-- Detail per DTE bucket per snapshot.
-- Join ke greeks_snapshots via snapshot_id.
CREATE TABLE IF NOT EXISTS greeks_expiry_inventory (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id         INTEGER NOT NULL REFERENCES greeks_snapshots(id),
    dte_bucket          INTEGER NOT NULL,      -- 0, 1, 7, 14, 30
    expiry_dates_json   TEXT    NOT NULL DEFAULT '[]',

    n_strikes           INTEGER NOT NULL DEFAULT 0,
    total_oi_calls      INTEGER NOT NULL DEFAULT 0,
    total_oi_puts       INTEGER NOT NULL DEFAULT 0,
    pcr_oi              REAL    NOT NULL DEFAULT 0,

    -- Net aggregate
    net_gex_spotgamma   REAL    NOT NULL DEFAULT 0,
    net_gex_raw         REAL    NOT NULL DEFAULT 0,
    net_vanna           REAL    NOT NULL DEFAULT 0,
    net_charm           REAL    NOT NULL DEFAULT 0,
    net_dai             REAL    NOT NULL DEFAULT 0,
    net_vex             REAL    NOT NULL DEFAULT 0,

    -- Gross aggregate
    gross_gex           REAL    NOT NULL DEFAULT 0,
    gross_vanna         REAL    NOT NULL DEFAULT 0,
    gross_charm         REAL    NOT NULL DEFAULT 0,
    gross_vex           REAL    NOT NULL DEFAULT 0,

    -- Key levels
    max_pain            REAL,
    gamma_flip          REAL,
    largest_gex_strike  REAL,
    largest_gex_value   REAL
);

CREATE INDEX IF NOT EXISTS idx_expiry_snapshot
    ON greeks_expiry_inventory (snapshot_id, dte_bucket);


-- ── 3. Signal Log ───────────────────────────────────────────────
-- Catat setiap kali GEX regime atau signal berubah.
-- Basis untuk tracking regime shifts.
CREATE TABLE IF NOT EXISTS greeks_signal_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL,
    ticker          TEXT    NOT NULL,
    signal_type     TEXT    NOT NULL,     -- 'gex_regime', 'vanna_signal', 'charm_signal', 'dai_bias', 'vex_signal'
    signal_value    TEXT    NOT NULL,     -- e.g. 'POSITIVE_GAMMA', 'BEARISH_VANNA'
    prev_value      TEXT,                -- signal sebelumnya
    spot_at_signal  REAL    NOT NULL,
    gex_at_signal   REAL,
    description     TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_greeks_signal_ticker_ts
    ON greeks_signal_log (ticker, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_greeks_signal_type
    ON greeks_signal_log (ticker, signal_type, timestamp DESC);


-- ── 4. Signal Outcomes ──────────────────────────────────────────
-- Evaluasi apakah GEX regime prediction benar setelah N hari.
-- Logic: positive gamma → expect low vol, negative gamma → expect high vol.
CREATE TABLE IF NOT EXISTS greeks_signal_outcomes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_log_id   INTEGER NOT NULL REFERENCES greeks_signal_log(id),
    horizon_days    INTEGER NOT NULL,         -- 1, 5, 20
    spot_at_horizon REAL,
    spot_change_pct REAL,                     -- % change dari spot at signal
    vol_realized    REAL,                     -- RV terealisasi selama horizon
    outcome         TEXT,                     -- 'correct', 'incorrect', 'neutral'
    evaluated_at    TEXT,
    UNIQUE (signal_log_id, horizon_days)
);


-- ── 5. Strike Archive (opsional, untuk deep analysis) ───────────
-- Simpan top N strikes per snapshot untuk tracking historical OI changes.
-- Hanya simpan strikes dengan |GEX| di atas threshold (bukan semua).
CREATE TABLE IF NOT EXISTS greeks_strike_archive (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id     INTEGER NOT NULL REFERENCES greeks_snapshots(id),
    dte_bucket      INTEGER NOT NULL,
    strike          REAL    NOT NULL,
    option_type     TEXT    NOT NULL,    -- 'call' atau 'put'
    expiry          TEXT    NOT NULL,
    dte             INTEGER NOT NULL,
    oi              INTEGER NOT NULL DEFAULT 0,
    volume          INTEGER NOT NULL DEFAULT 0,
    iv              REAL    NOT NULL DEFAULT 0,
    delta           REAL    NOT NULL DEFAULT 0,
    gamma           REAL    NOT NULL DEFAULT 0,
    vanna           REAL    NOT NULL DEFAULT 0,
    charm           REAL    NOT NULL DEFAULT 0,
    gex_spotgamma   REAL    NOT NULL DEFAULT 0,
    vanna_exp       REAL    NOT NULL DEFAULT 0,
    charm_exp       REAL    NOT NULL DEFAULT 0,
    delta_exp       REAL    NOT NULL DEFAULT 0,
    vega_exp        REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_strike_archive_snap
    ON greeks_strike_archive (snapshot_id, dte_bucket);
"""


# ════════════════════════════════════════════════════════
# DATABASE CLASS
# ════════════════════════════════════════════════════════

class GreeksDatabase:
    """
    Thread-safe SQLite3 wrapper untuk Options Inventory Engine.

    Pattern identik dengan VRPDatabase di db.py:
      - threading.Lock() untuk thread safety
      - WAL mode untuk concurrent reads
      - Context manager untuk auto commit/rollback

    Usage:
        from greeks_db import greeks_db
        greeks_db.insert_snapshot(result_dict)
        history = greeks_db.get_snapshot_history("SPY", n=50)
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

    def insert_snapshot(self, result: dict, archive_top_n: int = 20) -> int:
        """
        Insert satu Greeks snapshot ke DB.
        Return snapshot row id.

        Expects dict dari OptionsInventoryEngine.compute_dict().

        Juga insert:
          - Per-expiry inventory rows
          - Top N strikes ke archive (opsional, berdasarkan |GEX|)
        """
        with self._conn() as conn:
            # Insert main snapshot
            cur = conn.execute("""
                INSERT INTO greeks_snapshots
                    (timestamp, ticker, spot, data_source,
                     total_net_gex, total_net_vanna, total_net_charm,
                     total_net_dai, total_net_vex,
                     gex_regime, gamma_flip, signals_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                result.get("timestamp", datetime.now().isoformat()),
                result["ticker"],
                result["spot"],
                result.get("data_source", "live"),
                result.get("total_net_gex", 0),
                result.get("total_net_vanna", 0),
                result.get("total_net_charm", 0),
                result.get("total_net_dai", 0),
                result.get("total_net_vex", 0),
                result.get("gex_regime", "neutral"),
                result.get("gamma_flip"),
                json.dumps(result.get("signals", {})),
            ))
            snap_id = cur.lastrowid

            # Insert per-expiry inventory
            by_expiry = result.get("by_expiry", {})
            for bucket_key, inv in by_expiry.items():
                self._insert_expiry_inventory(conn, snap_id, inv)

                # Archive top strikes per bucket
                if archive_top_n > 0:
                    strikes = inv.get("strikes", [])
                    top = sorted(strikes, key=lambda x: abs(x.get("gex_spotgamma", 0)), reverse=True)
                    for s in top[:archive_top_n]:
                        self._insert_strike_archive(conn, snap_id, int(bucket_key), s)

        return snap_id

    def _insert_expiry_inventory(self, conn: sqlite3.Connection, snap_id: int, inv: dict):
        """Insert satu row expiry inventory."""
        conn.execute("""
            INSERT INTO greeks_expiry_inventory
                (snapshot_id, dte_bucket, expiry_dates_json,
                 n_strikes, total_oi_calls, total_oi_puts, pcr_oi,
                 net_gex_spotgamma, net_gex_raw, net_vanna, net_charm, net_dai, net_vex,
                 gross_gex, gross_vanna, gross_charm, gross_vex,
                 max_pain, gamma_flip, largest_gex_strike, largest_gex_value)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            snap_id,
            inv.get("dte_bucket", 0),
            json.dumps(inv.get("expiry_dates", [])),
            inv.get("n_strikes", 0),
            inv.get("total_oi_calls", 0),
            inv.get("total_oi_puts", 0),
            inv.get("pcr_oi", 0),
            inv.get("net_gex_spotgamma", 0),
            inv.get("net_gex_raw", 0),
            inv.get("net_vanna", 0),
            inv.get("net_charm", 0),
            inv.get("net_dai", 0),
            inv.get("net_vex", 0),
            inv.get("gross_gex", 0),
            inv.get("gross_vanna", 0),
            inv.get("gross_charm", 0),
            inv.get("gross_vex", 0),
            inv.get("max_pain"),
            inv.get("gamma_flip"),
            inv.get("largest_gex_strike"),
            inv.get("largest_gex_value"),
        ))

    def _insert_strike_archive(self, conn: sqlite3.Connection, snap_id: int, bucket: int, s: dict):
        """Insert satu strike ke archive."""
        conn.execute("""
            INSERT INTO greeks_strike_archive
                (snapshot_id, dte_bucket, strike, option_type, expiry, dte,
                 oi, volume, iv, delta, gamma, vanna, charm,
                 gex_spotgamma, vanna_exp, charm_exp, delta_exp, vega_exp)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            snap_id, bucket,
            s.get("strike", 0),
            s.get("option_type", ""),
            s.get("expiry", ""),
            s.get("dte", 0),
            s.get("oi", 0),
            s.get("volume", 0),
            s.get("iv", 0),
            s.get("delta", 0),
            s.get("gamma", 0),
            s.get("vanna", 0),
            s.get("charm", 0),
            s.get("gex_spotgamma", 0),
            s.get("vanna_exp", 0),
            s.get("charm_exp", 0),
            s.get("delta_exp", 0),
            s.get("vega_exp", 0),
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
        Return list of dicts, oldest first (untuk charting).
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
                SELECT timestamp, ticker, spot, data_source,
                       total_net_gex, total_net_vanna, total_net_charm,
                       total_net_dai, total_net_vex,
                       gex_regime, gamma_flip, signals_json
                FROM greeks_snapshots
                WHERE {where}
                ORDER BY timestamp DESC
                LIMIT ?
            """, params).fetchall()

        # Return ascending (oldest first) untuk charting
        result = []
        for r in reversed(rows):
            d = dict(r)
            # Parse signals JSON
            try:
                d["signals"] = json.loads(d.pop("signals_json", "{}"))
            except Exception:
                d["signals"] = {}
            # Format time field
            try:
                dt = datetime.fromisoformat(d["timestamp"])
                d["time"] = dt.strftime("%H:%M:%S")
            except Exception:
                d["time"] = d["timestamp"]
            result.append(d)

        return result

    def get_latest_snapshot(self, ticker: str) -> Optional[dict]:
        """Ambil snapshot terbaru untuk ticker."""
        with self._conn() as conn:
            row = conn.execute("""
                SELECT * FROM greeks_snapshots
                WHERE ticker = ?
                ORDER BY timestamp DESC
                LIMIT 1
            """, (ticker,)).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["signals"] = json.loads(d.pop("signals_json", "{}"))
        except Exception:
            d["signals"] = {}
        return d

    def get_expiry_history(
        self,
        ticker: str,
        dte_bucket: int,
        n: int = 50,
    ) -> list[dict]:
        """
        Ambil history per-expiry inventory untuk satu bucket.
        Berguna untuk tracking GEX evolution per tenor.
        """
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT gs.timestamp, gs.spot, ei.*
                FROM greeks_expiry_inventory ei
                JOIN greeks_snapshots gs ON gs.id = ei.snapshot_id
                WHERE gs.ticker = ? AND ei.dte_bucket = ?
                ORDER BY gs.timestamp DESC
                LIMIT ?
            """, (ticker, dte_bucket, n)).fetchall()

        result = []
        for r in reversed(rows):
            d = dict(r)
            try:
                d["expiry_dates"] = json.loads(d.pop("expiry_dates_json", "[]"))
            except Exception:
                d["expiry_dates"] = []
            result.append(d)
        return result

    def get_gex_timeseries(self, ticker: str, n: int = 100) -> list[dict]:
        """
        Return time series of total_net_gex untuk charting.
        Includes gex_regime dan gamma_flip.
        """
        with self._conn() as conn:
            rows = conn.execute("""
                SELECT timestamp, spot, total_net_gex, gex_regime, gamma_flip
                FROM greeks_snapshots
                WHERE ticker = ?
                ORDER BY timestamp DESC
                LIMIT ?
            """, (ticker, n)).fetchall()

        result = []
        for r in reversed(rows):
            d = dict(r)
            try:
                dt = datetime.fromisoformat(d["timestamp"])
                d["time"] = dt.strftime("%H:%M:%S")
            except Exception:
                d["time"] = d["timestamp"]
            result.append(d)
        return result

    # ─────────────────────────────────────────────────
    # FEATURE 3: Signal Log + Tracking
    # ─────────────────────────────────────────────────

    def log_signal_change(
        self,
        ticker:       str,
        signal_type:  str,    # 'gex_regime', 'vanna_signal', etc.
        signal_value: str,    # e.g. 'POSITIVE_GAMMA'
        prev_value:   Optional[str],
        spot:         float,
        gex:          Optional[float] = None,
        description:  str = "",
    ) -> int:
        """
        Catat perubahan signal.
        Hanya dipanggil kalau signal berubah dari sebelumnya.
        Return log id.
        """
        with self._conn() as conn:
            cur = conn.execute("""
                INSERT INTO greeks_signal_log
                    (timestamp, ticker, signal_type, signal_value,
                     prev_value, spot_at_signal, gex_at_signal, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().isoformat(),
                ticker, signal_type, signal_value,
                prev_value, spot, gex, description,
            ))
        return cur.lastrowid

    def get_last_signals(self, ticker: str) -> dict[str, str]:
        """
        Return dict of {signal_type: signal_value} terakhir untuk ticker.
        Digunakan untuk detect signal changes.

        Return example:
          {'gex_regime': 'POSITIVE_GAMMA', 'vanna_signal': 'BULLISH_VANNA', ...}
        """
        signal_types = ["gex_regime", "vanna_signal", "charm_signal", "dai_bias", "vex_signal"]
        result = {}
        with self._conn() as conn:
            for st in signal_types:
                row = conn.execute("""
                    SELECT signal_value FROM greeks_signal_log
                    WHERE ticker = ? AND signal_type = ?
                    ORDER BY timestamp DESC
                    LIMIT 1
                """, (ticker, st)).fetchone()
                if row:
                    result[st] = row["signal_value"]
        return result

    def detect_and_log_changes(self, ticker: str, spot: float, gex: float, signals: dict):
        """
        Otomatis detect semua signal changes dan log ke DB.

        Dipanggil setiap kali /api/greeks diakses.
        Compare current signals vs last signals, log yang berubah.

        signals dict keys: gex_regime, vanna_signal, charm_signal, dai_bias, vex_signal
        """
        signal_map = {
            "gex_regime":    (signals.get("gex_regime"),    signals.get("gex_desc", "")),
            "vanna_signal":  (signals.get("vanna_signal"),  signals.get("vanna_desc", "")),
            "charm_signal":  (signals.get("charm_signal"),  signals.get("charm_desc", "")),
            "dai_bias":      (signals.get("dai_bias"),      signals.get("dai_desc", "")),
            "vex_signal":    (signals.get("vex_signal"),    signals.get("vex_desc", "")),
        }

        prev_signals = self.get_last_signals(ticker)

        for signal_type, (current_value, desc) in signal_map.items():
            if current_value is None:
                continue
            prev_value = prev_signals.get(signal_type)
            if current_value != prev_value:
                self.log_signal_change(
                    ticker=ticker,
                    signal_type=signal_type,
                    signal_value=current_value,
                    prev_value=prev_value,
                    spot=spot,
                    gex=gex,
                    description=desc,
                )

    def get_signal_log(self, ticker: str, n: int = 50, signal_type: Optional[str] = None) -> list[dict]:
        """
        Return N signal change events terakhir.
        Optional filter by signal_type.
        """
        params: list = [ticker]
        where = "ticker = ?"

        if signal_type:
            where += " AND signal_type = ?"
            params.append(signal_type)

        params.append(n)

        with self._conn() as conn:
            rows = conn.execute(f"""
                SELECT * FROM greeks_signal_log
                WHERE {where}
                ORDER BY timestamp DESC
                LIMIT ?
            """, params).fetchall()
        return [dict(r) for r in rows]

    def evaluate_signal_outcomes(
        self,
        ticker:   str,
        horizons: list[int] = [1, 5, 20],
    ) -> int:
        """
        Evaluate signal outcomes untuk GEX regime predictions.

        Logic:
          - POSITIVE_GAMMA → expect low realized vol (spot stabil)
            → correct kalau |spot_change_pct| < threshold
          - NEGATIVE_GAMMA → expect high realized vol
            → correct kalau |spot_change_pct| > threshold

        Return: jumlah outcomes baru yang dievaluasi.
        """
        count = 0

        # Thresholds (annualized vol equivalent, converted to daily)
        # Rough: 16% annual ≈ 1% daily move
        daily_threshold = 1.0  # 1% daily

        with self._conn() as conn:
            logs = conn.execute("""
                SELECT id, timestamp, signal_type, signal_value,
                       spot_at_signal, gex_at_signal
                FROM greeks_signal_log
                WHERE ticker = ? AND signal_type = 'gex_regime'
                ORDER BY timestamp ASC
            """, (ticker,)).fetchall()

            for log in logs:
                signal_ts = datetime.fromisoformat(log["timestamp"])

                for horizon in horizons:
                    # Skip kalau sudah dievaluasi
                    existing = conn.execute("""
                        SELECT id FROM greeks_signal_outcomes
                        WHERE signal_log_id = ? AND horizon_days = ?
                    """, (log["id"], horizon)).fetchone()
                    if existing:
                        continue

                    target_ts = (signal_ts + timedelta(days=horizon)).isoformat()

                    # Belum tercapai?
                    if target_ts > datetime.now().isoformat():
                        continue

                    # Cari snapshot terdekat di target date
                    future_snap = conn.execute("""
                        SELECT spot FROM greeks_snapshots
                        WHERE ticker = ? AND timestamp >= ?
                        ORDER BY timestamp ASC
                        LIMIT 1
                    """, (ticker, target_ts)).fetchone()

                    if not future_snap:
                        continue

                    spot_at_signal  = log["spot_at_signal"]
                    spot_at_horizon = future_snap["spot"]
                    spot_change_pct = ((spot_at_horizon - spot_at_signal) / spot_at_signal) * 100

                    signal_value = log["signal_value"]
                    abs_change   = abs(spot_change_pct)
                    threshold    = daily_threshold * (horizon ** 0.5)  # scale by sqrt(time)

                    if signal_value == "POSITIVE_GAMMA":
                        # Expect suppressed vol → small move
                        outcome = "correct" if abs_change < threshold else "incorrect"
                    elif signal_value == "NEGATIVE_GAMMA":
                        # Expect amplified vol → big move
                        outcome = "correct" if abs_change > threshold else "incorrect"
                    else:
                        outcome = "neutral"

                    conn.execute("""
                        INSERT OR IGNORE INTO greeks_signal_outcomes
                            (signal_log_id, horizon_days, spot_at_horizon,
                             spot_change_pct, outcome, evaluated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (
                        log["id"], horizon,
                        spot_at_horizon,
                        round(spot_change_pct, 4),
                        outcome,
                        datetime.now().isoformat(),
                    ))
                    count += 1

        return count

    def get_backtest_summary(self, ticker: str) -> dict:
        """
        Return backtesting summary untuk GEX regime signals.

        Format identik dengan VRPDatabase.get_backtest_summary():
        {
          "ticker": "SPY",
          "total_signals": 42,
          "by_horizon": {
            1:  {"total": 40, "correct": 28, "win_rate": 0.70},
            5:  {...},
            20: {...},
          },
          "by_signal_value": {
            "POSITIVE_GAMMA": {"total": 20, "correct": 15, "win_rate": 0.75},
            ...
          }
        }
        """
        with self._conn() as conn:
            total_signals = conn.execute(
                "SELECT COUNT(*) AS n FROM greeks_signal_log WHERE ticker = ? AND signal_type = 'gex_regime'",
                (ticker,)
            ).fetchone()["n"]

            # By horizon
            by_horizon = {}
            for horizon in [1, 5, 20]:
                rows = conn.execute("""
                    SELECT outcome, COUNT(*) AS n
                    FROM greeks_signal_outcomes so
                    JOIN greeks_signal_log sl ON sl.id = so.signal_log_id
                    WHERE sl.ticker = ? AND so.horizon_days = ?
                      AND sl.signal_type = 'gex_regime'
                    GROUP BY outcome
                """, (ticker, horizon)).fetchall()

                total   = sum(r["n"] for r in rows)
                correct = next((r["n"] for r in rows if r["outcome"] == "correct"), 0)

                by_horizon[horizon] = {
                    "total":    total,
                    "correct":  correct,
                    "win_rate": round(correct / total, 4) if total > 0 else None,
                }

            # By signal value
            signal_rows = conn.execute("""
                SELECT sl.signal_value, so.outcome, COUNT(*) AS n
                FROM greeks_signal_outcomes so
                JOIN greeks_signal_log sl ON sl.id = so.signal_log_id
                WHERE sl.ticker = ? AND sl.signal_type = 'gex_regime'
                GROUP BY sl.signal_value, so.outcome
            """, (ticker,)).fetchall()

            by_signal: dict = {}
            for r in signal_rows:
                sv = r["signal_value"]
                if sv not in by_signal:
                    by_signal[sv] = {"total": 0, "correct": 0}
                by_signal[sv]["total"] += r["n"]
                if r["outcome"] == "correct":
                    by_signal[sv]["correct"] += r["n"]

            for sv in by_signal:
                t = by_signal[sv]["total"]
                c = by_signal[sv]["correct"]
                by_signal[sv]["win_rate"] = round(c / t, 4) if t > 0 else None

        return {
            "ticker":           ticker,
            "total_signals":    total_signals,
            "by_horizon":       by_horizon,
            "by_signal_value":  by_signal,
        }

    # ─────────────────────────────────────────────────
    # Utility
    # ─────────────────────────────────────────────────

    def get_db_stats(self) -> dict:
        """Return info tentang isi DB — untuk health check / debug."""
        with self._conn() as conn:
            tables = [
                "greeks_snapshots", "greeks_expiry_inventory",
                "greeks_signal_log", "greeks_signal_outcomes",
                "greeks_strike_archive",
            ]
            stats = {}
            for t in tables:
                row = conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()
                stats[t] = row["n"]

            # Tickers
            tickers = conn.execute(
                "SELECT DISTINCT ticker FROM greeks_snapshots"
            ).fetchall()
            stats["tickers"] = [r["ticker"] for r in tickers]

            # DB file size
            if self._path != ":memory:":
                try:
                    stats["db_size_kb"] = round(os.path.getsize(self._path) / 1024, 1)
                except Exception:
                    stats["db_size_kb"] = 0
            else:
                stats["db_size_kb"] = 0

        return stats

    def cleanup_old_snapshots(self, ticker: str, keep_days: int = 90):
        """
        Hapus snapshots yang lebih tua dari keep_days.
        Cascade: juga hapus expiry_inventory dan strike_archive terkait.
        """
        cutoff = (datetime.now() - timedelta(days=keep_days)).isoformat()
        with self._conn() as conn:
            # Ambil snapshot IDs yang akan dihapus
            old_ids = conn.execute("""
                SELECT id FROM greeks_snapshots
                WHERE ticker = ? AND timestamp < ?
            """, (ticker, cutoff)).fetchall()
            old_id_list = [r["id"] for r in old_ids]

            if old_id_list:
                placeholders = ",".join("?" * len(old_id_list))

                # Hapus child tables dulu
                conn.execute(f"""
                    DELETE FROM greeks_strike_archive
                    WHERE snapshot_id IN ({placeholders})
                """, old_id_list)

                conn.execute(f"""
                    DELETE FROM greeks_expiry_inventory
                    WHERE snapshot_id IN ({placeholders})
                """, old_id_list)

                # Hapus snapshots
                conn.execute(f"""
                    DELETE FROM greeks_snapshots
                    WHERE id IN ({placeholders})
                """, old_id_list)

            # Hapus old signal logs juga
            conn.execute("""
                DELETE FROM greeks_signal_log
                WHERE ticker = ? AND timestamp < ?
            """, (ticker, cutoff))


# ════════════════════════════════════════════════════════
# MODULE-LEVEL SINGLETON
# ════════════════════════════════════════════════════════

# Import di greeks_api.py:
#   from greeks_db import greeks_db
# Langsung pakai tanpa instantiate ulang.

greeks_db = GreeksDatabase()


# ════════════════════════════════════════════════════════
# STANDALONE TEST
# ════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("=" * 55)
    print("Greeks Database — Standalone Test")
    print("=" * 55)

    test_db = GreeksDatabase(":memory:")

    # ── Test 1: Insert snapshot ──────────────────────
    fake_result = {
        "timestamp":       datetime.now().isoformat(),
        "ticker":          "SPY",
        "spot":            450.25,
        "data_source":     "synthetic",
        "total_net_gex":   1.2345,
        "total_net_vanna": 0.5678,
        "total_net_charm": -0.234,
        "total_net_dai":   1500.0,
        "total_net_vex":   800.0,
        "gex_regime":      "positive",
        "gamma_flip":      448.50,
        "signals": {
            "gex_regime":    "POSITIVE_GAMMA",
            "gex_desc":      "Dealer long gamma",
            "vanna_signal":  "BULLISH_VANNA",
            "vanna_desc":    "Net positive vanna",
            "charm_signal":  "CHARM_NEUTRAL",
            "charm_desc":    "Charm minimal",
            "dai_bias":      "DEALER_NET_LONG",
            "dai_desc":      "Dealer net long",
            "vex_signal":    "HIGH_VEX",
            "vex_desc":      "Vega exposure tinggi",
        },
        "by_expiry": {
            "0": {
                "dte_bucket":         0,
                "expiry_dates":       ["2024-11-08"],
                "n_strikes":          30,
                "total_oi_calls":     50000,
                "total_oi_puts":      45000,
                "pcr_oi":             0.90,
                "net_gex_spotgamma":  0.45,
                "net_gex_raw":        120.5,
                "net_vanna":          0.23,
                "net_charm":          -0.12,
                "net_dai":            500.0,
                "net_vex":            300.0,
                "gross_gex":          0.80,
                "gross_vanna":        0.50,
                "gross_charm":        0.30,
                "gross_vex":          600.0,
                "max_pain":           450.0,
                "gamma_flip":         448.0,
                "largest_gex_strike": 450.0,
                "largest_gex_value":  0.15,
                "strikes": [
                    {
                        "strike": 450.0, "option_type": "call",
                        "expiry": "2024-11-08", "dte": 0,
                        "oi": 5000, "volume": 1200, "iv": 0.22,
                        "delta": 0.52, "gamma": 0.008, "vanna": 0.003, "charm": -0.001,
                        "gex_spotgamma": 0.15, "vanna_exp": 150.0,
                        "charm_exp": -50.0, "delta_exp": 2600.0, "vega_exp": 400.0,
                    },
                ],
            },
        },
    }

    snap_id = test_db.insert_snapshot(fake_result)
    print(f"\n✓ insert_snapshot → id={snap_id}")

    # ── Test 2: Get history ──────────────────────────
    history = test_db.get_snapshot_history("SPY", n=10)
    print(f"✓ get_snapshot_history → {len(history)} rows")
    if history:
        print(f"  sample keys: {list(history[0].keys())}")

    # ── Test 3: Get latest ───────────────────────────
    latest = test_db.get_latest_snapshot("SPY")
    print(f"✓ get_latest_snapshot → {'found' if latest else 'not found'}")

    # ── Test 4: GEX timeseries ───────────────────────
    gex_ts = test_db.get_gex_timeseries("SPY", n=10)
    print(f"✓ get_gex_timeseries → {len(gex_ts)} rows")

    # ── Test 5: Signal log ───────────────────────────
    test_db.detect_and_log_changes(
        ticker="SPY", spot=450.25, gex=1.2345,
        signals=fake_result["signals"]
    )
    signals = test_db.get_signal_log("SPY")
    print(f"✓ detect_and_log_changes → {len(signals)} signal entries logged")

    # ── Test 6: Expiry history ───────────────────────
    exp_hist = test_db.get_expiry_history("SPY", dte_bucket=0, n=10)
    print(f"✓ get_expiry_history(0DTE) → {len(exp_hist)} rows")

    # ── Test 7: DB stats ─────────────────────────────
    stats = test_db.get_db_stats()
    print(f"\n✓ get_db_stats:")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    print("\n✅ All tests passed")

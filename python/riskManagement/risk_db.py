import sqlite3
import os
import json
from datetime import datetime

class RiskDatabase:
    """Standalone Database for the Risk Management Module."""
    def __init__(self, db_path="risk_portfolio.db"):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            
            # Account State (Prop firm tracking)
            c.execute('''
                CREATE TABLE IF NOT EXISTS account_state (
                    id INTEGER PRIMARY KEY,
                    balance REAL,
                    equity REAL,
                    margin_used REAL,
                    daily_loss_limit REAL,
                    max_trailing_dd REAL,
                    last_updated TIMESTAMP
                )
            ''')
            
            # Behavioral Score
            c.execute('''
                CREATE TABLE IF NOT EXISTS behavioral_profile (
                    id INTEGER PRIMARY KEY,
                    score REAL DEFAULT 100,
                    revenge_count INTEGER DEFAULT 0,
                    overtrade_count INTEGER DEFAULT 0,
                    fomo_count INTEGER DEFAULT 0,
                    last_trade_time TIMESTAMP
                )
            ''')
            
            # Trade Log (for behavior tracking)
            c.execute('''
                CREATE TABLE IF NOT EXISTS trade_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT,
                    direction TEXT,
                    lot_size REAL,
                    entry_price REAL,
                    exit_price REAL,
                    pnl REAL,
                    entry_time TIMESTAMP,
                    exit_time TIMESTAMP,
                    hit_sl BOOLEAN
                )
            ''')
            
            # Active Holdings
            c.execute('''
                CREATE TABLE IF NOT EXISTS active_holdings (
                    ticker TEXT PRIMARY KEY,
                    direction TEXT,
                    lot_size REAL,
                    entry_price REAL,
                    entry_time TIMESTAMP
                )
            ''')
            
            conn.commit()

            # Initialize rows if empty
            c.execute("SELECT COUNT(*) FROM account_state")
            if c.fetchone()[0] == 0:
                c.execute("INSERT INTO account_state (id, balance, equity, margin_used, daily_loss_limit, max_trailing_dd, last_updated) VALUES (1, 50000.0, 50000.0, 0.0, 0.02, 0.08, ?)", (datetime.now(),))
            c.execute("SELECT COUNT(*) FROM behavioral_profile")
            if c.fetchone()[0] == 0:
                c.execute("INSERT INTO behavioral_profile (id, last_trade_time) VALUES (1, ?)", (datetime.now(),))
            conn.commit()
            
    def get_account_state(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            return dict(c.execute("SELECT * FROM account_state WHERE id=1").fetchone())
            
    def get_behavioral_profile(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            return dict(c.execute("SELECT * FROM behavioral_profile WHERE id=1").fetchone())
            
    def get_active_holdings(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            return [dict(r) for r in c.execute("SELECT * FROM active_holdings").fetchall()]

    def log_trade(self, ticker: str, direction: str, lot_size: float, entry_price: float, exit_price: float, pnl: float, entry_time: datetime, exit_time: datetime, hit_sl: bool):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute('''
                INSERT INTO trade_logs (ticker, direction, lot_size, entry_price, exit_price, pnl, entry_time, exit_time, hit_sl)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (ticker, direction, lot_size, entry_price, exit_price, pnl, entry_time, exit_time, hit_sl))
            conn.commit()

    def get_recent_trades(self, limit=10):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            return [dict(r) for r in c.execute("SELECT * FROM trade_logs ORDER BY exit_time DESC LIMIT ?", (limit,)).fetchall()]
            
    def update_behavioral_score(self, new_score, new_revenge, new_overtrade, new_fomo, trade_time):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute('''
                UPDATE behavioral_profile
                SET score=?, revenge_count=?, overtrade_count=?, fomo_count=?, last_trade_time=?
                WHERE id=1
            ''', (new_score, new_revenge, new_overtrade, new_fomo, trade_time))
            conn.commit()
            
    def add_active_holding(self, ticker, direction, lot_size, entry_price, entry_time):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute('''
                INSERT OR REPLACE INTO active_holdings (ticker, direction, lot_size, entry_price, entry_time)
                VALUES (?, ?, ?, ?, ?)
            ''', (ticker, direction, lot_size, entry_price, entry_time))
            conn.commit()

    def remove_active_holding(self, ticker):
        with sqlite3.connect(self.db_path) as conn:
            c = conn.cursor()
            c.execute("DELETE FROM active_holdings WHERE ticker=?", (ticker,))
            conn.commit()

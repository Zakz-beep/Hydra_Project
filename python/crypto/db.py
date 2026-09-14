import os
import sqlite3
from datetime import datetime

class CryptoDatabase:
    def __init__(self):
        # Definisikan lokasi database di python/data/crypto.db
        base_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(base_dir, "..", "data")
        os.makedirs(data_dir, exist_ok=True)
        self.db_path = os.path.join(data_dir, "crypto.db")
        self._init_db()

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._get_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS portfolio (
                    coin_id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    amount REAL DEFAULT 0.0,
                    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

    def get_portfolio(self):
        with self._get_conn() as conn:
            cursor = conn.execute("SELECT coin_id, symbol, name, amount, added_at FROM portfolio")
            return [dict(row) for row in cursor.fetchall()]

    def add_to_portfolio(self, coin_id: str, symbol: str, name: str, amount: float):
        with self._get_conn() as conn:
            conn.execute(
                """
                INSERT INTO portfolio (coin_id, symbol, name, amount)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(coin_id) DO UPDATE SET
                    amount = amount + excluded.amount
                """,
                (coin_id.lower(), symbol.upper(), name, amount)
            )
            conn.commit()

    def update_amount(self, coin_id: str, amount: float):
        with self._get_conn() as conn:
            conn.execute(
                "UPDATE portfolio SET amount = ? WHERE coin_id = ?",
                (amount, coin_id.lower())
            )
            conn.commit()

    def remove_from_portfolio(self, coin_id: str):
        with self._get_conn() as conn:
            conn.execute("DELETE FROM portfolio WHERE coin_id = ?", (coin_id.lower(),))
            conn.commit()

# Singleton instance
crypto_db = CryptoDatabase()

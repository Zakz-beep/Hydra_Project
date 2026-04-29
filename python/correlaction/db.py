import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'correlaction.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Table for storing the summary of a DCC model run
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS dcc_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_time TEXT,
        tickers TEXT,
        timeframe TEXT,
        history TEXT,
        final_passive_equity REAL,
        final_adaptive_equity REAL,
        max_passive_dd REAL,
        max_adaptive_dd REAL
    )
    ''')
    
    # Table for storing the time series data of a run
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS dcc_timeseries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER,
        timestamp TEXT,
        avg_corr REAL,
        weight REAL,
        passive_equity REAL,
        adaptive_equity REAL,
        passive_dd REAL,
        adaptive_dd REAL,
        asset_corrs TEXT,
        tail_dep REAL,
        FOREIGN KEY(run_id) REFERENCES dcc_runs(id)
    )
    ''')
    
    conn.commit()
    conn.close()

def save_dcc_run(tickers, timeframe, history, summary_metrics, timeseries_df):
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        
        run_time = datetime.now().isoformat()
        tickers_str = json.dumps(tickers)
        
        # Insert run summary
        cursor.execute('''
        INSERT INTO dcc_runs (run_time, tickers, timeframe, history, final_passive_equity, final_adaptive_equity, max_passive_dd, max_adaptive_dd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            run_time, tickers_str, timeframe, history,
            summary_metrics['final_passive_equity'],
            summary_metrics['final_adaptive_equity'],
            summary_metrics['max_passive_dd'],
            summary_metrics['max_adaptive_dd']
        ))
        
        run_id = cursor.lastrowid
        
        # Insert timeseries data
        records = []
        for index, row in timeseries_df.iterrows():
            # timestamp from index
            ts_str = index.isoformat() if hasattr(index, 'isoformat') else str(index)
            records.append((
                run_id,
                ts_str,
                float(row.get('Avg_Corr', 0)),
                float(row.get('Weight', 0)),
                float(row.get('Passive_Equity', 0)),
                float(row.get('Adaptive_Equity', 0)),
                float(row.get('Passive_DD', 0)),
                float(row.get('Adaptive_DD', 0)),
                json.dumps(row.get('Asset_Corrs', {})),
                float(row.get('Tail_Dep', 0.0))
            ))
            
        cursor.executemany('''
        INSERT INTO dcc_timeseries (run_id, timestamp, avg_corr, weight, passive_equity, adaptive_equity, passive_dd, adaptive_dd, asset_corrs, tail_dep)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', records)
        
        conn.commit()
        return run_id
    finally:
        conn.close()

def get_recent_runs(limit=10):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM dcc_runs ORDER BY id DESC LIMIT ?', (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]

def get_run_timeseries(run_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM dcc_timeseries WHERE run_id = ? ORDER BY timestamp ASC', (run_id,))
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]

# Initialize on import
init_db()

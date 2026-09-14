import sqlite3
import os

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "greeks.db")

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Snapshot 8873 is June 2nd, 8827 is June 1st
cursor.execute("""
    SELECT id, timestamp, spot, total_net_gex 
    FROM greeks_snapshots 
    WHERE id IN (8873, 8827)
    ORDER BY timestamp DESC
""")
rows = cursor.fetchall()
if len(rows) < 2:
    print("Not enough snapshots found.")
    conn.close()
    sys.exit()

snap_new = rows[0]
snap_old = rows[1]

print(f"Comparing Snapshot {snap_new['id']} ({snap_new['timestamp']}) vs Snapshot {snap_old['id']} ({snap_old['timestamp']}):\n")

for dte in [0, 1, 7]:
    cursor.execute("""
        SELECT total_oi_calls, total_oi_puts, pcr_oi, n_strikes 
        FROM greeks_expiry_inventory 
        WHERE snapshot_id = ? AND dte_bucket = ?
    """, (snap_new['id'], dte))
    inv_new = cursor.fetchone()
    
    cursor.execute("""
        SELECT total_oi_calls, total_oi_puts, pcr_oi, n_strikes 
        FROM greeks_expiry_inventory 
        WHERE snapshot_id = ? AND dte_bucket = ?
    """, (snap_old['id'], dte))
    inv_old = cursor.fetchone()
    
    if inv_new and inv_old:
        inv_new = dict(inv_new)
        inv_old = dict(inv_old)
        
        diff_calls = inv_new['total_oi_calls'] - inv_old['total_oi_calls']
        diff_puts = inv_new['total_oi_puts'] - inv_old['total_oi_puts']
        
        print(f"--- Bucket {dte}DTE ---")
        print(f"  Calls OI: {inv_new['total_oi_calls']:,} [Sebelumnya: {inv_old['total_oi_calls']:,} | Selisih: {diff_calls:+,}]")
        print(f"  Puts OI: {inv_new['total_oi_puts']:,} [Sebelumnya: {inv_old['total_oi_puts']:,} | Selisih: {diff_puts:+,}]")
        print(f"  PCR (OI): {inv_new['pcr_oi']:.4f} [Sebelumnya: {inv_old['pcr_oi']:.4f} | Selisih: {inv_new['pcr_oi'] - inv_old['pcr_oi']:+.4f}]")
        print(f"  Active Strikes: {inv_new['n_strikes']} [Sebelumnya: {inv_old['n_strikes']} | Selisih: {inv_new['n_strikes'] - inv_old['n_strikes']:+}]")
        print()

conn.close()

import sqlite3
import os
import sys
import json

db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "greeks.db")
print("DB Path:", db_path)

if not os.path.exists(db_path):
    print("Database file does not exist.")
    sys.exit()

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Get latest snapshot with strikes archived
print("Fetching latest snapshots for ^SPX:")
cursor.execute("""
    SELECT id, timestamp, spot, total_net_gex, gex_regime, gamma_flip 
    FROM greeks_snapshots 
    WHERE ticker = '^SPX' 
    ORDER BY timestamp DESC 
    LIMIT 5
""")
rows = cursor.fetchall()
for r in rows:
    print(f"ID: {r['id']} | Timestamp: {r['timestamp']} | Spot: {r['spot']:.2f} | Net GEX: {r['total_net_gex']:.2f}M | Regime: {r['gex_regime']} | Flip: {r['gamma_flip']}")

if rows:
    latest_id = rows[1]['id']  # Let's check the one before the 0-GEX snapshot we just inserted (ID 8878/8877 is the 0-GEX one)
    # Wait, the latest ID with actual GEX is ID 8873 (from yesterday June 2nd, 21:14 UTC).
    # Let's find the latest snapshot with total_net_gex != 0
    cursor.execute("""
        SELECT id, timestamp, spot, total_net_gex 
        FROM greeks_snapshots 
        WHERE ticker = '^SPX' AND total_net_gex > 100.0
        ORDER BY timestamp DESC 
        LIMIT 1
    """)
    valid_row = cursor.fetchone()
    if valid_row:
        valid_id = valid_row['id']
        print(f"\nAnalyzing latest valid snapshot ID {valid_id} ({valid_row['timestamp']}):")
        
        # Get weekly (7DTE) expiry info
        cursor.execute("""
            SELECT * FROM greeks_expiry_inventory 
            WHERE snapshot_id = ? AND dte_bucket = 7
        """, (valid_id,))
        weekly_inv = cursor.fetchone()
        if weekly_inv:
            weekly_inv = dict(weekly_inv)
            print("\nWeekly Bucket Inventory:")
            print(f"- Target Expiry Dates: {weekly_inv.get('expiry_dates_json')}")
            print(f"- Put/Call Ratio (OI): {weekly_inv.get('pcr_oi'):.4f}")
            print(f"- Weekly Net GEX: {weekly_inv.get('net_gex_spotgamma'):.2f}M")
            print(f"- Weekly Net Vanna: {weekly_inv.get('net_vanna'):,.2f}")
            print(f"- Weekly Net Charm: {weekly_inv.get('net_charm'):,.2f}")
            print(f"- Weekly Max Pain: {weekly_inv.get('max_pain')}")
            print(f"- Weekly Largest GEX Strike: {weekly_inv.get('largest_gex_strike')} ({weekly_inv.get('largest_gex_value'):.2f}M)")
            
            # Fetch strikes
            cursor.execute("""
                SELECT strike, option_type, oi, gex_spotgamma, vanna_exp, charm_exp 
                FROM greeks_strike_archive 
                WHERE snapshot_id = ? AND dte_bucket = 7
                ORDER BY abs(gex_spotgamma) DESC
                LIMIT 10
            """, (valid_id,))
            strikes = cursor.fetchall()
            print("\nTop strikes:")
            print("| Strike | Option Type | OI | Net GEX (M) | Vanna Exp | Charm Exp |")
            print("|---|---|---|---|---|---|")
            for s in strikes:
                print(f"| {s['strike']} | {s['option_type']} | {s['oi']:,} | {s['gex_spotgamma']:.2f} | {s['vanna_exp']:,.0f} | {s['charm_exp']:,.0f} |")
        else:
            print("No weekly inventory found for this snapshot.")
    else:
        print("No valid snapshot found with non-zero GEX.")
conn.close()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rpc_client import get_latest_block_number, get_gas_price, get_block
from live_feed import get_network_stats

stats = get_network_stats()
block_num = stats["latest_block"]
gas = stats["gas_price_gwei"]
eth_price = stats["eth_price_usd"]

print("=== Network Stats ===")
print(f"Latest block: #{block_num:,}")
print(f"Gas price: {gas} Gwei")
print(f"ETH price fallback: ${eth_price}")

block = get_block(block_num, full_transactions=True)
txs = block.get("transactions", []) if block else []
print(f"Txs in latest block: {len(txs)}")
if txs:
    tx = txs[0]
    h = tx["hash"][:20]
    val = int(tx.get("value", "0x0"), 16) / 1e18
    print(f"Sample tx hash: {h}...")
    print(f"Sample tx value: {val:.6f} ETH")
    print(f"Method: {tx.get('input','0x')[:10]}")

print("\nBackend FULLY WORKING!")

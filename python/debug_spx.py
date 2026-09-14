import yfinance as yf
import pandas as pd
from Greeks import OptionsInventoryEngine, _fetch_spot_price

ticker = "^SPX"
t = yf.Ticker(ticker)
spot, spot_src = _fetch_spot_price(t, ticker)
print(f"Spot price: {spot:.2f} (Source: {spot_src})")

if not t.options:
    print("No options available")
    sys.exit()

first_exp = t.options[0]
print(f"Testing first expiry: {first_exp}")
chain = t.option_chain(first_exp)
calls = chain.calls.copy()
puts = chain.puts.copy()

print(f"Raw Calls: {len(calls)}, Raw Puts: {len(puts)}")
print("First call record columns and values:")
print(calls.iloc[0])

# Let's count how many have Open Interest
print("Calls with OI > 0:", (calls['openInterest'] > 0).sum())
print("Calls with OI >= 10:", (calls['openInterest'] >= 10).sum())
print("Puts with OI >= 10:", (puts['openInterest'] >= 10).sum())

# Let's see what the strike range is:
print("Calls Strike Range:", calls['strike'].min(), "to", calls['strike'].max())

# Let's run a miniature check of the compute logic
engine = OptionsInventoryEngine(ticker="^SPX")
snap = engine.compute_dict()
print("\nEngine compute_dict summary:")
print("Spot:", snap['spot'])
print("Total strikes across all buckets:", sum(len(b['strikes']) for b in snap['by_expiry'].values() if b))
for b_name, b_val in snap['by_expiry'].items():
    print(f"Bucket {b_name}: {b_val['n_strikes']} strikes, Net GEX: {b_val['net_gex_spotgamma']:.2f}")

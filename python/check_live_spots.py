import yfinance as yf
import sys

sys.stdout.reconfigure(encoding='utf-8')

for ticker in ['SPY', 'QQQ', 'IWM']:
    try:
        t = yf.Ticker(ticker)
        # Ambil harga live teranyar
        history = t.history(period="1d", interval="1m")
        if not history.empty:
            spot = history['Close'].iloc[-1]
            prev_close = t.info.get('previousClose', spot)
            pct_change = (spot - prev_close) / prev_close * 100
            print(f"{ticker} Live Spot: {spot:.2f} | Change: {pct_change:+.2f}%")
        else:
            print(f"{ticker} Live Spot: N/A (History empty)")
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")

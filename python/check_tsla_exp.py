import yfinance as yf

t = yf.Ticker("TSLA")
expiries = t.options
print("Available TSLA Expiries:")
for e in expiries[:5]:
    print(e)

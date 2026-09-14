import yfinance as yf

ticker = "GLD"
t = yf.Ticker(ticker)
print("Ticker options dates:", t.options[:5])
if t.options:
    chain = t.option_chain(t.options[0])
    print("Calls columns:", list(chain.calls.columns))
    print("Calls first row:\n", chain.calls.head(1).to_dict(orient='records'))
    print("Calls openInterest non-zero count:", (chain.calls['openInterest'] > 0).sum())
    print("Calls volume non-zero count:", (chain.calls['volume'] > 0).sum())
else:
    print("No options available")

export const TEMPLATES: { name: string; code: string; file?: string }[] = [
  { name: 'EMA + momentum', code: `def calculate(ctx):
    bars = ctx.data.ohlcv()
    period = ctx.input.int("period", default=20, min=2, max=500)
    ema = bars.close.ewm(span=period, adjust=False).mean()
    ctx.plot.line("ema", ema, color="#eab86b", title=f"EMA {period}")
    distance = 100 * (bars.close / ema - 1)
    ctx.plot.histogram("momentum", distance, pane="Momentum", color="#45c9b0")
    ctx.plot.hline("zero", 0, pane="Momentum", color="#66758b")
    print(f"{ctx.symbol}: {len(bars)} candles processed")
` },
  { name: 'RSI', code: `def calculate(ctx):
    bars = ctx.data.ohlcv()
    length = ctx.input.int("length", default=14, min=2, max=200)
    delta = bars.close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1/length, adjust=False, min_periods=length).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1/length, adjust=False, min_periods=length).mean()
    rsi = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    rsi = rsi.mask((loss == 0) & (gain > 0), 100).mask((loss == 0) & (gain == 0), 50)
    ctx.plot.line("rsi", rsi, pane="RSI", color="#a3b8f3")
    ctx.plot.hline("upper", 70, pane="RSI", color="#d87983")
    ctx.plot.hline("lower", 30, pane="RSI", color="#45c9b0")
` },
  { name: 'Bollinger bands', code: `def calculate(ctx):
    bars = ctx.data.ohlcv()
    n = ctx.input.int("length", default=20, min=2, max=500)
    width = ctx.input.float("deviations", default=2, min=0.1, max=10)
    mid = bars.close.rolling(n).mean()
    sigma = bars.close.rolling(n).std(ddof=0)
    ctx.plot.line("middle", mid, color="#eab86b")
    ctx.plot.line("upper", mid + width*sigma, color="#7ca6e8")
    ctx.plot.line("lower", mid - width*sigma, color="#7ca6e8")
` },
  { name: 'Breakout signals', code: `def calculate(ctx):
    bars = ctx.data.ohlcv()
    n = ctx.input.int("lookback", default=20, min=2, max=500)
    ceiling = bars.high.shift(1).rolling(n).max()
    floor = bars.low.shift(1).rolling(n).min()
    ctx.plot.line("ceiling", ceiling, color="#45c9b0")
    ctx.plot.line("floor", floor, color="#d87983")
    ctx.plot.marker("breakout", bars.close > ceiling, text="Breakout", color="#eab86b")
` },
  { name: 'Realized volatility', code: `import numpy as np

def calculate(ctx):
    bars = ctx.data.ohlcv()
    n = ctx.input.int("lookback", default=30, min=2, max=500)
    periods = ctx.input.int("periods_per_year", default=365, min=1, max=525600)
    # Set periods_per_year to match your timeframe and market calendar.
    rv = np.log(bars.close / bars.close.shift(1)).rolling(n).std() * np.sqrt(periods) * 100
    ctx.plot.area("rv", rv, pane="Realized volatility (%)", color="#7ca6e8")
` },
  { name: 'Compare dataset', code: `def calculate(ctx):
    bars = ctx.data.ohlcv()
    # Add a second dataset named "compare" in Data inputs.
    other = ctx.data.ohlcv("compare")
    # Caller supplies confirmed auxiliary bars; forward alignment is as-of.
    aligned = other.close.reindex(bars.index, method="ffill")
    ratio = bars.close / aligned
    ctx.plot.line("ratio", ratio, pane="Relative value", color="#eab86b")
` },
  { name: 'The Greeks · Complete', code: '', file: '/chart-studio/indicators/the_greeks_complete.py' },
  { name: 'Options activity · Levels', code: '', file: '/chart-studio/indicators/options_activity_levels.py' },
  { name: 'Greeks · Regime history', code: '', file: '/chart-studio/indicators/greeks_regime_history.py' },
];
export const SDK_HELP = `def calculate(ctx):
    bars = ctx.data.ohlcv()  # UTC DatetimeIndex; open/high/low/close/volume/time
    n = ctx.input.int("length", default=20, min=1, max=500)
    ctx.plot.line("id", bars.close.rolling(n).mean(), pane="price", color="#45c9b0")

Outputs: line, area, histogram(id, Series, pane=..., color=...)
hline(id, value, pane=...)
marker(id, boolean_series, text="Buy")
box(id, start_time, end_time, top, bottom)

ctx.input.float(name, default=2, min=0.1, max=10, step=0.1)
ctx.data.ohlcv("compare") reads a dataset added in Data inputs.
ctx.symbol / ctx.timeframe identify this run. pandas (pd) and numpy (np) are available.
The Greeks input must be enabled with an options source ticker before using:
ctx.greeks.meta -> dict with ticker, source, contract_size, snapshot_time (epoch seconds), replay, cutoff
ctx.greeks.snapshot(allow_synthetic=False) -> dict of current totals and expiry summaries
ctx.greeks.chain(allow_synthetic=False) -> DataFrame of contracts: expiry, dte, strike, option_type,
oi, volume, mid_price, iv (annual decimal), delta, gamma, theta, vega, rho, vanna, charm,
gex_spotgamma, gex_raw, vanna_exp, charm_exp, delta_exp, vega_exp, bucket
ctx.greeks.history(allow_synthetic=False) -> UTC-indexed recorded aggregate snapshots
ctx.greeks.oi_changes(allow_synthetic=False) -> partial top-GEX archive comparisons
No current snapshot, chain or OI changes during replay. Do not fabricate missing history.
GEX USD per 1% spot move = gex_spotgamma * 1e7. Exposure signs are model conventions.
Chain volume * mid_price * contract_size is a premium proxy, not premium paid or buy/sell flow.
Historical alignment: reindex onto bar times using forward fill with an explicit age tolerance.
Current hlines must be labeled NOW; never infer historical walls from today's chain.
Use distinct output IDs. NaN is shown as a gap. Up to 32 outputs, 20,000 points each.
Python runs in a browser worker. Native system packages/files are not available.
NumPy, pandas and SciPy use the installed local runtime. Stop resets the worker.
Scripts can use browser networking; only run scripts you trust.
`;

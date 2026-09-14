// These signatures mirror public/chart-studio/sdk.py. Snippet fields are editable with Tab.
export const PYTHON_SDK = [
  { label: 'ctx.data.ohlcv', detail: '(name="chart") → DataFrame', info: 'UTC DatetimeIndex with open, high, low, close, volume, time. "compare" requires a Data input.', snippet: 'ctx.data.ohlcv("${chart}")' },
  { label: 'ctx.input.int', detail: '(name, default=20, min=1, max=10000) → int', info: 'Creates an editable integer in indicator Inputs. Run again after changing an input.', snippet: 'ctx.input.int("${length}", ${20}, ${1}, ${500})' },
  { label: 'ctx.input.float', detail: '(name, default=1.0, min=-1e9, max=1e9, step=0.1) → float', info: 'Creates a bounded numeric input.', snippet: 'ctx.input.float("${multiplier}", ${2.0}, ${0.1}, ${10.0}, ${0.1})' },
  ...['line', 'area', 'histogram'].map(kind => ({ label: `ctx.plot.${kind}`, detail: '(id, values, **options)', info: 'values: pandas Series aligned to candle timestamps. Options: pane="price", color="#45c9b0", title="Label". IDs must be unique.', snippet: `ctx.plot.${kind}("\${signal}", \${values}, pane="\${price}", color="#45c9b0")` })),
  { label: 'ctx.plot.hline', detail: '(id, value, **options)', info: 'Draw a finite horizontal reference value. Use pane= to choose an indicator pane.', snippet: 'ctx.plot.hline("${level}", ${0}, pane="${price}")' },
  { label: 'ctx.plot.marker', detail: '(id, condition, text="Signal", **options)', info: 'condition is a boolean Series. Markers appear at matching candle times.', snippet: 'ctx.plot.marker("${signal}", ${condition}, text="${Signal}")' },
  { label: 'ctx.plot.box', detail: '(id, start, end, top, bottom, **options)', info: 'start/end: UTC timestamps or pandas Timestamp. Requires top >= bottom and end >= start.', snippet: 'ctx.plot.box("${zone}", ${start}, ${end}, ${top}, ${bottom})' },
  ...['snapshot', 'chain', 'history', 'oi_changes'].map(method => ({ label: `ctx.greeks.${method}`, detail: '(allow_synthetic=False)', info: 'Enable The Greeks data input first. snapshot returns a dictionary; chain/history/oi_changes return DataFrames. In replay, use history().', snippet: `ctx.greeks.${method}()` })),
  { label: 'ctx.greeks.meta', detail: 'dict', info: 'Provenance, observed_at, replay and cutoff. Requires The Greeks input.' },
  { label: 'ctx.symbol', detail: 'str', info: 'Canonical chart symbol, such as BTC, xyz:TSLA or SPY.' },
  { label: 'ctx.timeframe', detail: 'str', info: 'Selected candle interval, such as 1m or 1h.' },
  { label: 'ctx.market', detail: 'dict', info: 'Latest supplied market snapshot. Empty during replay; this is not a historical time series.' },
];
export const PYTHON_SNIPPETS = [
  { label: 'calculate', detail: 'Indicator entry point', info: 'Start with candles and an editable EMA length.', snippet: 'def calculate(ctx):\n    df = ctx.data.ohlcv()\n    length = ctx.input.int("length", 20, 1, 500)\n    values = df.close.ewm(span=length, adjust=False).mean()\n    ctx.plot.line("ema", values, title="EMA")' },
  { label: 'rolling_mean', detail: 'pandas · SMA', info: 'Rolling mean keeps warm-up values as NaN; chart gaps are intentional.', snippet: '${df}.close.rolling(${20}).mean()' },
  { label: 'exponential_mean', detail: 'pandas · EMA', info: 'Exponential moving average with an explicit span.', snippet: '${df}.close.ewm(span=${20}, adjust=False).mean()' },
];

# Footprint chart — implementation and data semantics

Open `/terminal`, select a Hyperliquid instrument, and click **Footprint**. It uses a Lightweight Charts v5 custom series with native pan, zoom, crosshair, price/time scales and HiDPI canvas. The chart is independent of OHLC-derived indicators: it aggregates captured executions, not candle estimates.

- Bid × Ask: sell aggressor size on the left, buy aggressor size on the right.
- Delta mode: buy minus sell at each price row. The lower histogram shows delta for each captured bar.
- Gold outline: highest-volume price row (POC) of that captured bar. Ties choose the lowest price row deterministically.
- Diagonal imbalance: ask/buy at P compared with bid/sell one row below; bid/sell at P compared with ask/buy one row above. The configurable ratio defaults to 300%. Missing or zero denominators do not count. Minimum side volume uses the selected volume units.
- Stacked imbalance: at least three consecutive, adjacent rows with the same imbalance direction. Thick outline and ◆ identify stacked rows.
- Auto price increment is estimated from the first captured trade and held stable for the panel session. It is an aggregation increment, not an exchange tick-size claim. Manual increments support decimals. Extremely small increments are widened to keep the overall price span within roughly 240 rows; the effective increment is displayed.
- Units: base size, or quote notional computed as execution price × base size. Notional is never inferred from the midpoint of an aggregated row.
- Settings include custom buy/sell colors, text size, POC visibility, ratios and minimum volume. CSV exports every captured row; PNG exports the chart and delta pane.
- Follow keeps the latest bars visible. Turn it off to inspect earlier captured trades. Fit and +/- adjust the view. Zoom out hides numbers when cells are too small; zoom in restores them.

## Coverage limits

The existing order-flow API seeds recent trades and streams received executions. These are partial candles, not guaranteed complete exchange OHLC or full-session volume. Client retention is bounded at 20,000 fills and pruned to an hour when new fills arrive. Connection gaps and retention caps are shown. A reset clears prior captures; reopening starts a fresh capture. Yahoo and historical replay show an unavailable/paused state and never fabricate bid/ask data. Empty price rows are absent, not interpolated.

## Files

- `vrp-claude/app/lib/chart-studio/footprint.ts`: pure bucketing, exact base/quote accumulation, deduplication, POC and imbalance math.
- `vrp-claude/app/lib/chart-studio/footprintSeries.ts`: LWC custom series, only draws visible bars, clips canvas and suppresses unreadable text.
- `vrp-claude/app/components/lwc/studio/FootprintPanel.tsx`: batched feed, chart controls, selected-bar ladder and exports.
- `vrp-claude/app/components/lwc/studio/footprint.css`: responsive styling.
- `useOrderFlow.ts` and `/api/chart-studio/orderflow`: existing 500 ms batches, shared upstream WebSocket hub and cleanup. Footprint subscribes only while enabled on Hyperliquid in live mode.

Checks:

```powershell
cd vrp-claude
node --test tests/footprint.test.cjs
node tests/footprint.browser.cjs
npm run build
```

Browser tests use explicitly injected deterministic trade fixtures, verify native 2x backing canvases (Chrome physical device scale factor), exports, settings, cleanup, unsupported-source behavior, and widths 320/390/768/1500. Fixture data is never present in application runtime.

References: [Lightweight Charts custom series](https://tradingview.github.io/lightweight-charts/docs/5.0/plugins/custom_series), [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).

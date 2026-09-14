# The Greeks workspace — September 5, 2026

The overview now includes a strike exposure chart with GEX, Vanna and Charm, expiry bucket selection, a strike range selector, and an accessible data table. Calls and puts retain the engine's signed exposures; the net line sums both. GEX is converted to USD per 1% spot move at the display boundary, matching the existing snapshot formatter and CSV export.

The adjacent level panel shows the strike with the largest call OI, the strike with the largest put OI, the model gamma flip, and (for a selected bucket) max pain. Levels use the full selected bucket rather than the chart's visible range. Percent distances are relative to snapshot spot. These are inventory/model levels, not guaranteed support or resistance.

Bug fixes:

- Filter expiry buckets before deduplicating contracts. A contract appearing in an earlier bucket no longer disappears when selecting a later bucket.
- Reject incomplete snapshot totals and invalid source labels before rendering; preserve existing error handling and retry.
- History, backtest and signal panels can load while the current snapshot is unavailable.
- Abort research requests when changing views/tickers, and provide a timeout with retry.
- Show unknown cache status when the response contains no cache metadata.

Verification commands (from `vrp-claude`):

```powershell
node --test tests/greeks.test.cjs
npx tsc --noEmit
npm run build
```

`tests/greeks.browser.cjs` uses Playwright and an installed Chrome browser. Set `NODE_PATH` to the available Playwright runtime if it is not installed in the project. It tests explicitly synthetic fixtures: exposure controls, ticker selection, keyboard tabs, filtered CSV download, viewport widths 320/768/1024/1440, and history/signals while the snapshot endpoint returns 503. `GREEKS_TEST_BROWSER` can select another installed Playwright browser channel.

The frontend remains available at `http://127.0.0.1:3000/?view=greeks`. Start backend services with `uv run python start_servers.py` from `python`, as prescribed by the project launcher.

Implementation references: [React effect cleanup](https://react.dev/reference/react/useEffect), [Recharts responsive sizing](https://recharts.github.io/en-US/api/ResponsiveContainer/).

Verification results: six regression tests passed, TypeScript passed, browser fixture checks passed, and the production build exited successfully. The build logged a non-fatal network fetch warning under the sandbox. A separate browser check rendered the SPY provider snapshot and stored history without browser exceptions; the cached snapshot's stale/refreshing state was visible. The default index snapshot used synthetic fallback, which remained explicitly labelled in the UI. Run the production build with the dev server stopped, since both use `.next` by default.

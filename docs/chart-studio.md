# Chart Studio — implementation and user guide

Implemented 2026-09-05. Entry points: `/terminal` and `/?view=lwc`.

AI indicator authoring: [portable Python SDK guide](../vrp-claude/public/chart-studio/INDICATOR_AI_GUIDE.md), also downloadable from **Python Studio → AI guide .md**. Give this file to Codex, Antigravity, or other assistants before requesting a script.

Hyperliquid Market explorer discovers active native and HIP-3 perpetuals using `allPerpMetas`, with collateral resolved through `spotMeta`. Catalog requests are coalesced and cached for five minutes. Search aliases such as `TSLAUSDT.P` return canonical contracts such as `xyz:TSLA`; delisted contracts are excluded. Native/HIP-3 filters and **Show more markets** expose the full catalog. The alias does not imply USDT collateral. Provider contract: [official perpetual metadata API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals).

## Use it

1. Click the symbol at the top; choose Hyperliquid perpetuals or Yahoo Finance. Changing provider preserves separate instrument identities and drawing collections.
2. Open Python Studio. The default EMA + momentum script is ready to run. Click **Run** or press **Ctrl+Enter**. A fresh worker needs a short runtime startup; subsequent runs reuse it.
3. Use **New indicator** for RSI, Bollinger bands, breakout markers, realized volatility, or relative value. Import an existing `.py`, or use **AI draft** to create another script tab. AI drafts require the existing OpenRouter configuration and are never executed automatically.
4. Edit parameters in **Studies** after the first run. Run again to apply edits. **Run on candle close** evaluates completed primary candles; manual Run includes the current provisional bar.
5. Drawing tools: select/move, trendline, ray, horizontal/vertical line, rectangle, Fibonacci, freehand, text, measure, long/short 2:1 risk illustration, eraser. Drag on the chart to draw; Escape returns to Select. Drawing handles edit endpoints. Snap uses OHLC prices. Ctrl+Z / Ctrl+Shift+Z undo/redo drawing operations when focus is outside the editor.
6. **Objects** provides rename, duplicate, bring to front, hide, lock and delete. Text annotations can be created with the Text tool. Drawings are stored as UTC timestamps and prices.
7. Workspace and scripts autosave in this browser. **Save** also captures the current visible time range. **Export** produces a JSON backup, and Import restores it while backing up the prior workspace. The camera exports price, indicators and drawing overlay to PNG.
8. **Data** shows source, timezone, timestamps and live Hyperliquid asset context. An optional compare dataset can use another provider or timeframe; Python reads it with `ctx.data.ohlcv("compare")`.
9. **Replay** exposes candles up to a cursor. Step, play/pause, scrub, or Exit. Python sees only the selected primary history and available auxiliary bars. Live asset context is withheld from replay scripts.
10. The inspector collapses on narrow screens. Toggle it from the top-right panel button. Python editor can collapse and resize. Price panes support drag-resizing, fit, autoscale and logarithmic scale.

Paper trading and macro dashboards remain accessible via **Paper & macro** in the embedded dashboard. The standalone terminal retains its previous terminal through its legacy button. Existing account state is not migrated or rewritten by Chart Studio.

## Python SDK

Python is real CPython 3.12.7 via Pyodide 0.27.7 in a Web Worker. NumPy 2.0.2, pandas 2.2.3 and SciPy 1.14.1 are installed as local browser runtime assets. A new implementation decision replaces the plan's native Python job server: there is no new arbitrary Python execution endpoint or additional backend port.

```python
def calculate(ctx):
    bars = ctx.data.ohlcv()
    length = ctx.input.int("length", default=20, min=2, max=500)
    ema = bars.close.ewm(span=length, adjust=False).mean()
    ctx.plot.line("ema", ema, pane="price", color="#eab86b")
    ctx.plot.histogram("distance", 100 * (bars.close / ema - 1),
                       pane="Momentum", color="#45c9b0")
    ctx.plot.hline("zero", 0, pane="Momentum", color="#66758b")
```

DataFrame columns: `time`, `open`, `high`, `low`, `close`, `volume`; index: UTC DatetimeIndex. `pd` and `np` are available; imports of installed packages also work. Functions:

- `ctx.input.int(name, default, min, max)` / `.float(..., step=...)` declare parameter controls.
- `ctx.plot.line`, `.area`, `.histogram`: output ID, Series, optional pane/color/title.
- `ctx.plot.hline(id, value, ...)`: constant level.
- `ctx.plot.marker(id, boolean_series, text="Signal", ...)`: price-pane signal markers.
- `ctx.draw.box(id, start, end, top, bottom, ...)`: price-pane zone. `ctx.draw` aliases `ctx.plot`.
- `ctx.symbol`, `ctx.timeframe` identify the snapshot.
- `ctx.market`: latest Hyperliquid mark/oracle price, OI, funding, notional volume and receipt timestamp. This is a scalar current snapshot, not a historical time series; empty during replay and for unsupported sources.

Each study owns its outputs. Distinct output IDs are required. Colors use six-digit hex. NaN warmup becomes a gap; infinities, invalid parameters, duplicate output IDs and malformed boxes produce tracebacks instead of invalid charts. Limits: 12 study instances, 32 outputs per study, 20,000 points per output, 100 KB source, 16 MB serialized output, bounded console logs, 30-second execution deadline (including optional package loading once the runtime is ready). Stop terminates the whole worker, including an infinite Python loop.

The worker keeps chart interaction separate from Python computation. It does not expose native OS Python, local machine files, or arbitrary compiled system packages. It is not a claim of isolation from all browser networking: run trusted scripts. Native PyTorch/TensorFlow/system executables are not supported by this browser runtime. See [Pyodide's worker architecture](https://pyodide.org/en/0.27.7/usage/webworker.html).

## Setup

From `vrp-claude/`:

```powershell
npm install
npm run setup:chart-python
npm run dev
```

`setup:chart-python` downloads the pinned runtime from the official Pyodide distribution, recursively installs NumPy/pandas/SciPy dependencies, and verifies package SHA-256 against the version's lockfile. The ~41 MB runtime lives in `public/chart-studio/runtime/` and is gitignored; run setup on a fresh checkout or deployment. Once installed, Python runs without contacting the CDN. Market feeds and AI still need their respective network services.

AI uses `OPENROUTER_API_KEY` from existing server configuration. Optional `CHART_STUDIO_AI_MODEL` overrides the default model. No API key is passed to the browser worker.

## Architecture and files

- `app/components/lwc/studio/ChartWorkspace.tsx`: shared workspace controller and persistence.
- `StudioChart.tsx`: fresh Lightweight Charts v5 renderer, incremental candles, multi-pane study output and PNG compositing.
- `DrawingLayer.tsx`: timestamp/price overlay and pointer interaction.
- `CodeEditor.tsx`, `PythonStudio.tsx`: CodeMirror Python editor, SDK completions, files, templates, console, AI draft UI.
- `Inspector.tsx`, `SymbolPicker.tsx`, `studio.css`: market search, settings and responsive UI.
- `app/lib/chart-studio/`: schemas, normalization, session aggregation, provider adapters, shared upstream WebSocket hub, market hook and Python job lifecycle.
- `app/api/chart-studio/{bars,search,stream,assistant}/route.ts`: explicit same-origin endpoints. SSE forwards provider WebSocket updates and aborts/refcounts subscriptions.
- `public/chart-studio/sdk.py`, `python-worker.js`: runtime SDK and worker transport.
- `app/terminal/LegacyTerminal.tsx`: preserved standalone terminal implementation.

LWC uses public v5 series/pane APIs. Context7 was not available; official documentation and installed 5.2.0 types were used. [LWC panes](https://tradingview.github.io/lightweight-charts/tutorials/how_to/panes), [primitives](https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives).

Data is normalized once, sorted and deduplicated. Native Hyperliquid candle volume is replaced on an update, never added again. Snapshot loading buffers incoming candles and reconciles before rendering. Last unsubscribe closes the shared provider connection. Reconnect triggers history refresh; a capped REST cache reduces duplicate traffic. Yahoo refreshes at 20 seconds and retains its delay/session/raw-price labels. A 4h Yahoo bar is grouped by session/time bucket instead of every four rows.

Source boundaries: Hyperliquid snapshot history is limited to the recent window, and Yahoo intervals have provider limits. This release loads about 1,500 Hyperliquid candles, Yahoo 5 days for 1m / one month for other intraday intervals / 5 years daily. There is no invented backfill. [Hyperliquid candle history](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint), [Yahoo/yfinance interval limitations](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html).

## Order flow and volume profile (2026-09-06)

Use the **Order flow** and **Volume profile** buttons in the chart toolbar. Opening order flow collapses the Python editor to leave room for the chart. Both panels work in the embedded dashboard and standalone terminal.

- **Order flow:** Hyperliquid public trades and L2 book, including canonical HIP-3 symbols such as `xyz:TSLA`. The panel shows aggressor buy/sell volume, window delta, a CVD trace, top 5/10/20 bid/ask levels, spread in price units/bps, resting-size imbalance, and time & sales. The notional filter affects only the tape. CSV exports all retained trades in the selected window, unaffected by the tape filter.
- **Windows:** 1/5/15/60 minutes, bounded by what has actually been captured. Initial `recentTrades` provides a small seed; it is not complete historical coverage. Retention is at most 20,000 trades and one hour. CVD starts at zero at the beginning of the current retained window, so it moves as that window rolls. Reset removes existing captured trades; changing symbol, reloading, or closing both panels starts a new capture. No exchange-day or permanent historical archive is implied.
- **Profile:** choose estimated candle volume or captured executed trades; visible chart or all loaded/captured data; 24/48/96 rows; and 68/70/80/90% target value area. Candle volume is allocated uniformly over each candle's high–low range, without inferring buy/sell volume. Trade bins use actual execution price and base size. Visible trade range includes the full last visible candle interval.
- **Levels:** POC is the midpoint of the highest-volume bin; ties select the lower bin. Value area expands contiguously from POC toward the larger adjacent bin (lower bin wins ties) until target coverage is reached. Discrete bins can exceed the requested percentage; the panel shows actual coverage. VAH/VAL are the outer bin edges. The LWC primitive follows price scale, zoom, pane size, and log mode and is included in chart PNG exports. It does not change price autoscaling.
- **Coverage:** reconnects mark a possible gap; depth older than 15 seconds is marked stale, with imbalance suppressed. Resting depth is not executed flow and can cancel. Yahoo supports estimated candle profile only. Live trades/book and trade profile pause during replay; candle profile uses only candles up to the replay cursor. These UI feeds are not yet exposed as historical Python SDK datasets.

Implementation uses an on-demand same-origin SSE route `/api/chart-studio/orderflow`, sharing one upstream socket per symbol (up to eight). Public trades and L2 are batched at 500 ms, deduplicated by `(coin,time,tid)`, with finite-value and symbol checks. Browser publication is also bounded to 500 ms; closing the last consumer releases its socket/timers. Public provider contracts: [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [Hyperliquid info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint). Rendering uses [Lightweight Charts series primitives](https://tradingview.github.io/lightweight-charts/docs/plugins/series-primitives).

Verification: 11 chart/data unit tests passed, including conservation of profile volume, trade deduplication, delta, depth, value area and shared flow socket cleanup. `tests/orderflow.browser.cjs` exercises fixtures, filters/CSV, reset/gaps, replay, Yahoo and 320/390/768 widths. `tests/orderflow-live.browser.cjs` verifies actual BTC and `xyz:TSLA` trades/book/profile plus PNG export. In the development browser on this host at 1500×1050, live BTC recorded median 16.7 ms and p95 16.8 ms frame intervals; a separate 20,000-trade/96-row calculation benchmark measured median 4.7 ms and p95 11.0 ms. These measurements are bounded fixtures, not a guarantee for every machine or feed.

## Editable The Greeks indicators (2026-09-06)

Use **The Greeks → Options source → Use … Yahoo chart → Add complete indicator → Run**. The complete Python source opens in Python Studio; editable numeric inputs appear in Studies after the first successful run. Source ticker and scripts persist in the workspace. The New indicator menu also contains all three templates; Python download/import and the downloadable AI guide include the same SDK contract.

- **The Greeks · Complete:** current gamma flip, filtered call/put GEX walls, aggregate selected-expiry max pain, approximate IV expected move; four history panes for GEX, Vanna, Charm and Delta/Vega Z-scores. Console output includes OI/volume put-call ratios, exposure totals, expiry breakdown, unusual activity and partial archived OI changes.
- **Options activity · Levels:** configurable strike levels ranked by chain activity premium proxy, with volume, volume/OI, DTE and top-N filters.
- **Greeks · Regime history:** causal net/gross GEX, net/gross ratio and regime-crossing markers with configurable threshold and maximum observation age.

`/api/greeks/chart-data` uses the existing Next.js Greeks proxy to port 8001. The Python adapter deduplicates contracts across expiry buckets, removes duplicate chain payloads, normalizes legacy local timestamps to UTC, and includes data source/unit/coverage metadata. `ctx.greeks` exposes snapshot, chain, history, OI changes and metadata. Data is fetched on indicator Run and uses the engine cache. Synthetic/mixed snapshots require explicit experimental opt-in; history defaults to live records only.

Current levels carry **NOW** labels. They are snapshot references drawn across the chart, not historical signals. Replay strips current chain/snapshot/OI changes and filters stored aggregates to the replay cursor. Templates align observations only forward with a maximum age, leaving gaps where history is unavailable. Entirely empty history panes are hidden with an explanation in the console. History covers the latest 500 stored aggregates; chain filters do not change historical aggregates. Price overlays require matching underlyings, with a visible basis/session note for HIP-3 equities. Cross-asset conversions are not inferred.

The options dataset contains chain volume and OI, not an executed options tape. `volume × mid-price × contract size` is explicitly a premium activity proxy; aggressor, opening/closing, sweeps, blocks and institution labels are unavailable. GEX signs follow the engine's inventory assumption and do not prove dealer holdings. Native GEX multiplied by `1e7` gives the model USD hedge change per 1% underlying move. Expected move is an approximation and does not establish calibrated directional probabilities.

Verification: 13 chart/data unit tests and two Python adapter tests passed. Ten real Pyodide cases cover all three indicators, known wall/max-pain values, empty filters, synthetic rejection, replay redaction and absent history overlap. Browser UI tests cover adding templates, source selection, parameter changes, `.py` downloads, persistence, replay and 390/768 widths. The nine original Python SDK cases also passed. `tests/greeks-live.browser.cjs` ran the complete indicator using actual Yahoo SPY candles and a source-live Greeks snapshot (2,916 engine-filtered contracts, 500 stored aggregates at verification). Counts and prices change with the feed.

## Chart appearance and drawing interaction (2026-09-06)

The standalone terminal now uses the full window with compact toolbars, a quieter watchlist, and the Python editor collapsed initially. **Python / Open Python Studio** restores the editor; adding a template also opens it. The existing embedded workspace uses the same controls.

**Chart settings** in the top toolbar provides Symbol and Canvas sections. Body, wick and border colors are independently editable for bullish/bearish candles. Wicks, borders and volume can be toggled. Canvas controls cover background, axis text, crosshair, grid color/mode, watermark, and Dark/Light/Midnight presets. Changes preview immediately and persist in workspace autosave/export/import. Theme/color changes use the chart's public `applyOptions` API without rebuilding the chart or resetting zoom. The theme shortcut selects the corresponding default palette.

Candles use native Lightweight Charts rendering with visible borders, a minimum zoom spacing of two CSS pixels, and the library's display-resolution canvas backing. No CSS transform or bitmap upscaling is applied to the chart. Verification at a real Chrome device scale factor of 2 checks double-resolution canvas buffers before/after zoom. Browser `deviceScaleFactor` emulation alone is insufficient for this check because Chromium's device-pixel ResizeObserver can still report the host's physical scale. No dependency monkeypatches are used. Public API references: [candlestick options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/CandlestickStyleOptions), [time scale options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/TimeScaleOptions).

Drawing controls:

- Click a first and second point, or drag, to create a line, ray, zone, Fibonacci, measurement or position. Horizontal/vertical lines need one click. Brush follows a held pointer; text opens an inline note editor.
- A transparent 14-pixel hit area makes thin lines easier to select. Drag the body to translate the object. Rectangle has four corner handles; position drawings store independent entry/target/stop prices and calculate their displayed reward/risk from those prices. Invalid target/stop placement is identified visibly.
- Selected objects show a floating toolbar for color, line width/style, duplicate, lock/unlock, text editing and delete. Locked objects remain selectable but cannot be moved/deleted until unlocked. Click the chart or use Deselect to clear selection.
- **Snap to OHLC** uses a 14-pixel proximity threshold, leaving distant points free. **Stay in drawing mode** allows repeated drawings. Hold Shift to constrain a new two-point drawing to 45-degree increments. Alt+T/H/V/R selects trendline/horizontal/vertical/rectangle; Escape cancels; Delete removes the unlocked selection. Existing Ctrl+Z / Ctrl+Shift+Z undo/redo remains one entry per completed gesture.
- Drawing translation interpolates adjacent integer chart coordinates in both directions: the native coordinate APIs round/reject fractional logical indices. Stored anchors remain timestamps/prices, including between candles and across session gaps. Pixel-relative vertical translation also follows logarithmic price scales. SVG drawing export omits interaction handles/hit areas and composes at the native chart screenshot resolution.

`tests/chart-appearance.browser.cjs` covers settings persistence, dialog focus, viewport retention, physical 2× canvas sizing/zoom, two-click creation, drag, hit areas, styles, locks, duplicate/undo/redo, rectangle/position resizing, notes, Escape, repeat mode, PNG download and 320/390/768/1024 widths. The original chart/Python/Stop/theme/browser flow remains a separate regression test.

## Indicator Inputs and Style (2026-09-06)

Each indicator now has a chart legend row with Settings, visibility and remove controls. Click the indicator name or its settings icon; the Studies sidebar also has a settings icon. The dialog starts on **Style**, with **Inputs** for parameters/name/automatic candle-close runs and a **Run indicator** action. Inputs/code changes still require execution; appearance overrides do not run Python.

Style controls are per stable plot ID and per study instance: visibility, color, opacity, label, line thickness (1–4 px), solid/dashed/dotted line, straight/step interpolation, price-axis label and last-value line. Area and box outputs support fill opacity. Markers support arrow/circle/square, above/below/in-bar placement and size. Controls are shown only where the renderer supports them; histogram column width follows candle spacing. Reset one plot or all styles to the current Python output defaults. Overrides survive reruns and workspace save/export/import; a changed plot ID starts with defaults.

`Study.styles` stores optional overrides; `plotStyle.ts` validates values and resolves defaults from each Python plot. The chart retains series and uses public `applyOptions` for style edits; marker options use `setMarkers`, and boxes use the SVG drawing layer. This preserves canvas identity and pane sizes during style edits. Hiding a whole study removes its series/panes; hiding one output keeps its pane available. Plot data and calculation results are unchanged by style settings. Price-axis-label visibility suppresses both the value and axis title.

`tests/indicator-style.browser.cjs` executes a six-output Python fixture, verifies actual canvas pixel color/visibility, checks that style edits do not post another Python job or replace canvases, and exercises input recalculation, rerun persistence, reload persistence, reset, SVG box styling and responsive dialogs at 320/390/768 px. The indicator settings dialog uses the same native modal/focus conventions as chart settings.

## Core verification

`npm run build` passed (compile, type/lint checks, page generation, traces). It emitted non-fatal existing external-fetch and webpack cache warnings under the restricted build environment. The production server was started on port 3000 and the complete Chart Studio browser flow passed against that build, including real Python execution and Stop.

Production regression testing also exposed a duplicate `globals.css` import in the existing terminal layout: CSS extraction assigned global Tailwind styles to the terminal child route, leaving the root dashboard unstyled. Global CSS is now imported only by the root layout, and the terminal wrapper allows vertical scrolling on short mobile screens.

- Data tests: normalization, OHLC validity, duplicate updates, rollover, 4h session boundaries, market validation and shared socket cleanup.
- Real browser Python SDK tests: EMA numerical parity, NaN warmup, invalid color/infinity, duplicate IDs, invalid parameters, missing dataset, SciPy calculation, markers/zones.
- UI browser tests: Python Run/Stop, infinite loop interruption, drawings, undo/redo, persistence, provider/timeframe switching, dark/light themes, 320/768/1024 widths.
- Live browser smoke: actual Hyperliquid candles + asset context, actual Yahoo candles, Python plots on both.
- HIP-3 / guide verification: catalog unit tests cover collateral token indices, venue identity, delisted exclusion, and aliases. `tests/chart-catalog.browser.cjs` passed against the production build: guide download, both Markdown examples through ten real Python runs (including prefix causality and short/constant/zero data), market pagination and HIP-3 filtering, `tslausdt.p` selection to `xyz:TSLA`, real candles, Python plots, and live asset context. The live catalog contained 315 active contracts when checked; this count changes with listings.
- Embedded smoke: `/?view=lwc`, legacy navigation with a mocked empty paper account, replay step, Python, PNG/JSON export.
- Performance fixture: 20,000 candles, five line outputs, two oscillator panes, 100 drawings. Headless Chrome 152.0.7977.82 at 1440×1000, dev build: median 16.7 ms, p95 16.8 ms; Python computation 1.81 s. This measures the named fixture/device, not a guarantee for every script or GPU.

Commands are in `vrp-claude/tests/chart-*.cjs`; browser scripts require Playwright available through `NODE_PATH` and a local server at port 3000. Runtime output and screenshots are in `.ua/chart-studio/`.

## Remaining extensions from the original roadmap

The delivered workspace covers the core chart/Python/drawing/data flow, plus AI drafting, compare input, live asset context, editable Greeks indicators and replay. Multi-chart grids, historical trade CVD/order-book recording, arbitrary cross-asset Greeks mappings, server-synced workspaces, native Python execution, and general historical archival remain separate extensions. Existing Greeks analysis and legacy advanced chart tools stay accessible. Old Canvas drawings are preserved in the legacy workspace; indices without an authoritative source-time mapping are not guessed during migration.

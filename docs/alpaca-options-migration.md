# The Greeks → Alpaca options

The active options inventory engine now uses **Alpaca**. Default: `indicative` options and `iex` underlying. This migration changes the provider used by the Greeks snapshot and its downstream strike, surface, scenario, expected-move IV, constituent GEX, custom-indicator and activity consumers. It does not move Yahoo macro/index price history, ETF holdings, stock price research or the separate VRP engine.

## Local setup

1. Copy `python/.env.alpaca.example` to `python/.env.alpaca` if the latter does not exist.
2. Fill `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` **in that local file**, not the browser, chat, source code or `NEXT_PUBLIC_*` variables. The actual file is gitignored.
3. Match `ALPACA_ACCOUNT_ENV=paper` or `live` to the key. This selects only the **read-only contracts endpoint**; this adapter cannot place orders.
4. Keep `ALPACA_OPTIONS_FEED=indicative` for the user's free feed and `ALPACA_STOCK_FEED=iex`. OPRA/SIP may be selected explicitly when entitled. A 403 never silently switches feeds.
5. Start/restart with `start_dashboard.cmd --only greeks,next` (or `--production` after `npm run build`). Existing servers are left running by the launcher, so restart the existing launcher-managed Greeks process if settings changed. On an initially missing key, **Refresh source** retries provider initialization after the file is filled. Restart for key rotation or feed changes.
6. `/api/greeks/provider` returns safe configuration status, never key values. `/api/greeks?ticker=SPY&force=true` exercises contracts, snapshot pagination, underlying price and optional volume. Verify the UI source/coverage panel before using the result.

The dedicated file supports simple `KEY=value`, optional surrounding quotes and full-line comments. It does not execute shell code or interpolate variables. Process environment variables override the file. Only official Alpaca hosts are used; redirects are rejected before credentials can be forwarded.

## Provider contract

- `GET /v1beta1/options/snapshots/{underlying}`: explicit indicative/OPRA feed, expiry range from current New York date through +45 calendar days; limit 1000 and all pagination tokens followed.
- `GET /v2/options/contracts`: explicit same expiry range (Alpaca otherwise defaults to the upcoming weekend), active contracts, limit 10000, all pages. Contract metadata includes OI and its actual observation date. Cached for 15 minutes per asset/date range; cache age and capture time are separate from OI observation dates.
- `GET /v2/stocks/{symbol}/snapshot`: selected stock feed. Prefer timestamped latest trade, then daily/previous daily bar. Underlying and option observations are not guaranteed simultaneous. IEX is not a consolidated full-market quote.
- `GET /v1beta1/options/bars`: batches of at most 100 symbols, `1Day`, explicit date interval and all pages. Request ends at least 16 minutes before capture for access compatibility. The API does not expose an options-feed query parameter on this endpoint; do not label these bars as modified indicative quotes. Daily volume can be partial/revised and belongs to the displayed volume date. It is not a vintage-correct intraday reconstruction.
- Keep latest-trade size separate from daily contract volume. Missing/failed volume remains null and coverage is reported; it never becomes zero. Volume retrieval is optional to the numerical exposure calculation.
- Requests reuse HTTP sessions, are paced process-wide at a minimum 350 ms, retry transient failures up to three attempts, and use bounded timeouts. Request pagination has an explicit safety cap. An incomplete contracts/snapshot traversal fails; it is not published as a complete chain. Other API users may share account rate limits.

Only standard 100-share root contracts are eligible. Unknown/adjusted sizes or roots are excluded. OI must be dated, nonnegative integer and at least the engine minimum (10); future or >7-calendar-day-old OI is excluded. Quotes must have a positive bid, ask >= bid, timestamp, no future timestamp beyond clock tolerance, and age <=7 calendar days. IV must be present and between 1% and 500%. Counts of exclusions remain visible. These filters mean the result is **a filtered universe**, not the complete exchange inventory. Missing contracts are not zero exposure.

Same-date contracts at/after 16:00 New York are conservatively excluded; this is not a full exchange holiday/early-close calendar. Unsupported Yahoo-style index symbols are rejected without mapping them to different securities. The VVIX replication endpoint returns unavailable: VIX index options are not substituted with ETF options or a constant VVIX.

## Model vs provider Greeks

The separate Volatility Hybrid/SVI research modules retain their legacy Yahoo helpers imported from `Greeks.py`; these compatibility functions are never called by the migrated options inventory engine. This migration does not change their data source or historical fallback semantics.

The engine retains a consistent BSM model using **Alpaca implied volatility** for delta, gamma, theta, vega, rho, vanna and charm. Native snapshot Greeks are preserved separately as `provider_greeks` on each contract. They are not silently blended into GEX or the repriced gamma-flip/scenario curve. This keeps current-spot exposures and repricing internally consistent.

Existing BSM limitations remain: European exercise approximation, zero dividend yield, explicit model risk-free input (currently default 5.25%, not a live policy-rate claim), calendar DTE with a 0.5-day floor at 0DTE. This is not exact American-option valuation or exact intraday expiry timing. Changing those assumptions is a separate model migration.

`data_source='live'` is retained only as the legacy schema's **provider-backed vs synthetic** flag. It does **not** mean real-time or executable. Consumers must inspect `provenance.provider`, `feed`, quote/spot/OI timestamps and coverage. Indicative trades are delayed and quotes modified, per Alpaca. Their exposure output is an indicative model illustration, not observed dealer inventory. Signed GEX remains call-positive/put-negative.

Volume/OI activity has unknown aggressor and opening/closing status. Call/put type alone is not bullish/bearish evidence. Aggregate bars cannot establish sweeps or blocks. Volume × current midpoint × 100 is labelled a notional proxy, not traded premium.

## History and rollback

- New records are isolated in `python/data/greeks_alpaca_indicative.db` or `greeks_alpaca_opra.db`. Source metadata is stored with each snapshot. API history, OI change and signal comparisons use the current feed's database only.
- Existing `python/data/greeks.db` stays unchanged. History's **Yahoo · legacy archive** option reads it in SQLite read-only mode. Original live/mixed/synthetic labels are preserved. Records are not relabelled, backfilled or copied into Alpaca history.
- New archives start empty and only gain successfully computed observations. The selected feed must match the archive selected at process startup. Changing feed requires a restart; a guard prevents cross-feed writes.
- Rollback requires reverting the provider code and selecting the preserved legacy database. No data deletion or in-place renaming is needed. Retain the Alpaca archives for audit; do not merge them into Yahoo or fabricate historical Alpaca observations.
- Chart Studio/MCP consumers receive provenance in the snapshot/metadata and keep source limitations. Historical model signals are descriptive research; this change does not create a vintage-correct backtest.

## Verification

Run `python/.venv/Scripts/python.exe python/test_alpaca_options.py` (mocked HTTP, fake credentials, temporary SQLite). Run `node --test tests/greeks.test.cjs tests/greeks-input.test.cjs` and `npx tsc --noEmit` in `vrp-claude`, followed by `npm run build` with Next dev stopped. Live account verification requires the user's locally configured key and entitlement; passing mocks does not prove that an Alpaca account returns IV/Greeks or a complete usable chain.

References: [Alpaca option chain](https://docs.alpaca.markets/us/reference/optionchain), [contracts](https://docs.alpaca.markets/us/reference/get-options-contracts), [historical option bars](https://docs.alpaca.markets/us/reference/optionbars), [contract model and OI dates](https://alpaca.markets/sdks/python/api_reference/trading/models.html#optioncontract).

# MarketData historical Greeks lab

The Greeks → **History** or **Backtest** → **MarketData · EOD history**. The existing Alpaca/current-feed archive and legacy Yahoo history remain separate choices. This feature does not replace the live Alpaca surfaces or contract stream.

## Configuration and workflow

Fill `MARKETDATA_API_TOKEN` in ignored `python/.env.marketdata` (template: `.env.marketdata.example`). The process environment overrides the file. Never put the token in chat, frontend settings, `NEXT_PUBLIC_*`, logs or exports. The provider status only reports whether a token exists; it does **not** verify account entitlement. Refresh configuration after saving. No restart is required for a new import to read the file.

1. Choose a completed historical date window, at most 90 calendar days, and maximum expiry DTE (1–90).
2. **Import / resume** retrieves unadjusted underlying daily OHLC and one historical chain per uncached exchange session. Requests consume the user's API credits. History depth and instrument coverage depend on the account; an access failure does not switch provider or create synthetic observations.
3. Import status shows completed dates, outbound requests, failures and cancellation. Cancellation takes effect after the in-flight request. Existing dates remain saved. Only one import runs at once; identical active requests return that job. Jobs are process-local; after a restart click Import / resume to reuse archived dates. No automatic paid retry or background scheduling.
4. **Run analysis** is local-only and uses the selected date range and model parameters. Editing inputs does not silently rerun or relabel old results. Increasing maximum DTE may require another import; decreasing it reuses a sufficiently broad cached chain.
5. History shows exposure/levels by date, replay with actual expiries, and a contract table. Export research JSON includes parameters, model version, gaps, capture times, methodology and backtest ledger. Replay export contains the full modeled chain; the UI limits its table to 250 rows.

The import supports standard-root US equity/ETF options, not index settlement products. Expiry weekdays filter actual contract dates and never manufacture Monday/Wednesday listings. EOD data cannot reconstruct intraday/0DTE-before-close exposure.

### Historical-only freshness and HTTP 402

A configured/valid token does not imply access to the most recent closed options session. On historical-only access, an options session becomes available after the **next exchange-session open (09:30:01 ET)**. Friday quotes can remain unavailable over the weekend. Stock candles have a different cutoff. Do not silently substitute Thursday quotes for Friday or mark an entitlement failure as a `no_data` archive. The backtest is retrospective: it does not simulate account-specific delivery delays or guarantee that a signal could be executed at the next opening price using this plan.

When MarketData returns HTTP 402 with `latest available is YYYY-MM-DD`, the adapter extracts only that validated date, produces a safe explanatory error and exposes `latest_available` / `error_code=history_freshness` on the import job. The UI offers an explicit date-range adjustment; it does not automatically change the request, retry, purchase a plan or spend more credits. Other 402 errors explain plan entitlement/history depth separately from 401 authentication and 429 credit limits. Existing captures survive the failure and Run analysis remains available.

Verified with the user's token on September 12, 2026: one-contract SPY query for September 10 succeeded (203); September 11 returned 402 with latest available September 10. See [official freshness rules](https://www.marketdata.app/docs/account/data-freshness/) and [402 troubleshooting](https://www.marketdata.app/docs/api/troubleshooting/payment-required/).

## Provider and archive

`python/marketdata_provider.py` calls the fixed official host with bearer authentication and rejects redirects. No raw provider error body is returned. `options/chain/{ticker}/` uses `date`, `expiration=all`, expiry `from`/`to`, `nonstandard=false` and Unix timestamps. Omitting `expiration=all` would default to the next monthly expiry. Parallel arrays must align; unexpected pagination is rejected rather than publishing a partial chain.

`stocks/candles/D/{ticker}/` uses **both** `adjustsplits=false` and `adjustdividends=false`, plus `extended=false`. Daily timestamp means New York session date, not the price capture/close instant. Invalid OHLC and missing prices are not filled.

`python/data/marketdata_history.db` stores first-captured raw chain envelopes keyed by ticker/date/import scope and raw prices keyed by ticker/date. Captures are immutable within these keys. A wider scope is a separate capture; analysis records which scope/capture was used. Provider `no_data` is archived as unavailable, never zero exposure. Data revisions upstream may already be present in the first retrieval: this is **not a certified point-in-time/vintage archive**. Corporate actions are not reconciled across ticker renames or adjusted deliverables.

## Reconstruction and levels

Historical MarketData Greeks are unavailable, so `marketdata_model.py` reconstructs IV by bounded bisection (1–500%) from bid/ask midpoint using European BSM. Impossible prices are excluded, never clamped. The rate and continuous dividend yield are user-assumed constants over the window. American exercise, discrete dividends and historical rate curves are not modeled.

Eligibility requires exact standard OCC root/expiry/side/strike identity, nonnegative integer OI above the threshold, positive uncrossed bid/ask within the spread threshold and an update timestamp on that session at or after the XNYS close, no later than 16:15 New York. Expired contracts are excluded without an artificial time floor. Actual expiry and update timestamps determine remaining time. The common spot is the median of eligible row underlying prices; rows deviating over 0.5% are excluded. This rejects obvious disagreement but does not establish simultaneous executable quotes.

OI is the historical provider value available before that session, reflecting preceding settlement, rather than an EOD ownership update. The provider does not supply an exact OI capture timestamp. Modeled OI coverage divides modeled OI by OI in rows passing identity/expiry/minimum-OI filters, before quote/IV checks. This is **filtered-universe coverage**, not exchange-wide completeness; inspect exclusions and raw/modeled counts.

- GEX = call-positive/put-negative gamma × OI × 100 × spot² × 0.01: **USD per 1% underlying move**. The sign convention is a proxy, not observed dealer inventory.
- Walls maximize side GEX at a strike. Max pain minimizes fixed-OI intrinsic payouts **per actual expiry**, with lowest strike winning a tie. Multi-expiry max pain is null.
- Gamma flip is the nearest strict sign crossing on a 401-point 50–150% spot grid, frozen IV/OI, using the same rate/dividend/time inputs. No root means null. Numerical grid interpolation is approximate.
- Vanna exposure is signed delta units per unit IV. Charm is signed delta units per calendar day. Neither is mislabeled as dollar GEX. Contract theta is premium/day and vega is premium per 1 percentage point IV. OI-weighted IV is descriptive, not constant-maturity IV.

## Historical Surfaces replay

History defaults to **Historical Surfaces** after Run analysis. The date selector and previous/next buttons replay saved exchange sessions; **Contracts & data** retains the full-chain inspector. All surface inputs come from the selected historical reconstruction, never live Alpaca levels.

- All / 0 / ≤7 / ≤14 / ≤30 / ≤60 / ≤90 DTE intersect with weekday and actual-expiry filters. DTE is calendar days from the historical reference date, not today. Filters only narrow the last Run analysis universe; a larger pill cannot add unimported contracts. Expired EOD 0DTE remains an explicit empty state.
- The GEX strike chart includes call/put walls, nearest gamma flip, spot and single-expiry max pain. Display-range cropping does not change level calculations. Level labels remain on the domain even outside displayed strikes.
- `POST /surface-levels` accepts the replay Analysis parameters plus `captured_at` and an explicit `expiries` array. It reconstructs the original analysis universe before selecting dates, preserving the common spot, IV, rate and dividend yield. Capture mismatch returns 409, unknown modeled expiry returns 422, and an empty selection returns null exposure/levels. No provider requests or extra credits are used.
- The shared IV renderer provides a 3D surface, 2D heatmap, individual expiry smile, ATM term structure and skew measurements. IV is locally reconstructed European BSM IV. Interpolation stays within common observed strike support, has a bounded mesh and never fabricates missing expiries. One expiry provides a smile/term point; it cannot form a time surface.
- The renderer accepts a minimal `VolatilitySurfaceInput`, so historical records do not pretend to be live snapshots. Memo scope includes historical date, capture, parameters and selected dates. Pending scope requests clear visible levels; aborted responses cannot overwrite a newer selection.
- Export selected levels includes the model version, research parameters, selected expiry dates, capture, GEX profile and per-expiry values. Export full chain and full research remain available separately.

Verification adds `node --test tests/historical-surface.test.cjs tests/volatility-surface.test.cjs tests/option-expiries.test.cjs` and scoped API regression coverage in `test_marketdata_history.py`.

## Backtest chronology

The selected rule is long/cash: positive GEX, negative GEX, or spot above gamma flip. The signal uses session D EOD; entry is **the next XNYS session open**, exit its close. There is no same-close entry. Missing next-session prices are excluded, never replaced by a later available bar. Exchange holidays and early closes come from `exchange-calendars` XNYS. Minimum modeled-contract/OI-coverage filters apply to D. No forward-dependent signal fitting or optimization occurs.

An active session return is close/open − 1 minus the chosen round-trip basis-point cost. Cash has zero cost. Equity compounds from 1 and drawdown includes initial capital. Benchmark goes long at every eligible session's open and exits its close with the same cost. It is an **intraday benchmark**, not continuous buy-and-hold. Gaps are excluded, and the equity curve connects available ledger observations; it does not imply positions during gaps. No options premium P&L, short borrow, option execution, dividends or guaranteed fills are modeled.

Results are descriptive in-sample research; changing thresholds after seeing results creates selection bias. Positive GEX does not inherently predict rising prices. Regime comparison includes signed and absolute next-session open-to-close returns. With a Beta(1,1) prior, positive/negative return counts update P(up); ties are excluded, and zero observations leave the prior unchanged. The 95% credible interval assumes IID Bernoulli outcomes and ignores serial dependence. It is not a calibrated trading forecast or proof of an edge.

## API and verification

All routes use `/api/greeks/marketdata` through the existing Next.js proxy and Greeks API on 8001:

- `GET /status?ticker=SPY`: safe configuration, cached scopes/dates, recent process-local jobs.
- `POST /imports`: `{ticker,start,end,max_dte}`; explicit credit-consuming import.
- `GET /imports/{id}`, `DELETE /imports/{id}`: status/cancel. Foreign browser origins cannot mutate import jobs.
- `POST /analysis`: window plus `min_dte, weekday, rate, dividend_yield, min_oi, max_spread_pct, min_coverage, min_contracts, rule, cost_bps`. Read-only local computation.
- `POST /replay`: same parameters with start=end; full modeled chain for that date.

Run `python -m unittest test_marketdata_history test_greeks_levels test_alpaca_options test_options_workspace`, TypeScript checks, production build and browser UI verification. Unit fixtures must stay in tests/temporary databases and must never populate the user's real archive. The first live import still needs a configured token and successful account entitlement check.

Official sources: [historical option chains](https://www.marketdata.app/docs/api/options/chain/), [stock candles](https://www.marketdata.app/docs/api/stocks/candles/), [timestamps](https://www.marketdata.app/docs/api/dates-and-times/), [authentication](https://www.marketdata.app/docs/api/authentication/).

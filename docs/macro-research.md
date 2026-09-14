# ECO — USD Macro Research

Open `/?view=macro`, or execute **ECO** in the main dashboard command controller. ECO is a local-universe page: it covers USD releases and has its own economic-series selector. `SPY ECO` is intentionally invalid. The global equity ticker does not change the economy being analyzed.

## Runtime and scraper tools

`python/macro_api.py` is FastAPI on **8015**, registered as `macro` in `python/start_servers.py`. The existing `start_dashboard.cmd` starts all 13 APIs and Next.js. For this module alone use `start_dashboard.cmd --only macro,next`. The Next.js `/api/macro/[...path]` route proxies requests; browsers never call the Python port directly.

No extra packages or paid key are required. Existing **HTTPX** downloads public documents with TLS verification, timeouts and a 4 MB response limit. **Beautiful Soup 4** parses HTML tables/archive links. Python's XML parser handles RSS; unexpected entity/DOCTYPE declarations are rejected. No browser challenge bypass, login scraping, or invented data fallback is implemented.

- [HTTPX documentation](https://www.python-httpx.org/quickstart/)
- [Beautiful Soup documentation](https://www.crummy.com/software/BeautifulSoup/bs4/doc/)

## Coverage and semantics

| Source | Content | Limitations |
|---|---|---|
| [Forex Factory weekly export](https://nfs.faireconomy.media/ff_calendar_thisweek.json) | Provider-classified High impact, USD only, explicit offset timestamps, forecast/previous when supplied | Rolling current week, not a historical consensus archive. Actual is often omitted. No manufactured actual. |
| [BEA release schedule](https://www.bea.gov/news/schedule/full) | National GDP and Personal Income and Outlays schedules | Current published schedule; future dates can change. Impact is project-curated. |
| [BEA RSS](https://apps.bea.gov/rss/rss.xml) | Official headlines and published major release records | GDP actual is parsed only from its correctly identified main GDP percent-change field (annualized q/q). The personal-income main field is NOT PCE inflation. |
| [Federal Reserve RSS](https://www.federalreserve.gov/feeds/press_monetary.xml) | Monetary-policy headlines, FOMC statements and minutes | Official releases, not a comprehensive commercial news wire. |
| [FOMC archive](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) | Statement publication links, up to six previous years on the source page | Link dates do not establish release time. Preserve date-only precision. |
| [BLS CPI archive](https://www.bls.gov/bls/news-release/cpi.htm), [employment archive](https://www.bls.gov/bls/news-release/empsit.htm) | Published archive links, up to six previous years | May return 403. The dashboard reports this; no guessed data. Archive values are not scraped from article prose. |
| [FRED downloads](https://fredhelp.stlouisfed.org/fred/data/downloading/using-the-download-data-link/) | Revised economic observation histories for forecasting | Reference periods are not release dates; latest revisions are not first-release vintages. |

Calendar dates/time use source offsets or America/New_York for the BEA schedule, then display in New York, Jakarta or UTC. Unknown times stay unknown. Passing a scheduled time does not prove a release happened or that an actual value is available. Separate provider records can refer to the same economic release: counts are **source records**, not deduplicated market events.

SQLite `python/data/macro.db` stores cached documents, events, observed revisions, official headlines, and forecast snapshots. Do not commit this runtime database. Each change records its local observation time. `first_seen` is not the original publication time and cannot establish historical pre-release consensus. Feed refresh is one hour; HTML schedules/archives one day; FRED six hours. Failed retrievals have a five-minute retry cooldown and visibly marked cached fallback. The combined dashboard is cached for five minutes. Scraping runs on demand while the page is requested; no hidden scheduled automation is installed.

The first working collection on this machine returned 98 release/schedule source records and 62 headlines. BLS returned HTTP 403. These are initial observed counts, not guaranteed ongoing coverage. Existing archives are incomplete; do not describe this as all USD high-impact history or a complete actual/forecast/previous database.

## Surprise Monitor (released actual vs consensus)

The Surprise Monitor tab scores only released USD High-impact observations with compatible actual/consensus units. `GET /api/macro/surprises?window=36&neutral=0.5` reads locally captured provider data plus separately labelled imports. Calendar collection still follows the existing on-demand refresh/cache schedule; Refresh scores recalculates stored pairs and does not bypass source caching or synthesize missing actuals.

- Raw surprise `e = actual - consensus` (percent observations yield percentage-point differences).
- Headline **Surprise Z** is zero-centered standardized surprise `e / s`, where `s` is the sample standard deviation (n−1) of prior surprises. It is not the dispersion of actual levels.
- Separate **bias-adjusted Z** is `(e - mean(prior errors)) / s`. This does not determine the headline label; matching consensus should have zero headline surprise even when historical errors have a nonzero mean.
- Use up to 12/24/36/60 prior releases, minimum 12 valid prior pairs. Group by exact series definition, source and unit. Current, simultaneous and later releases cannot train a score. Missing values, incompatible units and zero historical variance remain **Unscored**, never Neutral.
- Neutral means `abs(Z) <= band`, configurable 0.25/0.5/1. Outside this band, modest <1σ, large 1–<2σ, extreme ≥2σ. Labels say Above expectations / Neutral / Below expectations. These are descriptive thresholds, not significance tests, Bayesian probabilities, USD direction or measured asset returns.
- Captured/imported values may contain revisions or consensus recorded after publication. Chronological exclusion alone does not make these vintage-correct first-release backtests. Do not silently claim pre-release consensus provenance.

The distinction between economic consensus errors and market response is consistent with the [Federal Reserve discussion of macro data surprises](https://www.federalreserve.gov/econres/notes/feds-notes/why-were-treasury-yields-so-stable-over-the-summer-20201229.html). This implementation estimates its denominator only on earlier releases.

CSV imports: `series,date,actual,forecast,unit,source_url`. `date` must be a past ISO release timestamp with UTC offset; `unit` is percent/thousands/count/index/number/bps. Use a stable series definition (e.g. Core CPI m/m), keeping core/headline, m/m/y/y and GDP estimate vintage separate. Percent inputs are 0.3 for 0.3%, not 0.003. K/M/B suffixes normalize counts. Optional currency/impact columns must be USD/High. Source URLs require HTTPS but are not fetched or independently verified. Maximum 1000 rows/1 MB; malformed or duplicate rows reject the whole batch. Preview is read-only. Saving is explicit; imports are stored separately in `surprise_imports`, append revisions on changes and skip identical repeats. The latest imported observation per series/date/unit/source-host is used, without mixing it with provider baselines.

`POST /api/macro/surprises/import` accepts `{csv_text, save:false}` for preview or `save:true` for persistence. All samples must come from the user's sourced history; do not load demonstration data into the production database. Run `python/test_macro_surprise.py` and `vrp-claude/tests/macro-surprise.browser.cjs` when editing this feature.

## Forecast model details: bayes-ar-v1

Editable controls: series, training window (60/120/240 observations), persistence prior strength (0.5/4/16), and a scenario threshold. The model forecasts the **next reference period**. Do not attach it to a calendar release without matching the reference period, definition, seasonal adjustment and estimate vintage. For example, next-quarter GDP is not an estimate of the next second/third revision to the current quarter.

| Key | FRED | Transform / output |
|---|---|---|
| cpi | CPIAUCSL | Monthly percentage change, seasonally adjusted |
| core_cpi | CPILFESL | Monthly percentage change, seasonally adjusted |
| payrolls | PAYEMS | Monthly difference, thousands of jobs |
| unemployment | UNRATE | Rate, percent |
| core_pce | PCEPILFE | Monthly percentage change |
| pce | PCEPI | Monthly percentage change |
| retail | RSAFS | Monthly percentage change |
| gdp | GDPC1 | `100 * ((level/previous_level)^4 - 1)`, quarterly annualized percent |
| claims | ICSA | Weekly level divided by 1000, thousands of claims |

Each training prefix standardizes its own values. Predictors are intercept, lag 1, lag 2 and mean of the previous three observations. The normal/inverse-gamma prior is centered on persistence: coefficients `[0,1,0,0]`; prior precision `diag(0.1, strength, strength, strength)`, shape 3, scale 1 in standardized units. The posterior predictive Student-t includes residual and coefficient uncertainty. Standardization uses a minimum scale of 0.01 to remain numerically defined for flat series. Missing observations remain on the regular period index; only complete consecutive feature/target rows train the model. At least 24 pairs and three consecutive latest observations are required.

The 80% interval is the Student-t 10th/90th percentiles. `P(next > threshold)` is the upper tail of that economic predictive distribution, not a USD/equity directional probability or calibrated trading signal. Predictions are not clipped to make outcomes look plausible; extreme inputs or regime changes can produce poor estimates.

The last up to 48 observations are evaluated sequentially. Every holdout prediction fits only its preceding prefix. Report MAE, RMSE, interval coverage and the same-period persistence baseline. Skill is `1 - model_MAE / naive_MAE`; negative skill means the model performed worse. **Latest-revised series still introduce vintage leakage** relative to a real-time release backtest, even though chronological holdout leakage is prevented. No profitability claim or first-release forecast claim is supported. Use ALFRED vintages and archived pre-release consensus before attempting those claims.

Forecast snapshots preserve model version, input hash, settings, target period and creation time. Scenario threshold changes only the probability query and is excluded from the forecast snapshot identity. `/api/macro/forecast-history?series=core_cpi` exposes captured forecasts; `/api/macro/revisions/{id}` exposes observed event changes.

## Model surprise history and USD scenario labels

**Forecast Lab → Histori surprise model** shows the existing sequential evaluation, most recent first, with actual, internal forecast, 80% predictive interval, raw error and Model Z. This is distinct from the consensus-based Surprise Monitor: it can run on FRED observations without inventing missing economist consensus.

For each preceding-data fit, predictive standard deviation is `s_pred = scale * sqrt(df / (df - 2))` for the posterior Student-t. **Model Z** is `(actual - internal forecast) / s_pred`. Its denominator includes residual and coefficient uncertainty from that period's fit; it is not the sample SD of consensus errors. Updating a holdout actual cannot change that period's forecast or predictive SD. It still uses latest-revised history and therefore is not a vintage-correct release backtest.

Labels are editable descriptive USD scenarios: **Netral** for `abs(Model Z) <= neutral`, otherwise **Bullish USD / Bearish USD** according to the sign of `Model Z * direction`; add **shock** when `abs(Model Z) >= shock`. Neutral choices are 0.25/0.5/1 (default 0.5), shock choices 1.5/2/3 (default 2). Unknown scores remain **Belum dinilai**, never neutral. Defaults invert claims/unemployment and use positive direction for other series. Users can reverse the orientation; these are growth/policy assumptions, not calibrated USD probabilities or measured asset returns. They do not imply a corresponding SPY direction. Exchange-rate responses depend on the announcement and economic conditions; see the [Federal Reserve study of announcement responses](https://www.federalreserve.gov/econres/ifdp/the-high-frequency-response-of-exchange-rates-and-interest-rates-to-macroeconomic-announcements.htm).

Filters, a recent 24-period bar chart, and CSV export use the selected scenario. Exports preserve thresholds, orientation, model errors and input hash. **Forecast tersimpan** separately displays actual saved snapshot creation times, target periods, model settings, source timestamp and source-cache status. Reconstructed evaluation rows are never presented as forecasts historically published by this app. A saved timestamp alone does not prove a forecast preceded an official release.

**Refresh data FRED** requests `/forecast?...&refresh=true`, bypassing the usual six-hour cache/five-minute failure cooldown subject to a 30-second minimum interval. Same-source requests are serialized within the API process. HTTPX retries transient transport failures once; HTTP status failures such as 403/429 are not retried. Cache timestamps and failures stay visible until a successful retrieval. Refresh changes the data snapshot only if the provider succeeds; it does not fix unavailable first-release vintages.

When editing, run `python/test_macro.py`, `tests/model-surprise.test.cjs`, and `tests/model-surprise.browser.cjs` as well as the relevant existing macro regressions. Browser fixtures must not be written into the production database.

## Macro Event Reaction

**ECO → Event Reaction** joins captured USD High-impact timestamps (including sourced Surprise Monitor imports) to Yahoo Finance five-minute prices. `/api/macro/reactions` accepts allowlisted `symbol`, optional `event_id`, `series_filter` (exact source/title/unit key), `surprise` (all/above/neutral/below/unscored), `horizon` (5/30/60/1440), `band` (0.05/0.1/0.25/0.5 percent), and `refresh`. Invalid assets/settings return 422; an unknown selected event returns 404. The app uses the existing macro proxy and API registry, with no new terminal code.

Assets: SPY, QQQ, GLD (gold ETF proxy), UUP (USD bullish ETF proxy), TLT (long Treasury ETF), BTC-USD. GLD/UUP are not spot gold/DXY. yfinance requests the previous 59 days, 5m, `prepost=True`, `auto_adjust=False`, `back_adjust=False`, `repair=False`, `actions=True`; prices may be delayed and intraday coverage incomplete. See [yfinance PriceHistory parameters and intraday limits](https://ranaroussi.github.io/yfinance/reference/yfinance.price_history.html). Do not replace missing intraday data with daily prices or manufactured ticks.

Yahoo bar timestamps are treated as interval starts; the close is available at start + 300 seconds. Incomplete bars are excluded. For event time t, baseline is the last completed close at/before t, with strictly less than 300 seconds lag. Horizon endpoints follow the same rule at t + horizon, after that target time has elapsed. Return is `(endpoint / baseline - 1) * 100`. +1440 means **24 wall-clock hours**, including weekends, not next-session close. Missing baseline, unknown release time, market closures, unfinished horizons, and reported stock splits crossing the measurement window remain unscored with explicit reasons. Replay covers −30 minutes to the selected horizon; gaps are not connected or filled. Prices are provider price returns, not dividend total returns or net trading P&L.

Historical source records without actuals may still have measured price responses after their scheduled timestamp: these say **Jadwal berlalu; actual belum terverifikasi**, not confirmed publication. Date-only events remain time-unknown. We do not join FRED reference-period model forecasts to calendar events without a verified definition/vintage match. Consensus Z comes from the existing prior-error calculation, with 0.5 neutral band; missing consensus is preserved. The scatter plot pairs only valid consensus scores and horizon returns. The source-series filter prevents accidental pooling of definitions when selected. Other source records at the same timestamp and through the selected horizon are displayed as possible confounders; the calendar cannot identify every market influence.

Reaction labels describe the selected asset: small if `abs(return) <= band`; sustained up/down when both 5m and selected-horizon returns exceed the band with matching signs; reversal up/down when both exceed the band and signs differ. A 5m selected horizon has a simple up/down label. These are editable percentage rules, not statistical shock significance or USD-scenario labels.

Summary deduplicates equal UTC timestamps within current series/surprise filters. It reports sample count, median, small reactions and (minimum five unique timestamps) a Beta(1,1) posterior for positive versus nonpositive returns, with an 80% equal-tail credible interval. This descriptive model assumes independent, stable Bernoulli outcomes; overlapping windows and heterogeneous releases can violate that. It is not a calibrated next-trade probability or a causal effect estimate. Table search only filters visible/exported rows; the summary follows the controls above the table.

`reaction_prices` in macro.db caches the allowlisted price payloads, per-close capture times, splits, fetch time and failure. Normal refresh is 15 minutes, failure cooldown five minutes, explicit refresh at least 60 seconds. Per-symbol locks coalesce concurrent fetches. Successful downloads merge into captured history (latest valid provider value wins), retaining at most 200,000 closes per asset. This preserves collected intraday prices beyond the provider's rolling window; it does not reconstruct earlier unavailable prices or retain every price revision. Failed downloads preserve the previous payload with a visible stale status. Per-price capture times and return sampling times are exported. A source refresh timestamp is not the capture date of every archived close. Up to 500 latest captured source records are evaluated, keeping missing-price records visible.

Tests: `python/test_macro_reaction.py` verifies completed-bar alignment, timezone offsets, no future sampling, missing sessions, split boundaries, label rules, timestamp deduplication, Bayesian summary, caching and archive preservation. `vrp-claude/tests/macro-reaction.browser.cjs` verifies filters/replay, missing data, source errors, CSV, asset selection and responsive layouts. Fixtures must not be inserted into the live database.

## Extension contract for AI agents

1. Add actual data adapters to `python/macro_sources.py`; use fixed allowlisted source URLs, explicit units/timezones, bounded requests and visible failures. Never accept arbitrary URLs from browser input.
2. Add economic series to `macro_model.SERIES` and keep the frontend selector in `components/macro/macroData.ts` synchronized. Test transform units and missing-period behavior.
3. Version changes to features/priors/forecast meaning. Preserve previously stored forecasts and revision records.
4. Keep market consensus, internal predictions, latest revised observations and published actuals distinct. Never fill a missing actual with previous/forecast, nor infer historical consensus.
5. New calendar sources may have different definitions of impact. Preserve the classification source. Do not fabricate Bayesian probabilities from prose sentiment.
6. Main command registry remains `app/lib/terminal/commands.ts`; read the portable terminal guide before changing codes.

## Verification

```powershell
.\python\.venv\Scripts\python.exe python/test_macro.py
cd vrp-claude
node --test tests/terminal-commands.test.cjs
npm run build
node tests/macro.browser.cjs
```

The browser test uses deterministic provider fixtures for interaction/navigation, errors, filters, timezones, model settings, CSV and 320/768/1024/1440 layouts. Keep a separate live smoke check through the Next.js proxy. Inspect screenshots instead of relying only on DOM assertions.

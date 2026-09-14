# The Greeks: ETF constituents and RV vs VIX

Open The Greeks (`GEX`) and select **ETF constituents** or **RV vs VIX**.
Both research panels work without a successful main options snapshot.

## ETF constituents

Supported ETF choices: SPY, QQQ, IWM, DIA, XLK, SMH, XLF, XLE. Yahoo fund top
holdings supply actual weights; these are not normalized to 100%. The UI reports
coverage. This feed does not expose a reliable effective date for the holdings;
retrieval time must never be presented as that date. Missing holdings fail visibly.

Returns use adjusted daily closes, excluding the current US date. Beta and
correlation use the latest 20/60/120 valid paired return observations. Both start
and end dates must agree; prices are not forward-filled. Fewer than 20 pairs or
zero variance produces unavailable metrics. Relative performance uses stock
growth divided by ETF growth minus one over 20 common closing intervals.

**Compare GEX** loads only the ETF and the clicked stock, independently. Net/gross
GEX is converted from the existing engine's billions-based spot-gamma scaling to
USD delta exposure per 1% move by multiplying by 1e7. Each underlying's shock is
separate. Never multiply ETF GEX by a constituent weight and call the result the
stock's own GEX. The engine uses call-positive / put-negative signs, a positioning
proxy rather than observed dealer inventory. Synthetic/mixed results are excluded.
Timestamps, stale-cache state, gamma flip and net/gross balance are displayed.

The options exposure source is now Alpaca, with an explicit indicative/OPRA feed label and propagated provenance; see [Alpaca migration](alpaca-options-migration.md). Indicative quotes are modified and must not be described as executable OPRA prices. Holdings and the daily return/index research described here retain their own Yahoo source.

## RV vs VIX

The benchmark is always the **S&P 500 price index (^GSPC)** and **Cboe VIX (^VIX)**,
regardless of the main ticker. VIX measures SPX-option-implied 30-calendar-day
variance on an annualized volatility scale. It is not NVDA implied volatility,
VIX futures, or a one-day volatility forecast.

For `r_i = log(P_i/P_(i−1))`, the daily-close realized-variance proxy is:

- RV on a 30-day scale: `100 * sqrt(sum(r_i²))`.
- Annualized RV: `100 * sqrt(365/30 * sum(r_i²))`.
- VIX on a 30-day scale: `VIX * sqrt(30/365)`.

Return **close dates** belong to `(t−30 calendar days, t]` for trailing RV, or
`(t, t+30 calendar days]` for subsequent RV. No demeaning, no 30-trading-day
substitution, and no mixing 252-day scaling with the selected calendar-day
variance convention. A 30-day window commonly contains about 21 trading returns.

This is explicitly a **daily-close proxy**: a boundary return is not split if
its previous close precedes the window boundary. Weekend/holiday returns are
observed at the next close. It is not continuous realized variance, an intraday
RV estimator, or an exact variance-swap payoff. Missing prices and intervals
longer than four calendar days invalidate affected windows. Index holidays of
up to four days are allowed; no synthetic bars are inserted.

**Historical context** compares backward RV with forward VIX. Its spread is
descriptive and must not be labeled a forecast error or an expected profit.
**Forward evaluation** aligns subsequent RV back to the VIX observation date;
values stay null until supplied SPX history reaches the target date. If a target
falls on a weekend, publication conservatively waits until a subsequent observed
close establishes that the window elapsed; returns after the target are excluded.

The data source is Yahoo daily closes, excluding the current New York date. SPX
and VIX timestamps are matched by session date, without forward fill; publication
times can differ, so this is not an executable simultaneous quote comparison.
Refresh rereads the backend's 15-minute cache. Source dates and retrieval time are
visible. Unit switching scales both lines identically. CSV retains annualized
percent and explicitly includes the horizon and future target dates.

Evaluation summaries use all matured origins in fetched history; chart history
filters do not change those summary statistics. Windows overlap, so the sample
count is not the number of independent observations. The mean of VIX² minus
subsequent RV² is a descriptive implied/realized variance gap in vol-point²,
not a calibrated posterior probability or trading strategy P&L.

References: [Cboe VIX methodology](https://cdn.cboe.com/resources/vix/VIX_Methodology.pdf),
[Cboe explanation of VIX versus VIX1D](https://www.cboe.com/insights/posts/what-the-vix-and-vix-1-d-indices-attempt-to-measure-and-how-they-differ/).

## Code and verification

- Pure math: `python/greeks_research_math.py`.
- Provider/cache/router: `python/greeks_market_research.py`, registered in `greeks_api.py`.
- Endpoints: `/api/greeks/rv-vix`, `/api/greeks/etf-constituents`, `/api/greeks/constituent-exposure`.
- Existing Next.js Greeks catch-all proxy forwards to port 8001.
- UI: `RvVixPanel.tsx`, `EtfConstituentPanel.tsx`, `ResearchPanelShell.tsx`.
- Run `python python/test_greeks_market_research.py` using the project environment.
- Run `node tests/greeks-research.browser.cjs` in `vrp-claude` with Playwright/Chrome
  and port 3000 available, plus the normal TypeScript/build checks.

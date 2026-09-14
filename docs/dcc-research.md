# DCC Correlation workspace

Terminal code **DCC** remains page-managed: select a 2–12 ticker Yahoo basket in the module. Active backend: `python/correlaction/api.py` port 8004, `run_copula_model_api` in `copula_model.py`; `modeldcc.py` is an older standalone implementation, not the routed engine. Use the shared launcher `start_dashboard.cmd --only correlation,next`.

## Research workflow

1. Choose a basket and sampling mode; click **Run analysis**. Typing, presets and tabs never refit automatically.
2. Click a matrix cell to inspect the pair's DCC and rolling Pearson history. Negative correlations remain visible on a fixed −1…1 axis. Drag chart range handles to zoom.
3. Pair radar ranks the latest correlation or absolute change over a configurable 10–120 **matched-bar** window. Search filters the table only.
4. Joint extremes reports every pair, residual lower/upper conditional co-exceedances and event counts, plus a Beta posterior with its assumptions.
5. Exposure Lab compares always-invested and adaptive equal-weight baskets. Set the correlation threshold, defensive exposure and aggregate turnover cost under Research controls, then rerun.
6. Export pairs CSV or full response JSON for an agent/research record. JSON contains methodology, run settings and fit diagnostics. CSV is a compact pair summary, not the complete research record.

## Data and estimation

- Yahoo adjusted close, exact intersection of available timestamps, no forward filling. All requested assets must have valid data and converged GARCH fits; no silently dropped tickers.
- At least 101 common prices (100 returns), and sufficient history for the chosen comparison window. Common-price alignment can create returns spanning missing sessions; a matched bar is not necessarily a uniform wall-clock duration.
- Daily prices from different exchanges have non-synchronous closes. Mixed-currency assets are compared using local-currency returns; simulated equity is in model units, not an FX-converted USD portfolio.
- Current download end is the current local calendar date, exclusive. The last downloaded observation is exposed, not advertised as real time. Intraday timestamps are bar starts; there is no exchange-calendar/completed-bar guarantee.
- GARCH(1,1), constant mean, normal innovations, percent log returns. Each fit must converge and generate finite standardized residuals. DCC parameters constrained nonnegative with a+b≤0.998; failed optimization is an error, not a fallback estimate. A 1e−8 diagonal numerical ridge regularizes Qbar.
- Correct DCC recursion: R[t] depends on z[t−1], not z[t]. All GARCH parameters, Qbar and DCC parameters still use the complete sample. This is **in-sample descriptive estimation**, not online filtering with fixed past-only training or a walk-forward backtest.
- Rolling Pearson uses log returns including its current bar. Each displayed DCC value is a conditional model estimate, so the two series need not agree.
- Matrix / pair summary uses all observations. Response history is capped to the last 1,000 bars, HMM history to 500. Exports preserve these limits explicitly.

Reference: [Engle (2002), Dynamic Conditional Correlation](https://doi.org/10.1198/073500102288618487).

## Exposure simulation

Equal-weight **simple returns**, rebalanced per bar, compound from 10,000 model units. Cash returns zero. Target exposure is defensive when average DCC exceeds the editable threshold OR more than half the basket's current standardized residuals fall below expanding past-only 10th percentiles (minimum 60 past observations). The entire target is lagged one bar. First exposure is 100%.

One-way cost in bps applies to initial entry and absolute aggregate exposure turnover. It excludes internal equal-weight rebalancing costs, final liquidation, financing, taxes and slippage. Drawdowns include initial capital in the running peak. Do not label the equity difference “strategy edge” or the basket “buy and hold”; model estimation uses the full sample even though exposure signals lag.

## Empirical tails and HMM

Full-sample standardized-residual ranks are rank/(T+1). Lower-tail statistic is P(rank_left≤0.1 | rank_right≤0.1), with success and conditioning counts. Upper tail uses ranks≥0.9. These are finite-threshold conditional frequencies, **not fitted Clayton/Gumbel/Student-t families** or asymptotic lambda coefficients. Legacy `copula_details.best_fit` is null; new UI uses `research.pairs`.

Beta(1,1) prior updates to Beta(k+1,n−k+1), displaying mean and central 80% interval. This descriptive binomial model assumes independent events. Serial clustering, fitted residual uncertainty and sample selection are not included; small tail counts are flagged. It is not a crash forecast. Under independent residual series, the finite-threshold reference is approximately 10%, not zero.

HMM standardizes log basket return, 5-bar rolling volatility and DCC mean correlation before fitting. State labels rank observed mean returns; they do not imply positive/negative returns, volatility ordering, or trade instructions. Historical posteriors are full-sample smoothed. Unpopulated states and nonconverged fits degrade to an explicit HMM error; DCC results remain usable. Legacy vol-stress proxy is −3 × mean per-bar vol × sqrt(20), not a predicted maximum drawdown.

## API and verification

`POST /api/dcc/run`: tickers, mode (1–4), window (10–120), threshold (−1…1), defensive (0…1), cost_bps (0…100). Default: daily / 20 / 0.65 / 0.1 / 5. Synchronous handler runs outside the event loop; process-local nonblocking lock rejects concurrent fits with HTTP 409. The browser cancels waiting after 180 seconds; cancellation does not terminate the Python fit. Run with one backend worker for this concurrency policy.

Validation: `python/.venv/Scripts/python.exe python/test_dcc_research.py`. Deterministic tests mock downloads and DB writes. They cover causal recursion given fixed parameters, constrained SPD matrices, signal lag, simple compounding, first-period drawdown, transaction costs, pair tail counts, API validation, missing-asset errors and response serialization.

Legacy persisted runs do not contain v2 diagnostics and must not be presented as corrected research. New complete metadata lives in the response/JSON export; the existing summary/timeseries SQLite schema is retained.

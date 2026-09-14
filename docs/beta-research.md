# BETA — market sensitivity research

The existing terminal code `BETA` opens `?view=beta`. The page manages its own asset and benchmark basket; the terminal's global ticker does not override this multi-instrument configuration. Python `beta_api.py` serves version 2 on 8012 through the existing Next.js proxy. Start with the shared launcher; do not launch duplicate services.

## Workflow

Enter one Yahoo asset and one to four comma-separated benchmarks, choose history, rolling observations and annualization, then **Run analysis**. Typing or switching tabs does not request data. All returned benchmarks can be inspected locally. Unsaved input changes and failed refreshes leave the previous result explicitly identified. CSV exports the comparison; JSON exports full analysis, parameters, observations and source metadata.

The workspace includes common-sample comparison, OLS scatter, rolling confidence bands, separate up/down regressions, an interactive scenario, largest residual observations, and methodology/provenance. These are descriptive tools, not trade signals.

## Data contract

- Yahoo adjusted daily close (`auto_adjust=True`), latest-adjusted observations. Exclude the current UTC price date conservatively to avoid partial bars; this is not an exchange-calendar validation.
- Sort, deduplicate, reject nonpositive/nonfinite prices and require every requested symbol. Intersect price dates across the entire basket without filling, then compute simple returns. Minimum 31 common prices / 30 returns.
- Every benchmark shares the same return dates and asset observations. Changing the basket can therefore change the fitted sample. Missing sessions may produce multi-session returns. Cross-market closes are not simultaneous; prices remain in local quote units and returns are not currency-hedged.
- Record retrieval timestamp, price/return dates and excluded rows. No cache or vintage-correct historical evaluation is claimed.
- API scatter, fitted values and residual events are percentage points. Model returns, intercepts, volatilities, residual quantiles and `market_range` are fractions. Beta is unitless. Preserve this unit boundary.

## Estimation

`r_asset = intercept + beta * r_benchmark + residual` uses OLS with an intercept. Returns are not risk-free-adjusted. The intercept must **not** be called Jensen alpha, and the scatter line is the **characteristic line**, not the security market line. R² describes in-sample linear fit, not causal attribution or forecast accuracy. A constant asset has beta zero but undefined R²/correlation; an invariant benchmark cannot identify beta.

Main and rolling intervals use statsmodels Newey–West HAC covariance, 5 matched-observation lags, finite-sample correction and an asymptotic Normal 95% interval. HAC does not fix missing/irregular dates or model misspecification. Rolling windows include their labelled ending observation and require the entire configured window. Null estimates remain null. Beta = 1 is unit sensitivity to the benchmark, **not market neutrality**.

Up/down models condition on positive/negative benchmark returns. Each gets its own intercept, HC3 covariance and minimum 20 observations. Zero benchmark returns are excluded. This is sign-conditioned sensitivity, not a tail copula, downside protection guarantee, or evidence of significant asymmetry from comparing point estimates alone.

Annualization is explicit: 252 or 365 sessions. Volatility uses sample standard deviation × square root of the convention; annual intercept uses arithmetic multiplication. Neither is a forecast or compounded return. Beta is invariant to this display convention.

Approximate Bayesian shrinkage uses beta ~ Normal(1, 1²), and beta_hat conditional on beta ~ Normal(beta, estimated HAC SE²). The displayed posterior treats the estimated SE as fixed and is not a full Bayesian time-series model. Keep its prior visible.

## Scenario and residuals

Scenario input is one matched-observation benchmark return in percent. Response = daily intercept × 100 + beta × input. Display the beta contribution separately. The scenario also adds the unconditional full-sample residual P10/P90 as descriptive dispersion, **not a calibrated prediction interval or VaR**. Warn when the input lies outside the observed benchmark return range. It does not incorporate future regime change or parameter uncertainty.

Residual events rank absolute full-sample residuals. They are unexplained by this particular model, not necessarily company-specific shocks. Do not attach news causality or retrospective trade performance to these observations.

## Verification

Run `python/.venv/Scripts/python.exe python/test_beta_research.py` from the repository root. Tests cover known slopes, inverse sensitivity, correct rolling alignment, insufficient/degenerate samples, common-date alignment, missing symbols, annualization invariance, self-benchmark and API validation. Then run frontend TypeScript/build checks and exercise live analysis, benchmark switching, scenario, exports, error states and responsive widths.

## References

- [statsmodels HAC covariance](https://www.statsmodels.org/dev/generated/statsmodels.stats.sandwich_covariance.cov_hac.html)
- [Federal Reserve: HAC estimation with missing observations](https://www.federalreserve.gov/econres/ifdp/nonparametric-hac-estimation-for-time-series-data-with-missing-observations.htm)
- [statsmodels prediction results](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLSResults.get_prediction.html)

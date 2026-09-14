# Greeks surfaces and actual-expiry levels

The Surfaces tab shares one weekday/date selection across its IV surface, GEX profile, walls, gamma flip and per-expiry max pain table. Contracts and Strikes also offer weekday/date selection. Dates are discovered from eligible Alpaca rows; no synthetic Monday/Wednesday expiries are created. Some stocks have these listings; others do not. Empty inventory can also mean listed contracts failed quote/IV/OI eligibility, not that the exchange has no listing.

The restored compact layout includes All / 0 / 1 / 7 / 14 / 30 DTE buttons alongside weekday/date filters. These use existing API buckets and intersect with the weekday selection; they do not reinterpret buckets as exact-day expiries. Missing 0DTE stays an explicit empty state. The GEX and skew panels sit side by side above the 3D surface. Gamma flip is shown in the level strip and as a labeled chart line; the x axis includes valid selected levels even when displayed contract strikes are cropped. A matching unfiltered bucket can show its captured gamma flip while the scoped API loads; no other-expiry fallback is permitted.

`python/greeks_levels.py` is the scoped numerical adapter; `GET /api/greeks/levels?ticker=NVDA&expiries=2026-09-14,2026-09-16&snapshot=<timestamp>` deduplicates by expiry/type/strike and rejects absent dates. Optional snapshot mismatch returns 409 so a chart never silently combines captures. Existing `/maxpain` adds `by_actual_expiry` while preserving its legacy bucket keys.

- GEX uses the existing call-positive/put-negative convention and 100-share standard multiplier. Legacy `gex_spotgamma` is multiplied by **1e7** to express USD per **1% spot move**. Walls maximize aggregated side GEX at a strike over the selected expiries, before display cropping. These are different from the Overview's largest-OI strikes.
- Gamma flip is the nearest sampled sign crossing of repriced BSM gamma at fixed IV/OI over 50–150% of spot. No crossing means **null**, not a boundary or nearest-expiry substitute. Exact grid zeros require a sign change. Multiple crossings are possible. Search resolution and frozen inputs are approximations.
- Max pain minimizes total fixed-OI call/put intrinsic payout at one settlement date. Empty/missing/zero OI gives null; equal minima choose the lowest strike. Multi-expiry buckets give null and individual dates have separate values. Payout search uses cumulative weights, avoiding repeated DataFrame scans.
- All levels use **eligible filtered inventory**, not complete listed OI. They are descriptive model statistics, not observed dealer positions or price predictions. IV/local BSM, indicative quotes, IEX spot and dated OI need not be synchronous; American early exercise/dividends are not modeled by European BSM.
- Surface interpolation is unchanged: actual expiries, shared observed strike support, no extrapolation, finite bounded grid. An explicit memo scope key redraws when expiry selection changes even if snapshot timestamp stays constant. A single expiry has a smile/slice; a time surface needs at least two dates. IV side/OI controls only filter the IV visualization.

The September 2026 fix applies to newly computed snapshots. Historical archives are not rewritten and older saved gamma flip/max pain observations may retain the previous conventions.

Verification: `python -m unittest test_greeks_levels test_alpaca_options test_options_workspace`, frontend `node --test tests/option-expiries.test.cjs`, TypeScript and production build. Live NVDA inventory verified Monday September 14/21 and Wednesday September 16/23, 2026.

Listing reference: [Nasdaq: new options expiries](https://www.nasdaq.com/newsroom/nasdaq-lists-new-options-expiries-what-means-and-why-it-matters).

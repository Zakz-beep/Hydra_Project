# Volatility term structure rendering

The old surface combined every observed strike into one axis and inserted nulls wherever a bucket lacked that strike. The saved SPY fixture produced 150 empty cells out of 915. Its three time rows represented DTE buckets, although the chain contained fourteen actual expiries. Fresh inline Plotly data/layout/config objects also caused an unrelated auto-refresh toggle to redraw the surface.

The replacement groups contracts by their actual expiry and DTE, deduplicates expiry/strike/type, and builds OI-weighted strike IVs after the selected side and OI filters. The default uses out-of-the-money puts below spot and calls above spot to reduce the influence of deep ITM quotes. Invalid IV, strike, OI and DTE values are excluded. A user can choose all options, calls only or puts only.

The grid uses shape-preserving cubic Hermite interpolation in strike and then DTE. It is restricted to the intersection of observed strike coverage and the selected spot range. It does not extrapolate or insert zero IV. At least two expiries, each with at least two distinct valid strikes, are required; sparse or disjoint data gets an explanation instead of a fabricated surface. Interpolated values are labelled as estimates, and observed strike IVs remain visible in the expiry smile panel. This is visual interpolation, not an arbitrage-free financial calibration.

Rendering changes:

- Stable, memoized Plotly data/layout/config and snapshot identity prevent redraws for unchanged cached snapshots or unrelated UI controls.
- The grid is bounded at 96 × 48 vertices (Smooth) or 48 × 24 (Lightweight), independent of chain size.
- Only the Plotly core, surface and heatmap modules are registered. Pixel ratio is 1 and projected contours are disabled.
- Camera state survives new snapshots through `uirevision`; Reset view deliberately resets it.
- The heatmap offers a 2D alternative, including when 3D rendering fails.
- The existing 2D skew chart now uses the snapshot's actual bucket keys instead of hard-coded 0/1/7 buckets.

Analysis controls include strike range, option side, minimum OI, expiry smile selection, ATM IV by actual expiry, 95%-minus-105% strike IV skew in percentage points, and back-minus-front ATM IV. A table exposes the underlying expiry values. ATM and wing readings remain unavailable outside that expiry's observed support.

## Verification

From `vrp-claude`:

```powershell
node --test tests/greeks.test.cjs tests/volatility-surface.test.cjs
npx tsc --noEmit
npm run build
```

Stop the development server before building; Next.js uses `.next` for both by default. `tests/volatility-surface.browser.cjs` uses Playwright from the configured runtime and installed Chrome. Set `NODE_PATH` if needed; optionally set `GREEKS_SURFACE_FIXTURE` to a saved snapshot JSON file to rerun with real snapshot structure. Default fixtures are explicitly synthetic.

Twelve unit/regression tests passed. Browser tests passed on synthetic and saved SPY data: finite surfaces, no redraw on unrelated control changes or unchanged cache refreshes, camera persistence/reset, heatmap, expiry selection, quality/range/OI controls, empty data, and widths 320/768/1024/1440. No browser exceptions were recorded.

TypeScript and the production build passed. Static page generation logged a non-fatal sandbox network fetch warning, and the build completed with exit code 0. The development preview was restarted after the build.

On the same saved SPY fixture, the new grid has zero empty cells and unrelated-control redraws fell from one to zero. A warmed local 30-run measurement of grid construction recorded median 3.7 ms and p95 9.0 ms. These measure data preparation and redundant rendering, not a guarantee of frame rate on every GPU. Screenshots and measurement artifacts are in `.ua/runtime/vol-surface-*`.

References: [PCHIP shape preservation and derivative formulas](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html), [Plotly UI revision](https://plotly.com/javascript/uirevision/), [Plotly surface attributes](https://plotly.com/javascript/reference/surface/). The installed `react-plotly.js` README documents the object-identity update behavior.

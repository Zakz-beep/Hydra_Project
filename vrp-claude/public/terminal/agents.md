# VRP Terminal — AI guide for function codes, tickers and pages

Applies to Codex, Antigravity and any AI editing this repository. Read the root `agents.md` first. This document is the portable source of truth for the MAIN dashboard controller. Download it from **Functions → AI extension guide .md**. Last updated: 2026-09-06.

## Architecture and entry points

- `app/lib/terminal/commands.ts`: the single function registry, parser, ticker normalization, search and URL conversion. Pure TypeScript; no React or browser APIs here.
- `app/lib/useTerminalNavigation.ts`: executed state vs draft, browser history, recent commands and favorites. Never put data fetching here.
- `app/components/bloomberg/BloombergHeader.tsx`: command combobox, Back/Forward, pins, copy link and module refresh.
- `app/components/bloomberg/BloombergHelpModal.tsx`: searchable directory generated from the registry, native dialog, keyboard focus and guide download.
- `app/components/bloomberg/TerminalController.module.css`: scoped visual system for the controller and directory.
- `app/components/bloomberg/TerminalChartPage.tsx`: resolves GP instruments through the actual Hyperliquid discovery API; passes the instrument to Chart Studio.
- `app/page.tsx`: mounts exactly one matching page after URL initialization; connects global tickers to page props.
- `/terminal` is also a standalone Chart Studio route. Main dashboard GP uses `/?view=gp&ticker=SPY`.

## Commands and ticker semantics

`AGT` opens Agent Center (`/?view=agent-center`), a local-universe MCP connection/skills/task inbox page. No ticker argument. Its `agenthub` API runs on loopback 8016 through the Next.js `/api/agent-center/*` proxy. Existing `AI` still opens Quant Agent chat. Read root `docs/agent-center.md` for the data gateway and task-lease contract.

`ECO` opens Macro Research (`/?view=macro`): USD high-impact calendars, release archives, official news and editable internal economic forecasts. It is a local-universe page; run ECO without an equity ticker. The economic-series selector lives in Forecast Lab. Backend `macro` uses port 8015 through `/api/macro/*`; methodology and source limitations live in root `docs/macro-research.md`.

Supported forms: `SPY GEX`, `GEX SPY`, `GEX`, `SPY`, optionally a trailing `<GO>`. Codes, aliases and ticker input are case-insensitive. Unknown single words are ticker candidates, not guaranteed available securities. The destination data source determines actual availability. Unknown two-word functions, extra terms, invalid symbols and incompatible page/ticker combinations must show an error without navigating or changing history.

Global ticker pages: VRP, GP, GEX, VOL, RISK, AI. They consume a controller ticker. VOL seeds the model input and sends ticker edits back to the controller when its debounced analysis runs. Other pages manage their own instrument or portfolio inputs: run `COT`, `DCC`, `HRP`, etc. Never display a global ticker as the analyzed security on these pages.

`GP` conventions:

- `TSLA GP`, `BBRI.JK GP`, `BTC-USD GP`, `^VIX GP` select Yahoo Finance symbols.
- `BTCUSDT.P GP` discovers the active Hyperliquid BTC perpetual.
- `xyz:TSLA GP` discovers that exact HIP-3 venue.
- `TSLAUSDT.P GP` is a SEARCH ALIAS, not an API coin and not a declaration of USDT collateral. Resolve via `/api/chart-studio/search?provider=hyperliquid&q=...`. If several venues match, let the user select. Never arbitrarily pick the first venue.
- Preserve canonical names (`xyz:TSLA`), including lowercase venue prefix. Pass returned `Instrument.provider`, `symbol`, `venue`, and `collateral` unchanged to market data code.
- Do not route perpetual tickers into Yahoo options/VRP models. The user must choose the underlying (e.g. `TSLA GEX`).
- Plain `BTC GP` means Yahoo's BTC symbol, not an inferred Hyperliquid coin. Use the perpetual alias or the Chart Studio provider picker explicitly.
- A symbol equal to a registered function code is ambiguous in two-word commands. Do not silently guess a provider or function. Use the destination page's symbol picker for those securities.

A new ordinary Yahoo ticker does NOT need a new registry entry. The registry describes FUNCTIONS, not a hand-maintained security list. Hyperliquid securities must come from discovery; to change aliases, update and test `app/lib/chart-studio/hyperliquidCatalog.ts`.

## Add a new page/function correctly

Example requirement: an earnings page with `ERN` code and a global equity ticker. This is a recipe, NOT an implemented ERN feature.

1. Implement the actual page component and its real data path first (e.g. `app/components/earnings/EarningsDashboard.tsx`). Show loading, empty and error states. Use the project's Next.js API proxy conventions and existing backend ports. Cancel or ignore stale responses when the ticker changes.
2. Add `'earnings'` to `TerminalPage` in `commands.ts`.
3. Add ONE registry entry:

```ts
{
  code: 'ERN', page: 'earnings', label: 'Earnings',
  description: 'Upcoming reports and earnings history',
  group: 'Research', aliases: ['earnings-calendar'], ticker: 'global',
}
```

4. Add the actual import and matching renderer inside the `nav.ready` section of `app/page.tsx`:

```tsx
{nav.activePage === 'earnings' && (
  <EarningsDashboard
    key={`${nav.activeTicker}-${nav.executionTimestamp}`}
    ticker={nav.activeTicker}
    onTickerChange={nav.setTicker}
  />
)}
```

The component must accept/use those props; adapt to its real interface. If it manages a portfolio/universe internally, use `ticker: 'local'`, omit the ticker props, and document how users choose instruments inside it. Do not claim global-ticker support with a label while the component silently uses SPY or AAPL internally.

5. Registry-driven tabs, search, directory, parser and URLs now pick up the entry automatically. Do not add duplicated arrays to the header/footer. All code, page and alias identifiers must be unique case-insensitively across different entries. Keep names stable so saved links and favorites remain valid; add aliases for renamed pages.
6. Extend command unit tests and browser tests. Verify the new page really mounts, its request uses the commanded ticker, refresh works, and Back/Forward + reload restore the destination.
7. Update this guide and root project memory if conventions change. Do not require users to approve ordinary reversible implementation changes already requested.

## Navigation and storage contracts

- The draft may change without fetching. Only execution changes the active page/ticker.
- Use `nav.executeCommand`, `nav.switchPage`, `nav.setTicker`; do not introduce a second navigation state.
- Executing the current destination is idempotent: no duplicate history and no remount. `nav.refresh()` explicitly increments a revision for reloading a module.
- Buttons and browser Back/Forward share History API entries identified by `vrpTerminalId`. Preserve Next.js fields in `window.history.state` when writing your marker. New navigation after Back discards forward entries.
- URL uses `view` and `ticker` and preserves unrelated query parameters. Legacy `view=greeks`, `view=lwc`, `view=volatility` aliases remain supported. URL state wins over saved preferences.
- Preferences: `localStorage['vrp.terminal.commands.v1']`, bounded to 12 recent and 12 pinned commands. Session trail: `sessionStorage['vrp.terminal.commands.v1.history']`, bounded to 500. Validate restored objects; blocked/corrupt storage must not break navigation.
- No fake quotes, fabricated live status, hardcoded market tape or unsupported function-key hints. Actual feed status belongs to each data page.
- Shortcuts: Ctrl/Cmd+K or `/` focuses commands, F1 opens the directory, arrows select suggestions, Enter executes, Escape closes. Respect text editors, contenteditable, selects and open dialogs; do not hijack F11/fullscreen or F12/devtools.
- Keep Watermark and HD export callbacks compatible. Chart Studio has its own HD control. Do not change the user's page silently when they request export.

## Verify before delivering

From `vrp-claude`:

```powershell
node --test tests/terminal-commands.test.cjs
npx tsc --noEmit
npm run build
# With the app listening on port 3000 and Playwright available:
node tests/terminal-controller.browser.cjs
```

Browser verification should cover both command orders, legacy URL aliases, invalid commands, duplicate suppression, branching history, browser Back/Forward, refresh, reload persistence, favorites, directory search, real keyboard interaction, mobile widths and absence of runtime errors. Mock data APIs in deterministic UI tests; do not mock the navigation code. Keep a separate live smoke check if data services are available. Inspect the actual UI screenshot, not just DOM assertions.

For Python custom indicators, ALSO read `public/chart-studio/INDICATOR_AI_GUIDE.md`; this controller guide does not replace the `calculate(ctx)` SDK contract.

# Contract Workspace + Streaming

Open **The Greeks → Contracts**, or **Strikes → Open** on a contract. Choose an expiration, call/put and strike. Selection comes from the existing filtered Alpaca inventory, so this is not discovery of every listed contract and does not add 0DTE IV support.

## User behavior

- Native Lightweight Charts v5 candles and a separate volume pane; 1Min, 5Min, 15Min or 1Day over 1, 5 or 20 calendar days. Zoom/pan/crosshair, Fit chart and an accessible latest-100-bars table. Times display in UTC.
- Bid/ask and sizes, indicative spread, latest reported trade, event age and exact timestamp. Zero sizes remain zero; a crossed or zero-bid quote has no derived midpoint/spread.
- Alpaca snapshot IV/Greeks compared with the existing inventory model, each with its capture time. Model/provider inputs and conventions can differ; this is a diagnostic comparison, not a calibrated accuracy score.
- Explicit **Start stream / Stop stream**. Changing contracts or leaving the panel closes that viewer's stream. Stream events update quotes/trades, not IV/Greeks. Refresh history/Greeks using the refresh button.
- The last 100 observed trades form a bounded session tape in arrival order, without buy/sell or institutional classification. Individual print size is never daily volume. No guaranteed complete tape or reconnect backfill.
- JSON export includes historical bars, snapshot observations, model inputs and the visible session tape with source limitations. Exports never contain API keys.

## Source semantics

Historical bars are Alpaca trade aggregates, requested through a cutoff 16 minutes before retrieval. That endpoint has no feed selector. The final bar can be partial; gaps remain absent and are not forward-filled. Historical bars and indicative WebSocket prints are **never merged** into a candle/volume series. This avoids mixing data sources and double-counting overlap.

Indicative quotes are modified; indicative trades are derivatives and delayed. Spreads are not executable market estimates. `subscribed` means Alpaca acknowledged the selected quote/trade subscriptions; it does not mean a trade occurred or the market is open. SSE heartbeat age describes link health separately from quote/trade age.

The existing options inventory, dated OI, model calculations and archive remain unchanged by stream events. This feature does not add an orders endpoint, a background recorder, automatic trading, or a new terminal function code.

## API and lifecycle

- `GET /api/greeks/contracts/{OCC}/history?interval=5Min&days=5`: strict OCC/date/strike validation, bounded history range, paginated bars, 45-second provider budget, 30-second cache slots with maximum 64 cached results. Snapshot failures are visible warnings; missing native Greeks/IV remain null. Provider errors use FastAPI `detail` responses.
- `GET /api/greeks/contracts/{OCC}/stream`: SSE bridge to the shared Python WebSocket. Fixed Alpaca host and selected configured feed. MessagePack binary decoding includes timestamp extensions. Authentication is sent only after checking the connected host; credentials never enter the browser.
- `GET /api/greeks/contracts/status`: safe counts of viewers, requested/confirmed contracts and worker state. No credentials or trading operations.

`python/options_workspace.py` owns one stream hub per Greeks API process. Up to 20 viewers / 10 distinct contracts share one upstream connection. Acknowledged quotes/trades are routed only to their viewers. Removed contracts are unsubscribed; the last viewer closes the upstream. Run this API as one worker to preserve the shared-connection model. Other Alpaca clients can still compete with the account's connection allowance.

Transport failure retries with capped exponential backoff and an explicit tape-gap message. Provider authentication/subscription errors terminate the stream with a safe message and require a manual restart. Each viewer queue is capped at 256 events; overflow reports a gap rather than silently claiming completeness. Browser painting is batched at 250ms with bounded pending trades/tape. Older observations do not overwrite newer displayed quotes/trades.

The dedicated Next SSE proxy streams bytes, propagates disconnect/cancel to Python and has a 20-second response-header timeout. It does not inherit the general proxy's 95-second full-request timeout. Do not replace it with a buffered JSON proxy.

## Dependencies and verification

`websockets==16.0` already exists; `msgpack==1.2.2` is added to Python requirements. Launch using the shared `start_dashboard.cmd --only greeks,next` (production after frontend build), not a separate unregistered service.

Tests: `python/test_options_workspace.py` covers OCC validation, binary timestamp decoding, bad quotes, trade-size semantics, bar validation/cutoff, shared subscriptions, cleanup, queue overflow, host verification and limits. `vrp-claude/tests/contract-workspace.test.cjs` covers observation ordering and invalid spread inputs. Keep `test_alpaca_options.py` passing.

Live check on 2026-09-12: SPY260914C00764000 returned 159 five-minute bars, snapshot quote and IV; Alpaca acknowledged the indicative quote/trade subscription. This was outside the regular market session, so real market-hours tick throughput and reconnect recovery still need observation. Synthetic test messages are confined to isolated tests and never inserted into production history.

References: [Alpaca option streaming](https://docs.alpaca.markets/us/docs/real-time-option-data), [stream authentication and errors](https://docs.alpaca.markets/us/docs/streaming-market-data), [historical option bars](https://docs.alpaca.markets/us/reference/optionbars), [Lightweight Charts v5 API](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/IChartApi).

---
name: vrp-python-indicator
description: Create editable Python Chart Studio indicators using the actual calculate(ctx) SDK and truthful market data semantics.
---
Read vrp://methodology/indicators completely before writing code; it is the executable SDK contract. Use dashboard_query market_search to discover canonical symbols and market_bars to inspect supported data. Preserve xyz:TSLA and other HIP-3 identifiers; TSLAUSDT.P is only a search alias.
Produce indicator source and usage notes according to the SDK. Run appropriate validation in the user's authorized coding environment. The VRP MCP gateway does not execute Python or install files. Deliver code as a job result or use the user's authorized workspace tools. Never fabricate missing Greeks, orderflow or volume-profile inputs.

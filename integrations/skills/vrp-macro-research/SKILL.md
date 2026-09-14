---
name: vrp-macro-research
description: Analyze USD macro calendars, surprises and event reactions using the VRP Dashboard MCP. Use for economic research tasks, not trade execution.
---
Read vrp://methodology/macro. Use dashboard_catalog to inspect schemas, then dashboard_query with macro_calendar, macro_forecast, macro_surprises or macro_reactions.
Keep release timestamps separate from FRED reference periods. Preserve missing actual and consensus. Latest revised observations are not first-release vintage backtests. Reaction windows are descriptive, not causal effects; +24h means wall-clock hours. State overlapping releases, data gaps and source fetch timestamps.
For Bayesian analysis, state prior and model assumptions, summarize evidence, then update the view only to the extent supported. Do not invent probability estimates from text or mechanically map economic surprises into stock direction.
Return a concise conclusion, source evidence, uncertainty and what would change the conclusion.

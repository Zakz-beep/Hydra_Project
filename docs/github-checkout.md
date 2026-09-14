# GitHub checkout

The repository contains application source, research code, tests and portable AI guides. Local SQLite databases, collected market data, logs, generated plots, scratch scripts, machine-specific AI settings and credentials are excluded. The three previously tracked SQLite files are removed from the Git index while retained on disk; existing Git history is not rewritten.

In `vrp-claude`, run `npm ci`, copy `.env.example` to `.env.local` and fill only the providers you use. The committed lockfile pins the frontend installation. Streaming features require a host that supports long-lived responses.

Follow [the launcher guide](start-dashboard.md) to create the Python environment and start services. Provider templates are `python/.env.alpaca.example` and `python/.env.marketdata.example`; actual environment files must remain ignored. Historical MarketData imports require an explicit request and account entitlement. New checkouts create local databases as needed; local historical captures are not part of the source distribution.

Before pushing, inspect staged files for credentials and generated data, run relevant unit tests and TypeScript/build checks, then fetch and verify that the remote branch has not moved. Push normally without forcing or rewriting remote history.

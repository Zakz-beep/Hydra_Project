# Local dashboard launcher

Double-click `start_dashboard.cmd` on Windows, or run from the repository root:

```powershell
.\start_dashboard.cmd
```

This starts Next.js (port 3000) and all 14 registered Python APIs: VRP 8000, Greeks 8001, risk 8002, correlation 8004, volatility 8006, regime 8007, COT 8008, dispersion 8009, HRP 8010, beta 8012, crypto 8013, on-chain 8014, macro 8015, Agent Center 8016. The authenticated `agenthub` service always binds to loopback, including with `--host 0.0.0.0`. Its MCP stdio bridge is launched by the external client. The previously excluded unauthenticated REPL is not part of the application launcher.

Keep the launcher terminal open. **Ctrl+C** stops only the process trees created by this launch, including reload workers. An existing service is left running. Occupied ports that cannot answer a readiness probe are reported as conflicts, not killed or replaced. Readiness means the HTTP application is responding; it does not promise that every external data provider is available.

Logs are written separately to `.ua/servers/<service>.log`. Startup is reported as STARTING, READY, EXISTING, FAILED or TIMEOUT; the summary reports how many services actually responded. A failed API does not prevent the other services from starting. Timeouts remain running for diagnosis; Ctrl+C stops them too.

## Requirements

- Node.js with the project's frontend packages installed (`npm install` inside `vrp-claude`).
- `uv` on PATH.
- The existing `python/.venv` with `python/requirements.txt` installed. The launcher explicitly selects this interpreter for every API, including APIs in subfolders, and does not download Python or install packages on startup.

For a new checkout (from the repository root):

```powershell
uv venv python/.venv
uv pip install --python python/.venv/Scripts/python.exe -r python/requirements.txt
```

## Useful options

```powershell
.\start_dashboard.cmd --check
.\start_dashboard.cmd --no-reload
.\start_dashboard.cmd --only greeks,next
.\start_dashboard.cmd --frontend-only
.\start_dashboard.cmd --backend-only
.\start_dashboard.cmd --host 0.0.0.0
.\start_dashboard.cmd --production
```

Default mode is development: Next dev and Uvicorn reload. `--no-reload` reduces Python reload processes. `--production` uses an existing `npm run build` and turns off Python reload. The default bind is `127.0.0.1`; `--host 0.0.0.0` is available when you explicitly want LAN access. `--startup-timeout 180`, `--port 3000`, `--python <executable>`, and `--log-dir <directory>` are configurable.

`--check` is read-only: validates paths/executables and lists ports; actual dependency imports/readiness are verified during launch.

The existing backend-only command still works:

```powershell
cd python
uv run python start_servers.py
# Optional: uv run python start_servers.py --with-frontend
```

The shared service registry remains in `python/start_servers.py`; add a new API there once rather than maintaining separate frontend/backend launcher lists. All startup scripts resolve paths relative to their own files, so folders containing spaces are supported.

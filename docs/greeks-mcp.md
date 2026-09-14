# Greeks API — MCP Server Documentation

> **Options Inventory Engine** — GEX · Vanna · Charm · DAI · VEX  
> API Server: `http://localhost:8001` | MCP Server: `python/greeks_mcp_server.py`

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Concepts](#3-core-concepts)
4. [Tool Reference](#4-tool-reference)
5. [Analysis Workflows](#5-analysis-workflows)
6. [Response Schema Reference](#6-response-schema-reference)
7. [Configuration Guide](#7-configuration-guide)
8. [Ticker Compatibility](#8-ticker-compatibility)

---

## 1. Quick Start

### Prerequisites

```bash
# Terminal 1: Start all backend servers
cd c:\Users\Akbar Alviansyah\Downloads\vrp-dashboard\python
uv run python start_servers.py
# → Greeks API will be available at http://localhost:8001

# Terminal 2: Run the MCP server (for testing)
uv run mcp run greeks_mcp_server.py
```

### Add to Claude Desktop

Edit `C:\Users\Akbar Alviansyah\AppData\Roaming\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "greeks-api": {
      "command": "uv",
      "args": [
        "run",
        "mcp",
        "run",
        "C:\\Users\\Akbar Alviansyah\\Downloads\\vrp-dashboard\\python\\greeks_mcp_server.py"
      ],
      "cwd": "C:\\Users\\Akbar Alviansyah\\Downloads\\vrp-dashboard\\python"
    }
  }
}
```

### Add to Cursor / Windsurf

Create or edit `.cursor/mcp.json` in the project root:

```json
{
  "mcpServers": {
    "greeks-api": {
      "command": "uv",
      "args": ["run", "mcp", "run", "greeks_mcp_server.py"],
      "cwd": "C:\\Users\\Akbar Alviansyah\\Downloads\\vrp-dashboard\\python"
    }
  }
}
```

---

## 2. Architecture Overview

```
AI Assistant (Claude/Cursor)
        │
        │  MCP (stdio transport)
        ▼
greeks_mcp_server.py      ← You are here
  FastMCP (23 tools)
        │
        │  HTTP/REST (localhost)
        ▼
greeks_api.py  (FastAPI)  ← port 8001
        │
        │  Python
        ▼
Greeks.py                  ← Options computation engine
   ├─ bsm_greeks()         BSM pricing & Greeks (Δ, Γ, Θ, V, ρ, Vanna, Charm)
   ├─ _find_gamma_flip()   GEX sign-crossing detection
   └─ OptionsInventoryEngine
           │
           │  yfinance
           ▼
    Yahoo Finance API      ← Live options chains
        │
        ▼
    greeks.db (SQLite)     ← Historical snapshots, signal log, backtest data
```

**Cache TTL:** 3 minutes (stale-while-revalidate — returns old data instantly, refreshes in background).

---

## 3. Core Concepts

### GEX (Gamma Exposure)

**Formula:** `GEX = sign × gamma × OI × 100 × (spot²) / 1e9`

- `sign = +1` for calls, `-1` for puts (dealer has opposite position to buyer)
- Result in **$Billions** of delta per 1% spot move

| Regime | GEX | MM Behavior | Market Behavior |
|--------|-----|-------------|-----------------|
| Positive | GEX > 0 | SELL rallies, BUY dips | Low vol, pinning, range-bound |
| Negative | GEX < 0 | BUY rallies, SELL dips | High vol, trending, gap risk |
| Neutral | ≈ 0 | Minimal systematic hedging | Transitioning regime |

**Gamma Flip:** The exact strike where net GEX = 0. Above = positive gamma territory, below = negative. This level acts as a major support/resistance.

---

### Vanna (dΔ/dIV)

Measures how delta changes when implied volatility changes.

**Dealer hedging flow:**
- **Positive Vanna + IV falling** → dealers must BUY spot → **Bullish flow**
- **Positive Vanna + IV rising** → dealers must SELL spot → **Bearish flow**

**When it matters most:**
- After major events (FOMC, earnings) when IV crushes by 10-20%
- During VIX spikes/unwinds
- Post-crisis vol normalization

---

### Charm (dΔ/dTime)

Measures how delta changes with the passage of time (theta-like but for delta).

**Dealer hedging flow:**
- Each calendar day, option deltas decay toward intrinsic value
- MMs must buy/sell shares to stay delta-neutral
- Most powerful in **final 7 DTE**, especially **0DTE/1DTE**

**Key OPEX dynamics:**
- Positive charm + bullish market → daily upward drift into expiry
- Negative charm + bearish market → daily downward drift
- "Charm pinning" = price gravitates toward high OI strikes near expiry

---

### DAI (Dealer Aggregate Index)

Composite directional exposure of the entire dealer book across all strikes.

- **Positive DAI** → dealers are net long delta → need to sell to stay hedged → **headwind**
- **Negative DAI** → dealers net short delta → need to buy → **tailwind**

---

### VEX (Volatility Exposure)

Net vega exposure of the dealer book.

- **High VEX** → dealers are long vega → benefit from IV expansion, hurt by crush
- **Low/Negative VEX** → dealers benefit from IV compression (gamma rich)

---

### GBS (Gamma Bounce Score) — 0 to 100

Proprietary score measuring how likely price will reverse at a GEX level.

```
Score = GEX_magnitude(0-40) + OI_density(0-20) + Proximity(0-25) 
      + Vanna_bonus(0-15) - RVOL_penalty(0-20)
```

| Score | Regime | Interpretation |
|-------|--------|----------------|
| 80-100 | EXTREME | Near-certain bounce — aggressive MM hedging |
| 60-79 | STRONG | High probability bounce |
| 40-59 | MODERATE | Resistance present, breakable |
| 20-39 | WEAK | Thin wall, momentum likely wins |
| 0-19 | MINIMAL | No meaningful GEX S/R |

---

### Expected Move Formula

```
EM = Spot × (IV / 100) × √(DTE / 252)
```

- **1σ range** contains ~68% of outcomes
- **2σ range** contains ~95% of outcomes

**Overextension regimes:**

| Regime | Actual / EM ratio | Trading implication |
|--------|-------------------|---------------------|
| WITHIN_RANGE | < 1.0σ | Normal variation |
| AT_BOUNDARY | ~1.0σ | Watch for potential reversal |
| EXTENDED | 1.5–2.0σ | Stretched, fade consideration |
| EXTREME | > 2.0σ | Mean reversion very likely |

---

## 4. Tool Reference

### Live Snapshot Tools

| Tool | Endpoint | Use Case |
|------|----------|----------|
| `get_greeks_snapshot` | `GET /api/greeks` | Full data dump, all buckets + strikes |
| `get_greeks_summary` | `GET /api/greeks/summary` | Quick overview, no strikes array |
| `get_gex` | `GET /api/greeks/gex` | GEX-specific analysis |
| `get_expiry_bucket` | `GET /api/greeks/expiry/{n}` | Single DTE bucket full data |
| `get_strikes` | `GET /api/greeks/strikes` | Sorted/filtered strike list |
| `get_signals` | `GET /api/greeks/signals` | Market structure signals only |
| `get_maxpain` | `GET /api/greeks/maxpain` | Max pain + PCR per bucket |
| `get_vanna_charm` | `GET /api/greeks/vanna-charm` | Vanna & Charm deep dive |

### Simulation & Pricing Tools

| Tool | Endpoint | Use Case |
|------|----------|----------|
| `simulate_greeks` | `GET /api/greeks/simulate` | Scenario: spot/IV/time shift |
| `calculate_bsm` | `GET /api/greeks/bsm` | Single option BSM pricing |
| `get_bsm_curve` | `GET /api/greeks/bsm/curve` | Greeks sensitivity curve |
| `get_expected_move` | `GET /api/greeks/expected-move` | IV-implied price ranges |
| `get_gamma_bounce_score` | `GET /api/greeks/gbs` | GEX level bounce probability |

### Flow & Positioning Tools

| Tool | Endpoint | Use Case |
|------|----------|----------|
| `get_unusual_activity` | `GET /api/greeks/unusual-activity` | UOA: Block trades, sweeps |
| `get_unusual_flow` | `GET /api/greeks/unusual-flow` | Anomaly-scored flow |
| `get_oi_change` | `GET /api/greeks/oi-change` | OI delta vs 24h ago |
| `get_vvix` | `GET /api/greeks/vvix` | VVIX replication |

### Historical / Database Tools

| Tool | Endpoint | Use Case |
|------|----------|----------|
| `get_history` | `GET /api/greeks/history` | Full snapshot history |
| `get_gex_timeseries` | `GET /api/greeks/gex/timeseries` | GEX trend series |
| `get_signal_log` | `GET /api/greeks/signals/log` | Signal change log |
| `get_backtest` | `GET /api/greeks/backtest` | Signal accuracy testing |
| `get_db_stats` | `GET /api/greeks/db/stats` | DB health check |

### Utility Tools

| Tool | Endpoint | Use Case |
|------|----------|----------|
| `warm_cache` | `POST /api/greeks/warm` | Pre-warm cache for a ticker |

---

## 5. Analysis Workflows

### 🔍 Quick Market Regime Check (2 steps)

```
1. get_signals("SPY")
   → Check: gex_regime, vanna_signal, charm_signal
   → If positive_gamma + vanna_bullish: bullish bias, low vol expected

2. get_expected_move("SPY")
   → Check: overextension_regime, em_1d (1-day expected range)
   → If EXTENDED/EXTREME: consider mean reversion trades
```

### 📊 Full Market Structure Analysis (5 steps)

```
1. get_gex("SPY")
   → Identify regime & gamma flip level
   → Note top_strikes GEX concentration

2. get_vanna_charm("SPY")
   → Check net_vanna & net_charm direction
   → Note top_vanna_strikes for key levels

3. get_gamma_bounce_score("SPY")
   → Find nearest_resistance & nearest_support
   → Check scores — anything >60 is a meaningful level

4. get_unusual_activity("SPY", min_volume=500, vol_oi_ratio=2.0)
   → Block trades + institutional sweeps confirm directional bias

5. get_expected_move("SPY")
   → Frame the overall expected range for the day/week
```

### 📅 Pre-Event Playbook (FOMC / CPI / Earnings)

```
# Before event:
1. get_expected_move("SPY")
   → "Market prices X% move" — compare to historical event moves

2. get_maxpain("SPY")
   → Post-event gravitational target if IV crushes

3. simulate_greeks("SPY", iv_shift_pct=-15, days_forward=1)
   → "What if IV drops 15% after the event resolves?"
   → Check: total_sim_gex, sim_gamma_flip shift

# After event (vol crush):
4. get_vanna_charm("SPY", force=True)
   → Fresh read of vanna after IV resets
   → If positive vanna + IV fell = strong buyer flow expected
```

### 🗓️ OPEX Week Playbook

```
# Monday/Tuesday:
1. get_expiry_bucket("SPY", bucket=0)
   → 0DTE dominant strikes and GEX levels
2. get_vanna_charm("SPY")
   → Charm is most powerful now — check direction

# Wednesday (major weekly OPEX):
3. get_strikes("SPY", bucket=0, sort_by="charm_exp")
   → Top 0DTE charm pressure strikes
4. get_maxpain("SPY")
   → Weekly max pain level — gravitational target

# Thursday/Friday:
5. get_gamma_bounce_score("SPY")
   → Check scores near current spot
   → EXTREME scores on 0DTE = very strong pin potential
```

### 💰 Institutional Flow Detection

```
1. get_unusual_activity("SPY", min_volume=500, vol_oi_ratio=2.0)
   → Block trades ($250K+) show major players
   → Institutional sweeps (Vol/OI > 4x) show urgency

2. get_unusual_flow("SPY", top_n=20)
   → OTM anomaly score boosts deep directional bets
   → Cross-reference with unusual_activity for confirmation

3. get_oi_change("SPY")
   → Strikes with rising OI = fresh money opening positions
   → Strikes with falling OI = profit-taking or rolling
```

### 📐 Single Option Analysis

```
# Precise BSM pricing:
1. calculate_bsm(spot=590, strike=595, dte=3, iv=0.14, option_type="call")
   → Exact theoretical value + all 7 Greeks

# Sensitivity profile:
2. get_bsm_curve(spot=590, strike=595, dte=3, iv=0.14)
   → Full delta/gamma/theta/vega curve across price range
   → Find gamma peak (where option is most convex)

# Expected move context:
3. get_expected_move("SPY")
   → Is the strike inside or outside the expected move range?
```

---

## 6. Response Schema Reference

### `GreeksSnapshot` (from `get_greeks_snapshot`)

```typescript
{
  timestamp:       string;        // ISO8601
  ticker:          string;        // e.g. "SPY"
  spot:            number;        // current price
  data_source:     "live" | "synthetic";

  total_net_gex:   number;        // $B (positive = positive gamma)
  total_net_vanna: number;        // Vanna exposure
  total_net_charm: number;        // Charm exposure
  total_net_dai:   number;        // Dealer Aggregate Index
  total_net_vex:   number;        // Volatility Exposure
  total_gross_gex: number;        // |GEX| without sign netting

  gex_regime:      string;        // "positive_gamma" | "negative_gamma" | "neutral"
  gamma_flip:      number | null; // strike price of GEX sign change

  signals: {
    gex_regime:    string;  // e.g. "positive_gamma"
    gex_desc:      string;  // human-readable explanation
    vanna_signal:  string;  // "vanna_bullish" | ...
    vanna_desc:    string;
    charm_signal:  string;
    charm_desc:    string;
    dai_bias:      string;
    dai_desc:      string;
    vex_signal:    string;
    vex_desc:      string;
  };

  by_expiry: {
    "0":  ExpiryBucket;   // 0DTE
    "1":  ExpiryBucket;   // 1DTE
    "7":  ExpiryBucket;   // 7DTE
    "14": ExpiryBucket;   // 14DTE
    "30": ExpiryBucket;   // 30DTE
  };
}
```

### `ExpiryBucket`

```typescript
{
  dte_bucket:         number;       // 0, 1, 7, 14, or 30
  expiry_dates:       string[];     // actual expiry dates in bucket
  n_strikes:          number;       // count of strikes
  total_oi_calls:     number;       // total open interest (calls)
  total_oi_puts:      number;       // total open interest (puts)
  pcr_oi:             number;       // put/call OI ratio
  net_gex_spotgamma:  number;       // net GEX for this bucket
  net_vanna:          number;
  net_charm:          number;
  net_dai:            number;
  net_vex:            number;
  gross_gex:          number;
  max_pain:           number | null;
  gamma_flip:         number | null;
  largest_gex_strike: number | null;
  largest_gex_value:  number | null;
  strikes?:           StrikeGreeks[]; // only in full snapshot
}
```

### `StrikeGreeks`

```typescript
{
  strike:        number;  // strike price
  expiry:        string;  // expiry date
  dte:           number;  // days to expiry
  option_type:   string;  // "call" | "put"
  oi:            number;  // open interest (contracts)
  volume:        number;  // daily volume
  mid_price:     number;  // option mid price ($)
  iv:            number;  // implied vol (decimal, 0.15 = 15%)
  delta:         number;  // 0 to ±1
  gamma:         number;  // per $1 spot
  theta:         number;  // $ per day
  vega:          number;  // $ per 1% IV
  rho:           number;  // $ per 1% rate
  vanna:         number;  // dDelta/dIV
  charm:         number;  // dDelta/dTime
  gex_spotgamma: number;  // net GEX contribution ($B)
  gex_raw:       number;  // raw GEX before sign
  vanna_exp:     number;  // scaled vanna exposure
  charm_exp:     number;  // scaled charm exposure
  delta_exp:     number;  // scaled delta exposure
  vega_exp:      number;  // scaled vega exposure
}
```

### `GBSResponse` (from `get_gamma_bounce_score`)

```typescript
{
  ticker:             string;
  spot:               number;
  total_net_gex:      number;
  gex_regime:         string;
  overall_score:      number;   // 0-100
  regime:             "EXTREME" | "STRONG" | "MODERATE" | "WEAK" | "MINIMAL";
  vix_change:         number;   // VIX daily change
  rvol:               number;   // relative volume ratio
  rvol_regime:        "EXTREME_VOL" | "HIGH" | "NORMAL" | "LOW";
  today_volume:       number;
  avg_volume_20:      number;
  total_net_vanna:    number;
  total_net_charm:    number;
  nearest_resistance: GBSWall | null;  // closest wall above spot
  nearest_support:    GBSWall | null;  // closest wall below spot
  walls:              GBSWall[];       // up to 25 walls ±15% from spot
}

type GBSWall = {
  strike:       number;
  dist_pct:     number;     // % distance from spot
  total_gex:    number;
  total_oi:     number;
  net_vanna:    number;
  wall_type:    "CALL_WALL" | "PUT_WALL";
  behavior:     string;     // human-readable behavior description
  price_action: "BOUNCE_DOWN" | "BOUNCE_UP";
  score:        number;     // 0-100 GBS score
  components: {
    gex_score:    number;
    oi_score:     number;
    prox_score:   number;
    vanna_bonus:  number;
    rvol_penalty: number;
  };
}
```

---

## 7. Configuration Guide

### DTE Buckets Explained

| Bucket | Label | Expiry Type |
|--------|-------|-------------|
| `0` | 0DTE | Same-day expiration (SPY: Mon/Wed/Fri, QQQ: Mon/Wed/Fri) |
| `1` | 1DTE | Next trading day |
| `7` | 1W | This week's Friday |
| `14` | 2W | Next week or bi-weekly |
| `30` | 1M | Monthly expiry (~4 weeks out) |

### Cache Behavior

The engine uses **stale-while-revalidate**:
1. First call: blocking compute (5-30 seconds depending on option chain size)
2. Subsequent calls within 3 minutes: instant (returns cached data)
3. After 3 minutes: returns stale data immediately + triggers background refresh

To force fresh data: pass `force=True` to any snapshot tool.  
To pre-warm a ticker: call `warm_cache("TICKER")` before users need it.

### Signal Values Reference

```
gex_regime:   "positive_gamma" | "negative_gamma" | "neutral"
vanna_signal: "vanna_bullish"  | "vanna_bearish"  | "vanna_neutral"
charm_signal: "charm_bullish"  | "charm_bearish"  | "charm_neutral"
dai_bias:     "bullish"        | "bearish"        | "neutral"
vex_signal:   "high_vex"       | "normal_vex"     | "low_vex"
```

---

## 8. Ticker Compatibility

### ✅ Best Coverage (Liquid ETFs with large options chains)

| Ticker | Name | Notes |
|--------|------|-------|
| `SPY` | S&P 500 ETF | Best data quality, 0DTE Mon/Wed/Fri |
| `QQQ` | Nasdaq-100 ETF | Excellent coverage |
| `IWM` | Russell 2000 ETF | Good coverage |
| `GLD` | Gold ETF | Good options chain |
| `TLT` | 20Y Bond ETF | Rate-sensitive positioning |
| `SLV` | Silver ETF | Commodity options |
| `XLE` | Energy Sector ETF | |
| `XLF` | Financial Sector ETF | |

### ✅ Single Stock Coverage

| Ticker | Notes |
|--------|-------|
| `AAPL` | Very liquid, large chain |
| `TSLA` | High volatility, great data |
| `NVDA` | High premium, active |
| `AMZN`, `GOOGL`, `META`, `MSFT` | Mega-cap, good data |
| `SPX`, `XSP` | Index options (no ETF premium) |

### ⚠️ Limited / Synthetic Fallback

Less liquid single stocks may return `data_source: "synthetic"` — computed from estimated parameters rather than live chain data. Accuracy is lower.

### ❌ Incompatible (No Options Chain)

| Symbol | Reason | Use Instead |
|--------|---------|-------------|
| `^GSPC` | S&P 500 index | Use `SPY` or `SPX` |
| `^IXIC` | Nasdaq Composite | Use `QQQ` or `NDX` |
| `^DJI` | Dow Jones index | Use `DIA` |
| `^RUT` | Russell 2000 index | Use `IWM` |

---

## Appendix: Error Handling

### Connection Error
If the backend is not running, all tools return:
```json
{
  "error": "Cannot connect to Greeks API (port 8001).",
  "hint": "Run: cd python && uv run python start_servers.py"
}
```

### Invalid Ticker
Returns `data_source: "synthetic"` with estimated data rather than an error.

### Invalid Bucket
Returns HTTP 400 with: `{"detail": "Bucket invalid. Valid: [0, 1, 7, 14, 30]"}`

---

*Last updated: 2026-06-03 | VRP Dashboard — Options Inventory Engine v1.0*

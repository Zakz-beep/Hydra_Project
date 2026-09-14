"""
greeks_mcp_server.py — Options Greeks API MCP Server
=====================================================
Model Context Protocol (MCP) server exposing the full Options Inventory
Engine API as structured tools for AI assistants (Claude Desktop, Cursor, etc.).

This server is a thin async proxy over greeks_api.py running on port 8001.

────────────────────────────────────────────────────────────
HOW TO RUN (2 options):

  Option A — via mcp CLI (recommended for Claude Desktop):
    uv run mcp run greeks_mcp_server.py

  Option B — directly:
    uv run python greeks_mcp_server.py

────────────────────────────────────────────────────────────
CLAUDE DESKTOP CONFIG  (~/.claude/claude_desktop_config.json):

{
  "mcpServers": {
    "greeks-api": {
      "command": "uv",
      "args": [
        "run",
        "mcp",
        "run",
        "C:\\\\Users\\\\Akbar Alviansyah\\\\Downloads\\\\vrp-dashboard\\\\python\\\\greeks_mcp_server.py"
      ],
      "cwd": "C:\\\\Users\\\\Akbar Alviansyah\\\\Downloads\\\\vrp-dashboard\\\\python"
    }
  }
}

────────────────────────────────────────────────────────────
CURSOR / WINDSURF MCP CONFIG  (.cursor/mcp.json):

{
  "mcpServers": {
    "greeks-api": {
      "command": "uv",
      "args": ["run", "mcp", "run", "greeks_mcp_server.py"],
      "cwd": "C:\\\\Users\\\\Akbar Alviansyah\\\\Downloads\\\\vrp-dashboard\\\\python"
    }
  }
}

────────────────────────────────────────────────────────────
PREREQUISITE: The backend must be running first!
    cd python && uv run python start_servers.py
────────────────────────────────────────────────────────────
"""

import sys
import logging
import pathlib
import httpx
from mcp.server.fastmcp import FastMCP
from typing import Optional

# ─────────────────────────────────────────────────────────────
# LOGGING — tulis ke file DAN stderr
# ─────────────────────────────────────────────────────────────

LOG_FILE = pathlib.Path(__file__).parent / "greeks_mcp_server.log"

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("greeks-mcp")
log.info("=" * 60)
log.info("Greeks MCP Server starting...")
log.info(f"Python: {sys.version}")
log.info(f"Log file: {LOG_FILE}")

try:
    import httpx as _httpx_test
    log.info(f"httpx OK: {_httpx_test.__version__}")
except Exception as e:
    log.error(f"httpx import FAILED: {e}")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────

log.info("Initializing FastMCP...")
mcp      = FastMCP("Greeks API — Options Inventory Engine")
BASE_URL = "http://localhost:8001/api/greeks"
TIMEOUT  = 45.0  # seconds (GBS + full snapshot can be slow)
log.info(f"FastMCP initialized. BASE_URL={BASE_URL}")


# ─────────────────────────────────────────────────────────────
# HTTP HELPERS
# ─────────────────────────────────────────────────────────────

def _get(path: str, params: Optional[dict] = None) -> dict:
    """Synchronous GET to the Greeks API, returns JSON dict."""
    clean = {k: v for k, v in (params or {}).items() if v is not None}
    log.debug(f"GET {BASE_URL}{path} params={clean}")
    try:
        r = httpx.get(f"{BASE_URL}{path}", params=clean, timeout=TIMEOUT)
        r.raise_for_status()
        log.debug(f"GET {path} → {r.status_code}")
        return r.json()
    except httpx.ConnectError:
        log.warning(f"ConnectError: Greeks API not reachable at port 8001")
        return {
            "error": "Cannot connect to Greeks API (port 8001).",
            "hint": "Run: cd python && uv run python start_servers.py"
        }
    except Exception as e:
        log.error(f"GET {path} error: {e}")
        return {"error": str(e)}


def _post(path: str, params: Optional[dict] = None) -> dict:
    """Synchronous POST to the Greeks API, returns JSON dict."""
    clean = {k: v for k, v in (params or {}).items() if v is not None}
    log.debug(f"POST {BASE_URL}{path} params={clean}")
    try:
        r = httpx.post(f"{BASE_URL}{path}", params=clean, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except httpx.ConnectError:
        log.warning(f"ConnectError: Greeks API not reachable at port 8001")
        return {
            "error": "Cannot connect to Greeks API (port 8001).",
            "hint": "Run: cd python && uv run python start_servers.py"
        }
    except Exception as e:
        log.error(f"POST {path} error: {e}")
        return {"error": str(e)}


# ═════════════════════════════════════════════════════════════
# TOOLS — LIVE SNAPSHOT ENDPOINTS
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_greeks_snapshot(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Full Options Greeks inventory snapshot for a ticker.

    Returns ALL expiry buckets (0DTE, 1DTE, 7DTE, 14DTE, 30DTE) with:
    - Net & gross GEX (Gamma Exposure) in $B
    - Net Vanna, Charm, DAI (Dealer Aggregate Index), VEX exposures
    - GEX regime: 'positive_gamma' | 'negative_gamma' | 'neutral'
    - Gamma flip level (price where MM hedging direction flips)
    - Spot price, data source (live vs synthetic)
    - Market structure signals for each Greek dimension
    - Per-strike breakdown (strike, OI, IV, delta, gamma, vanna, charm, GEX)

    ⚠️ Response can be large (100s of strikes).
       Use get_greeks_summary() for a lightweight version.
    Cache TTL: 3 minutes. Pass force=True to bypass.

    Compatible tickers: SPY, QQQ, IWM, GLD, TLT, AAPL, TSLA, NVDA, SPX, etc.
    ❌ Incompatible: ^GSPC, ^IXIC (no options chain — use SPY/QQQ instead).
    """
    return _get("", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_greeks_summary(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Lightweight aggregate Greeks summary (no per-strike arrays).

    Ideal for: Dashboard overview, quick regime check, position monitoring.

    Returns:
    - total_net_gex, total_net_vanna, total_net_charm, total_net_dai, total_net_vex
    - gex_regime and gamma_flip level
    - signals dict with human-readable descriptions for each Greek dimension
    - by_expiry: per-bucket aggregate totals (without the strikes[] array)
    """
    return _get("/summary", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_gex(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Gamma Exposure (GEX) detail for a ticker.

    KEY CONCEPTS:
    - Positive GEX: MMs are net long gamma → SELL rallies, BUY dips
      → Low realized volatility, range-bound, mean reversion behavior
    - Negative GEX: MMs are net short gamma → BUY rallies, SELL dips
      → High volatility, trending markets, gap risk
    - Gamma Flip: strike where GEX sign changes — critical S/R level

    Returns:
    - total_net_gex (net, in $B), gex_regime, gamma_flip
    - per_bucket: net/gross GEX, largest GEX strike per DTE bucket
    - top_strikes: 20 strikes with highest absolute GEX across all buckets
    """
    return _get("/gex", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_expiry_bucket(bucket: int, ticker: str = "SPY", force: bool = False) -> dict:
    """
    Full options data for a single DTE (days-to-expiry) bucket.

    Valid buckets: 0 (0DTE/same day), 1 (next day), 7 (weekly),
                   14 (bi-weekly), 30 (monthly).

    Returns all per-strike Greeks for that expiry bucket:
    strike, OI, volume, mid_price, IV, delta, gamma, theta, vega, rho,
    vanna, charm, gex_spotgamma, vanna_exp, charm_exp, delta_exp, vega_exp

    Use 0DTE bucket for intraday gamma analysis and pin risk.
    """
    if bucket not in (0, 1, 7, 14, 30):
        return {"error": "Invalid bucket. Must be one of: 0, 1, 7, 14, 30"}
    return _get(f"/expiry/{bucket}", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_strikes(
    ticker: str = "SPY",
    bucket: Optional[int] = None,
    option_type: Optional[str] = None,
    sort_by: str = "gex_spotgamma",
    limit: int = 50,
    force: bool = False
) -> dict:
    """
    Per-strike Greeks breakdown — sortable and filterable.

    Sort fields to find impactful strikes:
    - 'gex_spotgamma' → GEX walls and key gamma levels
    - 'vanna_exp'     → vanna-sensitive strikes (vol-driven flow)
    - 'charm_exp'     → charm decay strikes (critical near OPEX)
    - 'oi'            → OI concentration (where contracts sit)
    - 'iv'            → volatility skew across strikes
    - 'delta_exp'     → directional exposure by strike

    Args:
        bucket: Filter by DTE bucket (0, 1, 7, 14, or 30). None = all.
        option_type: Filter by 'call' or 'put'. None = both.
        sort_by: Field to sort by (descending by absolute value).
        limit: Max results to return (1-500).
    """
    valid_sort = [
        "gex_spotgamma", "delta", "gamma", "vanna", "charm",
        "vega", "theta", "oi", "iv", "strike",
        "vanna_exp", "charm_exp", "delta_exp", "vega_exp"
    ]
    if sort_by not in valid_sort:
        sort_by = "gex_spotgamma"

    params: dict = {
        "ticker":  ticker.upper(),
        "sort_by": sort_by,
        "limit":   limit,
        "force":   force,
    }
    if bucket is not None:
        params["bucket"] = bucket
    if option_type is not None:
        params["option_type"] = option_type.lower()

    return _get("/strikes", params)


@mcp.tool()
def get_signals(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Market structure signals derived from aggregate Greeks.

    Returns structured trading signals with descriptions:
    - gex_regime:    positive/negative gamma environment
    - vanna_signal:  IV-driven delta hedging pressure direction
    - charm_signal:  time-decay delta hedging direction (critical near OPEX)
    - dai_bias:      Dealer Aggregate Index directional bias
    - vex_signal:    Volatility Exposure sensitivity regime
    - gamma_flip:    the gamma flip price level

    Each signal has a 'signal' value and a 'desc' explanation.
    Fast & lightweight — ideal for quick regime identification.
    """
    return _get("/signals", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_maxpain(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Max Pain levels per expiry bucket.

    Max Pain = the strike where options buyers suffer maximum loss at expiry.
    Markets gravitationally attract toward max pain approaching OPEX.

    Returns per bucket:
    - max_pain strike level
    - gamma_flip level
    - pcr_oi (put/call OI ratio — above 1.0 = more puts than calls)
    - total_oi_calls, total_oi_puts
    - expiry_dates in each bucket

    Use cases:
    - 'Where will SPY pin at Friday expiry?'
    - 'What is the put/call OI balance for 0DTE?'
    """
    return _get("/maxpain", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_vanna_charm(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Vanna & Charm exposure detail — for vol-driven and time-driven price flows.

    VANNA (dDelta/dIV):
    - When IV falls: dealers with positive vanna must BUY spot (bullish)
    - When IV rises: dealers must SELL spot (bearish)
    - Key for understanding post-VIX spike unwinds and vol crush mechanics

    CHARM (dDelta/dTime):
    - Each day, options delta decays → dealers must unwind hedges
    - Most powerful near OPEX (0-7 DTE, especially Fri/Mon/Wed expirations)
    - Positive charm + bullish market → daily drift upward into expiry

    Returns:
    - total_net_vanna, total_net_charm
    - per_bucket vanna/charm breakdown per DTE
    - top_vanna_strikes: 15 strikes by |vanna_exp|
    - top_charm_strikes: 15 strikes by |charm_exp|
    - vanna/charm signals with directional descriptions
    """
    return _get("/vanna-charm", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def simulate_greeks(
    ticker: str = "SPY",
    spot_shift_pct: float = 0.0,
    iv_shift_pct: float = 0.0,
    days_forward: int = 0,
    force: bool = False
) -> dict:
    """
    Gamma/Vanna/Charm Profile Scenario Simulator.

    Re-calculates ALL BSM Greeks for every strike given hypothetical shifts:
    - spot_shift_pct: e.g., 5.0 for +5% spot, -3.0 for -3% spot
    - iv_shift_pct:   e.g., -15.0 for vol crush after FOMC, +20.0 for vol spike
    - days_forward:   e.g., 1 for 'what does tomorrow look like?'

    Use cases:
    - 'What does the GEX profile look like if SPY drops 2%?'
    - 'How does gamma flip shift after a -15% IV vol crush post-event?'
    - 'How does vanna profile change 3 days before monthly OPEX?'

    Returns:
    - orig vs sim totals for GEX, vanna, charm
    - orig vs sim gamma flip levels
    - chart_data: per-strike orig/sim values for visualization
    """
    return _get("/simulate", {
        "ticker":         ticker.upper(),
        "spot_shift_pct": spot_shift_pct,
        "iv_shift_pct":   iv_shift_pct,
        "days_forward":   days_forward,
        "force":          force,
    })


@mcp.tool()
def calculate_bsm(
    spot: float,
    strike: float,
    dte: float,
    iv: float,
    option_type: str = "call"
) -> dict:
    """
    Black-Scholes-Merton calculator for a single option contract.

    Returns all first & second order Greeks:
    - price:  theoretical option price (in $)
    - delta:  directional sensitivity (0-1 for calls, -1-0 for puts)
    - gamma:  convexity (delta change per $1 spot move)
    - theta:  daily time decay (negative = costs $ per day)
    - vega:   IV sensitivity ($ per 1% IV move)
    - rho:    interest rate sensitivity
    - vanna:  cross-Greek dDelta/dIV
    - charm:  cross-Greek dDelta/dTime

    Args:
        spot:        Current underlying price (e.g., 590.50 for SPY)
        strike:      Option strike price
        dte:         Days to expiry (can be fractional, e.g., 0.5 for half-day)
        iv:          Implied volatility as DECIMAL (e.g., 0.15 for 15% IV)
        option_type: 'call' or 'put'
    """
    return _get("/bsm", {
        "spot":        spot,
        "strike":      strike,
        "dte":         dte,
        "iv":          iv,
        "option_type": option_type.lower(),
    })


@mcp.tool()
def get_bsm_curve(
    spot: float,
    strike: float,
    dte: float,
    iv: float,
    option_type: str = "call",
    range_pct: float = 0.15,
    steps: int = 50
) -> dict:
    """
    Generate a full Greeks sensitivity curve across a range of spot prices.

    For a given option, calculates ALL Greeks at each spot price from
    spot*(1 - range_pct) to spot*(1 + range_pct) with `steps` data points.

    Use cases:
    - Plot the delta profile shape (S-curve for calls, Z-curve for puts)
    - Find where gamma peaks (near ATM)
    - See how theta accelerates as option approaches ATM
    - Understand vanna curve shape for vol-driven rebalancing

    Args:
        spot:      Current underlying price
        strike:    Option strike
        dte:       Days to expiry
        iv:        Implied volatility as decimal (0.15 = 15%)
        range_pct: Price range ± as decimal (0.15 = ±15%)
        steps:     Number of data points in the output curve
    """
    return _get("/bsm/curve", {
        "spot":        spot,
        "strike":      strike,
        "dte":         dte,
        "iv":          iv,
        "option_type": option_type.lower(),
        "range_pct":   range_pct,
        "steps":       steps,
    })


@mcp.tool()
def get_expected_move(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Options-implied Expected Move calculator.

    Formula: EM = Spot × (IV / 100) × sqrt(DTE / 252)

    Returns:
    - standard_periods: Expected moves for 1D, 1W, 2W, 1M, 1Q
      (each with em_1sigma, em_2sigma, upper/lower bounds, pct versions)
    - by_expiry: EM per DTE bucket with 1σ and 2σ bounds
    - overextension: ratio of actual daily move to 1D expected move
    - overextension_regime:
        WITHIN_RANGE (<1σ) — normal daily variation
        AT_BOUNDARY  (~1σ) — at key inflection
        EXTENDED   (1.5σ)  — stretched, watch for reversal
        EXTREME    (>2σ)   — mean reversion likely
    - actual_move_pct: today's price change vs previous close
    - annualized_iv: composite IV used for calculations

    Example use: 'What move is options market pricing for CPI tomorrow?'
    """
    return _get("/expected-move", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_gamma_bounce_score(ticker: str = "SPY", force: bool = False) -> dict:
    """
    Gamma Bounce Score (GBS) — probability that price reverses at a GEX wall.

    Scoring components (max 100 pts):
    - GEX Magnitude  (40 pts): larger |GEX| = stronger wall
    - OI Density     (20 pts): more contracts = more hedging required
    - Proximity      (25 pts): closer to spot = more imminent hedging
    - Vanna Bonus    (15 pts): positive GEX + VIX falling = bullish tailwind
    - RVOL Penalty   (0-20 deducted): high relative volume can break walls

    Regime interpretation:
    - 80-100: EXTREME — bounce nearly certain, MM hedging very aggressive
    - 60-79:  STRONG  — high probability bounce, solid GEX wall
    - 40-59:  MODERATE — resistance present but breakable with momentum
    - 20-39:  WEAK    — thin wall, momentum likely wins
    - 0-19:   MINIMAL — no meaningful GEX support/resistance

    Returns:
    - overall_score, regime
    - nearest_resistance, nearest_support (closest walls above/below spot)
    - walls: up to 25 GEX levels within ±15% of spot with component scores
    - vix_change, rvol, rvol_regime (context factors)
    """
    return _get("/gbs", {"ticker": ticker.upper(), "force": force})


@mcp.tool()
def get_unusual_activity(
    ticker: str = "SPY",
    min_volume: int = 100,
    vol_oi_ratio: float = 1.5,
    force: bool = False
) -> dict:
    """
    Unusual Options Activity (UOA) scanner — detects institutional/smart money flow.

    Flags strikes where Volume > Open Interest (new positions being opened,
    not just rolling existing ones). Returns top 50 by total premium.

    Activity classification by Vol/OI ratio:
    - Block Trade:          premium > $250K (large institutional order)
    - Institutional Sweep:  Vol/OI ≥ 4.0x (aggressive multi-exchange sweep)
    - Sweep:                Vol/OI ≥ 2.0x (directional conviction)
    - Unusual Volume:       Vol/OI ≥ 1.5x (above-average interest)

    Each result includes: strike, expiry, DTE, option_type, volume, OI,
    ratio, mid_price, premium, sentiment (BULLISH/BEARISH), activity_type,
    IV%, and distance from spot (dist_pct).

    Args:
        min_volume:   Minimum option volume to consider (default 100)
        vol_oi_ratio: Minimum Vol/OI ratio to flag (default 1.5)
    """
    return _get("/unusual-activity", {
        "ticker":       ticker.upper(),
        "min_volume":   min_volume,
        "vol_oi_ratio": vol_oi_ratio,
        "force":        force,
    })


@mcp.tool()
def get_unusual_flow(
    ticker: str = "SPY",
    min_vol_oi_ratio: float = 1.5,
    min_volume: int = 100,
    top_n: int = 30
) -> dict:
    """
    Unusual Options Flow Scanner — anomaly-scored options activity.

    Uses a proprietary anomaly score:
      score = Vol/OI_ratio × log(1 + volume)
    OTM contracts (>3% from spot) get a 1.4x score boost since
    deep OTM high-volume trades indicate stronger directional conviction.

    Returns contracts sorted by anomaly score (highest first) with:
    - moneyness_pct: how far OTM the strike is (% from spot)
    - is_otm: true if >3% from spot
    - sentiment: BULL (call) or BEAR (put)
    - vol_oi_ratio, iv_pct, expiry_dte

    Complementary to get_unusual_activity() — use both for full picture.
    """
    return _get("/unusual-flow", {
        "ticker":           ticker.upper(),
        "min_vol_oi_ratio": min_vol_oi_ratio,
        "min_volume":       min_volume,
        "top_n":            top_n,
    })


@mcp.tool()
def get_oi_change(ticker: str = "SPY") -> dict:
    """
    Open Interest change delta vs approximately 24 hours ago.

    Tracks OI growth/decline per strike to detect smart money positioning:
    - OI increasing:  new positions being opened (fresh directional conviction)
    - OI decreasing:  positions being closed or rolled
    - Large OI growth at OTM strike: speculative directional bet

    Returns per strike:
    - oi_new, oi_old, delta_oi (change)
    - volume_new, volume_old, delta_volume
    - Current Greeks: iv_new, gex_new, vanna_new, charm_new

    Sorted by |delta_oi| descending (largest changes first).
    """
    return _get("/oi-change", {"ticker": ticker.upper()})


@mcp.tool()
def get_vvix() -> dict:
    """
    VVIX replication using CBOE methodology on VIX options data.

    VVIX = Volatility of VIX = the 'vol of vol' index.
    Measures how much VIX itself is expected to move.

    Interpretation:
    - VVIX > 110:  Very high vol-of-vol — markets expect extreme VIX swings
    - VVIX 90-110: Elevated — caution, vol regime unstable
    - VVIX 80-90:  Normal — typical vol environment
    - VVIX < 80:   Calm — stable vol of vol

    Returns:
    - replicated_vvix: our CBOE-formula replication
    - actual_vvix:     live VVIX from market data
    - deviation:       difference (replicated - actual)
    - accuracy_pct:    replication accuracy %
    - t1_days, t2_days: near/far term VIX option maturities used
    - var_1, var_2:    variance swap rates for each maturity term
    """
    return _get("/vvix")


# ═════════════════════════════════════════════════════════════
# TOOLS — DATABASE HISTORY ENDPOINTS
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def get_history(
    ticker: str = "SPY",
    n: int = 50,
    from_ts: Optional[str] = None,
    to_ts: Optional[str] = None
) -> dict:
    """
    Historical Greeks snapshots from the SQLite database.

    Snapshots are auto-saved every time /api/greeks is fetched.
    Returns oldest-first (chronological order for charting).

    Each record contains: timestamp, spot, total_net_gex, total_net_vanna,
    total_net_charm, gex_regime, gamma_flip, signals.

    Args:
        n:       Number of records to return (1-500, default 50)
        from_ts: Start timestamp filter (ISO8601, e.g. '2024-11-01T09:30:00')
        to_ts:   End timestamp filter (ISO8601)
    """
    params: dict = {"ticker": ticker.upper(), "n": n}
    if from_ts:
        params["from_ts"] = from_ts
    if to_ts:
        params["to_ts"] = to_ts
    return _get("/history", params)


@mcp.tool()
def get_gex_timeseries(ticker: str = "SPY", n: int = 100) -> dict:
    """
    GEX time series from the database — optimized for trend analysis.

    Returns a condensed series of records, each containing:
    [time, spot, total_net_gex, total_gross_gex, gex_regime, gamma_flip]

    Use cases:
    - 'How has GEX trended over the past 100 snapshots?'
    - 'When did SPY flip from positive to negative gamma?'
    - 'What was the gamma flip level at market open vs now?'

    Args:
        n: Number of records (1-1000, default 100)
    """
    return _get("/gex/timeseries", {"ticker": ticker.upper(), "n": n})


@mcp.tool()
def get_signal_log(
    ticker: str = "SPY",
    n: int = 50,
    signal_type: Optional[str] = None
) -> dict:
    """
    Historical log of all signal change events from the database.

    Records every time a market structure signal changes state.

    Signal types (use for filtering):
    - 'gex_regime':    positive_gamma ↔ negative_gamma ↔ neutral
    - 'vanna_signal':  vanna_bullish ↔ vanna_bearish ↔ vanna_neutral
    - 'charm_signal':  charm_bullish ↔ charm_bearish ↔ charm_neutral
    - 'dai_bias':      bullish ↔ bearish ↔ neutral
    - 'vex_signal':    high_vex ↔ normal_vex ↔ low_vex

    Each record: id, timestamp, signal_type, signal_value, prev_value,
    spot_at_signal, gex_at_signal, description.

    Args:
        n:           Number of records (1-500)
        signal_type: Optional filter (one of the types listed above)
    """
    params: dict = {"ticker": ticker.upper(), "n": n}
    if signal_type:
        params["signal_type"] = signal_type
    return _get("/signals/log", params)


@mcp.tool()
def get_backtest(ticker: str = "SPY") -> dict:
    """
    GEX signal accuracy backtest from historical database.

    Tests whether GEX regime signals have predictive power:
    - Positive GEX signal → expects low volatility / mean reversion
    - Negative GEX signal → expects high volatility / trending move

    Evaluates at 3 forward horizons:
    - 1 day:  next-day accuracy
    - 5 days: 1-week accuracy
    - 20 days: 1-month accuracy

    Returns:
    - by_horizon: {1: {total, correct, win_rate%}, 5: ..., 20: ...}
    - by_signal_value: breakdown per specific signal value
    - total_signals: total signals evaluated
    - newly_evaluated: signals evaluated this call (new since last run)

    Note: Requires sufficient historical data in the SQLite DB (50+ signals).
    """
    return _get("/backtest", {"ticker": ticker.upper()})


@mcp.tool()
def get_db_stats() -> dict:
    """
    Greeks database health check and storage statistics.

    Returns:
    - Row counts for each table (snapshots, strike_snapshots, signal_log)
    - File size of greeks.db in MB
    - List of all tickers currently stored in the database
    - Oldest and newest snapshot timestamps per ticker

    Use to verify the database is accumulating data and check coverage.
    """
    return _get("/db/stats")


# ═════════════════════════════════════════════════════════════
# TOOLS — UTILITY / CACHE
# ═════════════════════════════════════════════════════════════

@mcp.tool()
def warm_cache(ticker: str = "SPY") -> dict:
    """
    Pre-warm the options engine cache for a ticker (background, non-blocking).

    Returns immediately — computation runs in a background thread.
    Call this before fetching greeks for a new ticker so data is ready.
    Especially useful for slow tickers (single stocks with large option chains).

    Returns:
    - status: 'warming_started' | 'warming' (already in progress) | 'already_cached'
    - ticker: the normalized ticker symbol
    """
    return _post("/warm", {"ticker": ticker.upper()})


# ═════════════════════════════════════════════════════════════
# ENTRY POINT
# ═════════════════════════════════════════════════════════════

if __name__ == "__main__":
    mcp.run()

"""
options_inventory.py — Options Inventory Engine
================================================
Menghitung Greeks aggregate per expiry dan per strike untuk:

  GEX  — Gamma Exposure (SpotGamma style + Raw BSM)
  Vanna — dDelta/dIV (sensitivity delta terhadap perubahan IV)
  Charm — dDelta/dT  (delta decay terhadap waktu)
  DAI   — Delta-Adjusted Inventory (net directional exposure dealer)
  VEX   — Vega Exposure (sensitivity IV aggregate)

Expiry buckets: 0DTE, 1DTE, 7DTE, 14DTE, 30DTE
Data source   : Alpaca options snapshots + dated contract OI
Fallback      : none; provider/configuration failures are explicit

Cara pakai:
  from options_inventory import OptionsInventoryEngine
  engine = OptionsInventoryEngine(ticker="SPY")
  result = engine.compute_dict()

Author: generated for FLOW's VRP Signal Engine
"""

import warnings
import numpy as np
import pandas as pd
from alpaca_options import AlpacaOptionsProvider, OptionsDataError
from scipy.stats import norm
from datetime import datetime, date, timedelta, timezone
from dataclasses import dataclass, field
from typing import Optional
import time

warnings.filterwarnings("ignore")


# ════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════

TRADING_DAYS    = 252
CONTRACT_SIZE   = 100          # standar equity options
EXPIRY_BUCKETS  = [0, 1, 7, 14, 30]   # DTE buckets
MIN_OI          = 10           # filter OI terlalu kecil (noise)
MIN_IV          = 0.01
MAX_IV          = 5.0
RISK_FREE_RATE  = 0.0525       # approx Fed Funds Rate


# Compatibility for the separate Hybrid/SVI Yahoo research modules. The Alpaca
# OptionsInventoryEngine below never calls these helpers or falls back to Yahoo.
def _get_expiry_dates(ticker_obj) -> list[str]:
    try:
        return list(ticker_obj.options)
    except Exception:
        return []


def _fetch_options_chain(ticker_obj, expiry_str: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    try:
        chain = ticker_obj.option_chain(expiry_str)
        calls, puts = chain.calls.copy(), chain.puts.copy()
        for frame in (calls, puts):
            frame.columns = [c.lower().replace(" ", "_") for c in frame.columns]
            for col in ("bid", "ask", "lastprice", "openinterest", "volume", "impliedvolatility"):
                if col not in frame.columns:
                    frame[col] = 0.0
        return calls, puts
    except Exception:
        return pd.DataFrame(), pd.DataFrame()


def _fetch_spot_price(ticker_obj, ticker_str: str) -> tuple[float, str]:
    """Legacy Yahoo research contract; callers must inspect the source flag."""
    try:
        return float(ticker_obj.fast_info["last_price"]), "realtime"
    except Exception:
        pass
    try:
        import yfinance as yf
        hist = yf.download(ticker_str, period="2d", interval="1d", progress=False, auto_adjust=True)
        if not hist.empty:
            return float(hist["Close"].iloc[-1]), "delayed"
    except Exception:
        pass
    return 450.0, "synthetic"


# ════════════════════════════════════════════════════════
# DATA STRUCTURES
# ════════════════════════════════════════════════════════

@dataclass
class StrikeGreeks:
    """Greeks untuk satu strike di satu expiry."""
    strike:       float
    expiry:       str           # YYYY-MM-DD
    dte:          int           # days to expiry
    option_type:  str           # 'call' atau 'put'
    oi:           int
    volume:       Optional[int]
    mid_price:    float
    iv:           float

    # BSM Greeks
    delta:        float
    gamma:        float
    theta:        float
    vega:         float
    rho:          float
    vanna:        float         # dDelta/dIV
    charm:        float         # dDelta/dT (theta of delta)

    # Exposure metrics (sudah dikali OI × contract_size)
    gex_spotgamma:  float       # gamma × OI × contract_size × spot²  / 10^9
    gex_raw:        float       # gamma × OI × contract_size
    vanna_exp:      float       # vanna × OI × contract_size
    charm_exp:      float       # charm × OI × contract_size
    delta_exp:      float       # delta × OI × contract_size  (untuk DAI)
    vega_exp:       float       # vega  × OI × contract_size  (untuk VEX)
    provenance:    dict = field(default_factory=dict)


@dataclass
class ExpiryInventory:
    """Aggregate Greeks untuk satu expiry bucket."""
    dte_bucket:     int         # 0, 1, 7, 14, 30
    expiry_dates:   list        # tanggal expiry yang masuk bucket ini
    n_strikes:      int
    total_oi_calls: int
    total_oi_puts:  int
    pcr_oi:         float       # put/call ratio by OI

    # Net aggregate (calls - puts untuk dealer perspective)
    # Dealer short calls → long gamma saat harga naik
    # Dealer short puts  → short gamma saat harga turun
    net_gex_spotgamma: float    # key GEX metric
    net_gex_raw:       float
    net_vanna:         float
    net_charm:         float
    net_dai:           float    # net delta exposure (directional)
    net_vex:           float    # net vega exposure

    # Gross (absolute total)
    gross_gex:         float
    gross_vanna:       float
    gross_charm:       float
    gross_vex:         float

    # Key levels
    max_pain:          Optional[float]  # Minimum intrinsic payout, single expiry only
    gamma_flip:        Optional[float]   # level di mana GEX flip sign
    largest_gex_strike: float   # strike dengan GEX terbesar
    largest_gex_value:  float

    # Per-strike breakdown
    strikes:           list     # list of StrikeGreeks dicts


@dataclass
class InventorySnapshot:
    """Full snapshot options inventory satu waktu."""
    timestamp:     str
    ticker:        str
    spot:          float
    data_source:   str

    # Aggregate total semua expiry
    total_net_gex:    float
    total_net_vanna:  float
    total_net_charm:  float
    total_net_dai:    float
    total_net_vex:    float
    total_gross_gex:  float


    # GEX regime
    gex_regime:    str    # 'positive' (bullish suppression) / 'negative' (volatility amplifier)
    gamma_flip:    Optional[float]

    # Per-expiry breakdown
    by_expiry:     dict   # {dte_bucket: ExpiryInventory}

    # Market structure signals
    signals:       dict


# ════════════════════════════════════════════════════════
# BSM GREEKS ENGINE
# ════════════════════════════════════════════════════════

def _d1_d2(S: float, K: float, T: float, r: float, sigma: float):
    """Hitung d1 dan d2 untuk BSM."""
    if T <= 1e-6 or sigma <= MIN_IV:
        return 0.0, 0.0
    sqrt_T = np.sqrt(T)
    d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqrt_T)
    d2 = d1 - sigma * sqrt_T
    return d1, d2


def bsm_greeks(
    S: float, K: float, T: float, r: float, sigma: float, option_type: str = "call"
) -> dict:
    """
    Hitung semua Greeks BSM + Vanna + Charm.

    Returns dict dengan keys:
      delta, gamma, theta, vega, rho, vanna, charm

    Vanna  = dDelta/dSigma = vega/S × (d2/sigma) = -pdf(d1) × d2 / sigma
    Charm  = dDelta/dT     = -pdf(d1) × [2rT - d2·sigma·√T] / (2T·sigma·√T)
             (negatif → delta decay)
    """
    if T <= 1e-6 or sigma <= MIN_IV or sigma > MAX_IV:
        # At/past expiry
        if option_type == "call":
            delta = 1.0 if S > K else 0.0
            price = max(0.0, S - K)
        else:
            delta = -1.0 if S < K else 0.0
            price = max(0.0, K - S)
        return dict(price=price, delta=delta, gamma=0.0, theta=0.0, vega=0.0,
                    rho=0.0, vanna=0.0, charm=0.0)

    d1, d2     = _d1_d2(S, K, T, r, sigma)
    pdf_d1     = norm.pdf(d1)
    cdf_d1     = norm.cdf(d1)
    cdf_d2     = norm.cdf(d2)
    sqrt_T     = np.sqrt(T)

    # Delta
    if option_type == "call":
        delta = cdf_d1
    else:
        delta = cdf_d1 - 1.0

    # Gamma (sama untuk call dan put)
    gamma = pdf_d1 / (S * sigma * sqrt_T)

    # Theta (per calendar day, bukan per year)
    term1 = -(S * pdf_d1 * sigma) / (2 * sqrt_T)
    if option_type == "call":
        term2 = -r * K * np.exp(-r * T) * cdf_d2
        theta = (term1 + term2) / 365
    else:
        term2 = r * K * np.exp(-r * T) * norm.cdf(-d2)
        theta = (term1 + term2) / 365

    # Vega (per 1% IV move)
    vega = S * pdf_d1 * sqrt_T / 100

    # Rho
    if option_type == "call":
        rho = K * T * np.exp(-r * T) * cdf_d2 / 100
    else:
        rho = -K * T * np.exp(-r * T) * norm.cdf(-d2) / 100

    # Vanna = dDelta/dSigma = -pdf(d1) × d2 / sigma
    # Positif vanna → delta naik saat IV naik (call); amplifikasi move
    vanna = -pdf_d1 * d2 / sigma

    # Charm = dDelta/dT
    # Untuk call: charm = -pdf(d1) × [2rT - d2·sigma·√T] / (2T·sigma·√T)
    if T > 1e-6:
        charm_num = 2 * r * T - d2 * sigma * sqrt_T
        charm_den = 2 * T * sigma * sqrt_T
        if option_type == "call":
            charm = -pdf_d1 * charm_num / charm_den
        else:
            charm = pdf_d1 * charm_num / charm_den
    else:
        charm = 0.0

    # Option Price
    if option_type == "call":
        price = S * cdf_d1 - K * np.exp(-r * T) * cdf_d2
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

    return dict(
        price=float(price),
        delta=float(delta),
        gamma=float(gamma),
        theta=float(theta),
        vega=float(vega),
        rho=float(rho),
        vanna=float(vanna),
        charm=float(charm),
    )


def implied_vol_newton(
    market_price: float, S: float, K: float, T: float, r: float,
    option_type: str = "call", max_iter: int = 100
) -> float:
    """Newton-Raphson IV solver."""
    if T <= 1e-6 or market_price <= 0:
        return 0.0

    # Initial guess
    sigma = max(MIN_IV, min((market_price / S) * np.sqrt(2 * np.pi / max(T, 1e-6)), MAX_IV))

    for _ in range(max_iter):
        d1, d2 = _d1_d2(S, K, T, r, sigma)
        pdf_d1 = norm.pdf(d1)
        cdf_d1 = norm.cdf(d1)
        cdf_d2 = norm.cdf(d2)

        if option_type == "call":
            price = S * cdf_d1 - K * np.exp(-r * T) * cdf_d2
        else:
            price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

        vega_raw = S * pdf_d1 * np.sqrt(T)
        diff = price - market_price

        if abs(diff) < 1e-6 or abs(vega_raw) < 1e-10:
            break

        sigma -= diff / vega_raw
        sigma = max(MIN_IV, min(sigma, MAX_IV))

    return float(sigma)


# ════════════════════════════════════════════════════════
# DATA FETCH & SYNTHETIC FALLBACK
# ════════════════════════════════════════════════════════

def _dte(expiry_str: str) -> int:
    """Hitung DTE dari string YYYY-MM-DD."""
    try:
        exp_date = datetime.strptime(expiry_str, "%Y-%m-%d").date()
        today    = date.today()
        return max(0, (exp_date - today).days)
    except Exception:
        return 999


def _assign_bucket(dte_val: int) -> Optional[int]:
    """
    Assign DTE ke bucket terdekat.
    Rules:
      0DTE  → dte == 0
      1DTE  → dte == 1
      7DTE  → 2 <= dte <= 10
      14DTE → 11 <= dte <= 21
      30DTE → 22 <= dte <= 45
      None  → di luar range (skip)
    """
    if dte_val == 0:
        return 0
    elif dte_val == 1:
        return 1
    elif 2 <= dte_val <= 10:
        return 7
    elif 11 <= dte_val <= 21:
        return 14
    elif 22 <= dte_val <= 45:
        return 30
    return None


# ════════════════════════════════════════════════════════
# GREEKS COMPUTATION PER STRIKE
# ════════════════════════════════════════════════════════

def _compute_strike_greeks(
    row: pd.Series,
    option_type: str,
    S: float,
    expiry_str: str,
    dte_val: int,
    r: float = RISK_FREE_RATE,
) -> Optional[StrikeGreeks]:
    """
    Hitung StrikeGreeks untuk satu row options chain.
    Return None kalau OI terlalu kecil atau data invalid.
    """
    try:
        K   = float(row["strike"])
        oi  = int(row.get("openinterest", 0) or 0)
        raw_volume = row.get("volume")
        vol = int(raw_volume) if raw_volume is not None and pd.notna(raw_volume) else None

        if oi < MIN_OI or K <= 0:
            return None

        # Mid price
        bid = float(row.get("bid", 0) or 0)
        ask = float(row.get("ask", 0) or 0)
        if bid > 0 and ask > 0:
            mid = (bid + ask) / 2
        else:
            mid = float(row.get("lastprice", 0) or 0)

        if mid <= 0:
            return None

        # T (time to expiry dalam tahun)
        T = max(dte_val, 0.5) / 365  # minimal 0.5 hari untuk prevent div/0

        # All displayed/model Greeks use one BSM convention from provider IV.
        iv_raw = float(row.get("impliedvolatility", 0) or 0)
        if MIN_IV <= iv_raw <= MAX_IV:
            iv = iv_raw
        else:
            iv = implied_vol_newton(mid, S, K, T, r, option_type)

        if iv < MIN_IV:
            return None

        # BSM Greeks
        g = bsm_greeks(S, K, T, r, iv, option_type)

        # Exposure metrics (dikali OI × contract_size)
        notional = oi * CONTRACT_SIZE

        # GEX SpotGamma style: gamma × OI × contract_size × spot² / 1e9
        # Calls → dealer short → positif GEX (mereka long gamma)
        # Puts  → dealer short → negatif GEX (mereka short gamma)
        sign = 1.0 if option_type == "call" else -1.0

        gex_sg  = sign * g["gamma"] * notional * (S ** 2) / 1e9
        gex_raw = sign * g["gamma"] * notional

        # Vanna exposure: vanna × OI × contract_size
        # Dealer short calls → long vanna → exposure naik saat IV naik
        vanna_exp = sign * g["vanna"] * notional

        # Charm exposure: charm × OI × contract_size
        charm_exp = sign * g["charm"] * notional

        # Delta exposure (untuk DAI): delta × OI × contract_size
        # Net delta yang perlu di-hedge oleh dealer
        delta_exp = sign * g["delta"] * notional

        # Vega exposure (untuk VEX)
        vega_exp = sign * g["vega"] * notional

        return StrikeGreeks(
            strike=K,
            expiry=expiry_str,
            dte=dte_val,
            option_type=option_type,
            oi=oi,
            volume=vol,
            mid_price=round(mid, 4),
            iv=round(iv, 6),
            delta=round(g["delta"], 6),
            gamma=round(g["gamma"], 8),
            theta=round(g["theta"], 6),
            vega=round(g["vega"], 6),
            rho=round(g["rho"], 6),
            vanna=round(g["vanna"], 8),
            charm=round(g["charm"], 8),
            gex_spotgamma=round(gex_sg, 6),
            gex_raw=round(gex_raw, 4),
            vanna_exp=round(vanna_exp, 4),
            charm_exp=round(charm_exp, 4),
            delta_exp=round(delta_exp, 4),
            vega_exp=round(vega_exp, 4),
            provenance={key: row.get(key) for key in ('contract_symbol', 'oi_date', 'quote_timestamp', 'trade_timestamp', 'provider_greeks', 'contract_size') if row.get(key) is not None},
        )
    except Exception:
        return None


# ════════════════════════════════════════════════════════
# MAX PAIN CALCULATION
# ════════════════════════════════════════════════════════

def _calculate_max_pain(calls_df: pd.DataFrame, puts_df: pd.DataFrame, spot: float) -> Optional[float]:
    """Minimum intrinsic payout at one expiry, using fixed eligible OI.

    No positive OI means unavailable. Equal minima use the lowest strike.
    This descriptive level is not a price forecast; spot is kept for API compatibility.
    """
    sides = []
    for frame in (calls_df, puts_df):
        if frame.empty or not {"strike", "openinterest"}.issubset(frame.columns):
            sides.append((np.array([]), np.array([])))
            continue
        k = pd.to_numeric(frame["strike"], errors="coerce").to_numpy(dtype=float)
        oi = pd.to_numeric(frame["openinterest"], errors="coerce").to_numpy(dtype=float)
        valid = np.isfinite(k) & np.isfinite(oi) & (k > 0) & (oi >= 0)
        sides.append((k[valid], oi[valid]))
    if sum(float(oi.sum()) for _, oi in sides) <= 0:
        return None
    strikes = np.unique(np.concatenate([k for k, _ in sides]))
    payout = np.zeros(len(strikes))
    for side, (k, oi) in enumerate(sides):
        weights = np.bincount(np.searchsorted(strikes, k), weights=oi, minlength=len(strikes))
        cumulative = np.cumsum(weights)
        weighted = np.cumsum(weights * strikes)
        payout += (strikes * cumulative - weighted) if side == 0 else (
            weighted[-1] - weighted - strikes * (cumulative[-1] - cumulative))
    return float(strikes[np.argmin(payout)])


# ════════════════════════════════════════════════════════
# GAMMA FLIP CALCULATION
# ════════════════════════════════════════════════════════

def _compute_total_gex_at_spot(
    S_hypo: float,
    strikes: np.ndarray,
    option_types: np.ndarray,
    T: np.ndarray,
    sqrt_T: np.ndarray,
    ivs: np.ndarray,
    ois: np.ndarray,
    r: float,
) -> float:
    """
    Compute total net GEX at a hypothetical spot level S_hypo.
    Uses vectorized BSM gamma across all option contracts.

    GEX per contract = sign * gamma(S_hypo, K, T, IV) * OI * 100 * S_hypo^2 / 1e9
    where sign = +1 for calls, -1 for puts (model convention only).

    Returns: legacy scaled GEX; multiply by 1e7 for USD per 1% spot move.
    """
    d1 = (np.log(S_hypo / strikes) + (r + 0.5 * ivs ** 2) * T) / (ivs * sqrt_T)
    gamma = norm.pdf(d1) / (S_hypo * ivs * sqrt_T)
    gex = option_types * gamma * ois * CONTRACT_SIZE * (S_hypo ** 2) / 1e9
    return float(np.sum(gex))


def _find_zero_crossings(spot_grid: np.ndarray, gex_grid: np.ndarray) -> list[float]:
    """
    Find all zero-crossing points (where total GEX flips sign)
    using linear interpolation between adjacent grid points.
    """
    crossings = []
    for i in range(len(gex_grid) - 1):
        g1, g2 = gex_grid[i], gex_grid[i + 1]
        if not np.isfinite(g1) or not np.isfinite(g2):
            continue
        if g1 == 0 and i > 0 and np.isfinite(gex_grid[i - 1]) and gex_grid[i - 1] * g2 < 0:
            crossings.append(float(spot_grid[i]))
        if (g1 < 0 < g2) or (g2 < 0 < g1):  # avoid product underflow
            s1, s2 = spot_grid[i], spot_grid[i + 1]
            denom = g2 - g1
            if denom != 0:
                flip = s1 - g1 * (s2 - s1) / denom
            else:
                flip = 0.5 * (s1 + s2)
            crossings.append(float(flip))
    return crossings


def _find_gamma_flip(strikes_data: list, spot: float, r: float = RISK_FREE_RATE) -> Optional[float]:
    """Closest sampled sign crossing of call-positive/put-negative BSM GEX.

    Fixed IV and OI, searched over 50–150% of spot. No crossing means None,
    not a boundary estimate. These are model exposures, not dealer positions.
    """
    if not strikes_data or not np.isfinite(spot) or spot <= 0:
        return None

    # ── 1. Extract option parameters ──────────────────────
    arr_strikes = []
    arr_types = []
    arr_dtes = []
    arr_ivs = []
    arr_ois = []

    for s in strikes_data:
        is_dict = isinstance(s, dict)
        k       = s.get("strike")      if is_dict else getattr(s, "strike", None)
        otype   = s.get("option_type") if is_dict else getattr(s, "option_type", None)
        dte     = s.get("dte")         if is_dict else getattr(s, "dte", None)
        iv      = s.get("iv")          if is_dict else getattr(s, "iv", None)
        oi      = s.get("oi")          if is_dict else getattr(s, "oi", None)

        if any(v is None for v in (k, otype, dte, iv, oi)):
            continue

        try:
            k, dte, iv, oi = map(float, (k, dte, iv, oi))
        except (TypeError, ValueError):
            continue
        if not all(np.isfinite(v) for v in (k, dte, iv, oi)) or k <= 0 or dte < 0 or iv <= 0 or oi <= 0 or otype not in ("call", "put"):
            continue
        arr_strikes.append(float(k))
        arr_types.append(1.0 if str(otype).lower() == "call" else -1.0)
        arr_dtes.append(float(dte))
        arr_ivs.append(float(iv))
        arr_ois.append(float(oi))

    if not arr_strikes:
        return None

    strikes_np = np.array(arr_strikes)
    types_np   = np.array(arr_types)
    dtes_np    = np.array(arr_dtes)
    ivs_np     = np.maximum(np.array(arr_ivs), MIN_IV)
    ois_np     = np.array(arr_ois)

    T_np     = np.maximum(dtes_np, 0.5) / 365.0
    sqrt_T_np = np.sqrt(T_np)

    # ── 2. Multi-pass grid search (narrow → wide → ultra-wide) ──
    search_ranges = [
        (0.85, 1.15, 400),   # Pass 1: ±15% spot, 400 points
        (0.70, 1.30, 400),   # Pass 2: ±30% spot, 400 points
        (0.50, 1.50, 500),   # Pass 3: ±50% spot, 500 points
    ]

    for lo_mult, hi_mult, n_pts in search_ranges:
        grid = np.linspace(lo_mult * spot, hi_mult * spot, n_pts)
        gex_vals = np.array([
            _compute_total_gex_at_spot(
                S, strikes_np, types_np, T_np, sqrt_T_np, ivs_np, ois_np, r
            )
            for S in grid
        ])

        crossings = _find_zero_crossings(grid, gex_vals)
        if crossings:
            # Return the crossing closest to current spot
            best = min(crossings, key=lambda x: abs(x - spot))
            return round(best, 2)

    return None


# ════════════════════════════════════════════════════════
# EXPIRY INVENTORY AGGREGATION
# ════════════════════════════════════════════════════════

def _aggregate_expiry_inventory(
    strikes_data: list[StrikeGreeks],
    expiry_dates: list[str],
    dte_bucket: int,
    calls_df: pd.DataFrame,
    puts_df: pd.DataFrame,
    spot: float,
    r: float = RISK_FREE_RATE,
) -> ExpiryInventory:
    """Aggregate semua StrikeGreeks menjadi ExpiryInventory untuk satu bucket."""

    if not strikes_data:
        return ExpiryInventory(
            dte_bucket=dte_bucket,
            expiry_dates=expiry_dates,
            n_strikes=0,
            total_oi_calls=0,
            total_oi_puts=0,
            pcr_oi=0.0,
            net_gex_spotgamma=0.0,
            net_gex_raw=0.0,
            net_vanna=0.0,
            net_charm=0.0,
            net_dai=0.0,
            net_vex=0.0,
            gross_gex=0.0,
            gross_vanna=0.0,
            gross_charm=0.0,
            gross_vex=0.0,
            max_pain=None,
            gamma_flip=None,
            largest_gex_strike=spot,
            largest_gex_value=0.0,
            strikes=[],
        )

    # Net aggregate
    net_gex_sg  = sum(s.gex_spotgamma for s in strikes_data)
    net_gex_raw = sum(s.gex_raw       for s in strikes_data)
    net_vanna   = sum(s.vanna_exp     for s in strikes_data)
    net_charm   = sum(s.charm_exp     for s in strikes_data)
    net_dai     = sum(s.delta_exp     for s in strikes_data)
    net_vex     = sum(s.vega_exp      for s in strikes_data)

    # Gross (absolute)
    gross_gex    = sum(abs(s.gex_spotgamma) for s in strikes_data)
    gross_vanna  = sum(abs(s.vanna_exp)     for s in strikes_data)
    gross_charm  = sum(abs(s.charm_exp)     for s in strikes_data)
    gross_vex    = sum(abs(s.vega_exp)      for s in strikes_data)

    # OI totals
    oi_calls = sum(s.oi for s in strikes_data if s.option_type == "call")
    oi_puts  = sum(s.oi for s in strikes_data if s.option_type == "put")
    pcr      = oi_puts / oi_calls if oi_calls > 0 else 0.0

    # Max pain
    max_pain = _calculate_max_pain(calls_df, puts_df, spot) if len(set(expiry_dates)) == 1 else None

    # Gamma flip
    gamma_flip = _find_gamma_flip(strikes_data, spot, r)

    # Largest GEX strike
    if strikes_data:
        largest = max(strikes_data, key=lambda x: abs(x.gex_spotgamma))
        largest_gex_strike = largest.strike
        largest_gex_value  = largest.gex_spotgamma
    else:
        largest_gex_strike = spot
        largest_gex_value  = 0.0

    # Convert strikes to dicts untuk serialization
    strikes_dicts = [
        {
            "strike":          s.strike,
            "option_type":     s.option_type,
            "expiry":          s.expiry,
            "dte":             s.dte,
            "oi":              s.oi,
            "volume":          s.volume,
            "mid_price":       s.mid_price,
            "iv":              s.iv,
            "delta":           s.delta,
            "gamma":           s.gamma,
            "theta":           s.theta,
            "vega":            s.vega,
            "rho":             s.rho,
            "vanna":           s.vanna,
            "charm":           s.charm,
            "gex_spotgamma":   s.gex_spotgamma,
            "gex_raw":         s.gex_raw,
            "vanna_exp":       s.vanna_exp,
            "charm_exp":       s.charm_exp,
            "delta_exp":       s.delta_exp,
            "vega_exp":        s.vega_exp,
            **s.provenance,
        }
        for s in strikes_data
    ]

    return ExpiryInventory(
        dte_bucket=dte_bucket,
        expiry_dates=expiry_dates,
        n_strikes=len(strikes_data),
        total_oi_calls=oi_calls,
        total_oi_puts=oi_puts,
        pcr_oi=round(pcr, 4),
        net_gex_spotgamma=round(net_gex_sg,  4),
        net_gex_raw=round(net_gex_raw,       2),
        net_vanna=round(net_vanna,            4),
        net_charm=round(net_charm,            4),
        net_dai=round(net_dai,                4),
        net_vex=round(net_vex,                4),
        gross_gex=round(gross_gex,            4),
        gross_vanna=round(gross_vanna,        4),
        gross_charm=round(gross_charm,        4),
        gross_vex=round(gross_vex,            4),
        max_pain=round(max_pain, 2) if max_pain is not None else None,
        gamma_flip=gamma_flip,
        largest_gex_strike=largest_gex_strike,
        largest_gex_value=round(largest_gex_value, 4),
        strikes=strikes_dicts,
    )


# ════════════════════════════════════════════════════════
# MARKET STRUCTURE SIGNALS
# ════════════════════════════════════════════════════════

def _generate_signals(
    total_gex: float,
    total_vanna: float,
    total_charm: float,
    total_dai: float,
    total_vex: float,
    spot: float,
    gamma_flip: Optional[float],
    by_expiry: dict,
) -> dict:
    """
    Generate market structure signals dari aggregate Greeks.

    Returns dict of signal interpretations.
    """
    signals = {}

    # ── GEX Regime ──────────────────────────────────
    if total_gex > 0.5:
        signals["gex_regime"]   = "POSITIVE_GAMMA"
        signals["gex_desc"]     = "Dealer long gamma → mereka jual saat naik, beli saat turun → volatilitas tertekan"
        signals["gex_desc_slang"] = "Bandar lagi adem ayem, bro. Setiap harga naik disundul jual, turun diserok beli. Pasar dibikin mager, gerak dikit-dikit doang, gak bakal ada kejutan liar!"
    elif total_gex < -0.5:
        signals["gex_regime"]   = "NEGATIVE_GAMMA"
        signals["gex_desc"]     = "Dealer short gamma → mereka beli saat naik, jual saat turun → volatilitas diamplifikasi"
        signals["gex_desc_slang"] = "Wah gawat, bandar lagi boncos kejar-kejaran! Harga naik mereka FOMO beli, harga turun mereka panic selling. Volatilitas bakal ngamuk, siap-siap naik turun roller coaster liar!"
    else:
        signals["gex_regime"]   = "NEUTRAL_GAMMA"
        signals["gex_desc"]     = "GEX mendekati nol, tidak ada dominasi jelas dari dealer hedging"
        signals["gex_desc_slang"] = "Bandar lagi pada ngopi-ngopi doang, gak ada yang ngegas. Arah pasar terserah retail atau angin, gak ada penahan sama sekali!"

    # ── Gamma Flip vs Spot ───────────────────────────
    if gamma_flip:
        dist_pct = (spot - gamma_flip) / spot * 100
        if dist_pct > 0:
            signals["gamma_flip_position"] = f"Spot {dist_pct:.1f}% DI ATAS gamma flip ({gamma_flip:.1f}) → zona positive gamma"
        else:
            signals["gamma_flip_position"] = f"Spot {abs(dist_pct):.1f}% DI BAWAH gamma flip ({gamma_flip:.1f}) → zona negative gamma"

    # ── Vanna Signal ─────────────────────────────────
    if total_vanna > 0.3:
        signals["vanna_signal"] = "BULLISH_VANNA"
        signals["vanna_desc"]   = "Net positive vanna → kalau IV turun, dealer unwind hedge → tekanan beli di spot"
        signals["vanna_desc_slang"] = "IV (kepanikan) lagi loyo nih. Karena market adem, bandar lepas tameng hedging-an mereka dan malah belanja spot. Angin seger buat buy!"
    elif total_vanna < -0.3:
        signals["vanna_signal"] = "BEARISH_VANNA"
        signals["vanna_desc"]   = "Net negative vanna → kalau IV naik, dealer hedging → tekanan jual di spot"
        signals["vanna_desc_slang"] = "Kepanikan pasar (IV) lagi nanjak. Bandar parno langsung pasang tameng hedging dan buang barang di pasar spot. Awas longsor, mending tiarap dulu!"
    else:
        signals["vanna_signal"] = "NEUTRAL_VANNA"
        signals["vanna_desc"]   = "Vanna exposure relatif seimbang"
        signals["vanna_desc_slang"] = "Pasar lagi santai, emosi bandar terkendali gak ada aksi panic buy atau panic sell gara-gara IV."

    # ── Charm Signal (relevan menjelang OPEX) ────────
    if abs(total_charm) > 0.2:
        if total_charm > 0:
            signals["charm_signal"] = "CHARM_TAILWIND"
            signals["charm_desc"]   = "Positive charm → delta dealer meningkat seiring waktu → support harga"
            signals["charm_desc_slang"] = "Waktu berpihak ke kita! Tiap hari delta bandar naik sendiri gara-gara decay waktu. Ada dorongan halus ke atas layaknya angin buritan!"
        else:
            signals["charm_signal"] = "CHARM_HEADWIND"
            signals["charm_desc"]   = "Negative charm → delta dealer berkurang seiring waktu → tekanan ke bawah"
            signals["charm_desc_slang"] = "Waktu adalah musuh! Tiap hari delta bandar kemakan waktu (decay) ke bawah. Harga bakal berasa berat buat naik, ada tekanan jual halus tapi konsisten!"
    else:
        signals["charm_signal"] = "CHARM_NEUTRAL"
        signals["charm_desc"]   = "Charm minimal"
        signals["charm_desc_slang"] = "Waktu gak ngaruh apa-apa hari ini, decay waktu gak bikin bandar keringat dingin."

    # ── DAI (Directional bias dari dealer) ───────────
    if total_dai > 1000:
        signals["dai_bias"]  = "DEALER_NET_LONG"
        signals["dai_desc"]  = f"Dealer net long {total_dai:.0f} deltas → potensi jual saat rally"
        signals["dai_desc_slang"] = f"Bandar lagi megang barang kebanyakan ({total_dai:.0f} delta). Kalau harga naik dikit, mereka bakal langsung guyur jualan biar gak keberatan muatan!"
    elif total_dai < -1000:
        signals["dai_bias"]  = "DEALER_NET_SHORT"
        signals["dai_desc"]  = f"Dealer net short {abs(total_dai):.0f} deltas → potensi beli saat turun"
        signals["dai_desc_slang"] = f"Bandar lagi boncos jualan kosong/short ({abs(total_dai):.0f} delta). Begitu harga turun dikit, mereka bakal serok beli buat nutup lubang short-nya!"
    else:
        signals["dai_bias"]  = "DEALER_BALANCED"
        signals["dai_desc"]  = "Posisi delta dealer relatif balanced"
        signals["dai_desc_slang"] = "Muatan bandar lagi pas, gak kurang gak lebih. Gak bakal ada aksi guyur massal atau serok brutal dari mereka."

    # ── VEX (IV sensitivity) ─────────────────────────
    if total_vex > 500:
        signals["vex_signal"] = "HIGH_VEX"
        signals["vex_desc"]   = "Vega exposure tinggi → market sangat sensitif terhadap perubahan IV"
        signals["vex_desc_slang"] = "Senggol bacok nih market sama yang namanya IV! Kepanikan naik dikit aja, portofolio bandar bisa langsung kebakaran atau pesta pora!"
    elif total_vex < -500:
        signals["vex_signal"] = "SHORT_VEX"
        signals["vex_desc"]   = "Net short vega → dealer butuh IV turun untuk profit"
        signals["vex_desc_slang"] = "Bandar lagi berdoa khusyuk biar kepanikan pasar mereda (IV turun) biar mereka bisa cuan lebar. Kalau IV malah lompat, mereka nangis bombay!"
    else:
        signals["vex_signal"] = "MODERATE_VEX"
        signals["vex_desc"]   = "Vega exposure moderat"
        signals["vex_desc_slang"] = "Biasa aja bro, bandar lagi santai gak terlalu sensitif sama naik turunnya kepanikan pasar (IV)."

    # ── 0DTE specific ────────────────────────────────
    if 0 in by_expiry:
        dte0 = by_expiry[0]
        if dte0.net_gex_spotgamma != 0:
            signals["dte0_gex"]  = round(dte0.net_gex_spotgamma, 4)
            signals["dte0_desc"] = "GEX dari 0DTE options — dominan saat expiry harian (Tue/Thu/Fri untuk SPY)"

    # ── DGCI (Dealer Gamma Condition Index) ──────────
    total_oi = sum((getattr(v, "total_oi_calls", 0) + getattr(v, "total_oi_puts", 0)) for v in by_expiry.values())
    if total_oi > 0 and gamma_flip:
        # Distance component (-50 to +50)
        dist_pct = (spot - gamma_flip) / spot * 100
        dist_component = max(-50, min(50, dist_pct * 10))

        # GEX / OI component (-50 to +50)
        oi_millions = total_oi / 1_000_000
        gex_ratio = total_gex / oi_millions if oi_millions > 0 else 0
        gex_component = max(-50, min(50, gex_ratio * 50))

        dgci = dist_component + gex_component
        dgci = max(-100, min(100, dgci))

        signals["dgci"] = round(dgci, 2)
        signals["dgci_desc"] = f"DGCI Score: {round(dgci, 2)} ({round(gex_component, 1)} GEX/OI, {round(dist_component, 1)} Spot dist)"

        # Slang for DGCI
        if dgci > 60:
            signals["dgci_desc_slang"] = f"Skor DGCI mantap jiwa ({round(dgci, 1)})! Tembok pertahanan bandar tebel abis, siap nahan longsoran gimanapun!"
        elif dgci > 20:
            signals["dgci_desc_slang"] = f"Skor DGCI aman terkendali ({round(dgci, 1)}). Bandar masih punya bensin buat jaga lapak."
        elif dgci > -20:
            signals["dgci_desc_slang"] = f"Skor DGCI biasa aja ({round(dgci, 1)}). Pasar lagi galau, bandar cuma nunggu momen."
        elif dgci > -60:
            signals["dgci_desc_slang"] = f"Skor DGCI agak was-was ({round(dgci, 1)}). Bandar mulai ketar-ketir, tameng mereka mulai tipis."
        else:
            signals["dgci_desc_slang"] = f"Skor DGCI kritis parah ({round(dgci, 1)})! Bandar lagi capitulation/nyerah, market rawan jebol dan ambyar!"

    return signals


# ════════════════════════════════════════════════════════
# MAIN ENGINE CLASS
# ════════════════════════════════════════════════════════

class OptionsInventoryEngine:
    """
    Engine utama untuk menghitung Options Inventory (GEX, Vanna, Charm, DAI, VEX).

    Usage:
        engine = OptionsInventoryEngine(ticker="SPY")
        result = engine.compute_dict()

    State:
        Cache ticker object dan spot price (TTL 5 menit).
        Options chain di-fetch fresh tiap compute() dipanggil
        karena OI bisa berubah intraday.
    """

    def __init__(
        self,
        ticker:    str   = "SPY",
        r:         float = RISK_FREE_RATE,
        cache_ttl: int   = 300,   # 5 menit
    ):
        self.ticker    = ticker
        self.r         = r
        self.cache_ttl = cache_ttl

        self._provider = None
        self._provenance = {}

    def compute(self) -> InventorySnapshot:
        if self._provider is None:
            self._provider = AlpacaOptionsProvider()
        bundle = self._provider.load(self.ticker)
        spot = bundle['spot']
        fetched_chains = bundle['chains']
        self._provenance = bundle['provenance']
        self._provenance['risk_free_rate'] = self.r
        asof_date = bundle['asof_date']
        bucket_map = {b: [] for b in EXPIRY_BUCKETS}
        for expiry in fetched_chains:
            dte_value = (date.fromisoformat(expiry) - asof_date).days
            bucket = _assign_bucket(dte_value)
            if bucket is not None:
                bucket_map[bucket].append(expiry)
        # ── Process each bucket ───────────────────────
        by_expiry: dict[int, ExpiryInventory] = {}
        all_strikes_data: list[StrikeGreeks]   = []

        for bucket, exp_list in bucket_map.items():
            if not exp_list:
                continue

            bucket_calls = []
            bucket_puts  = []
            bucket_strikes: list[StrikeGreeks] = []
            all_calls_df_list = []
            all_puts_df_list  = []

            for exp_str in exp_list:
                dte_val = (date.fromisoformat(exp_str) - asof_date).days
                calls_df, puts_df = fetched_chains[exp_str]
                all_calls_df_list.append(calls_df)
                all_puts_df_list.append(puts_df)

                # Process calls
                for _, row in calls_df.iterrows():
                    sg = _compute_strike_greeks(row, "call", spot, exp_str, dte_val, self.r)
                    if sg:
                        bucket_strikes.append(sg)

                # Process puts
                for _, row in puts_df.iterrows():
                    sg = _compute_strike_greeks(row, "put", spot, exp_str, dte_val, self.r)
                    if sg:
                        bucket_strikes.append(sg)

            # Combine DFs untuk max pain calculation
            combined_calls = pd.concat(all_calls_df_list, ignore_index=True) if all_calls_df_list else pd.DataFrame()
            combined_puts  = pd.concat(all_puts_df_list,  ignore_index=True) if all_puts_df_list  else pd.DataFrame()

            inv = _aggregate_expiry_inventory(
                bucket_strikes, exp_list, bucket,
                combined_calls, combined_puts, spot, self.r
            )
            by_expiry[bucket]  = inv
            all_strikes_data.extend(bucket_strikes)

        if not all_strikes_data:
            raise OptionsDataError("No valid model Greeks after filtering. An empty chain is not zero exposure.")
        self._provenance["modeled_contracts"] = len(all_strikes_data)
        # ── Total aggregate ───────────────────────────
        total_gex   = sum(v.net_gex_spotgamma for v in by_expiry.values())
        total_vanna = sum(v.net_vanna          for v in by_expiry.values())
        total_charm = sum(v.net_charm          for v in by_expiry.values())
        total_dai   = sum(v.net_dai            for v in by_expiry.values())
        total_vex   = sum(v.net_vex            for v in by_expiry.values())
        total_gross_gex = sum(v.gross_gex      for v in by_expiry.values())

        # Overall gamma flip dari semua strikes
        gamma_flip = _find_gamma_flip(all_strikes_data, spot, self.r)

        # GEX regime
        gex_regime = (
            "positive" if total_gex > 0 else
            "negative" if total_gex < 0 else
            "neutral"
        )

        # Signals
        signals = _generate_signals(
            total_gex, total_vanna, total_charm,
            total_dai, total_vex, spot, gamma_flip, by_expiry
        )

        return InventorySnapshot(
            timestamp=datetime.now(timezone.utc).isoformat(),
            ticker=self.ticker,
            spot=round(spot, 2),
            data_source="live",
            total_net_gex=round(total_gex,   4),
            total_net_vanna=round(total_vanna, 4),
            total_net_charm=round(total_charm, 4),
            total_net_dai=round(total_dai,    4),
            total_net_vex=round(total_vex,    4),
            total_gross_gex=round(total_gross_gex, 4),
            gex_regime=gex_regime,
            gamma_flip=gamma_flip,
            by_expiry=by_expiry,
            signals=signals,
        )

    def compute_dict(self) -> dict:
        """
        Return InventorySnapshot sebagai dict (JSON-serializable).
        Dipakai di FastAPI endpoint.
        """
        snap = self.compute()

        by_expiry_dict = {}
        for bucket, inv in snap.by_expiry.items():
            by_expiry_dict[str(bucket)] = {
                "dte_bucket":          inv.dte_bucket,
                "expiry_dates":        inv.expiry_dates,
                "n_strikes":           inv.n_strikes,
                "total_oi_calls":      inv.total_oi_calls,
                "total_oi_puts":       inv.total_oi_puts,
                "pcr_oi":              inv.pcr_oi,
                "net_gex_spotgamma":   inv.net_gex_spotgamma,
                "net_gex_raw":         inv.net_gex_raw,
                "net_vanna":           inv.net_vanna,
                "net_charm":           inv.net_charm,
                "net_dai":             inv.net_dai,
                "net_vex":             inv.net_vex,
                "gross_gex":           inv.gross_gex,
                "gross_vanna":         inv.gross_vanna,
                "gross_charm":         inv.gross_charm,
                "gross_vex":           inv.gross_vex,
                "max_pain":            inv.max_pain,
                "gamma_flip":          inv.gamma_flip,
                "largest_gex_strike":  inv.largest_gex_strike,
                "largest_gex_value":   inv.largest_gex_value,
                "strikes":             inv.strikes,
            }

        return {
            "timestamp":        snap.timestamp,
            "ticker":           snap.ticker,
            "spot":             snap.spot,
            "data_source":      snap.data_source,
            "provenance":       self._provenance,
            "total_net_gex":    snap.total_net_gex,
            "total_net_vanna":  snap.total_net_vanna,
            "total_net_charm":  snap.total_net_charm,
            "total_net_dai":    snap.total_net_dai,
            "total_net_vex":    snap.total_net_vex,
            "total_gross_gex":  snap.total_gross_gex,
            "gex_regime":       snap.gex_regime,
            "gamma_flip":       snap.gamma_flip,
            "by_expiry":        by_expiry_dict,
            "signals":          snap.signals,
        }



# ════════════════════════════════════════════════════════
# SIMULATOR ENGINE
# ════════════════════════════════════════════════════════

def simulate_greeks_profile(
    snapshot_dict: dict,
    spot_shift_pct: float,
    iv_shift_pct: float,
    days_forward: int,
    r: float = RISK_FREE_RATE
) -> dict:
    """
    Simulate options inventory profile with shifted spot, IV, and DTE.
    Return dictionary expected by the frontend.
    """
    orig_spot = snapshot_dict["spot"]
    new_spot = orig_spot * (1 + spot_shift_pct / 100.0)

    by_expiry = snapshot_dict.get("by_expiry", {})
    
    orig_gex_by_strike = {}
    sim_gex_by_strike = {}
    
    total_orig_gex = 0.0
    total_sim_gex = 0.0
    
    class MockStrike:
        def __init__(self, strike, option_type, dte, iv, oi, gex):
            self.strike = strike
            self.option_type = option_type
            self.dte = dte
            self.iv = iv
            self.oi = oi
            self.gex_spotgamma = gex

    orig_strikes_mock = []
    sim_strikes_mock = []

    for bucket, inv in by_expiry.items():
        for s in inv["strikes"]:
            strike = s["strike"]
            option_type = s["option_type"]
            dte = s["dte"]
            iv = s["iv"]
            oi = s["oi"]
            
            orig_gex = s["gex_spotgamma"]
            
            # Record original
            orig_gex_by_strike[strike] = orig_gex_by_strike.get(strike, 0) + orig_gex
            total_orig_gex += orig_gex
            orig_strikes_mock.append(MockStrike(strike, option_type, dte, iv, oi, orig_gex))
            
            # Simulate new
            new_dte = max(0, dte - days_forward)
            new_T = max(new_dte, 0.5) / 365
            new_iv = max(MIN_IV, iv * (1 + iv_shift_pct / 100.0))
            
            g = bsm_greeks(new_spot, strike, new_T, r, new_iv, option_type)
            sign = 1.0 if option_type == "call" else -1.0
            notional = oi * CONTRACT_SIZE
            sim_gex = sign * g["gamma"] * notional * (new_spot ** 2) / 1e9
            
            sim_gex_by_strike[strike] = sim_gex_by_strike.get(strike, 0) + sim_gex
            total_sim_gex += sim_gex
            sim_strikes_mock.append(MockStrike(strike, option_type, new_dte, new_iv, oi, sim_gex))

    orig_flip = _find_gamma_flip(orig_strikes_mock, orig_spot, r)
    sim_flip = _find_gamma_flip(sim_strikes_mock, new_spot, r)
    
    all_strikes = sorted(set(orig_gex_by_strike.keys()).union(set(sim_gex_by_strike.keys())))
    chart_data = []
    for k in all_strikes:
        chart_data.append({
            "strike": k,
            "orig_gex": round(orig_gex_by_strike.get(k, 0), 4),
            "sim_gex": round(sim_gex_by_strike.get(k, 0), 4)
        })
        
    return {
        "timestamp": snapshot_dict.get("timestamp", datetime.now().isoformat()),
        "ticker": snapshot_dict["ticker"],
        "orig_spot": round(orig_spot, 2),
        "new_spot": round(new_spot, 2),
        "total_orig_gex": round(total_orig_gex, 4),
        "total_sim_gex": round(total_sim_gex, 4),
        "orig_gamma_flip": orig_flip,
        "sim_gamma_flip": sim_flip,
        "chart_data": chart_data
    }


# ════════════════════════════════════════════════════════
# STANDALONE TEST
# ════════════════════════════════════════════════════════


if __name__ == "__main__":
    print("=" * 60)
    print("Options Inventory Engine — Standalone Test")
    print("=" * 60)

    engine = OptionsInventoryEngine(ticker="SPY")
    result = engine.compute_dict()

    print(f"\nTicker     : {result['ticker']}")
    print(f"Spot       : {result['spot']}")
    print(f"Source     : {result['data_source']}")
    print(f"Timestamp  : {result['timestamp']}")
    print(f"\n-- Aggregate Greeks --")
    print(f"Net GEX    : {result['total_net_gex']:.4f}  ({result['gex_regime']})")
    print(f"Gamma Flip : {result['gamma_flip']}")
    print(f"Net Vanna  : {result['total_net_vanna']:.4f}")
    print(f"Net Charm  : {result['total_net_charm']:.4f}")
    print(f"Net DAI    : {result['total_net_dai']:.4f}")
    print(f"Net VEX    : {result['total_net_vex']:.4f}")
    print(f"\n-- By Expiry Bucket --")
    for dte, inv in result["by_expiry"].items():
        print(f"\n  {dte}DTE bucket:")
        print(f"    Expiries    : {inv['expiry_dates']}")
        print(f"    Strikes     : {inv['n_strikes']}")
        print(f"    PCR (OI)    : {inv['pcr_oi']:.2f}")
        print(f"    GEX (SG)    : {inv['net_gex_spotgamma']:.4f}")
        print(f"    Max Pain    : {inv['max_pain']:.2f}")
        print(f"    Gamma Flip  : {inv['gamma_flip']}")
        print(f"    Net Vanna   : {inv['net_vanna']:.4f}")
        print(f"    Net Charm   : {inv['net_charm']:.4f}")
        print(f"    Net DAI     : {inv['net_dai']:.4f}")
        print(f"    Net VEX     : {inv['net_vex']:.4f}")
    print(f"\n-- Signals --")
    for k, v in result["signals"].items():
        print(f"  {k}: {str(v).replace('→', '->')}")


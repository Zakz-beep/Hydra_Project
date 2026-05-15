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
Data source   : yfinance (delay ~15 menit)
Fallback      : synthetic options chain

Cara pakai:
  from options_inventory import OptionsInventoryEngine
  engine = OptionsInventoryEngine(ticker="SPY")
  result = engine.compute_dict()

Author: generated for FLOW's VRP Signal Engine
"""

import warnings
import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm
from datetime import datetime, date, timedelta
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
    volume:       int
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
    max_pain:          float    # strike dengan total pain maksimum
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
        else:
            delta = -1.0 if S < K else 0.0
        return dict(delta=delta, gamma=0.0, theta=0.0, vega=0.0,
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

    return dict(
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

def _get_expiry_dates(ticker_obj) -> list[str]:
    """Ambil semua tanggal expiry yang tersedia."""
    try:
        return list(ticker_obj.options)
    except Exception:
        return []


def _fetch_options_chain(
    ticker_obj, expiry_str: str
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Fetch calls dan puts untuk satu expiry.
    Return (calls_df, puts_df).
    Kolom: strike, lastPrice, bid, ask, openInterest, volume, impliedVolatility
    """
    try:
        chain = ticker_obj.option_chain(expiry_str)
        calls = chain.calls.copy()
        puts  = chain.puts.copy()

        # Normalize kolom
        for df in [calls, puts]:
            df.columns = [c.lower().replace(" ", "_") for c in df.columns]
            for col in ["bid", "ask", "lastprice", "openinterest", "volume", "impliedvolatility"]:
                if col not in df.columns:
                    df[col] = 0.0

        return calls, puts
    except Exception:
        return pd.DataFrame(), pd.DataFrame()


def _gen_synthetic_chain(
    spot: float, expiry_str: str, dte: int, n_strikes: int = 30
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Generate synthetic options chain untuk fallback.
    Log-normal strike distribution di sekitar spot.
    """
    rng = np.random.default_rng(abs(hash(expiry_str)) % 99999)

    T = max(dte, 1) / 365
    base_iv = 0.18 + 0.05 * rng.random()  # base IV antara 18-23%

    # Strikes: ±15% dari spot, spaced 0.5%
    pct_range = np.linspace(-0.15, 0.15, n_strikes)
    strikes   = sorted(spot * np.exp(pct_range))
    strikes   = [round(s, 0) for s in strikes]

    calls_data = []
    puts_data  = []

    for K in strikes:
        moneyness = np.log(K / spot)

        # Volatility smile: higher IV for OTM
        smile = base_iv + 0.3 * moneyness ** 2 + 0.1 * abs(moneyness)
        iv = max(0.05, smile)

        # OI: higher near ATM, lower far OTM
        oi_scale = int(5000 * np.exp(-4 * moneyness ** 2))
        oi_call  = max(10, int(oi_scale * rng.integers(80, 120) / 100))
        oi_put   = max(10, int(oi_scale * rng.integers(80, 120) / 100))

        vol_call = int(oi_call * rng.uniform(0.05, 0.3))
        vol_put  = int(oi_put  * rng.uniform(0.05, 0.3))

        # BSM price
        d1, d2 = _d1_d2(spot, K, T, RISK_FREE_RATE, iv)
        call_p  = spot * norm.cdf(d1) - K * np.exp(-RISK_FREE_RATE * T) * norm.cdf(d2)
        put_p   = K * np.exp(-RISK_FREE_RATE * T) * norm.cdf(-d2) - spot * norm.cdf(-d1)

        spread = max(0.01, call_p * 0.02)

        calls_data.append({
            "strike": K, "lastprice": max(0.01, call_p),
            "bid": max(0.01, call_p - spread), "ask": call_p + spread,
            "openinterest": oi_call, "volume": vol_call, "impliedvolatility": iv
        })
        puts_data.append({
            "strike": K, "lastprice": max(0.01, put_p),
            "bid": max(0.01, put_p - spread), "ask": put_p + spread,
            "openinterest": oi_put, "volume": vol_put, "impliedvolatility": iv
        })

    return pd.DataFrame(calls_data), pd.DataFrame(puts_data)


def _fetch_spot_price(ticker_obj, ticker_str: str) -> tuple[float, str]:
    """Ambil harga spot. Fallback ke history."""
    try:
        spot = float(ticker_obj.fast_info["last_price"])
        return spot, "realtime"
    except Exception:
        pass
    try:
        hist = yf.download(ticker_str, period="2d", interval="1d",
                           progress=False, auto_adjust=True)
        if not hist.empty:
            return float(hist["Close"].iloc[-1]), "delayed"
    except Exception:
        pass
    return 450.0, "synthetic"


# ════════════════════════════════════════════════════════
# DTE BUCKET ASSIGNMENT
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
        vol = int(row.get("volume", 0) or 0)

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

        # IV: pakai yfinance IV kalau tersedia, fallback ke Newton-Raphson
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
        )
    except Exception:
        return None


# ════════════════════════════════════════════════════════
# MAX PAIN CALCULATION
# ════════════════════════════════════════════════════════

def _calculate_max_pain(calls_df: pd.DataFrame, puts_df: pd.DataFrame, spot: float) -> float:
    """
    Max Pain: strike di mana total nilai options yang expire worthless paling besar.
    (Total pain = total payout yang harus dibayar oleh option writers)

    Formula per strike K_test:
        pain(K_test) = Σ_calls [max(0, K_test - K_i) × OI_i]
                     + Σ_puts  [max(0, K_i - K_test) × OI_i]

    Strike dengan pain minimum = max pain level.
    """
    if calls_df.empty and puts_df.empty:
        return spot

    all_strikes = set()
    if not calls_df.empty:
        all_strikes.update(calls_df["strike"].values)
    if not puts_df.empty:
        all_strikes.update(puts_df["strike"].values)

    if not all_strikes:
        return spot

    min_pain = float("inf")
    max_pain_strike = spot

    for K_test in sorted(all_strikes):
        pain = 0.0

        if not calls_df.empty:
            oi_calls = calls_df.get("openinterest", pd.Series(dtype=float)).fillna(0)
            strikes_c = calls_df["strike"].values
            pain += np.sum(np.maximum(0, K_test - strikes_c) * oi_calls.values)

        if not puts_df.empty:
            oi_puts = puts_df.get("openinterest", pd.Series(dtype=float)).fillna(0)
            strikes_p = puts_df["strike"].values
            pain += np.sum(np.maximum(0, strikes_p - K_test) * oi_puts.values)

        if pain < min_pain:
            min_pain = pain
            max_pain_strike = K_test

    return float(max_pain_strike)


# ════════════════════════════════════════════════════════
# GAMMA FLIP CALCULATION
# ════════════════════════════════════════════════════════

def _find_gamma_flip(strikes_data: list[StrikeGreeks], spot: float) -> Optional[float]:
    """
    Cari level di mana net GEX flip dari positif ke negatif (atau sebaliknya).
    Ini adalah level kritis — di atas flip = positive gamma (suppressed vol),
    di bawah flip = negative gamma (amplified vol).

    Method: cumulative GEX dari strikes terdekat ke spot, cari zero crossing.
    """
    if not strikes_data:
        return None

    # Aggregate GEX per strike
    gex_by_strike: dict[float, float] = {}
    for sg in strikes_data:
        gex_by_strike[sg.strike] = gex_by_strike.get(sg.strike, 0) + sg.gex_spotgamma

    if not gex_by_strike:
        return None

    sorted_strikes = sorted(gex_by_strike.keys())
    gex_values     = [gex_by_strike[k] for k in sorted_strikes]

    # Cari zero crossing di antara strikes
    for i in range(len(gex_values) - 1):
        g1, g2 = gex_values[i], gex_values[i + 1]
        if g1 * g2 < 0:  # sign change
            # Linear interpolation
            s1, s2 = sorted_strikes[i], sorted_strikes[i + 1]
            flip = s1 + (s2 - s1) * abs(g1) / (abs(g1) + abs(g2))
            return round(flip, 2)

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
            max_pain=spot,
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
    max_pain = _calculate_max_pain(calls_df, puts_df, spot)

    # Gamma flip
    gamma_flip = _find_gamma_flip(strikes_data, spot)

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
            "iv":              s.iv,
            "delta":           s.delta,
            "gamma":           s.gamma,
            "theta":           s.theta,
            "vega":            s.vega,
            "vanna":           s.vanna,
            "charm":           s.charm,
            "gex_spotgamma":   s.gex_spotgamma,
            "gex_raw":         s.gex_raw,
            "vanna_exp":       s.vanna_exp,
            "charm_exp":       s.charm_exp,
            "delta_exp":       s.delta_exp,
            "vega_exp":        s.vega_exp,
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
        max_pain=round(max_pain,              2),
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
    elif total_gex < -0.5:
        signals["gex_regime"]   = "NEGATIVE_GAMMA"
        signals["gex_desc"]     = "Dealer short gamma → mereka beli saat naik, jual saat turun → volatilitas diamplifikasi"
    else:
        signals["gex_regime"]   = "NEUTRAL_GAMMA"
        signals["gex_desc"]     = "GEX mendekati nol, tidak ada dominasi jelas dari dealer hedging"

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
    elif total_vanna < -0.3:
        signals["vanna_signal"] = "BEARISH_VANNA"
        signals["vanna_desc"]   = "Net negative vanna → kalau IV naik, dealer hedging → tekanan jual di spot"
    else:
        signals["vanna_signal"] = "NEUTRAL_VANNA"
        signals["vanna_desc"]   = "Vanna exposure relatif seimbang"

    # ── Charm Signal (relevan menjelang OPEX) ────────
    if abs(total_charm) > 0.2:
        if total_charm > 0:
            signals["charm_signal"] = "CHARM_TAILWIND"
            signals["charm_desc"]   = "Positive charm → delta dealer meningkat seiring waktu → support harga"
        else:
            signals["charm_signal"] = "CHARM_HEADWIND"
            signals["charm_desc"]   = "Negative charm → delta dealer berkurang seiring waktu → tekanan ke bawah"
    else:
        signals["charm_signal"] = "CHARM_NEUTRAL"
        signals["charm_desc"]   = "Charm minimal"

    # ── DAI (Directional bias dari dealer) ───────────
    if total_dai > 1000:
        signals["dai_bias"]  = "DEALER_NET_LONG"
        signals["dai_desc"]  = f"Dealer net long {total_dai:.0f} deltas → potensi jual saat rally"
    elif total_dai < -1000:
        signals["dai_bias"]  = "DEALER_NET_SHORT"
        signals["dai_desc"]  = f"Dealer net short {abs(total_dai):.0f} deltas → potensi beli saat turun"
    else:
        signals["dai_bias"]  = "DEALER_BALANCED"
        signals["dai_desc"]  = "Posisi delta dealer relatif balanced"

    # ── VEX (IV sensitivity) ─────────────────────────
    if total_vex > 500:
        signals["vex_signal"] = "HIGH_VEX"
        signals["vex_desc"]   = "Vega exposure tinggi → market sangat sensitif terhadap perubahan IV"
    elif total_vex < -500:
        signals["vex_signal"] = "SHORT_VEX"
        signals["vex_desc"]   = "Net short vega → dealer butuh IV turun untuk profit"
    else:
        signals["vex_signal"] = "MODERATE_VEX"
        signals["vex_desc"]   = "Vega exposure moderat"

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

        self._ticker_obj     = None
        self._last_fetch     = 0.0
        self._cached_spot    = None
        self._cached_expiries = []

    def _get_ticker(self):
        """Return cached yfinance Ticker object."""
        now = time.time()
        if self._ticker_obj is None or (now - self._last_fetch) > self.cache_ttl:
            self._ticker_obj      = yf.Ticker(self.ticker)
            self._last_fetch      = now
            self._cached_expiries = _get_expiry_dates(self._ticker_obj)
        return self._ticker_obj

    def compute(self) -> InventorySnapshot:
        """
        Full compute: fetch semua expiry yang relevan, hitung Greeks,
        aggregate per bucket, generate signals.
        """
        ticker_obj = self._get_ticker()
        spot, spot_src = _fetch_spot_price(ticker_obj, self.ticker)
        is_live = spot_src in ("realtime", "delayed")

        expiry_dates = self._cached_expiries
        if not expiry_dates:
            # Pure synthetic mode
            expiry_dates = [
                (date.today() + timedelta(days=d)).strftime("%Y-%m-%d")
                for d in [0, 1, 7, 14, 30]
            ]
            is_live = False

        # ── Group expiries by bucket ──────────────────
        bucket_map: dict[int, list[str]] = {b: [] for b in EXPIRY_BUCKETS}
        for exp_str in expiry_dates:
            dte_val = _dte(exp_str)
            bucket  = _assign_bucket(dte_val)
            if bucket is not None:
                bucket_map[bucket].append(exp_str)

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
                dte_val = _dte(exp_str)

                if is_live:
                    calls_df, puts_df = _fetch_options_chain(ticker_obj, exp_str)
                else:
                    calls_df, puts_df = _gen_synthetic_chain(spot, exp_str, dte_val)

                if calls_df.empty and puts_df.empty:
                    calls_df, puts_df = _gen_synthetic_chain(spot, exp_str, dte_val)

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
                combined_calls, combined_puts, spot
            )
            by_expiry[bucket]  = inv
            all_strikes_data.extend(bucket_strikes)

        # ── Total aggregate ───────────────────────────
        total_gex   = sum(v.net_gex_spotgamma for v in by_expiry.values())
        total_vanna = sum(v.net_vanna          for v in by_expiry.values())
        total_charm = sum(v.net_charm          for v in by_expiry.values())
        total_dai   = sum(v.net_dai            for v in by_expiry.values())
        total_vex   = sum(v.net_vex            for v in by_expiry.values())
        total_gross_gex = sum(v.gross_gex      for v in by_expiry.values())

        # Overall gamma flip dari semua strikes
        gamma_flip = _find_gamma_flip(all_strikes_data, spot)

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
            timestamp=datetime.now().isoformat(),
            ticker=self.ticker,
            spot=round(spot, 2),
            data_source="live" if is_live else "synthetic",
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
    print(f"\n── Aggregate Greeks ──")
    print(f"Net GEX    : {result['total_net_gex']:.4f}  ({result['gex_regime']})")
    print(f"Gamma Flip : {result['gamma_flip']}")
    print(f"Net Vanna  : {result['total_net_vanna']:.4f}")
    print(f"Net Charm  : {result['total_net_charm']:.4f}")
    print(f"Net DAI    : {result['total_net_dai']:.4f}")
    print(f"Net VEX    : {result['total_net_vex']:.4f}")
    print(f"\n── By Expiry Bucket ──")
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
    print(f"\n── Signals ──")
    for k, v in result["signals"].items():
        print(f"  {k}: {v}")
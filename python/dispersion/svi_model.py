"""
svi_model.py — Stochastic Volatility Inspired (SVI) Surface Fitter
===================================================================
Implementasi formula Raw SVI (Jim Gatheral, 2004) untuk fitting kurva
Volatility Smile / Smirk dari data Implied Volatility pasar.

Formula Raw SVI:
    w(k) = a + b * [ρ(k - m) + sqrt((k - m)² + σ²)]

Di mana:
    k   = log-moneyness = ln(K / F)  [F = forward price]
    w   = total implied variance = IV² × T
    a   = level varians keseluruhan
    b   = kemiringan sayap (konveksitas)
    ρ   = korelasi/kemiringan (-1 < ρ < 1), negatif untuk equity skew
    m   = pergeseran horizontal (pusat smile)
    σ   = kelancaran kurva di sekitar m

Referensi:
    Gatheral, J. (2004). "A parsimonious arbitrage-free implied
    volatility parameterization with application to the valuation
    of volatility derivatives."
"""

import numpy as np
from scipy.optimize import minimize, differential_evolution
from typing import Optional


# ═══════════════════════════════════════════════
# CORE SVI FORMULA
# ═══════════════════════════════════════════════

def svi_variance(k: np.ndarray, a: float, b: float, rho: float,
                 m: float, sigma: float) -> np.ndarray:
    """
    Hitung Total Implied Variance w(k) menggunakan formula Raw SVI.

    Args:
        k     : log-moneyness array = ln(K / F)
        a     : level varians (> 0)
        b     : kemiringan sayap (≥ 0)
        rho   : korelasi skew (-1 < ρ < 1)
        m     : pusat smile
        sigma : kelancaran (> 0)

    Returns:
        w(k)  : total implied variance (array)
    """
    return a + b * (rho * (k - m) + np.sqrt((k - m) ** 2 + sigma ** 2))


def svi_iv(k: np.ndarray, T: float, a: float, b: float, rho: float,
           m: float, sigma: float) -> np.ndarray:
    """
    Konversi Total Implied Variance ke Implied Volatility (annualized, desimal).
    w = IV² × T  →  IV = sqrt(w / T)
    """
    w = svi_variance(k, a, b, rho, m, sigma)
    # Clamp agar tidak negatif (numerical safety)
    w = np.maximum(w, 1e-10)
    return np.sqrt(w / T)


# ═══════════════════════════════════════════════
# BUTTERFLY & CALENDAR ARBITRAGE-FREE CHECK
# ═══════════════════════════════════════════════

def check_butterfly_free(k_grid: np.ndarray, a: float, b: float,
                         rho: float, m: float, sigma: float) -> bool:
    """
    Verifikasi kondisi bebas-butterfly arbitrase:
    g(k) = (1 - k·w'/2w)² - (w'/2)²·(1/4 + 1/w) + w''/2 ≥ 0
    (Pendekatan sederhana via finite differences)
    """
    dk = k_grid[1] - k_grid[0] if len(k_grid) > 1 else 0.01
    w = svi_variance(k_grid, a, b, rho, m, sigma)
    dw = np.gradient(w, dk)
    d2w = np.gradient(dw, dk)

    with np.errstate(divide="ignore", invalid="ignore"):
        g = (1 - k_grid * dw / (2 * w)) ** 2 - (dw / 2) ** 2 * (1 / 4 + 1 / w) + d2w / 2

    return bool(np.all(np.isfinite(g)) and np.all(g >= -1e-6))


# ═══════════════════════════════════════════════
# SVI FITTING ENGINE
# ═══════════════════════════════════════════════

def fit_svi(
    strikes: np.ndarray,
    ivs: np.ndarray,
    spot: float,
    T: float,
    forward: Optional[float] = None,
    weights: Optional[np.ndarray] = None,
) -> dict:
    """
    Fitting Raw SVI ke data IV pasar menggunakan L-BFGS-B + global fallback.

    Args:
        strikes : array harga strike opsi
        ivs     : array Implied Volatility (desimal, misal 0.18 = 18%)
        spot    : harga spot saat ini
        T       : time-to-expiry dalam tahun (misal 30/365)
        forward : harga forward (default = spot * exp(r*T), approx = spot)
        weights : bobot per strike (default: inverse IV)

    Returns:
        dict berisi params (a,b,rho,m,sigma), rmse, is_arbitrage_free, fitted_ivs
    """
    if forward is None:
        forward = spot  # Pendekatan: abaikan carry cost

    # Filter: hapus IV yang tidak valid (nol, nan, negatif)
    valid_mask = (ivs > 0.01) & (ivs < 5.0) & np.isfinite(ivs) & np.isfinite(strikes)
    if valid_mask.sum() < 4:
        return _fallback_params(strikes, ivs, T)

    strikes_clean = strikes[valid_mask]
    ivs_clean = ivs[valid_mask]

    # Hitung log-moneyness k = ln(K/F)
    k = np.log(strikes_clean / forward)

    # Total implied variance: w = IV² × T
    w_market = ivs_clean ** 2 * T

    # Bobot (lebih berat ke ATM strikes)
    if weights is None:
        weights_clean = 1.0 / (ivs_clean + 1e-6)
    else:
        weights_clean = weights[valid_mask]
    weights_clean = weights_clean / weights_clean.sum()

    def objective(params):
        a, b, rho, m, sigma = params
        w_svi = svi_variance(k, a, b, rho, m, sigma)
        # Penalti untuk nilai negatif
        if np.any(w_svi <= 0):
            return 1e9
        residuals = (w_svi - w_market) ** 2 * weights_clean
        return float(np.sum(residuals))

    # Bounds: pastikan kondisi SVI valid
    # a > 0, b >= 0, -1 < ρ < 1, m bebas, σ > 0
    atm_var = float(np.mean(w_market))
    bounds = [
        (1e-6, max(atm_var * 5, 0.5)),   # a
        (1e-6, 2.0),                       # b
        (-0.999, 0.999),                   # rho
        (-1.0, 1.0),                       # m
        (1e-4, 2.0),                       # sigma
    ]

    # Initial guess dari distribusi parameter tipikal equity
    x0 = [atm_var * 0.8, 0.1, -0.7, 0.0, 0.3]

    # L-BFGS-B (cepat, akurat untuk lokal)
    result = minimize(
        objective, x0,
        method="L-BFGS-B",
        bounds=bounds,
        options={"maxiter": 2000, "ftol": 1e-12},
    )

    # Jika L-BFGS-B gagal, coba differential evolution (global search)
    if not result.success or result.fun > 1e-4:
        result_de = differential_evolution(
            objective, bounds,
            maxiter=500, tol=1e-10, seed=42, workers=1,
        )
        if result_de.fun < result.fun:
            result = result_de

    a, b, rho, m, sigma = result.x

    # Hitung RMSE dalam satuan IV (lebih intuitif)
    w_fitted = svi_variance(k, a, b, rho, m, sigma)
    w_fitted = np.maximum(w_fitted, 1e-10)
    iv_fitted = np.sqrt(w_fitted / T)
    rmse = float(np.sqrt(np.mean((iv_fitted - ivs_clean) ** 2)))

    # Periksa butterfly-free
    k_grid = np.linspace(k.min() - 0.1, k.max() + 0.1, 200)
    is_arb_free = check_butterfly_free(k_grid, a, b, rho, m, sigma)

    return {
        "params": {
            "a": float(a),
            "b": float(b),
            "rho": float(rho),
            "m": float(m),
            "sigma": float(sigma),
        },
        "rmse": rmse,
        "is_arbitrage_free": is_arb_free,
        "fit_quality": _quality_label(rmse),
        "n_points": int(valid_mask.sum()),
    }


def _fallback_params(strikes, ivs, T):
    """Fallback jika data tidak cukup untuk fitting."""
    avg_iv = float(np.nanmean(ivs)) if len(ivs) > 0 else 0.2
    a = avg_iv ** 2 * T
    return {
        "params": {"a": a, "b": 0.05, "rho": -0.5, "m": 0.0, "sigma": 0.3},
        "rmse": 999.0,
        "is_arbitrage_free": False,
        "fit_quality": "INSUFFICIENT_DATA",
        "n_points": 0,
    }


def _quality_label(rmse: float) -> str:
    if rmse < 0.005:
        return "EXCELLENT"
    elif rmse < 0.01:
        return "GOOD"
    elif rmse < 0.02:
        return "FAIR"
    else:
        return "POOR"


# ═══════════════════════════════════════════════
# KURVA GENERATOR (untuk visualisasi chart)
# ═══════════════════════════════════════════════

def generate_svi_curve(
    params: dict,
    spot: float,
    T: float,
    forward: Optional[float] = None,
    n_points: int = 100,
    moneyness_range: float = 0.20,
) -> list[dict]:
    """
    Menghasilkan titik-titik kurva SVI untuk divisualisasikan di chart.

    Returns:
        list of {"strike": K, "svi_iv": iv_pct}
    """
    if forward is None:
        forward = spot

    a, b, rho, m, sigma = (
        params["a"], params["b"], params["rho"], params["m"], params["sigma"]
    )

    k_min = np.log(1 - moneyness_range)
    k_max = np.log(1 + moneyness_range)
    k_grid = np.linspace(k_min, k_max, n_points)
    iv_grid = svi_iv(k_grid, T, a, b, rho, m, sigma)

    curve = []
    for k_val, iv_val in zip(k_grid, iv_grid):
        strike = float(forward * np.exp(k_val))
        if 0.01 < iv_val < 5.0:  # filter invalid
            curve.append({
                "strike": round(strike, 2),
                "svi_iv": round(float(iv_val) * 100, 4),  # persen
            })
    return curve

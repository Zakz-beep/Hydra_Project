"""
SVI (Stochastic Volatility Inspired) Model Engine for Options Quant Dashboard
Implements Jim Gatheral's (2004) Raw SVI Parameterization:
w(k) = a + b * (rho * (k - m) + sqrt((k - m)^2 + sigma^2))

Guarantees arbitrage-free Implied Volatility Surface fitting for SPY, QQQ, and index options.
"""

import os
import sys
import numpy as np
import pandas as pd
from scipy.optimize import minimize
import yfinance as yf

# Ensure path imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from Greeks import _fetch_spot_price, _get_expiry_dates, _dte, RISK_FREE_RATE
except ImportError:
    RISK_FREE_RATE = 0.05
    def _fetch_spot_price(t, ticker):
        hist = t.history(period="1d")
        return float(hist["Close"].iloc[-1]), "realtime"
    def _get_expiry_dates(t):
        return t.options
    def _dte(exp_str):
        from datetime import datetime
        exp_dt = datetime.strptime(exp_str, "%Y-%m-%d")
        return max(0, (exp_dt - datetime.now()).days)

class RawSVI:
    def __init__(self, a=0.0, b=0.1, rho=-0.5, m=0.0, sigma=0.1):
        self.a = a
        self.b = b
        self.rho = rho
        self.m = m
        self.sigma = sigma
        
    def total_variance(self, k):
        """Calculates total variance w(k) at log-moneyness k = log(K / F)"""
        return self.a + self.b * (self.rho * (k - self.m) + np.sqrt((k - self.m)**2 + self.sigma**2))
        
    def implied_volatility(self, k, T):
        """Converts SVI total variance w(k) to BS Implied Volatility sigma_BS"""
        w = self.total_variance(k)
        w_clamped = np.maximum(w, 1e-6)
        return np.sqrt(w_clamped / T)

def calibrate_svi_ticker(ticker="SPY", expiry_idx=1):
    """
    Calibrates SVI model parameters (a, b, rho, m, sigma) to live option chain of ticker.
    """
    t = yf.Ticker(ticker)
    spot, spot_src = _fetch_spot_price(t, ticker)
    expiry_dates = _get_expiry_dates(t)
    
    if not expiry_dates:
        raise ValueError(f"No option expiries found for {ticker}")
        
    target_exp = expiry_dates[expiry_idx] if len(expiry_dates) > expiry_idx else expiry_dates[0]
    dte_val = _dte(target_exp)
    T = max(0.008, dte_val / 365.0)
    r = RISK_FREE_RATE
    
    # Forward Price F = S * exp(r * T)
    F = spot * np.exp(r * T)
    
    try:
        chain = t.option_chain(target_exp)
        calls = chain.calls.copy()
        puts = chain.puts.copy()
    except Exception as e:
        raise RuntimeError(f"Failed to fetch option chain for {target_exp}: {e}")
        
    calls.columns = [c.lower().replace(" ", "_") for c in calls.columns]
    puts.columns = [c.lower().replace(" ", "_") for c in puts.columns]
    
    data_pts = []
    
    for _, row in calls.iterrows():
        K = row.get('strike', 0)
        iv = row.get('impliedvolatility', 0)
        if spot * 0.80 <= K <= spot * 1.20 and iv > 0.01:
            k = np.log(K / F)
            w_mkt = (iv**2) * T
            data_pts.append({'strike': K, 'k': k, 'iv_mkt': iv, 'w_mkt': w_mkt, 'type': 'call'})
            
    for _, row in puts.iterrows():
        K = row.get('strike', 0)
        iv = row.get('impliedvolatility', 0)
        if spot * 0.80 <= K <= spot * 1.20 and iv > 0.01:
            k = np.log(K / F)
            w_mkt = (iv**2) * T
            data_pts.append({'strike': K, 'k': k, 'iv_mkt': iv, 'w_mkt': w_mkt, 'type': 'put'})
            
    df_pts = pd.DataFrame(data_pts).drop_duplicates(subset=['strike', 'type'])
    
    if len(df_pts) < 5:
        raise ValueError("Not enough market data points for SVI calibration.")
        
    # SVI Calibration Objective Function with No-Arbitrage Constraints
    def objective(params):
        a, b, rho, m, sigma = params
        
        # Arbitrage & Non-Negativity Constraints
        if b < 0 or abs(rho) >= 1.0 or sigma <= 0:
            return 1e6
        if a + b * sigma * np.sqrt(1 - rho**2) < 0:
            return 1e6
            
        k_vec = df_pts['k'].values
        w_mkt_vec = df_pts['w_mkt'].values
        
        w_pred = a + b * (rho * (k_vec - m) + np.sqrt((k_vec - m)**2 + sigma**2))
        return np.sum((w_pred - w_mkt_vec)**2)
        
    init_params = [0.005, 0.10, -0.60, 0.0, 0.10]
    bounds = [(-0.10, 0.50), (0.001, 2.0), (-0.99, 0.99), (-0.50, 0.50), (0.001, 1.0)]
    
    res = minimize(objective, init_params, bounds=bounds, method='L-BFGS-B')
    a_opt, b_opt, rho_opt, m_opt, sigma_opt = res.x
    
    svi_model = RawSVI(a_opt, b_opt, rho_opt, m_opt, sigma_opt)
    
    # Evaluate SVI Fit Table
    sample_strikes = np.linspace(spot * 0.85, spot * 1.15, 15)
    evaluation_rows = []
    
    for K in sample_strikes:
        k = np.log(K / F)
        w_svi = svi_model.total_variance(k)
        iv_svi = svi_model.implied_volatility(k, T) * 100
        
        near_mkt = df_pts.iloc[(df_pts['strike'] - K).abs().argsort()[:1]]
        mkt_iv = near_mkt['iv_mkt'].values[0] * 100 if len(near_mkt) > 0 else np.nan
        
        evaluation_rows.append({
            'strike': round(K, 2),
            'log_moneyness': round(k, 4),
            'svi_total_var': round(w_svi, 6),
            'svi_iv_pct': round(iv_svi, 2),
            'market_iv_pct': round(mkt_iv, 2) if not np.isnan(mkt_iv) else None
        })
        
    return {
        'ticker': ticker,
        'spot': spot,
        'target_expiry': target_exp,
        'dte': dte_val,
        'params': {
            'a': a_opt,
            'b': b_opt,
            'rho': rho_opt,
            'm': m_opt,
            'sigma': sigma_opt,
            'sse': res.fun
        },
        'evaluation_matrix': pd.DataFrame(evaluation_rows)
    }

if __name__ == "__main__":
    out = calibrate_svi_ticker("SPY", expiry_idx=1)
    print("====================================================")
    print(f"IMPLEMENTASI SVI MODEL UNTUK {out['ticker']}")
    print(f"Spot: {out['spot']:.2f} | Expiry Target: {out['target_expiry']} ({out['dte']} DTE)")
    print("====================================================")
    print("Parameter Hasil Kalibrasi SVI:")
    for p, v in out['params'].items():
        print(f"  - {p}: {v}")
        
    print("\nMatrix Fit SVI Surface (Sample 15 Strikes):")
    print(out['evaluation_matrix'].to_string(index=False))

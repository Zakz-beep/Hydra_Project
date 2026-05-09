"""
hybrid_engine.py — Hybrid AI-Quant Volatility Arbitrage Engine
================================================================
Menggabungkan output LSTM (AI Fair Volatility) dengan Black-Scholes
pricing dari Greeks.py untuk menemukan opsi yang mispriced dan
menghitung Delta-Neutral hedging action.

Flow:
  1. Load trained LSTM model -> predict Fair Volatility
  2. Fetch live options chain via Greeks.py
  3. Compare Market IV vs AI Fair Vol -> find mispricing
  4. Calculate BSM theoretical price with AI vol
  5. Generate Delta-Neutral hedge recommendations

Usage:
  from ml_models.hybrid_engine import HybridArbitrageEngine
  engine = HybridArbitrageEngine()
  result = engine.scan("SPY")

Author: Hybrid AI-Quant Volatility Arbitrage Engine
"""

import os
import sys
import pickle
import warnings
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, date, timedelta
from typing import Optional

warnings.filterwarnings("ignore")

# ── Path setup ────────────────────────────────────────────────────────────────
# Add parent dir so we can import Greeks.py
PARENT_DIR = os.path.dirname(os.path.dirname(__file__))
if PARENT_DIR not in sys.path:
    sys.path.insert(0, PARENT_DIR)

from Greeks import (
    bsm_greeks,
    _d1_d2,
    _fetch_spot_price,
    _get_expiry_dates,
    _fetch_options_chain,
    _dte,
    RISK_FREE_RATE,
    MIN_OI,
    MIN_IV,
    MAX_IV,
    CONTRACT_SIZE,
)

# ═══════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")
TRADING_DAYS = 252
LOOK_BACK = 22
MAX_DTE = 45            # scan opsi 0-45 DTE
MONEYNESS_RANGE = 0.10  # scan strikes +/-10% dari spot
MIN_EDGE_PCT = 2.0      # minimum mispricing % agar masuk rekomendasi
TOP_N = 10              # top N opportunities per sisi


# ═══════════════════════════════════════════════════════
# LSTM INFERENCE MODULE
# ═══════════════════════════════════════════════════════

class LSTMVolPredictor:
    """
    Load trained LSTM model dan predict Fair Volatility.
    Model & scaler harus sudah di-train via train_lstm.py.
    """

    def __init__(self):
        self._models = {}   # cache: ticker -> (model, scaler)

    def _load_model(self, ticker: str):
        """Load model + scaler dari disk (lazy, cached)."""
        ticker_clean = ticker.replace("^", "").replace("/", "_").upper()

        if ticker_clean in self._models:
            return self._models[ticker_clean]

        model_path = os.path.join(WEIGHTS_DIR, f"lstm_vol_{ticker_clean}.keras")
        scaler_path = os.path.join(WEIGHTS_DIR, f"scaler_{ticker_clean}.pkl")

        if not os.path.exists(model_path):
            raise FileNotFoundError(
                f"Model not found: {model_path}. "
                f"Run: uv run python -m ml_models.train_lstm --ticker {ticker}"
            )

        # Lazy import TensorFlow
        import tensorflow as tf
        model = tf.keras.models.load_model(model_path)

        with open(scaler_path, "rb") as f:
            scaler = pickle.load(f)

        self._models[ticker_clean] = (model, scaler)
        return model, scaler

    def predict_fair_vol(self, ticker: str) -> dict:
        """
        Predict tomorrow's Fair Volatility using trained LSTM.
        
        Returns dict:
          - fair_vol_pct: annualized GK vol prediction (%)
          - current_rv_pct: latest actual RV
          - rv_series_22d: last 22 days RV (for context)
        """
        model, scaler = self._load_model(ticker)

        # Download recent data for inference
        data = yf.download(ticker, period="60d", progress=False, auto_adjust=True)
        if isinstance(data.columns, pd.MultiIndex):
            data.columns = [c[0] if isinstance(c, tuple) else c for c in data.columns]

        # Garman-Klass RV
        log_hl = np.log(data["High"] / data["Low"])
        log_co = np.log(data["Close"] / data["Open"])
        gk_var = 0.5 * (log_hl ** 2) - (2 * np.log(2) - 1) * (log_co ** 2)
        data["RV_Daily"] = np.sqrt(gk_var * TRADING_DAYS) * 100
        data = data.dropna()

        rv_values = data["RV_Daily"].values.reshape(-1, 1)
        scaled = scaler.transform(rv_values)

        # Last 22 days for prediction
        last_window = scaled[-LOOK_BACK:]
        X_pred = last_window.reshape(1, LOOK_BACK, 1)

        pred_scaled = model.predict(X_pred, verbose=0)
        fair_vol = float(scaler.inverse_transform(pred_scaled)[0][0])

        current_rv = float(data["RV_Daily"].iloc[-1])
        rv_22d = [round(float(v), 4) for v in data["RV_Daily"].tail(LOOK_BACK).values]

        return {
            "fair_vol_pct": round(fair_vol, 4),
            "current_rv_pct": round(current_rv, 4),
            "rv_series_22d": rv_22d,
        }


# ═══════════════════════════════════════════════════════
# BSM PRICING WITH AI VOLATILITY
# ═══════════════════════════════════════════════════════

def bsm_price(S, K, T, r, sigma, option_type="call"):
    """
    Calculate BSM option price using AI-predicted volatility.
    """
    from scipy.stats import norm

    if T <= 1e-6 or sigma <= MIN_IV:
        if option_type == "call":
            return max(0, S - K)
        else:
            return max(0, K - S)

    d1, d2 = _d1_d2(S, K, T, r, sigma)
    if option_type == "call":
        price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

    return max(0.0, float(price))


# ═══════════════════════════════════════════════════════
# HYBRID ARBITRAGE ENGINE
# ═══════════════════════════════════════════════════════

class HybridArbitrageEngine:
    """
    Mesin utama Volatility Arbitrage.

    Pipeline:
      1. LSTM -> Fair Vol (%)
      2. Greeks.py -> Live options chain
      3. Bandingkan Market IV vs AI Fair Vol
      4. BSM(AI Vol) -> Fair Price ($)
      5. Delta-Neutral hedging calculation
    """

    def __init__(self):
        self.lstm = LSTMVolPredictor()

    def scan(self, ticker: str) -> dict:
        """
        Full scan: predict fair vol, scan options chain,
        find mispriced options, calculate hedging.
        
        Returns JSON-serializable dict for API.
        """
        # ── Step 1: LSTM Fair Vol ────────────────────────
        lstm_result = self.lstm.predict_fair_vol(ticker)
        ai_fair_vol = lstm_result["fair_vol_pct"]
        # Convert annualized % to decimal for BSM
        ai_sigma = ai_fair_vol / 100.0

        # ── Step 2: Fetch Live Market Data ───────────────
        ticker_obj = yf.Ticker(ticker)
        spot, spot_src = _fetch_spot_price(ticker_obj, ticker)
        expiry_dates = _get_expiry_dates(ticker_obj)

        if not expiry_dates:
            raise ValueError(f"No options data available for {ticker}")

        # ── Step 3: Scan Options Chain ───────────────────
        opportunities = []
        vol_surface = []
        all_market_ivs = []

        for exp_str in expiry_dates:
            dte_val = _dte(exp_str)
            if dte_val > MAX_DTE or dte_val < 0:
                continue

            T = max(dte_val, 0.5) / 365.0

            calls_df, puts_df = _fetch_options_chain(ticker_obj, exp_str)
            if calls_df.empty and puts_df.empty:
                continue

            # Process both calls and puts
            for df, opt_type in [(calls_df, "call"), (puts_df, "put")]:
                if df.empty:
                    continue

                for _, row in df.iterrows():
                    try:
                        K = float(row["strike"])
                        oi = int(row.get("openinterest", 0) or 0)
                        vol = int(row.get("volume", 0) or 0)

                        if oi < MIN_OI or K <= 0:
                            continue

                        # Moneyness filter
                        moneyness = abs(K - spot) / spot
                        if moneyness > MONEYNESS_RANGE:
                            continue

                        # Mid price
                        bid = float(row.get("bid", 0) or 0)
                        ask = float(row.get("ask", 0) or 0)
                        if bid > 0 and ask > 0:
                            mid = (bid + ask) / 2
                        else:
                            mid = float(row.get("lastprice", 0) or 0)
                        if mid <= 0.01:
                            continue

                        # Market IV
                        market_iv = float(row.get("impliedvolatility", 0) or 0)
                        if market_iv < MIN_IV or market_iv > MAX_IV:
                            continue

                        all_market_ivs.append(market_iv)

                        # BSM Greeks with MARKET IV
                        market_greeks = bsm_greeks(spot, K, T, RISK_FREE_RATE, market_iv, opt_type)

                        # BSM Fair Price with AI VOLATILITY
                        fair_price = bsm_price(spot, K, T, RISK_FREE_RATE, ai_sigma, opt_type)

                        # BSM Greeks with AI VOLATILITY (for hedging)
                        ai_greeks = bsm_greeks(spot, K, T, RISK_FREE_RATE, ai_sigma, opt_type)

                        # ── Mispricing Calculation ───────────
                        mispricing_dollar = mid - fair_price
                        mispricing_pct = (mispricing_dollar / fair_price * 100) if fair_price > 0.01 else 0.0

                        # Direction: positive = overvalued, negative = undervalued
                        if abs(mispricing_pct) < MIN_EDGE_PCT:
                            signal = "FAIR"
                        elif mispricing_pct > 0:
                            signal = "OVERVALUED"
                        else:
                            signal = "UNDERVALUED"

                        # ── Delta Hedge Action ──────────────
                        # If we SELL an overvalued option (short), we need to hedge:
                        #   Short call -> Short delta -> BUY shares (delta shares)
                        #   Short put  -> Long delta  -> SELL shares (-delta shares)
                        # If we BUY an undervalued option (long), reverse.
                        ai_delta = ai_greeks["delta"]
                        hedge_shares = round(-ai_delta * CONTRACT_SIZE)

                        if signal == "OVERVALUED":
                            action = "SELL"
                            hedge_direction = "BUY" if hedge_shares > 0 else "SELL"
                            hedge_desc = f"{action} option, {hedge_direction} {abs(hedge_shares)} shares"
                        elif signal == "UNDERVALUED":
                            action = "BUY"
                            hedge_shares = -hedge_shares  # reverse for long
                            hedge_direction = "BUY" if hedge_shares > 0 else "SELL"
                            hedge_desc = f"{action} option, {hedge_direction} {abs(hedge_shares)} shares"
                        else:
                            action = "HOLD"
                            hedge_desc = "No action needed"

                        opp = {
                            "strike": K,
                            "type": opt_type,
                            "expiry": exp_str,
                            "dte": dte_val,
                            "oi": oi,
                            "volume": vol,
                            "bid": round(bid, 2),
                            "ask": round(ask, 2),
                            "mid_price": round(mid, 2),
                            "market_iv": round(market_iv, 4),
                            "market_iv_pct": round(market_iv * 100, 2),
                            "ai_fair_price": round(fair_price, 2),
                            "mispricing_dollar": round(mispricing_dollar, 2),
                            "mispricing_pct": round(mispricing_pct, 2),
                            "signal": signal,
                            "action": action,
                            "market_delta": round(market_greeks["delta"], 4),
                            "ai_delta": round(ai_delta, 4),
                            "market_gamma": round(market_greeks["gamma"], 6),
                            "market_vega": round(market_greeks["vega"], 4),
                            "hedge_shares": abs(hedge_shares),
                            "hedge_direction": hedge_direction if signal != "FAIR" else "NONE",
                            "hedge_desc": hedge_desc,
                        }
                        opportunities.append(opp)

                        # Vol surface data point
                        vol_surface.append({
                            "strike": K,
                            "dte": dte_val,
                            "market_iv_pct": round(market_iv * 100, 2),
                            "ai_fair_vol_pct": round(ai_fair_vol, 2),
                            "iv_spread_pct": round(market_iv * 100 - ai_fair_vol, 2),
                            "type": opt_type,
                            "moneyness": round(K / spot, 4),
                        })

                    except Exception:
                        continue

        # ── Step 4: Rank & Filter ────────────────────────
        # Sort by absolute mispricing
        opportunities.sort(key=lambda x: abs(x["mispricing_pct"]), reverse=True)

        overvalued = [o for o in opportunities if o["signal"] == "OVERVALUED"][:TOP_N]
        undervalued = [o for o in opportunities if o["signal"] == "UNDERVALUED"][:TOP_N]

        # ── Step 5: Market Summary ───────────────────────
        avg_market_iv = float(np.mean(all_market_ivs) * 100) if all_market_ivs else 0.0
        median_market_iv = float(np.median(all_market_ivs) * 100) if all_market_ivs else 0.0
        iv_spread = avg_market_iv - ai_fair_vol

        if iv_spread > 3.0:
            market_regime = "IV_RICH"
            regime_desc = (
                f"Market IV ({avg_market_iv:.1f}%) LEBIH TINGGI dari AI Fair Vol ({ai_fair_vol:.1f}%). "
                f"Opsi rata-rata OVERPRICED. Peluang jual premium."
            )
        elif iv_spread < -3.0:
            market_regime = "IV_CHEAP"
            regime_desc = (
                f"Market IV ({avg_market_iv:.1f}%) LEBIH RENDAH dari AI Fair Vol ({ai_fair_vol:.1f}%). "
                f"Opsi rata-rata UNDERPRICED. Peluang beli premium."
            )
        else:
            market_regime = "IV_FAIR"
            regime_desc = (
                f"Market IV ({avg_market_iv:.1f}%) mendekati AI Fair Vol ({ai_fair_vol:.1f}%). "
                f"Tidak ada edge signifikan secara agregat."
            )

        # ── Build Response ───────────────────────────────
        return {
            "status": "success",
            "ticker": ticker,
            "timestamp": datetime.now().isoformat(),
            "spot": round(spot, 2),
            "data_source": spot_src,
            "ai_model": {
                "type": "LSTM (Garman-Klass RV)",
                "fair_vol_pct": round(ai_fair_vol, 4),
                "current_rv_pct": lstm_result["current_rv_pct"],
                "look_back_days": LOOK_BACK,
                "rv_22d_history": lstm_result["rv_series_22d"],
            },
            "market_summary": {
                "avg_market_iv_pct": round(avg_market_iv, 2),
                "median_market_iv_pct": round(median_market_iv, 2),
                "ai_fair_vol_pct": round(ai_fair_vol, 2),
                "iv_spread_pct": round(iv_spread, 2),
                "regime": market_regime,
                "regime_desc": regime_desc,
                "n_options_scanned": len(opportunities),
                "n_overvalued": len(overvalued),
                "n_undervalued": len(undervalued),
            },
            "top_overvalued": overvalued,
            "top_undervalued": undervalued,
            "vol_surface": vol_surface[:200],  # limit surface data
        }


# ═══════════════════════════════════════════════════════
# STANDALONE TEST
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    import json

    print("=" * 65)
    print("  Hybrid AI-Quant Volatility Arbitrage Engine - Test")
    print("=" * 65)

    engine = HybridArbitrageEngine()

    ticker = sys.argv[1] if len(sys.argv) > 1 else "SPY"
    print(f"\n  Scanning {ticker}...\n")

    result = engine.scan(ticker)

    # Pretty print summary
    ms = result["market_summary"]
    ai = result["ai_model"]
    print(f"  Spot       : ${result['spot']}")
    print(f"  AI Fair Vol: {ai['fair_vol_pct']:.2f}%")
    print(f"  Avg Mkt IV : {ms['avg_market_iv_pct']:.2f}%")
    print(f"  IV Spread  : {ms['iv_spread_pct']:+.2f}%")
    print(f"  Regime     : {ms['regime']}")
    print(f"  Scanned    : {ms['n_options_scanned']} options")
    print(f"  Overvalued : {ms['n_overvalued']} | Undervalued: {ms['n_undervalued']}")

    print(f"\n  -- Top Overvalued (SELL Candidates) --")
    for o in result["top_overvalued"][:5]:
        print(f"    {o['type'].upper():4} K={o['strike']:<8} DTE={o['dte']:<3} "
              f"Mkt${o['mid_price']:<7} AI${o['ai_fair_price']:<7} "
              f"Edge={o['mispricing_pct']:+.1f}% | {o['hedge_desc']}")

    print(f"\n  -- Top Undervalued (BUY Candidates) --")
    for o in result["top_undervalued"][:5]:
        print(f"    {o['type'].upper():4} K={o['strike']:<8} DTE={o['dte']:<3} "
              f"Mkt${o['mid_price']:<7} AI${o['ai_fair_price']:<7} "
              f"Edge={o['mispricing_pct']:+.1f}% | {o['hedge_desc']}")

    print("\n" + "=" * 65)

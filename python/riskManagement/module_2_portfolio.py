"""
module_2_portfolio.py
Portfolio Tracking & Pre-Trade Simulation.
Handles strict prop-firm logic and correlation checks.
"""

from typing import Dict, Any, List
from riskManagement.risk_db import RiskDatabase
import numpy as np

class PortfolioManager:
    def __init__(self, db: RiskDatabase):
        self.db = db

    def check_correlation(self, new_ticker: str, new_direction: str, holdings: List[Dict]) -> Dict:
        """
        Mock correlation check for active holdings.
        Normally this takes an empirically updated correlation matrix weekly.
        """
        correlation_penalty = 0.0
        warnings = []
        
        indices = ["NQ=F", "ES=F", "^GSPC", "^NDX", "SPY", "QQQ"]
        cryptos = ["BTC-USD", "ETH-USD"]
        
        for holding in holdings:
            if holding['ticker'] != new_ticker:
                if new_ticker in indices and holding['ticker'] in indices:
                    if new_direction == holding['direction']:
                        warnings.append(f"High positive correlation with active holding {holding['ticker']}. Risk is amplified.")
                        correlation_penalty += 0.2
                    else:
                        warnings.append(f"Hedging against active holding {holding['ticker']}.")
                if new_ticker in cryptos and holding['ticker'] in cryptos:
                    if new_direction == holding['direction']:
                        warnings.append(f"High correlation in Crypto sector with {holding['ticker']}.")
                        correlation_penalty += 0.25
        
        return {
            "warnings": warnings,
            "correlation_penalty": correlation_penalty
        }

    def simulate_pre_trade(self, ticker: str, direction: str, lot_size_user: float, entry_price: float, current_regime_vol: float, regime_state: str) -> Dict[str, Any]:
        """
        Generate 2 scenarios: User vs Recommended. 
        Calculates pip value, 3x SL, TP options per regime.
        Strict Prop Firm constraints applied.
        """
        state = self.db.get_account_state()
        equity = state['equity']
        daily_loss_limit = state['daily_loss_limit'] # e.g. 0.02 (2%)
        
        vol_factor = 1.5 if "High" in regime_state else (0.8 if "Low" in regime_state else 1.0)
        
        # Base daily volatility pts calculation
        # Simplified: using current_regime_vol (annualized) -> daily expected move % -> points
        daily_vol_pct = current_regime_vol / np.sqrt(252) if current_regime_vol > 0 else 0.01
        base_sl_pts = entry_price * daily_vol_pct * vol_factor
        base_tp_pts = base_sl_pts * 1.5 # 1:1.5 RR

        sl_options = {
            "tight": entry_price - (base_sl_pts * 0.5) if direction == "Long" else entry_price + (base_sl_pts * 0.5),
            "normal": entry_price - base_sl_pts if direction == "Long" else entry_price + base_sl_pts,
            "wide": entry_price - (base_sl_pts * 1.5) if direction == "Long" else entry_price + (base_sl_pts * 1.5)
        }
        
        tp_option = entry_price + base_tp_pts if direction == "Long" else entry_price - base_tp_pts

        # Calculate Risk ($) - assuming generic points mapping where 1 point = 1 USD per lot. 
        # (In reality NQ is $20/pt, ES is $50/pt. For this workflow, assuming uniform point value or multiplier=1 for demo)
        multiplier = 20 if "NQ" in ticker else (50 if "ES" in ticker else 1)
        risk_per_point_user = lot_size_user * multiplier
        
        max_loss_user = abs(entry_price - sl_options["normal"]) * risk_per_point_user
        daily_budget_dollars = equity * daily_loss_limit
        
        user_scenario = {
            "lot_size": lot_size_user,
            "risk_dollars": float(max_loss_user),
            "percent_of_daily_budget": float((max_loss_user / daily_budget_dollars) * 100) if daily_budget_dollars > 0 else 0,
            "is_rejected": max_loss_user > daily_budget_dollars
        }

        # Recommended lot size based on 0.5% - 1% risk per trade depending on correlation
        active_holdings = self.db.get_active_holdings()
        corr_data = self.check_correlation(ticker, direction, active_holdings)
        
        target_risk_pct = 0.01 - (corr_data["correlation_penalty"] * 0.01) # Reduce risk if highly correlated
        if target_risk_pct <= 0:
            target_risk_pct = 0.002 # minimum risk 0.2%

        recommended_risk_dollars = equity * target_risk_pct
        pt_diff = abs(entry_price - sl_options["normal"])
        recommended_lot = recommended_risk_dollars / (pt_diff * multiplier) if pt_diff > 0 else 0.01
        
        recommended_scenario = {
            "lot_size": float(round(recommended_lot, 2)),
            "risk_dollars": float(recommended_risk_dollars),
            "target_risk_pct": float(target_risk_pct * 100),
            "is_rejected": False
        }
        
        return {
            "ticker": ticker,
            "direction": direction,
            "entry_price": float(entry_price),
            "tp_target": float(tp_option),
            "sl_options": {k: float(v) for k, v in sl_options.items()},
            "correlation_warnings": corr_data["warnings"],
            "scenarios": {
                "user": user_scenario,
                "recommended": recommended_scenario
            }
        }

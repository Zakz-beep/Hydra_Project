"""
module_3_behavior.py
Behavioral Profiler.
Tracks negative patterns (Revenge trading, FOMO, Overtrading) and updates user Behavior Score.
"""

from typing import Dict, Any
from riskManagement.risk_db import RiskDatabase
from datetime import datetime, timedelta

class BehavioralProfiler:
    def __init__(self, db: RiskDatabase):
        self.db = db

    def evaluate_post_trade(self, ticker: str, direction: str, pnl: float, entry_time_str: str, exit_time_str: str, hit_sl: bool) -> Dict[str, Any]:
        """
        Takes trade info to detect psychological patterns.
        Updates the Database behavioral score.
        """
        # Ensure datetimes
        if isinstance(entry_time_str, str):
            # Fallback for simple formats
            try:
                entry_time = datetime.fromisoformat(entry_time_str)
                exit_time = datetime.fromisoformat(exit_time_str)
            except:
                entry_time = datetime.strptime(entry_time_str, "%Y-%m-%d %H:%M:%S")
                exit_time = datetime.strptime(exit_time_str, "%Y-%m-%d %H:%M:%S")
        else:
            entry_time = entry_time_str
            exit_time = exit_time_str

        profile = self.db.get_behavioral_profile()
        score = profile['score']
        revenge = profile['revenge_count']
        overtrade = profile['overtrade_count']
        fomo = profile['fomo_count']

        recent_trades = self.db.get_recent_trades(limit=10)
        
        flags = []
        point_deductions = 0

        # Pattern 1: REVENGE TRADING
        # Opening a trade quickly after hitting a Stop Loss
        if recent_trades:
            last_trade = recent_trades[0]
            if last_trade['hit_sl']:
                try:
                    last_exit = datetime.fromisoformat(last_trade['exit_time']) if isinstance(last_trade['exit_time'], str) else last_trade['exit_time']
                except:
                    last_exit = datetime.strptime(last_trade['exit_time'], "%Y-%m-%d %H:%M:%S")
                    
                time_diff_minutes = (entry_time - last_exit).total_seconds() / 60
                if time_diff_minutes < 15: # Trade opened within 15 minutes of an SL hit
                    flags.append(f"Revenge Trading Alert: Trade opened within {int(time_diff_minutes)} mins of hitting SL.")
                    point_deductions += 10
                    revenge += 1

        # Pattern 2: FOMO
        same_dir_trades_last_hour = 0
        for rt in recent_trades:
            try:
                rt_exit = datetime.fromisoformat(rt['exit_time']) if isinstance(rt['exit_time'], str) else rt['exit_time']
            except:
                rt_exit = datetime.strptime(rt['exit_time'], "%Y-%m-%d %H:%M:%S")
                
            if (entry_time - rt_exit).total_seconds() / 3600 < 1.0:
                if rt['direction'] == direction and rt['ticker'] == ticker:
                    same_dir_trades_last_hour += 1
        
        if same_dir_trades_last_hour >= 2:
            flags.append("FOMO / Chasing: Multiple rapid entries in identical direction within 1 hour.")
            point_deductions += 5
            fomo += 1

        # Pattern 3: OVERTRADING
        today_start = datetime(exit_time.year, exit_time.month, exit_time.day)
        trades_today = 0
        for t in recent_trades:
            try:
                t_entry = datetime.fromisoformat(t['entry_time']) if isinstance(t['entry_time'], str) else t['entry_time']
            except:
                t_entry = datetime.strptime(t['entry_time'], "%Y-%m-%d %H:%M:%S")
            if t_entry >= today_start:
                trades_today += 1
        
        if trades_today >= 5: # Generic 5 trades a day rule
            flags.append("Overtrading Risk: High volume of trades taken today.")
            point_deductions += 5
            overtrade += 1

        # CALCULATION UPDATE
        if not flags:
            score = min(100.0, score + 2.0)
            flags.append("Positive Discipline: Trade passed all behavioral checks.")
        else:
            score = max(0.0, score - point_deductions)

        # Apply to DB
        self.db.update_behavioral_score(score, revenge, overtrade, fomo, exit_time)
        
        return {
            "pnl": pnl,
            "behavioral_flags": flags,
            "old_score": float(profile['score']),
            "new_score": float(score),
            "deductions": float(point_deductions)
        }

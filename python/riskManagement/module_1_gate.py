"""
module_1_gate.py
Pre-Trade Gate & Daily Baseline Generation
Handles News Checking and VaR logic for the 07:00 Baseline.
"""

from datetime import datetime, timedelta
import pandas as pd
from typing import Dict, Any, Tuple
from riskManagement.data_layer import fetch_economic_calendar

class Phase1Gate:
    def __init__(self):
        self.calendar_df = None
        self.last_fetched = None

    def refresh_calendar(self):
        self.calendar_df = fetch_economic_calendar()
        self.last_fetched = datetime.now()

    def _ensure_calendar(self):
        # Cache calendar for 1 hour
        now = datetime.now()
        if self.calendar_df is None or self.last_fetched is None or (now - self.last_fetched).seconds > 3600:
            self.refresh_calendar()

    def check_upcoming_news(self, impact_levels=["High", "Medium"], window_minutes=30) -> Tuple[bool, list]:
        """
        Check if there are high/medium impact news within the next `window_minutes`.
        """
        self._ensure_calendar()
        if self.calendar_df is None or self.calendar_df.empty:
            return False, []

        now = datetime.now()
        window_end = now + timedelta(minutes=window_minutes)

        mask = (self.calendar_df.index >= now) & (self.calendar_df.index <= window_end)
        upcoming = self.calendar_df[mask]

        if upcoming.empty:
            return False, []

        alerts = upcoming[upcoming['impact'].isin(impact_levels)]
        if not alerts.empty:
            events = []
            for idx, row in alerts.iterrows():
                events.append({
                    "time": idx.strftime("%H:%M"),
                    "country": row['country'],
                    "title": row['title'],
                    "impact": row['impact']
                })
            return True, events
        return False, []

    def generate_daily_brief(self) -> Dict[str, Any]:
        """
        Produce a daily brief with major news events for the day.
        """
        self._ensure_calendar()
        now = datetime.now()
        # End of day is today at 23:59:59
        end_of_day = datetime(now.year, now.month, now.day, 23, 59, 59)

        if self.calendar_df is None or self.calendar_df.empty:
            return {"status": "No calendar data available for today."}

        # Filter events for the rest of today
        mask = (self.calendar_df.index >= now) & (self.calendar_df.index <= end_of_day)
        today_events = self.calendar_df[mask]

        high_impact = today_events[today_events['impact'] == 'High']
        
        events_list = []
        for idx, row in high_impact.iterrows():
            events_list.append({
                "time": idx.strftime("%H:%M"),
                "country": row['country'],
                "title": row['title'],
                "forecast": row['forecast'],
                "previous": row['previous']
            })

        return {
            "date": now.strftime("%Y-%m-%d"),
            "total_events_today": len(today_events),
            "high_impact_count": len(high_impact),
            "high_impact_events": events_list
        }

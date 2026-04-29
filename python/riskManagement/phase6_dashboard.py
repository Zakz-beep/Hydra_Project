"""
phase6_dashboard.py
===================
Phase 6 — Decision Dashboard & Live Data Feedback Loop

Meliputi:
    6.1  Decision Engine      (aggregate Phase 2-5 → actionable signals)
    6.2  Position Sizer       (regime-aware dynamic position sizing)
    6.3  Live Regime Monitor  (real-time regime tracking + alert system)
    6.4  Dashboard Renderer   (terminal dashboard + JSON export untuk web UI)
    6.5  Feedback Loop        (auto-refresh data → re-run pipeline → update decisions)

Input : Phase 2 regime data, Phase 3 sim, Phase 4 risk metrics, Phase 5 stress results
Output: Trading decisions, position sizes, alerts, dashboard data

Dependencies:
    pip install numpy pandas scipy yfinance
"""

import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable
import time
import warnings
warnings.filterwarnings("ignore")

import yfinance as yf

from phase3_simulation import TradingRules, SimulationConfig
from phase4_metrics import Phase4Results
from phase5_stress import Phase5Results


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════

@dataclass
class TradingDecision:
    """Satu trading decision output."""
    timestamp:         str
    ticker:            str
    # Signal
    action:            str      # "LONG", "SHORT", "FLAT", "REDUCE"
    confidence:        float    # 0.0 - 1.0
    rationale:         list[str] = field(default_factory=list)
    # Sizing
    position_size:     float    = 1.0
    risk_per_trade:    float    = 0.01
    stop_loss_pct:     float    = 0.008
    take_profit_pct:   float    = 0.015
    # Risk context
    current_regime:    str      = "Unknown"
    regime_confidence: float    = 0.0
    ann_vol:           float    = 0.0
    # Prop firm context
    challenge_pass_rate: float  = 0.0
    ev_positive:       bool     = False
    # Alerts
    alerts:            list[str] = field(default_factory=list)


@dataclass
class DashboardSnapshot:
    """Complete dashboard state at a point in time."""
    timestamp:          str
    ticker:             str
    last_price:         float = 0.0
    # Regime
    current_regime:     str   = "Unknown"
    regime_probs:       dict  = field(default_factory=dict)
    regime_history:     list  = field(default_factory=list)
    # Risk metrics (from best model)
    var_95:             float = 0.0
    cvar_95:            float = 0.0
    max_dd_p90:         float = 0.0
    sharpe_median:      float = 0.0
    sortino_median:     float = 0.0
    calmar_median:      float = 0.0
    # Prop firm
    challenge_pass_rate: float = 0.0
    expected_attempts:   float = 0.0
    ev_assessment:       str   = "Unknown"
    # Stress test
    worst_scenario:      str   = ""
    worst_impact:        float = 0.0
    # Decision
    decision:            TradingDecision | None = None
    # Sensitivity highlights
    optimal_sl:          float = 0.0
    optimal_tp:          float = 0.0
    optimal_size:        float = 0.0
    # Raw data for charts
    chart_data:          dict  = field(default_factory=dict)


# ═══════════════════════════════════════════════════════════════
# 6.1 — DECISION ENGINE
# ═══════════════════════════════════════════════════════════════

class DecisionEngine:
    """
    Aggregate semua output Phase 2-5 menjadi satu trading decision.

    Decision logic:
    1. Regime → determines base action + sizing multiplier
    2. Risk metrics → validates apakah risk acceptable
    3. Stress test → override jika extreme scenario likely
    4. Prop firm → adjust untuk challenge constraints
    """

    # Regime-based action mapping
    REGIME_ACTIONS = {
        # 3-state model
        "Low-Vol Trend":     {"action": "LONG",   "size_mult": 1.2, "bias": "bullish"},
        "High-Vol Trend":    {"action": "LONG",   "size_mult": 0.6, "bias": "cautious_long"},
        "Choppy/Mean-Rev":   {"action": "FLAT",   "size_mult": 0.4, "bias": "neutral"},
        # 2-state model
        "Low-Vol":           {"action": "LONG",   "size_mult": 1.0, "bias": "bullish"},
        "High-Vol":          {"action": "REDUCE", "size_mult": 0.5, "bias": "defensive"},
        # 4-state model
        "Bull Quiet":        {"action": "LONG",   "size_mult": 1.3, "bias": "aggressive_long"},
        "Bull Volatile":     {"action": "LONG",   "size_mult": 0.7, "bias": "cautious_long"},
        "Bear Quiet":        {"action": "SHORT",  "size_mult": 0.8, "bias": "cautious_short"},
        "Bear Volatile":     {"action": "REDUCE", "size_mult": 0.3, "bias": "defensive"},
    }

    def __init__(
        self,
        phase2_results: dict,
        phase4_results: dict[str, Phase4Results],
        phase5_results: Phase5Results | None = None,
        trading_rules:  TradingRules | None  = None,
        preferred_model: str = "RegimeGBM",
    ):
        self.p2      = phase2_results
        self.p4      = phase4_results
        self.p5      = phase5_results
        self.rules   = trading_rules or TradingRules()
        self.pref    = preferred_model

        # Pick best model from Phase 4
        if preferred_model in phase4_results:
            self.best_p4 = phase4_results[preferred_model]
        else:
            self.best_p4 = list(phase4_results.values())[0]

    def generate_decision(self) -> TradingDecision:
        """Generate comprehensive trading decision."""
        ticker = self.p2["ticker"]
        now    = datetime.now().isoformat(timespec="seconds")

        # ── 1. Regime analysis ────────────────────────────
        regime_probs   = self.p2["current_regime_probs"]
        dominant       = max(regime_probs, key=regime_probs.get)
        confidence     = regime_probs[dominant]
        regime_action  = self.REGIME_ACTIONS.get(dominant, {"action": "FLAT", "size_mult": 0.5, "bias": "unknown"})

        rationale = [f"Current regime: {dominant} (conf: {confidence:.0%})"]

        # ── 2. Risk validation ────────────────────────────
        risk    = self.best_p4.risk_metrics
        returns = self.best_p4.return_metrics

        var_95      = risk.get("VaR_95pct", 0)
        max_dd_p90  = risk.get("max_dd_P90", 0)
        prob_profit = returns.get("prob_profit", 0.5)

        # Risk override: if VaR too extreme, reduce position
        risk_override = 1.0
        alerts = []

        if abs(var_95) > 0.15:
            risk_override = 0.5
            alerts.append(f"⚠️ HIGH VaR ({var_95:.1%}) — size reduced 50%")
            rationale.append(f"VaR 95% = {var_95:.1%} (extreme)")

        if max_dd_p90 > 0.12:
            risk_override = min(risk_override, 0.4)
            alerts.append(f"⚠️ HIGH MaxDD P90 ({max_dd_p90:.1%}) — size capped")
            rationale.append(f"MaxDD P90 = {max_dd_p90:.1%} (elevated)")

        if prob_profit < 0.45:
            risk_override = min(risk_override, 0.3)
            alerts.append(f"❌ LOW P(profit) = {prob_profit:.0%} — consider sitting out")
            rationale.append(f"P(profit) = {prob_profit:.0%}")
        else:
            rationale.append(f"P(profit) = {prob_profit:.0%}")

        # ── 3. Stress test override ───────────────────────
        stress_override = 1.0
        if self.p5:
            # Check if any historical scenario has high breach rate
            for key, res in self.p5.historical_results.items():
                if res.prop_firm_breach_rate > 0.7:
                    stress_override = min(stress_override, 0.6)
                    alerts.append(f"🔴 Stress: {res.scenario_name} breach rate {res.prop_firm_breach_rate:.0%}")

            # Check challenge EV
            cs = self.p5.challenge_sim
            if cs:
                prob_pos = cs.get("prob_net_positive", 0)
                if prob_pos < 0.40:
                    alerts.append(f"⚠️ Challenge EV negative (P(net+) = {prob_pos:.0%})")

        # ── 4. Prop firm constraints ──────────────────────
        prop_metrics    = self.best_p4.prop_firm_metrics
        pass_rate       = prop_metrics.get("pass_rate", 0)
        exp_attempts    = prop_metrics.get("expected_attempts", 0)
        ev_positive     = pass_rate > 0.15  # heuristic: > 15% pass = worth trying

        rationale.append(f"Challenge pass rate: {pass_rate:.1%} ({exp_attempts:.0f}x expected attempts)")

        # ── 5. Final sizing ───────────────────────────────
        base_size   = regime_action["size_mult"]
        final_size  = base_size * risk_override * stress_override
        final_size  = max(0.1, min(2.0, final_size))  # clamp [0.1, 2.0]

        # Dynamic SL/TP based on regime volatility
        regime_stats = self.p2.get("regime_stats", {})
        ann_vol = 0.20  # default
        for s in regime_stats.values():
            if s["label"] == dominant:
                ann_vol = s["vol_annualized"]
                break

        daily_vol = ann_vol / np.sqrt(252)
        # SL = 1.5× daily vol, TP = 2× daily vol (adaptive)
        sl = max(0.004, min(0.025, daily_vol * 1.5))
        tp = max(0.006, min(0.040, daily_vol * 2.0))

        rationale.append(f"Regime vol: {ann_vol:.1%}/yr → SL={sl:.1%}, TP={tp:.1%}")
        rationale.append(f"Size multiplier: {final_size:.2f}× (regime={base_size:.1f} × risk={risk_override:.1f} × stress={stress_override:.1f})")

        # ── 6. Action determination ──────────────────────
        action = regime_action["action"]
        # Override action if risk is too high
        if risk_override < 0.4:
            action = "FLAT"
            rationale.append("Action overridden to FLAT due to excessive risk")
        elif final_size < 0.3 and action in ("LONG", "SHORT"):
            action = "REDUCE"
            rationale.append(f"Action downgraded to REDUCE (size too small: {final_size:.2f})")

        decision = TradingDecision(
            timestamp         = now,
            ticker            = ticker,
            action            = action,
            confidence        = round(confidence * risk_override, 3),
            rationale         = rationale,
            position_size     = round(final_size, 3),
            risk_per_trade    = round(self.rules.risk_per_trade * final_size, 4),
            stop_loss_pct     = round(sl, 4),
            take_profit_pct   = round(tp, 4),
            current_regime    = dominant,
            regime_confidence = round(confidence, 3),
            ann_vol           = round(ann_vol, 4),
            challenge_pass_rate = round(pass_rate, 3),
            ev_positive       = ev_positive,
            alerts            = alerts,
        )

        return decision


# ═══════════════════════════════════════════════════════════════
# 6.2 — POSITION SIZER (Regime-Aware)
# ═══════════════════════════════════════════════════════════════

class PositionSizer:
    """
    Dynamic position sizing berdasarkan:
    1. Current regime (vol-adjusted)
    2. Kelly Criterion (theoretical optimal)
    3. Risk-per-trade (practical constraint)
    4. Prop firm DD limits (hard constraint)
    """

    def __init__(
        self,
        account_size:   float = 50_000.0,
        max_portfolio_risk: float = 0.02,  # max 2% account per trade
        max_trailing_dd:    float = 0.08,  # prop firm trailing DD limit
        risk_free:      float = 0.05,
    ):
        self.acc         = account_size
        self.max_risk    = max_portfolio_risk
        self.max_dd      = max_trailing_dd
        self.rf          = risk_free

    def kelly_fraction(
        self,
        win_rate: float,
        avg_win:  float,
        avg_loss: float,
    ) -> float:
        """
        Kelly Criterion: f* = (bp - q) / b
        b = avg_win / avg_loss (reward ratio)
        p = win_rate
        q = 1 - p
        """
        if avg_loss == 0 or win_rate <= 0:
            return 0.0
        b = abs(avg_win / avg_loss)
        p = win_rate
        q = 1 - p
        kelly = (b * p - q) / b
        # Half-Kelly = more conservative
        return max(0, kelly * 0.5)

    def regime_adjusted_size(
        self,
        base_size:    float,
        regime_vol:   float,  # annualized
        target_vol:   float = 0.15,  # target portfolio vol
    ) -> float:
        """
        Vol-target sizing: adjust size so portfolio vol ≈ target_vol.
        size_adj = target_vol / regime_vol
        """
        if regime_vol <= 0:
            return base_size
        vol_ratio = target_vol / regime_vol
        adjusted  = base_size * vol_ratio
        return max(0.1, min(3.0, adjusted))

    def prop_firm_constrained_size(
        self,
        size:         float,
        current_dd:   float,  # current drawdown as positive fraction
        price:        float,
        sl_pct:       float,
    ) -> float:
        """
        Constrain position size supaya single-trade loss
        tidak bisa push trailing DD beyond limit.

        remaining_dd = max_dd - current_dd
        max_loss = remaining_dd × account
        max_size = max_loss / (price × sl_pct)
        """
        remaining_dd = max(0, self.max_dd - current_dd)
        max_loss     = remaining_dd * self.acc
        max_trade_loss = price * sl_pct if sl_pct > 0 else price * 0.01
        max_size       = max_loss / max_trade_loss if max_trade_loss > 0 else 0

        return min(size, max_size)

    def compute(
        self,
        decision:    TradingDecision,
        price:       float,
        current_dd:  float = 0.0,
        win_rate:    float = 0.55,
        avg_win:     float = 0.015,
        avg_loss:    float = 0.008,
    ) -> dict:
        """
        Compute full position sizing recommendation.
        """
        # 1. Kelly
        kelly = self.kelly_fraction(win_rate, avg_win, avg_loss)

        # 2. Regime-adjusted
        regime_size = self.regime_adjusted_size(
            decision.position_size, decision.ann_vol
        )

        # 3. Risk-based
        risk_amt     = self.acc * self.max_risk
        sl_dollars   = price * decision.stop_loss_pct
        risk_size    = risk_amt / sl_dollars if sl_dollars > 0 else 0

        # 4. Prop firm constrained
        pf_size = self.prop_firm_constrained_size(
            regime_size, current_dd, price, decision.stop_loss_pct
        )

        # Final: minimum of all constraints
        final_size = min(regime_size, risk_size, pf_size, kelly * 10)
        final_size = max(0.1, final_size)

        return {
            "kelly_fraction":        round(kelly, 4),
            "kelly_suggested_size":  round(kelly * 10, 2),  # * 10 contracts/lots
            "regime_adjusted_size":  round(regime_size, 2),
            "risk_based_size":       round(risk_size, 2),
            "prop_firm_max_size":    round(pf_size, 2),
            "final_size":            round(final_size, 2),
            "risk_per_trade_dollar": round(final_size * sl_dollars, 2),
            "risk_as_pct_account":   round(final_size * sl_dollars / self.acc * 100, 2),
        }


# ═══════════════════════════════════════════════════════════════
# 6.3 — LIVE REGIME MONITOR
# ═══════════════════════════════════════════════════════════════

class LiveRegimeMonitor:
    """
    Real-time regime tracking.
    Fetch latest price, re-compute regime probability, generate alerts.
    """

    # Alert thresholds
    REGIME_CHANGE_THRESHOLD  = 0.15  # alert kalau regime prob shift > 15%
    VOL_SPIKE_THRESHOLD      = 2.0   # alert kalau current vol > 2× recent avg

    def __init__(
        self,
        phase2_results: dict,
        ticker:         str = "NQ=F",
    ):
        self.p2     = phase2_results
        self.ticker = ticker
        self.hmm    = phase2_results.get("hmm_detector")
        self.alerts_history: list[dict] = []
        self.regime_history: list[dict] = []
        self.last_probs:     dict       = phase2_results.get("current_regime_probs", {})

    def fetch_latest_price(self) -> float:
        """Fetch latest price dari Yahoo Finance."""
        try:
            t = yf.Ticker(self.ticker)
            hist = t.history(period="1d", interval="1m")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
            # Fallback: daily
            hist = t.history(period="5d", interval="1d")
            if not hist.empty:
                return float(hist["Close"].iloc[-1])
        except Exception:
            pass
        return 0.0

    def fetch_recent_returns(self, period: str = "5d", interval: str = "1d") -> pd.Series | None:
        """Fetch recent returns untuk regime re-estimation."""
        try:
            raw = yf.download(self.ticker, period=period, interval=interval,
                             auto_adjust=True, progress=False)
            if raw.empty:
                return None
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.get_level_values(0)
            prices = raw["Close"].dropna()
            log_ret = np.log(prices / prices.shift(1)).dropna()
            return log_ret
        except Exception:
            return None

    def check_regime_shift(self) -> dict:
        """
        Compare current regime probs vs last recorded.
        Generate alert jika ada significant shift.
        """
        current_probs = self.p2.get("current_regime_probs", {})
        alerts = []
        regime_changed = False

        # Compare with last recorded probs
        for regime, prob in current_probs.items():
            last_prob = self.last_probs.get(regime, prob)
            shift     = abs(prob - last_prob)
            if shift > self.REGIME_CHANGE_THRESHOLD:
                direction = "↑" if prob > last_prob else "↓"
                alerts.append(
                    f"⚡ Regime shift: {regime} {direction} "
                    f"({last_prob:.0%} → {prob:.0%})"
                )
                regime_changed = True

        # Record
        dominant = max(current_probs, key=current_probs.get)
        self.regime_history.append({
            "timestamp":  datetime.now().isoformat(),
            "regime":     dominant,
            "confidence": current_probs[dominant],
            "probs":      current_probs,
        })

        result = {
            "timestamp":       datetime.now().isoformat(),
            "current_regime":  dominant,
            "confidence":      current_probs[dominant],
            "regime_probs":    current_probs,
            "regime_changed":  regime_changed,
            "alerts":          alerts,
        }

        if alerts:
            self.alerts_history.extend([
                {"timestamp": datetime.now().isoformat(), "alert": a}
                for a in alerts
            ])

        self.last_probs = current_probs
        return result

    def check_vol_spike(self) -> dict | None:
        """Check for volatility spikes in recent data."""
        recent = self.fetch_recent_returns(period="10d", interval="1d")
        if recent is None or len(recent) < 3:
            return None

        recent_vol  = float(recent.tail(3).std() * np.sqrt(252))
        hist_vol    = 0.20  # default

        regime_stats = self.p2.get("regime_stats", {})
        if regime_stats:
            vols = [s["vol_annualized"] for s in regime_stats.values()]
            hist_vol = float(np.mean(vols))

        vol_ratio = recent_vol / hist_vol if hist_vol > 0 else 1.0

        result = {
            "recent_vol_ann":   round(recent_vol, 4),
            "historical_vol":   round(hist_vol, 4),
            "vol_ratio":        round(vol_ratio, 2),
            "vol_spike":        vol_ratio > self.VOL_SPIKE_THRESHOLD,
        }

        if result["vol_spike"]:
            alert = f"🔥 VOL SPIKE: {recent_vol:.1%} vs avg {hist_vol:.1%} ({vol_ratio:.1f}×)"
            self.alerts_history.append({
                "timestamp": datetime.now().isoformat(),
                "alert": alert,
            })
            result["alert"] = alert

        return result

    def get_status(self) -> dict:
        """Full status check."""
        price   = self.fetch_latest_price()
        regime  = self.check_regime_shift()
        vol     = self.check_vol_spike()

        return {
            "ticker":        self.ticker,
            "last_price":    price,
            "regime_status": regime,
            "vol_status":    vol,
            "alerts":        self.alerts_history[-10:],  # last 10
            "n_checks":      len(self.regime_history),
        }


# ═══════════════════════════════════════════════════════════════
# 6.4 — DASHBOARD RENDERER
# ═══════════════════════════════════════════════════════════════

class DashboardRenderer:
    """
    Generate dashboard snapshot dari semua Phase outputs.
    Output: DashboardSnapshot + terminal rendering + JSON export.
    """

    def __init__(
        self,
        phase2_results: dict,
        phase4_results: dict[str, Phase4Results],
        phase5_results: Phase5Results | None = None,
        decision:       TradingDecision | None = None,
        preferred_model: str = "RegimeGBM",
    ):
        self.p2       = phase2_results
        self.p4       = phase4_results
        self.p5       = phase5_results
        self.decision = decision
        self.pref     = preferred_model

        if preferred_model in phase4_results:
            self.best_p4 = phase4_results[preferred_model]
        else:
            self.best_p4 = list(phase4_results.values())[0]

    def build_snapshot(self) -> DashboardSnapshot:
        """Build complete dashboard snapshot."""
        ticker = self.p2["ticker"]
        raw_df = self.p2.get("labeled_df", self.p2.get("raw_df"))
        last_price = float(raw_df["Close"].iloc[-1]) if raw_df is not None else 0.0

        # Regime
        regime_probs = self.p2.get("current_regime_probs", {})
        dominant     = max(regime_probs, key=regime_probs.get) if regime_probs else "Unknown"

        # Risk from best model
        risk    = self.best_p4.risk_metrics
        returns = self.best_p4.return_metrics
        prop    = self.best_p4.prop_firm_metrics

        # Stress
        worst_scenario = ""
        worst_impact   = 0.0
        if self.p5 and self.p5.historical_results:
            worst = min(self.p5.historical_results.values(),
                       key=lambda x: x.portfolio_impact_pct)
            worst_scenario = worst.scenario_name
            worst_impact   = worst.portfolio_impact_pct

        # Challenge EV
        ev_assessment = "Unknown"
        if self.p5 and self.p5.challenge_sim:
            prob_pos = self.p5.challenge_sim.get("prob_net_positive", 0)
            if prob_pos > 0.60:
                ev_assessment = "✅ POSITIVE EV"
            elif prob_pos > 0.40:
                ev_assessment = "🟡 MARGINAL"
            else:
                ev_assessment = "❌ NEGATIVE EV"

        # Sensitivity optimal params
        optimal_sl = self.decision.stop_loss_pct if self.decision else 0.008
        optimal_tp = self.decision.take_profit_pct if self.decision else 0.015
        optimal_size = self.decision.position_size if self.decision else 1.0

        # Chart data (for web dashboard)
        chart_data = self._build_chart_data()

        snapshot = DashboardSnapshot(
            timestamp           = datetime.now().isoformat(timespec="seconds"),
            ticker              = ticker,
            last_price          = last_price,
            current_regime      = dominant,
            regime_probs        = regime_probs,
            var_95              = risk.get("VaR_95pct", 0),
            cvar_95             = risk.get("CVaR_95pct", 0),
            max_dd_p90          = risk.get("max_dd_P90", 0),
            sharpe_median       = risk.get("sharpe_median", 0),
            sortino_median      = risk.get("sortino_median", 0),
            calmar_median       = risk.get("calmar_median", 0),
            challenge_pass_rate = prop.get("pass_rate", 0),
            expected_attempts   = prop.get("expected_attempts", 0),
            ev_assessment       = ev_assessment,
            worst_scenario      = worst_scenario,
            worst_impact        = worst_impact,
            decision            = self.decision,
            optimal_sl          = optimal_sl,
            optimal_tp          = optimal_tp,
            optimal_size        = optimal_size,
            chart_data          = chart_data,
        )

        return snapshot

    def _build_chart_data(self) -> dict:
        """Build chart-ready data for web dashboard."""
        data = {}

        # Regime distribution
        regime_stats = self.p2.get("regime_stats", {})
        data["regime_distribution"] = [
            {"regime": s["label"], "frequency": s["frequency_pct"],
             "ann_return": s["mean_return_annualized"], "ann_vol": s["vol_annualized"]}
            for s in regime_stats.values()
        ]

        # Cross-model comparison
        model_comparison = []
        for name, p4_res in self.p4.items():
            model_comparison.append({
                "model":       name,
                "mean_return":  p4_res.return_metrics.get("mean_return_annualized", 0),
                "prob_profit":  p4_res.return_metrics.get("prob_profit", 0),
                "var_95":       p4_res.risk_metrics.get("VaR_95pct", 0),
                "max_dd_p90":   p4_res.risk_metrics.get("max_dd_P90", 0),
                "sharpe":       p4_res.risk_metrics.get("sharpe_median", 0),
                "pass_rate":    p4_res.prop_firm_metrics.get("pass_rate", 0),
            })
        data["model_comparison"] = model_comparison

        # Stress test results
        if self.p5 and self.p5.historical_results:
            stress_data = []
            for key, res in self.p5.historical_results.items():
                stress_data.append({
                    "scenario":    res.scenario_name,
                    "avg_impact":  res.portfolio_impact_pct,
                    "worst_impact": res.max_impact_pct,
                    "breach_rate": res.prop_firm_breach_rate,
                    "recovery":    res.avg_recovery_days,
                })
            data["stress_tests"] = stress_data

        # Transition matrix
        trans = self.p2.get("empirical_transmat")
        if trans is not None:
            data["transition_matrix"] = trans.to_dict()

        return data

    def render_terminal(self, snapshot: DashboardSnapshot | None = None):
        """Render dashboard ke terminal."""
        if snapshot is None:
            snapshot = self.build_snapshot()

        w = 62
        print(f"\n{'━'*w}")
        print(f"  📊 RISK MANAGEMENT DASHBOARD — {snapshot.ticker}")
        print(f"  {snapshot.timestamp}")
        print(f"{'━'*w}")

        # Price & Regime
        print(f"\n  💰 Last Price: ${snapshot.last_price:,.2f}")
        print(f"  🔮 Current Regime: {snapshot.current_regime}")
        if snapshot.regime_probs:
            for label, prob in snapshot.regime_probs.items():
                bar = "█" * int(prob * 30)
                marker = " ◄" if label == snapshot.current_regime else ""
                print(f"     {label:<22} {prob:>5.1%}  {bar}{marker}")

        # Risk Metrics
        print(f"\n  {'─'*w}")
        print(f"  📉 RISK METRICS (Model: {self.pref})")
        print(f"  {'─'*w}")
        print(f"  VaR 95%:        {snapshot.var_95:>8.2%}")
        print(f"  CVaR 95% (ES):  {snapshot.cvar_95:>8.2%}")
        print(f"  Max DD P90:     {snapshot.max_dd_p90:>8.2%}")
        print(f"  Sharpe (med):   {snapshot.sharpe_median:>8.3f}")
        print(f"  Sortino (med):  {snapshot.sortino_median:>8.3f}")
        print(f"  Calmar (med):   {snapshot.calmar_median:>8.3f}")

        # Prop Firm
        print(f"\n  {'─'*w}")
        print(f"  🏢 PROP FIRM CHALLENGE")
        print(f"  {'─'*w}")
        print(f"  Pass Rate:       {snapshot.challenge_pass_rate:>7.1%}")
        print(f"  Expected Attempts: {snapshot.expected_attempts:>5.1f}×")
        print(f"  EV Assessment:   {snapshot.ev_assessment}")

        # Stress
        if snapshot.worst_scenario:
            print(f"\n  {'─'*w}")
            print(f"  💥 WORST-CASE STRESS")
            print(f"  {'─'*w}")
            print(f"  Scenario:  {snapshot.worst_scenario}")
            print(f"  Impact:    {snapshot.worst_impact:.2%}")

        # Decision
        if snapshot.decision:
            d = snapshot.decision
            print(f"\n  {'─'*w}")
            print(f"  🎯 TRADING DECISION")
            print(f"  {'─'*w}")

            # Action with color emoji
            action_emoji = {
                "LONG": "🟢", "SHORT": "🔴",
                "FLAT": "⚪", "REDUCE": "🟡"
            }
            emoji = action_emoji.get(d.action, "❓")
            print(f"  Action:       {emoji} {d.action}")
            print(f"  Confidence:   {d.confidence:.0%}")
            print(f"  Position Size: {d.position_size:.2f}×")
            print(f"  Stop Loss:    {d.stop_loss_pct:.2%}")
            print(f"  Take Profit:  {d.take_profit_pct:.2%}")

            if d.alerts:
                print(f"\n  ⚠️  ALERTS:")
                for alert in d.alerts:
                    print(f"    {alert}")

            if d.rationale:
                print(f"\n  📝 Rationale:")
                for r in d.rationale:
                    print(f"    • {r}")

        print(f"\n{'━'*w}\n")

    def to_json(self, snapshot: DashboardSnapshot | None = None) -> dict:
        """Export dashboard snapshot sebagai JSON-serializable dict."""
        if snapshot is None:
            snapshot = self.build_snapshot()

        result = {
            "timestamp":          snapshot.timestamp,
            "ticker":             snapshot.ticker,
            "last_price":         snapshot.last_price,
            "regime": {
                "current":        snapshot.current_regime,
                "probabilities":  snapshot.regime_probs,
            },
            "risk_metrics": {
                "var_95":         snapshot.var_95,
                "cvar_95":        snapshot.cvar_95,
                "max_dd_p90":     snapshot.max_dd_p90,
                "sharpe_median":  snapshot.sharpe_median,
                "sortino_median": snapshot.sortino_median,
                "calmar_median":  snapshot.calmar_median,
            },
            "prop_firm": {
                "pass_rate":       snapshot.challenge_pass_rate,
                "expected_attempts": snapshot.expected_attempts,
                "ev_assessment":   snapshot.ev_assessment,
            },
            "stress_test": {
                "worst_scenario":  snapshot.worst_scenario,
                "worst_impact":    snapshot.worst_impact,
            },
            "chart_data":          snapshot.chart_data,
        }

        if snapshot.decision:
            d = snapshot.decision
            result["decision"] = {
                "action":          d.action,
                "confidence":      d.confidence,
                "position_size":   d.position_size,
                "stop_loss_pct":   d.stop_loss_pct,
                "take_profit_pct": d.take_profit_pct,
                "risk_per_trade":  d.risk_per_trade,
                "current_regime":  d.current_regime,
                "ev_positive":     d.ev_positive,
                "alerts":          d.alerts,
                "rationale":       d.rationale,
            }

        return result


# ═══════════════════════════════════════════════════════════════
# MASTER PHASE 6 RUNNER
# ═══════════════════════════════════════════════════════════════

class Phase6Runner:
    """
    Orchestrate seluruh Phase 6 dari satu interface.

    Usage:
        runner  = Phase6Runner(p2_results, p3_results, p4_results, p5_results)
        output  = runner.run()
    """

    def __init__(
        self,
        phase2_results:  dict,
        phase3_results:  dict,
        phase4_results:  dict[str, Phase4Results],
        phase5_results:  Phase5Results | None = None,
        trading_rules:   TradingRules | None  = None,
        preferred_model: str = "RegimeGBM",
        account_size:    float = 50_000.0,
    ):
        self.p2      = phase2_results
        self.p3      = phase3_results
        self.p4      = phase4_results
        self.p5      = phase5_results
        self.rules   = trading_rules or TradingRules()
        self.pref    = preferred_model
        self.acc     = account_size

        self.decision:  TradingDecision | None  = None
        self.snapshot:  DashboardSnapshot | None = None
        self.sizing:    dict | None             = None
        self.monitor:   LiveRegimeMonitor | None = None

    def run(self) -> dict:
        ticker = self.p2["ticker"]
        print(f"\n{'='*60}")
        print(f"  PHASE 6 — Decision Dashboard | {ticker}")
        print(f"{'='*60}")

        # ── 6.1 Decision Engine ───────────────────────────
        print(f"\n── [6.1] Decision Engine ──")
        engine = DecisionEngine(
            phase2_results  = self.p2,
            phase4_results  = self.p4,
            phase5_results  = self.p5,
            trading_rules   = self.rules,
            preferred_model = self.pref,
        )
        self.decision = engine.generate_decision()
        print(f"    Action: {self.decision.action} (conf: {self.decision.confidence:.0%})")
        print(f"    Size: {self.decision.position_size:.2f}× | SL: {self.decision.stop_loss_pct:.2%} | TP: {self.decision.take_profit_pct:.2%}")

        # ── 6.2 Position Sizing ───────────────────────────
        print(f"\n── [6.2] Position Sizing ──")
        sizer = PositionSizer(
            account_size     = self.acc,
            max_trailing_dd  = self.rules.max_trailing_dd,
        )
        raw_df = self.p2.get("labeled_df", self.p2.get("raw_df"))
        last_price = float(raw_df["Close"].iloc[-1]) if raw_df is not None else 20000.0
        self.sizing = sizer.compute(self.decision, price=last_price)
        print(f"    Final size: {self.sizing['final_size']:.2f}")
        print(f"    Kelly fraction: {self.sizing['kelly_fraction']:.4f}")
        print(f"    Risk/trade: {self.sizing['risk_as_pct_account']:.2f}% of account")

        # ── 6.3 Live Regime Monitor (init) ───────────────
        print(f"\n── [6.3] Live Regime Monitor ──")
        self.monitor = LiveRegimeMonitor(
            phase2_results = self.p2,
            ticker         = ticker,
        )
        status = self.monitor.check_regime_shift()
        print(f"    Current: {status['current_regime']} ({status['confidence']:.0%})")
        if status["alerts"]:
            for a in status["alerts"]:
                print(f"    {a}")

        # ── 6.4 Dashboard Render ─────────────────────────
        print(f"\n── [6.4] Dashboard ──")
        renderer = DashboardRenderer(
            phase2_results  = self.p2,
            phase4_results  = self.p4,
            phase5_results  = self.p5,
            decision        = self.decision,
            preferred_model = self.pref,
        )
        self.snapshot = renderer.build_snapshot()
        renderer.render_terminal(self.snapshot)

        # ── Assemble output ──────────────────────────────
        output = {
            "ticker":       ticker,
            "decision":     self.decision,
            "sizing":       self.sizing,
            "snapshot":      self.snapshot,
            "dashboard_json": renderer.to_json(self.snapshot),
            "monitor":      self.monitor,
        }

        return output

    def refresh(self) -> dict:
        """
        Feedback loop: re-check live data tanpa re-run full pipeline.
        Hanya update: regime monitor + vol check + decision.
        """
        if self.monitor is None:
            return {"error": "Run full pipeline first via .run()"}

        print(f"\n[Phase6] Refreshing live data for {self.p2['ticker']}...")

        status    = self.monitor.get_status()
        vol_check = self.monitor.check_vol_spike()

        print(f"  Price: ${status['last_price']:,.2f}")
        print(f"  Regime: {status['regime_status']['current_regime']}")
        if vol_check and vol_check.get("vol_spike"):
            print(f"  ⚠️ {vol_check['alert']}")

        return {
            "status":    status,
            "vol_check": vol_check,
        }

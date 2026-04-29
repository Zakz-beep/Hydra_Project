"""
phase5_stress.py
================
Phase 5 — Stress Testing & Prop Firm Challenge Simulation

Meliputi:
    5.1  Historical Stress Scenarios   (replay event historis → portfolio impact)
    5.2  Hypothetical Stress Tests     (user-defined extreme scenarios)
    5.3  Sensitivity Analysis          (parameter sweeps: sizing, SL/TP, regime)
    5.4  Prop Firm Challenge Simulator (multi-attempt Monte Carlo + budget/ROI)

Input : Phase 3 SimulationResults + Phase 4 Phase4Results + Phase 2 regime data
Output: Phase5Results — structured dict + DataFrames siap untuk Phase 6 dashboard.

Dependencies:
    pip install numpy pandas scipy
"""

import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass, field
from typing import Callable
import warnings
warnings.filterwarnings("ignore")

from phase3_simulation import (
    SimulationResults, SimulationConfig, TradingRules,
    TradeSimulator, GBMSimulator, RegimeSwitchingGBMSimulator,
    MertonJumpDiffusionSimulator, BlockBootstrapSimulator,
)
from phase4_metrics import (
    Phase4Results, ReturnMetricsComputer, RiskMetricsComputer,
    PropFirmAnalyzer,
)


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════

@dataclass
class HistoricalScenario:
    """
    Satu historical stress scenario.
    Define drawdown pattern dan recovery profile dari event nyata.
    """
    name:        str
    description: str
    # Daily return sequence yang merepresentasikan event
    # List of daily log returns selama event berlangsung
    daily_returns: list[float] = field(default_factory=list)
    # Atau: total drawdown + duration jika pattern tidak detail
    total_drawdown_pct: float = 0.0    # e.g. -0.35 untuk -35%
    drawdown_days:      int   = 1      # durasi drawdown
    recovery_days:      int   = 0      # hari sampai recover (optional)
    # Volatility multiplier selama event (vs normal)
    vol_multiplier:     float = 3.0
    # Category tag
    category:           str   = "market_crash"


@dataclass
class StressTestResult:
    """Container untuk satu stress test result."""
    scenario_name:    str
    n_simulations:    int
    # Impact metrics
    portfolio_impact_pct:    float = 0.0    # rata-rata portfolio drawdown
    max_impact_pct:          float = 0.0    # worst case
    survival_rate:           float = 0.0    # % yang survive (equity > 0)
    prop_firm_breach_rate:   float = 0.0    # % yang breach prop firm rules
    # Recovery
    avg_recovery_days:       float = 0.0
    # Equity after stress
    mean_equity_after:       float = 0.0
    median_equity_after:     float = 0.0
    P10_equity_after:        float = 0.0
    # Detail distributions
    impact_distribution:     np.ndarray = field(default_factory=lambda: np.array([]))


@dataclass
class Phase5Results:
    """Container untuk semua Phase 5 output."""
    ticker:              str
    # 5.1 Historical stress
    historical_results:  dict = field(default_factory=dict)
    historical_table:    pd.DataFrame | None = None
    # 5.2 Hypothetical stress
    hypothetical_results: dict = field(default_factory=dict)
    hypothetical_table:   pd.DataFrame | None = None
    # 5.3 Sensitivity analysis
    sensitivity_results: dict = field(default_factory=dict)
    sensitivity_tables:  dict = field(default_factory=dict)  # {param_name: DataFrame}
    # 5.4 Prop firm challenge sim
    challenge_sim:       dict = field(default_factory=dict)
    challenge_table:     pd.DataFrame | None = None


# ═══════════════════════════════════════════════════════════════
# 5.1 — HISTORICAL STRESS SCENARIOS
# ═══════════════════════════════════════════════════════════════

# Pre-defined historical scenarios (approximate daily return sequences)
HISTORICAL_SCENARIOS = {

    "covid_crash_2020": HistoricalScenario(
        name="COVID Crash (Feb-Mar 2020)",
        description="S&P 500 turun ~34% dalam 23 trading days. "
                    "Fastest bear market dalam sejarah.",
        daily_returns=[
            -0.0032, -0.0098, -0.0045, -0.0070, -0.0028,  # Pekan 1: awal sell-off
            -0.0322, -0.0338, -0.0276, -0.0049,  0.0465,  # Pekan 2: panic selling
            -0.0495,  0.0093, -0.0542, -0.0258, -0.0120,  # Pekan 3: waterfall
            -0.0989, -0.0301,  0.0594, -0.0432, -0.0336,  # Pekan 4: capitulation
             0.0945, -0.0325,  0.0620,                     # Pekan 5: bounces
        ],
        total_drawdown_pct=-0.34,
        drawdown_days=23,
        recovery_days=148,
        vol_multiplier=4.0,
        category="pandemic",
    ),

    "volmageddon_2018": HistoricalScenario(
        name="Volmageddon (Feb 2018)",
        description="XIV blow-up. VIX spike 100%+ dalam sehari. "
                    "NQ turun ~10% dalam 8 hari.",
        daily_returns=[
            -0.0069, -0.0058, -0.0012, -0.0200, -0.0413,
            -0.0037,  0.0148, -0.0145,
        ],
        total_drawdown_pct=-0.10,
        drawdown_days=8,
        recovery_days=45,
        vol_multiplier=3.5,
        category="vol_event",
    ),

    "flash_crash_2010": HistoricalScenario(
        name="Flash Crash (May 6, 2010)",
        description="Dow turun ~9% lalu recover dalam menit. "
                    "Approximated as daily: single day extreme.",
        daily_returns=[
            -0.0347,  0.0125,  -0.0062,
        ],
        total_drawdown_pct=-0.09,
        drawdown_days=1,
        recovery_days=3,
        vol_multiplier=5.0,
        category="flash_crash",
    ),

    "fed_tightening_2022": HistoricalScenario(
        name="Fed Rate Hike Cycle (2022)",
        description="NQ turun ~35% sepanjang 2022. "
                    "Sustained grind-down, bukan crash tajam.",
        daily_returns=[
            # Approximation: 2 hari drop, 1 hari bounce diulang selama ~60 hari
            *([  -0.0085, -0.0065,  0.0040] * 20),
        ],
        total_drawdown_pct=-0.35,
        drawdown_days=190,
        recovery_days=300,
        vol_multiplier=1.8,
        category="rate_cycle",
    ),

    "black_monday_1987": HistoricalScenario(
        name="Black Monday (Oct 19, 1987)",
        description="Single-day drop -22.6% di DJIA. "
                    "Worst single day dalam sejarah modern.",
        daily_returns=[
            -0.0250, -0.0200, -0.0050,  # pre-crash weakness
            -0.2260,                      # Black Monday
             0.0570, -0.0332,  0.0443,    # aftermath bounces
        ],
        total_drawdown_pct=-0.336,
        drawdown_days=4,
        recovery_days=400,
        vol_multiplier=6.0,
        category="market_crash",
    ),

    "gfc_2008": HistoricalScenario(
        name="GFC — Lehman Collapse (Sep-Nov 2008)",
        description="Lehman Brothers collapse. Sustained crash dengan "
                    "VIX > 80. NQ turun ~50% peak to trough.",
        daily_returns=[
            # Approximation: 40 trading days of extreme
            -0.0140,  0.0050, -0.0200, -0.0450,  0.0200,
            -0.0380,  0.0100, -0.0510, -0.0190, -0.0270,
             0.0450, -0.0700,  0.0340, -0.0350,  0.0100,
            -0.0180,  0.0250, -0.0400,  0.0150, -0.0600,
             0.0480, -0.0260, -0.0320,  0.0580, -0.0150,
            -0.0180,  0.0100, -0.0550,  0.0390, -0.0280,
             0.0560, -0.0400,  0.0230, -0.0370,  0.0140,
            -0.0250, -0.0190,  0.0680,  0.0350, -0.0450,
        ],
        total_drawdown_pct=-0.50,
        drawdown_days=40,
        recovery_days=500,
        vol_multiplier=4.5,
        category="financial_crisis",
    ),

    "nq_gap_down_earnings": HistoricalScenario(
        name="NQ Earnings Gap Down (Generic)",
        description="Heavy tech earnings miss → overnight gap down. "
                    "Typical 3-5% gap + follow-through.",
        daily_returns=[
            -0.035, -0.012, -0.008, 0.015, -0.005,
        ],
        total_drawdown_pct=-0.055,
        drawdown_days=3,
        recovery_days=10,
        vol_multiplier=2.0,
        category="earnings",
    ),

    "yen_carry_unwind_2024": HistoricalScenario(
        name="Yen Carry Trade Unwind (Aug 2024)",
        description="BOJ rate hike → massive yen carry unwind. "
                    "Nikkei -12% single day, NQ -5% sympathy.",
        daily_returns=[
            -0.0120, -0.0180, -0.0530,  0.0290,  0.0080,
            -0.0050,  0.0210,
        ],
        total_drawdown_pct=-0.083,
        drawdown_days=3,
        recovery_days=15,
        vol_multiplier=3.0,
        category="macro_shock",
    ),
}


class HistoricalStressTester:
    """
    Apply historical stress scenarios ke portfolio simulation.

    Cara kerja:
    1. Ambil equity curves dari Phase 3/4
    2. Untuk setiap scenario, inject daily return sequence ke random
       positions dalam equity curve
    3. Measure impact: drawdown, breach rate, survival, recovery
    """

    def __init__(
        self,
        equity_curves:   np.ndarray,       # (n_sim, n_steps+1) dari Phase 3
        account_size:    float = 50_000.0,
        trading_rules:   TradingRules | None = None,
        scenarios:       dict | None = None,
    ):
        self.equity      = equity_curves
        self.acc         = account_size
        self.rules       = trading_rules or TradingRules()
        self.scenarios   = scenarios or HISTORICAL_SCENARIOS
        self.n_sim       = equity_curves.shape[0]
        self.results:    dict[str, StressTestResult] = {}

    def _apply_scenario(
        self,
        scenario: HistoricalScenario,
        injection_point: str = "random",  # "start", "middle", "end", "random"
    ) -> StressTestResult:
        """
        Apply satu scenario ke semua equity curves.
        Inject return sequence ke specific point dalam setiap equity curve.
        """
        rng = np.random.default_rng(42)
        stress_returns = np.array(scenario.daily_returns)
        shock_len      = len(stress_returns)
        n_steps        = self.equity.shape[1] - 1

        if shock_len > n_steps:
            # Truncate kalau scenario lebih panjang dari sim
            stress_returns = stress_returns[:n_steps]
            shock_len = n_steps

        impacts      = np.zeros(self.n_sim)
        equities_after = np.zeros(self.n_sim)
        breached     = np.zeros(self.n_sim, dtype=bool)
        recovery_days = np.zeros(self.n_sim)

        for i in range(self.n_sim):
            eq = self.equity[i].copy()

            # Determine injection point
            max_inject = max(1, n_steps - shock_len)
            if injection_point == "start":
                inject_at = 0
            elif injection_point == "middle":
                inject_at = n_steps // 2
            elif injection_point == "end":
                inject_at = max(0, n_steps - shock_len)
            else:
                inject_at = rng.integers(0, max_inject)

            # Apply stress returns ke equity curve
            pre_stress_eq = eq[inject_at]
            stressed_eq   = pre_stress_eq

            for j, r in enumerate(stress_returns):
                idx = inject_at + j + 1
                if idx >= len(eq):
                    break
                stressed_eq = stressed_eq * np.exp(r)
                eq[idx] = stressed_eq

            # Propagate stress effect ke remaining bars (shift all subsequent)
            stress_ratio = stressed_eq / pre_stress_eq if pre_stress_eq > 0 else 1.0
            for idx in range(inject_at + shock_len + 1, len(eq)):
                eq[idx] = eq[idx] * stress_ratio

            # Measure impact
            post_eq         = eq[-1]
            peak_eq         = np.max(eq[:inject_at + 1]) if inject_at > 0 else eq[0]
            min_eq          = np.min(eq[inject_at:])
            impact_pct      = (min_eq - peak_eq) / peak_eq if peak_eq > 0 else 0
            impacts[i]      = impact_pct
            equities_after[i] = post_eq

            # Check prop firm breach
            peak_running   = np.maximum.accumulate(eq)
            trailing_dd    = (peak_running - eq) / np.maximum(peak_running, 1)
            if np.max(trailing_dd) > self.rules.max_trailing_dd:
                breached[i] = True

            # Recovery: bars until equity returns to pre-stress level
            recover_idx = np.where(eq[inject_at + 1:] >= pre_stress_eq)[0]
            recovery_days[i] = float(recover_idx[0]) if len(recover_idx) > 0 else float(n_steps)

        result = StressTestResult(
            scenario_name        = scenario.name,
            n_simulations        = self.n_sim,
            portfolio_impact_pct = float(np.mean(impacts)),
            max_impact_pct       = float(np.min(impacts)),   # most negative
            survival_rate        = float(np.mean(equities_after > 0)),
            prop_firm_breach_rate = float(np.mean(breached)),
            avg_recovery_days    = float(np.mean(recovery_days)),
            mean_equity_after    = float(np.mean(equities_after)),
            median_equity_after  = float(np.median(equities_after)),
            P10_equity_after     = float(np.percentile(equities_after, 10)),
            impact_distribution  = impacts,
        )

        return result

    def run_all(self, injection_point: str = "random") -> dict[str, StressTestResult]:
        """Run semua historical scenarios."""
        print("[Phase5.1] Running historical stress tests...")

        for key, scenario in self.scenarios.items():
            print(f"    Scenario: {scenario.name}...")
            self.results[key] = self._apply_scenario(scenario, injection_point)

        return self.results

    def summary_table(self) -> pd.DataFrame:
        """Generate summary table untuk semua historical stress results."""
        rows = []
        for key, res in self.results.items():
            scen = self.scenarios[key]
            rows.append({
                "Scenario":         scen.name,
                "Category":         scen.category,
                "Hist DD":          f"{scen.total_drawdown_pct:.1%}",
                "Avg Impact":       f"{res.portfolio_impact_pct:.2%}",
                "Worst Impact":     f"{res.max_impact_pct:.2%}",
                "PF Breach %":      f"{res.prop_firm_breach_rate:.1%}",
                "Survival %":       f"{res.survival_rate:.1%}",
                "Avg Recovery (d)": f"{res.avg_recovery_days:.0f}",
                "Med Equity After": f"${res.median_equity_after:,.0f}",
            })
        return pd.DataFrame(rows).set_index("Scenario")


# ═══════════════════════════════════════════════════════════════
# 5.2 — HYPOTHETICAL STRESS TESTS
# ═══════════════════════════════════════════════════════════════

class HypotheticalStressTester:
    """
    User-defined extreme scenarios.

    Contoh:
        - "NQ drops 15% in 3 days"
        - "Volatility spikes 5× normal for 2 weeks"
        - "3 consecutive gap-downs of 3%"
    """

    def __init__(
        self,
        equity_curves:  np.ndarray,
        account_size:   float = 50_000.0,
        trading_rules:  TradingRules | None = None,
        last_price:     float = 20000.0,
    ):
        self.equity    = equity_curves
        self.acc       = account_size
        self.rules     = trading_rules or TradingRules()
        self.S0        = last_price
        self.results:  dict[str, StressTestResult] = {}

    def create_scenario(
        self,
        name:          str,
        total_drop_pct: float,
        duration_days: int,
        pattern:       str = "linear",  # "linear", "front_loaded", "back_loaded", "vshape"
        vol_mult:      float = 3.0,
        description:   str = "",
    ) -> HistoricalScenario:
        """
        Generate synthetic daily return sequence dari user-defined scenario.

        Patterns:
            linear       : smooth grind down
            front_loaded : big drop awal, lalu stabilize
            back_loaded  : slowly accelerating crash
            vshape       : crash lalu recover separuh
        """
        n = max(1, duration_days)
        daily_ret = np.zeros(n)

        if pattern == "linear":
            # Even distribution over duration
            daily_log_ret = np.log(1 + total_drop_pct) / n
            daily_ret[:] = daily_log_ret

        elif pattern == "front_loaded":
            # 70% impact in first 30% of duration
            front_n   = max(1, int(n * 0.3))
            back_n    = n - front_n
            total_log = np.log(1 + total_drop_pct)
            front_log = total_log * 0.7 / front_n
            back_log  = total_log * 0.3 / back_n if back_n > 0 else 0
            daily_ret[:front_n] = front_log
            daily_ret[front_n:] = back_log

        elif pattern == "back_loaded":
            # Accelerating: each day worse than previous
            weights = np.arange(1, n + 1, dtype=float)
            weights = weights / weights.sum()
            total_log = np.log(1 + total_drop_pct)
            daily_ret = total_log * weights

        elif pattern == "vshape":
            # Crash in first half, partial recovery in second half
            half = max(1, n // 2)
            crash_log = np.log(1 + total_drop_pct * 1.3) / half  # overshoot
            daily_ret[:half] = crash_log
            # Recovery portion
            recovery_log = -np.log(1 + total_drop_pct * 1.3) * 0.3 / max(1, n - half)
            daily_ret[half:] = recovery_log

        # Add noise
        rng = np.random.default_rng(42)
        noise = rng.normal(0, abs(np.mean(daily_ret)) * 0.3, size=n)
        daily_ret = daily_ret + noise

        return HistoricalScenario(
            name=name,
            description=description or f"Hypothetical: {total_drop_pct:.0%} in {n}d ({pattern})",
            daily_returns=daily_ret.tolist(),
            total_drawdown_pct=total_drop_pct,
            drawdown_days=n,
            vol_multiplier=vol_mult,
            category="hypothetical",
        )

    def run_scenario(
        self,
        scenario:        HistoricalScenario,
        injection_point: str = "random",
    ) -> StressTestResult:
        """Run satu hypothetical scenario."""
        tester = HistoricalStressTester(
            self.equity, self.acc, self.rules,
            scenarios={scenario.name: scenario},
        )
        result = tester._apply_scenario(scenario, injection_point)
        self.results[scenario.name] = result
        return result

    def run_preset_hypotheticals(self) -> dict[str, StressTestResult]:
        """
        Run beberapa hypothetical preset yang relevan untuk NQ/futures traders.
        """
        print("[Phase5.2] Running hypothetical stress tests...")

        presets = [
            ("NQ -15% in 3 days",   -0.15,  3,  "front_loaded"),
            ("NQ -10% in 1 day",    -0.10,  1,  "linear"),
            ("NQ -25% in 10 days",  -0.25,  10, "back_loaded"),
            ("NQ -8% V-shape 5d",   -0.08,  5,  "vshape"),
            ("NQ -5% grind 20d",    -0.05,  20, "linear"),
            ("NQ -40% in 30d",      -0.40,  30, "front_loaded"),
        ]

        for name, drop, dur, pattern in presets:
            print(f"    Scenario: {name}...")
            scenario = self.create_scenario(name, drop, dur, pattern)
            self.run_scenario(scenario)

        return self.results

    def summary_table(self) -> pd.DataFrame:
        rows = []
        for name, res in self.results.items():
            rows.append({
                "Scenario":       name,
                "Avg Impact":     f"{res.portfolio_impact_pct:.2%}",
                "Worst Impact":   f"{res.max_impact_pct:.2%}",
                "PF Breach %":    f"{res.prop_firm_breach_rate:.1%}",
                "Survival %":     f"{res.survival_rate:.1%}",
                "Avg Recovery":   f"{res.avg_recovery_days:.0f}d",
                "Med Eq After":   f"${res.median_equity_after:,.0f}",
            })
        return pd.DataFrame(rows).set_index("Scenario")


# ═══════════════════════════════════════════════════════════════
# 5.3 — SENSITIVITY ANALYSIS (Parameter Sweeps)
# ═══════════════════════════════════════════════════════════════

class SensitivityAnalyzer:
    """
    Sweep trading parameters dan observe impact ke risk metrics + challenge pass rate.

    Parameters yang di-sweep:
        - Stop loss %: 0.5% → 2%
        - Take profit %: 1% → 3%
        - Position size: 0.5x → 2x
        - Max trailing DD rule: 4% → 12%
        - Risk per trade %: 0.5% → 2%
    """

    def __init__(
        self,
        phase2_results: dict,
        price_paths:    np.ndarray | None = None,  # pre-generated paths atau None → regenerate
        base_rules:     TradingRules | None = None,
        base_config:    SimulationConfig | None = None,
        account_size:   float = 50_000.0,
    ):
        self.p2          = phase2_results
        self.price_paths = price_paths
        self.base_rules  = base_rules  or TradingRules()
        self.base_config = base_config or SimulationConfig(n_simulations=2000)  # fewer untuk speed
        self.acc         = account_size
        self.results:    dict = {}

    def _run_with_rules(self, rules: TradingRules) -> dict:
        """Run trade simulation dengan specific rules, return summary metrics."""
        ts = TradeSimulator(rules)

        if self.price_paths is not None:
            eq, logs, cp = ts.simulate_equity_curves(self.price_paths)
        else:
            # Shouldn't happen — price_paths must be provided
            return {"error": "No price paths"}

        n_sim = eq.shape[0]
        terminal_ret = (eq[:, -1] - rules.account_size) / rules.account_size

        # Quick risk calc
        ret_comp  = ReturnMetricsComputer(eq, rules.account_size, n_steps=eq.shape[1] - 1)
        risk_comp = RiskMetricsComputer(eq, rules.account_size, n_steps=eq.shape[1] - 1)

        var_dict = risk_comp.compute_var(0.95)
        dd_dict  = risk_comp.compute_max_drawdown_distribution()

        return {
            "pass_rate":      float(cp.mean()),
            "mean_return":    float(np.mean(terminal_ret)),
            "median_return":  float(np.median(terminal_ret)),
            "prob_profit":    float(np.mean(terminal_ret > 0)),
            "var_95":         var_dict.get("VaR_95pct", 0),
            "cvar_95":        var_dict.get("CVaR_95pct", 0),
            "max_dd_median":  dd_dict.get("max_dd_median", 0),
            "max_dd_p90":     dd_dict.get("max_dd_P90", 0),
            "mean_pnl":       float(np.mean(eq[:, -1] - rules.account_size)),
        }

    def sweep_parameter(
        self,
        param_name: str,
        values:     list,
        label:      str | None = None,
    ) -> pd.DataFrame:
        """
        Sweep satu parameter, fixing yang lain di baseline.

        Args:
            param_name : nama attribute di TradingRules (e.g. "stop_loss_pct")
            values     : list of values untuk sweep
            label      : display label (opsional)
        """
        results = []
        label = label or param_name

        for val in values:
            rules = TradingRules(
                entry_mode       = self.base_rules.entry_mode,
                take_profit_pct  = self.base_rules.take_profit_pct,
                stop_loss_pct    = self.base_rules.stop_loss_pct,
                max_hold_bars    = self.base_rules.max_hold_bars,
                position_size    = self.base_rules.position_size,
                account_size     = self.base_rules.account_size,
                risk_per_trade   = self.base_rules.risk_per_trade,
                use_risk_sizing  = self.base_rules.use_risk_sizing,
                daily_loss_limit = self.base_rules.daily_loss_limit,
                max_trailing_dd  = self.base_rules.max_trailing_dd,
                min_trading_days = self.base_rules.min_trading_days,
                challenge_target = self.base_rules.challenge_target,
            )
            # Override the swept parameter
            setattr(rules, param_name, val)

            metrics = self._run_with_rules(rules)
            metrics[label] = val
            results.append(metrics)

        df = pd.DataFrame(results).set_index(label)
        return df

    def run_default_sweeps(self) -> dict[str, pd.DataFrame]:
        """
        Run pre-defined parameter sweeps.
        Returns dict of {sweep_name: DataFrame}.
        """
        print("[Phase5.3] Running sensitivity analysis...")

        sweeps = {}

        # 1. Stop Loss sweep
        print("    Sweeping stop_loss_pct...")
        sweeps["stop_loss"] = self.sweep_parameter(
            "stop_loss_pct",
            [0.004, 0.006, 0.008, 0.010, 0.012, 0.015, 0.020],
            label="SL %",
        )

        # 2. Take Profit sweep
        print("    Sweeping take_profit_pct...")
        sweeps["take_profit"] = self.sweep_parameter(
            "take_profit_pct",
            [0.008, 0.010, 0.012, 0.015, 0.020, 0.025, 0.030],
            label="TP %",
        )

        # 3. Position Size sweep
        print("    Sweeping position_size...")
        sweeps["position_size"] = self.sweep_parameter(
            "position_size",
            [0.25, 0.50, 0.75, 1.0, 1.25, 1.5, 2.0],
            label="Size",
        )

        # 4. Max Trailing DD rule
        print("    Sweeping max_trailing_dd...")
        sweeps["trailing_dd"] = self.sweep_parameter(
            "max_trailing_dd",
            [0.04, 0.05, 0.06, 0.08, 0.10, 0.12],
            label="Trail DD Rule",
        )

        # 5. Risk per Trade (if risk-based sizing)
        print("    Sweeping risk_per_trade (risk-based sizing)...")
        risk_sweeps = []
        for val in [0.005, 0.0075, 0.01, 0.015, 0.02, 0.025]:
            rules = TradingRules(
                entry_mode       = self.base_rules.entry_mode,
                take_profit_pct  = self.base_rules.take_profit_pct,
                stop_loss_pct    = self.base_rules.stop_loss_pct,
                max_hold_bars    = self.base_rules.max_hold_bars,
                position_size    = self.base_rules.position_size,
                account_size     = self.base_rules.account_size,
                risk_per_trade   = val,
                use_risk_sizing  = True,  # force risk-based sizing
                daily_loss_limit = self.base_rules.daily_loss_limit,
                max_trailing_dd  = self.base_rules.max_trailing_dd,
                min_trading_days = self.base_rules.min_trading_days,
                challenge_target = self.base_rules.challenge_target,
            )
            metrics = self._run_with_rules(rules)
            metrics["Risk/Trade"] = val
            risk_sweeps.append(metrics)
        sweeps["risk_per_trade"] = pd.DataFrame(risk_sweeps).set_index("Risk/Trade")

        self.results = sweeps
        return sweeps

    def optimal_params_table(self) -> pd.DataFrame:
        """
        Dari semua sweeps, identify parameter combo yang maximize pass_rate
        sambil minimize max_dd_p90.
        """
        rows = []
        for sweep_name, df in self.results.items():
            if "pass_rate" in df.columns:
                best_idx = df["pass_rate"].idxmax()
                row = {
                    "Parameter":     sweep_name,
                    "Best Value":    best_idx,
                    "Pass Rate":     f"{df.loc[best_idx, 'pass_rate']:.1%}",
                    "Mean Return":   f"{df.loc[best_idx, 'mean_return']:.2%}",
                    "VaR 95%":       f"{df.loc[best_idx, 'var_95']:.2%}",
                    "MaxDD P90":     f"{df.loc[best_idx, 'max_dd_p90']:.2%}",
                }
                rows.append(row)
        return pd.DataFrame(rows).set_index("Parameter")


# ═══════════════════════════════════════════════════════════════
# 5.4 — PROP FIRM CHALLENGE MULTI-ATTEMPT SIMULATOR
# ═══════════════════════════════════════════════════════════════

class PropFirmChallengeSim:
    """
    Monte Carlo simulation of multiple prop firm challenge attempts.

    Answers:
        1. Given pass_rate per attempt, berapa probability pass dalam N attempts?
        2. Expected total cost (challenge fees) until first pass?
        3. Expected ROI setelah funded?
        4. Break-even analysis: berapa profit harus di-generate untuk cover challenge costs?
        5. Optimal number of max attempts before abandoning?
    """

    def __init__(
        self,
        pass_rate_per_attempt: float = 0.15,
        challenge_fee:         float = 500.0,   # USD per attempt
        funded_account_size:   float = 50_000.0,
        profit_split:          float = 0.80,    # 80% profit split
        monthly_profit_pct:    float = 0.04,    # expected 4%/month if funded
        funded_dd_limit:       float = 0.10,    # max DD on funded account
        # Bisa override dari Phase 4 metrics
        pass_mean_profit:      float = 0.12,    # avg profit if pass challenge (12%)
        blow_rate_funded:      float = 0.20,    # probability blow funded account
        n_monte_carlo:         int   = 50_000,
    ):
        self.pass_rate      = pass_rate_per_attempt
        self.fee            = challenge_fee
        self.funded_size    = funded_account_size
        self.split          = profit_split
        self.monthly_profit = monthly_profit_pct
        self.funded_dd      = funded_dd_limit
        self.pass_profit    = pass_mean_profit
        self.blow_rate      = blow_rate_funded
        self.n_mc           = n_monte_carlo
        self.results:       dict = {}

    def simulate_attempts(self, max_attempts: int = 20) -> dict:
        """
        Simulate sequences of challenge attempts.

        Returns distribusi:
            - attempts until first pass
            - total fees spent
            - time to pass (months)
            - net ROI after N months of funded trading
        """
        rng = np.random.default_rng(42)

        attempts_to_pass = np.zeros(self.n_mc)
        total_fees       = np.zeros(self.n_mc)
        passed           = np.zeros(self.n_mc, dtype=bool)

        for i in range(self.n_mc):
            for attempt in range(1, max_attempts + 1):
                if rng.random() < self.pass_rate:
                    attempts_to_pass[i] = attempt
                    total_fees[i]       = attempt * self.fee
                    passed[i]           = True
                    break
            else:
                # Never passed within max_attempts
                attempts_to_pass[i] = max_attempts
                total_fees[i]       = max_attempts * self.fee
                passed[i]           = False

        # Funded trading PnL (6 months post-funding)
        funded_months = 6
        funded_pnl    = np.zeros(self.n_mc)
        for i in range(self.n_mc):
            if passed[i]:
                # Each month: probability of blowing
                account = self.funded_size
                total_profit = 0.0
                for m in range(funded_months):
                    if rng.random() < self.blow_rate / funded_months:
                        # Blown — lose the funded account
                        break
                    # Monthly profit drawn
                    profit = account * self.monthly_profit
                    total_profit += profit * self.split
                funded_pnl[i] = total_profit

        net_pnl       = funded_pnl - total_fees
        pass_rate_sim = float(passed.mean())

        self.results = {
            # Pass/fail within max_attempts
            "pass_rate_within_max":       pass_rate_sim,
            "fail_rate_within_max":       1 - pass_rate_sim,

            # Attempts distribution
            "attempts_mean":             float(np.mean(attempts_to_pass[passed])) if passed.any() else None,
            "attempts_median":           float(np.median(attempts_to_pass[passed])) if passed.any() else None,
            "attempts_P90":              float(np.percentile(attempts_to_pass[passed], 90)) if passed.any() else None,

            # Cost analysis
            "total_fees_mean":           float(np.mean(total_fees)),
            "total_fees_median":         float(np.median(total_fees)),
            "total_fees_P90":            float(np.percentile(total_fees, 90)),

            # ROI analysis (over 6 months post-funding)
            "funded_pnl_mean":           float(np.mean(funded_pnl[passed])) if passed.any() else 0,
            "net_pnl_mean":              float(np.mean(net_pnl)),
            "net_pnl_median":            float(np.median(net_pnl)),
            "net_pnl_P10":               float(np.percentile(net_pnl, 10)),
            "net_pnl_P90":               float(np.percentile(net_pnl, 90)),
            "prob_net_positive":         float(np.mean(net_pnl > 0)),

            # Break-even
            "breakeven_monthly_pct":     self._breakeven_monthly(),

            # Config echo
            "config": {
                "pass_rate":          self.pass_rate,
                "challenge_fee":      self.fee,
                "funded_account":     self.funded_size,
                "profit_split":       self.split,
                "monthly_profit_pct": self.monthly_profit,
                "max_attempts":       max_attempts,
                "n_simulations":      self.n_mc,
            }
        }

        return self.results

    def _breakeven_monthly(self) -> float:
        """
        Minimum monthly profit % needed supaya EV dari challenge attempts positive.
        EV = (pass_rate * funded_profit * split * months) - (expected_fees)
        """
        expected_attempts = 1 / self.pass_rate if self.pass_rate > 0 else float("inf")
        expected_fees     = expected_attempts * self.fee
        # Solve: pass_rate * (funded * monthly * split * months) = expected_fees
        months = 6
        if self.pass_rate * self.funded_size * self.split * months > 0:
            breakeven = expected_fees / (self.pass_rate * self.funded_size * self.split * months)
            return round(breakeven, 4)
        return float("inf")

    def cumulative_pass_probability(self, max_attempts: int = 20) -> pd.DataFrame:
        """
        P(pass within N attempts) for N = 1 to max_attempts.
        Geometric distribution: P(X ≤ N) = 1 - (1 - p)^N
        """
        rows = []
        for n in range(1, max_attempts + 1):
            cum_prob = 1 - (1 - self.pass_rate) ** n
            total_cost = n * self.fee
            rows.append({
                "Attempt #":      n,
                "P(pass by now)": f"{cum_prob:.1%}",
                "Total Cost":     f"${total_cost:,.0f}",
                "Marginal Cost":  f"${self.fee:,.0f}",
            })
        return pd.DataFrame(rows).set_index("Attempt #")

    def roi_table(self) -> pd.DataFrame:
        """Summary ROI table dari simulate_attempts()."""
        m = self.results
        if not m:
            return pd.DataFrame()

        rows = [
            {"Metric": "Pass Rate per Attempt",        "Value": f"{self.pass_rate:.1%}"},
            {"Metric": "P(Pass within max attempts)",   "Value": f"{m['pass_rate_within_max']:.1%}"},
            {"Metric": "Avg Attempts to Pass",          "Value": f"{m['attempts_mean']:.1f}" if m['attempts_mean'] else "—"},
            {"Metric": "Challenge Fee per Attempt",     "Value": f"${self.fee:,.0f}"},
            {"Metric": "Avg Total Fees",                "Value": f"${m['total_fees_mean']:,.0f}"},
            {"Metric": "P90 Total Fees",                "Value": f"${m['total_fees_P90']:,.0f}"},
            {"Metric": "Funded Profit (6mo, avg)",      "Value": f"${m['funded_pnl_mean']:,.0f}"},
            {"Metric": "Net P&L (mean)",                "Value": f"${m['net_pnl_mean']:,.0f}"},
            {"Metric": "Net P&L (median)",              "Value": f"${m['net_pnl_median']:,.0f}"},
            {"Metric": "P(Net Positive)",               "Value": f"{m['prob_net_positive']:.1%}"},
            {"Metric": "Breakeven Monthly %",           "Value": f"{m['breakeven_monthly_pct']:.2%}"},
        ]
        return pd.DataFrame(rows).set_index("Metric")


# ═══════════════════════════════════════════════════════════════
# MASTER PHASE 5 RUNNER
# ═══════════════════════════════════════════════════════════════

class Phase5Runner:
    """
    Orchestrate seluruh Phase 5 dari satu interface.

    Usage:
        runner  = Phase5Runner(phase3_results, phase4_results, phase2_results)
        results = runner.run()
    """

    def __init__(
        self,
        phase3_results: dict,              # {model_name: SimulationResults}
        phase4_results: dict,              # {model_name: Phase4Results}
        phase2_results: dict,              # output dari Phase2Runner.run()
        model_to_stress: str | None = None,  # default: pick "RegimeGBM" atau first available
        account_size:   float = 50_000.0,
        challenge_fee:  float = 500.0,
    ):
        self.p3      = phase3_results
        self.p4      = phase4_results
        self.p2      = phase2_results
        self.acc     = account_size
        self.fee     = challenge_fee

        # Pick model to stress test (prefer RegimeGBM, fallback ke first available)
        if model_to_stress and model_to_stress in phase3_results:
            self.target_model = model_to_stress
        elif "RegimeGBM" in phase3_results:
            self.target_model = "RegimeGBM"
        else:
            self.target_model = list(phase3_results.keys())[0]

        self.sim_res: SimulationResults = phase3_results[self.target_model]
        self.p4_res:  Phase4Results     = phase4_results.get(self.target_model)

        self.results: Phase5Results | None = None

    def run(self) -> Phase5Results:
        ticker = self.p2["ticker"]
        print(f"\n{'='*60}")
        print(f"  PHASE 5 — Stress Testing & Challenge Sim | {ticker}")
        print(f"  Target model: {self.target_model}")
        print(f"{'='*60}")

        results = Phase5Results(ticker=ticker)

        # ── 5.1 Historical Stress Tests ──────────────────────
        print(f"\n── [5.1] Historical Stress Scenarios ──")
        hist_tester = HistoricalStressTester(
            equity_curves = self.sim_res.equity_curves,
            account_size  = self.acc,
            trading_rules = self.sim_res.trading_rules,
        )
        results.historical_results = hist_tester.run_all()
        results.historical_table   = hist_tester.summary_table()

        # ── 5.2 Hypothetical Stress Tests ────────────────────
        print(f"\n── [5.2] Hypothetical Stress Tests ──")
        raw_df = self.p2.get("labeled_df")
        if raw_df is None:
            raw_df = self.p2.get("raw_df")
        last_price = float(raw_df["Close"].iloc[-1]) if raw_df is not None else 20000.0

        hypo_tester = HypotheticalStressTester(
            equity_curves = self.sim_res.equity_curves,
            account_size  = self.acc,
            trading_rules = self.sim_res.trading_rules,
            last_price    = last_price,
        )
        results.hypothetical_results = hypo_tester.run_preset_hypotheticals()
        results.hypothetical_table   = hypo_tester.summary_table()

        # ── 5.3 Sensitivity Analysis ─────────────────────────
        print(f"\n── [5.3] Sensitivity Analysis ──")
        sens_analyzer = SensitivityAnalyzer(
            phase2_results = self.p2,
            price_paths    = self.sim_res.price_paths,
            base_rules     = self.sim_res.trading_rules,
            base_config    = self.sim_res.sim_config,
            account_size   = self.acc,
        )
        results.sensitivity_results = sens_analyzer.run_default_sweeps()
        results.sensitivity_tables  = results.sensitivity_results

        # ── 5.4 Prop Firm Challenge Monte Carlo ──────────────
        print(f"\n── [5.4] Prop Firm Challenge Multi-Attempt Simulation ──")
        # Get pass rate dari Phase 4 (actual simulated)
        pass_rate = 0.15  # default
        if self.p4_res and self.p4_res.prop_firm_metrics:
            pass_rate = self.p4_res.prop_firm_metrics.get("pass_rate", 0.15)
            pass_rate = max(pass_rate, 0.001)  # floor supaya gak infinite

        # Get monthly profit estimate from Phase 4
        monthly_pct = 0.04  # default
        if self.p4_res and self.p4_res.return_metrics:
            # Approximate monthly dari sim period return
            sim_ret  = self.p4_res.return_metrics.get("mean_return", 0)
            n_steps  = self.p4_res.n_steps
            monthly_pct = float(sim_ret * (21 / max(n_steps, 1)))  # ~21 trading days/month
            monthly_pct = max(monthly_pct, 0.005)  # floor

        print(f"    Pass rate from Phase 4: {pass_rate:.1%}")
        print(f"    Est. monthly profit: {monthly_pct:.2%}")

        challenge_sim = PropFirmChallengeSim(
            pass_rate_per_attempt = pass_rate,
            challenge_fee         = self.fee,
            funded_account_size   = self.acc,
            monthly_profit_pct    = monthly_pct,
        )
        results.challenge_sim   = challenge_sim.simulate_attempts(max_attempts=20)
        results.challenge_table = challenge_sim.roi_table()

        # ── Print Summary ────────────────────────────────────
        self._print_summary(results, challenge_sim)

        self.results = results
        return results

    def _print_summary(self, results: Phase5Results, challenge_sim: PropFirmChallengeSim):
        print(f"\n{'='*60}")
        print(f"  PHASE 5 COMPLETE — {results.ticker}")
        print(f"{'='*60}")

        # 5.1 Historical
        if results.historical_table is not None:
            print(f"\n[5.1] Historical Stress Test Results")
            print(results.historical_table.to_string())

        # 5.2 Hypothetical
        if results.hypothetical_table is not None:
            print(f"\n[5.2] Hypothetical Stress Test Results")
            print(results.hypothetical_table.to_string())

        # 5.3 Sensitivity — print optimal params
        if results.sensitivity_results:
            print(f"\n[5.3] Sensitivity Analysis — Optimal Parameters")
            sens = SensitivityAnalyzer(self.p2, self.sim_res.price_paths)
            sens.results = results.sensitivity_results
            try:
                print(sens.optimal_params_table().to_string())
            except Exception:
                print("    (Optimal params table generation skipped)")

        # 5.4 Challenge Sim
        if results.challenge_table is not None:
            print(f"\n[5.4] Prop Firm Challenge Simulation (Multi-Attempt)")
            print(results.challenge_table.to_string())

            # Cumulative probabilities
            print(f"\n[5.4b] Cumulative Pass Probability")
            cum_df = challenge_sim.cumulative_pass_probability(max_attempts=10)
            print(cum_df.to_string())

        # Final verdict
        print(f"\n{'─'*60}")
        print(f"  🎯 PHASE 5 VERDICT")
        print(f"{'─'*60}")

        # Worst historical impact
        if results.historical_results:
            worst_hist = min(results.historical_results.values(),
                           key=lambda x: x.portfolio_impact_pct)
            print(f"  Worst historical impact: {worst_hist.scenario_name}")
            print(f"    → Avg impact: {worst_hist.portfolio_impact_pct:.2%}")
            print(f"    → PF breach rate: {worst_hist.prop_firm_breach_rate:.1%}")

        # Challenge assessment
        if results.challenge_sim:
            cs = results.challenge_sim
            net_pnl  = cs.get("net_pnl_mean", 0)
            prob_pos = cs.get("prob_net_positive", 0)
            if prob_pos > 0.60:
                emoji = "✅"
                assessment = "POSITIVE EV — Challenge worth pursuing"
            elif prob_pos > 0.40:
                emoji = "🟡"
                assessment = "MARGINAL EV — Consider improving edge first"
            else:
                emoji = "❌"
                assessment = "NEGATIVE EV — NOT recommended to take challenge"

            print(f"\n  Challenge Assessment: {emoji} {assessment}")
            print(f"    P(net positive): {prob_pos:.1%}")
            print(f"    Expected net P&L: ${net_pnl:,.0f}")
            print(f"    Breakeven monthly: {cs.get('breakeven_monthly_pct', 0):.2%}")

        print(f"\n{'='*60}\n")

    def save_to_csv(self, output_dir: str = "output"):
        """Save Phase 5 tables ke CSV."""
        import os
        os.makedirs(output_dir, exist_ok=True)

        if self.results is None:
            print("[Phase5] No results to save.")
            return

        ticker = self.results.ticker.replace("=", "_").replace("^", "")

        if self.results.historical_table is not None:
            path = os.path.join(output_dir, f"{ticker}_stress_historical.csv")
            self.results.historical_table.to_csv(path)
            print(f"[Phase5] Historical stress → {path}")

        if self.results.hypothetical_table is not None:
            path = os.path.join(output_dir, f"{ticker}_stress_hypothetical.csv")
            self.results.hypothetical_table.to_csv(path)
            print(f"[Phase5] Hypothetical stress → {path}")

        for name, df in self.results.sensitivity_tables.items():
            path = os.path.join(output_dir, f"{ticker}_sensitivity_{name}.csv")
            df.to_csv(path)
            print(f"[Phase5] Sensitivity [{name}] → {path}")

        if self.results.challenge_table is not None:
            path = os.path.join(output_dir, f"{ticker}_challenge_sim.csv")
            self.results.challenge_table.to_csv(path)
            print(f"[Phase5] Challenge sim → {path}")

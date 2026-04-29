"""
phase4_metrics.py
=================
Phase 4 — Risk & Return Metrics Computation

Consume output Phase 3 (SimulationResults) dan compute semua metrics relevant.

Meliputi:
    4.1  Return Metrics       (mean, median, percentiles, P(target), EV)
    4.2  Risk Metrics         (VaR, CVaR/ES, Max Drawdown distribution,
                               Drawdown duration, Calmar, Sortino, Sharpe)
    4.3  Conditional Metrics  (semua metrics di atas per regime)
    4.4  Prop Firm Analysis   (pass/fail distribution, fail day distribution)

Output: Phase4Results — structured dict + DataFrames siap untuk Phase 5/6 atau export.

Dependencies:
    pip install numpy pandas scipy
"""

import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass, field
import warnings
warnings.filterwarnings("ignore")

from phase3_simulation import SimulationResults, TradingRules


# ═══════════════════════════════════════════════════════════════
# DATA CLASS
# ═══════════════════════════════════════════════════════════════

@dataclass
class Phase4Results:
    """
    Container untuk semua Phase 4 output.
    Satu instance per model (GBM, RegimeGBM, JumpDiffusion, Bootstrap).
    """
    model_name:  str
    ticker:      str
    n_sims:      int
    n_steps:     int

    # 4.1 Return metrics
    return_metrics:      dict = field(default_factory=dict)

    # 4.2 Risk metrics
    risk_metrics:        dict = field(default_factory=dict)

    # 4.3 Conditional per regime
    conditional_metrics: dict = field(default_factory=dict)  # {regime_label: metrics_dict}

    # 4.4 Prop firm
    prop_firm_metrics:   dict = field(default_factory=dict)

    # Summary tables (DataFrames)
    return_table:        pd.DataFrame | None = None
    risk_table:          pd.DataFrame | None = None
    conditional_table:   pd.DataFrame | None = None
    prop_firm_table:     pd.DataFrame | None = None


# ═══════════════════════════════════════════════════════════════
# 4.1 — RETURN METRICS
# ═══════════════════════════════════════════════════════════════

class ReturnMetricsComputer:
    """
    Compute distribusi terminal P&L dan return metrics dari equity curves.
    """

    def __init__(
        self,
        equity_curves:  np.ndarray,   # (n_sim, n_steps+1)
        account_size:   float = 50_000.0,
        target_profit:  float = 0.08,  # 8% prop firm target
        annualize_factor: int = 252,
        n_steps:        int   = 63,    # trading days in simulation
    ):
        self.equity       = equity_curves
        self.acc          = account_size
        self.target       = target_profit
        self.ann_factor   = annualize_factor
        self.n_steps      = n_steps

        # Terminal values
        self.terminal_eq  = equity_curves[:, -1]
        self.terminal_pnl = self.terminal_eq - account_size
        self.terminal_ret = self.terminal_pnl / account_size

        # Per-bar returns (log)
        # equity curve → log returns per bar per simulation
        with np.errstate(divide="ignore", invalid="ignore"):
            self.bar_returns = np.diff(np.log(np.maximum(equity_curves, 1e-6)), axis=1)

    def compute(self) -> dict:
        ret = self.terminal_ret
        pnl = self.terminal_pnl

        # Annualization factor: scale from n_steps to 252
        ann_scale = self.ann_factor / self.n_steps

        mean_ret_ann = float(np.mean(ret)) * ann_scale
        std_ret_ann  = float(np.std(ret))  * np.sqrt(ann_scale)

        metrics = {
            # Terminal return distribution
            "mean_return":            float(np.mean(ret)),
            "median_return":          float(np.median(ret)),
            "mean_return_annualized": mean_ret_ann,
            "std_return_annualized":  std_ret_ann,

            # Percentiles (P10, P25, P50, P75, P90)
            "P10_return":  float(np.percentile(ret, 10)),
            "P25_return":  float(np.percentile(ret, 25)),
            "P50_return":  float(np.percentile(ret, 50)),
            "P75_return":  float(np.percentile(ret, 75)),
            "P90_return":  float(np.percentile(ret, 90)),

            # P&L in dollar terms
            "mean_pnl":    float(np.mean(pnl)),
            "median_pnl":  float(np.median(pnl)),
            "P10_pnl":     float(np.percentile(pnl, 10)),
            "P90_pnl":     float(np.percentile(pnl, 90)),

            # Probability metrics
            "prob_profit":        float(np.mean(ret > 0)),
            "prob_target":        float(np.mean(ret >= self.target)),
            "prob_loss_gt_5pct":  float(np.mean(ret < -0.05)),
            "prob_loss_gt_10pct": float(np.mean(ret < -0.10)),

            # Expected Value (EV)
            "expected_value_dollar": float(np.mean(pnl)),
            "ev_per_dollar_risked":  float(np.mean(pnl) / self.acc),

            # Distribution shape
            "skewness":            float(stats.skew(ret)),
            "excess_kurtosis":     float(stats.kurtosis(ret, fisher=True)),
        }

        return metrics

    def percentile_table(self) -> pd.DataFrame:
        ret = self.terminal_ret
        pnl = self.terminal_pnl
        rows = []
        for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
            rows.append({
                "Percentile":       f"P{p}",
                "Return (%)":       round(float(np.percentile(ret, p)) * 100, 2),
                "P&L ($)":          round(float(np.percentile(pnl, p)), 0),
                "Final Equity ($)": round(float(np.percentile(self.terminal_eq, p)), 0),
            })
        return pd.DataFrame(rows).set_index("Percentile")


# ═══════════════════════════════════════════════════════════════
# 4.2 — RISK METRICS
# ═══════════════════════════════════════════════════════════════

class RiskMetricsComputer:
    """
    Compute VaR, CVaR/ES, Max Drawdown distribution,
    Drawdown duration, Calmar, Sortino, Sharpe.
    """

    def __init__(
        self,
        equity_curves: np.ndarray,   # (n_sim, n_steps+1)
        account_size:  float = 50_000.0,
        n_steps:       int   = 63,
        ann_factor:    int   = 252,
        risk_free:     float = 0.05,  # annualized risk-free rate (5%)
    ):
        self.equity      = equity_curves
        self.acc         = account_size
        self.n_steps     = n_steps
        self.ann_factor  = ann_factor
        self.rf          = risk_free
        self.ann_scale   = ann_factor / n_steps

        self.terminal_ret = (equity_curves[:, -1] - account_size) / account_size

        # Bar-level log returns per simulation
        with np.errstate(divide="ignore", invalid="ignore"):
            self.bar_returns = np.diff(np.log(np.maximum(equity_curves, 1e-6)), axis=1)

    # ─── VaR & CVaR ──────────────────────────────────────────

    def compute_var(self, confidence: float = 0.95) -> dict:
        """
        VaR dan CVaR pada confidence level tertentu.
        Dihitung dari terminal return distribution (per-simulation).
        """
        alpha    = 1 - confidence
        ret      = self.terminal_ret

        var      = float(np.percentile(ret, alpha * 100))
        # CVaR = rata-rata semua returns yang lebih buruk dari VaR
        cvar     = float(np.mean(ret[ret <= var]))

        return {
            f"VaR_{int(confidence*100)}pct":  var,
            f"CVaR_{int(confidence*100)}pct": cvar,
            f"VaR_{int(confidence*100)}pct_dollar":  var  * self.acc,
            f"CVaR_{int(confidence*100)}pct_dollar": cvar * self.acc,
        }

    # ─── Max Drawdown ─────────────────────────────────────────

    def compute_drawdown_series(self, equity: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Hitung drawdown series dari satu equity curve.

        Returns:
            drawdown_pct   : drawdown array (negative numbers, in %)
            drawdown_duration: bars in drawdown at each point
        """
        peak          = np.maximum.accumulate(equity)
        drawdown_pct  = (equity - peak) / np.maximum(peak, 1e-6)
        
        # Duration: consecutive bars below peak
        in_dd    = drawdown_pct < -1e-6
        duration = np.zeros(len(equity), dtype=int)
        count    = 0
        for i in range(len(in_dd)):
            if in_dd[i]:
                count      += 1
                duration[i] = count
            else:
                count = 0

        return drawdown_pct, duration

    def compute_max_drawdown_distribution(self) -> dict:
        """
        Hitung max drawdown untuk setiap simulation → distribusi.
        """
        n_sim        = self.equity.shape[0]
        max_dds      = np.zeros(n_sim)
        max_durations = np.zeros(n_sim)

        for i in range(n_sim):
            dd, dur      = self.compute_drawdown_series(self.equity[i])
            max_dds[i]   = float(np.min(dd))   # most negative = worst
            max_durations[i] = float(np.max(dur))

        return {
            # Max drawdown distribution (as positive %)
            "max_dd_mean":   float(np.mean(  -max_dds)),
            "max_dd_median": float(np.median(-max_dds)),
            "max_dd_P50":    float(np.percentile(-max_dds, 50)),
            "max_dd_P75":    float(np.percentile(-max_dds, 75)),
            "max_dd_P90":    float(np.percentile(-max_dds, 90)),   # <-- FOKUS INI untuk prop firm
            "max_dd_P95":    float(np.percentile(-max_dds, 95)),
            "max_dd_P99":    float(np.percentile(-max_dds, 99)),
            "max_dd_worst":  float(np.max(-max_dds)),

            # Duration distribution (bars)
            "dd_duration_mean":   float(np.mean(max_durations)),
            "dd_duration_median": float(np.median(max_durations)),
            "dd_duration_P90":    float(np.percentile(max_durations, 90)),
            "dd_duration_worst":  float(np.max(max_durations)),
        }

    # ─── Risk-Adjusted Return Ratios ─────────────────────────

    def compute_ratios(self) -> dict:
        """
        Sharpe, Sortino, Calmar — across simulation distributions.
        Compute per-simulation, lalu report distribusi.
        """
        n_sim = self.equity.shape[0]
        rf_daily = self.rf / self.ann_factor

        sharpes   = np.zeros(n_sim)
        sortinos  = np.zeros(n_sim)
        calmars   = np.zeros(n_sim)

        for i in range(n_sim):
            bar_ret = self.bar_returns[i]
            excess  = bar_ret - rf_daily

            # Sharpe
            if bar_ret.std() > 1e-8:
                sharpes[i] = float(excess.mean() / bar_ret.std() * np.sqrt(self.ann_factor))

            # Sortino — hanya downside deviation
            downside = bar_ret[bar_ret < 0]
            if len(downside) > 1 and downside.std() > 1e-8:
                sortinos[i] = float(
                    excess.mean() / downside.std() * np.sqrt(self.ann_factor)
                )

            # Calmar = annualized return / max drawdown
            ann_ret  = (self.equity[i, -1] / self.equity[i, 0]) ** (self.ann_scale) - 1
            dd, _    = self.compute_drawdown_series(self.equity[i])
            max_dd   = float(-np.min(dd)) if np.min(dd) < 0 else 1e-6
            calmars[i] = ann_ret / max_dd if max_dd > 0 else 0.0

        def _dist(arr):
            return {
                "mean":   round(float(np.nanmean(arr)), 3),
                "median": round(float(np.nanmedian(arr)), 3),
                "P10":    round(float(np.nanpercentile(arr, 10)), 3),
                "P90":    round(float(np.nanpercentile(arr, 90)), 3),
            }

        return {
            "sharpe":  _dist(sharpes),
            "sortino": _dist(sortinos),
            "calmar":  _dist(calmars),
        }

    # ─── Master ───────────────────────────────────────────────

    def compute(self) -> dict:
        metrics = {}
        metrics.update(self.compute_var(confidence=0.95))
        metrics.update(self.compute_var(confidence=0.99))
        metrics.update(self.compute_max_drawdown_distribution())

        ratios = self.compute_ratios()
        for name, dist in ratios.items():
            for k, v in dist.items():
                metrics[f"{name}_{k}"] = v

        return metrics

    def risk_summary_table(self) -> pd.DataFrame:
        var95  = self.compute_var(0.95)
        var99  = self.compute_var(0.99)
        dd     = self.compute_max_drawdown_distribution()
        ratios = self.compute_ratios()

        rows = [
            {"Metric": "VaR 95%",              "Value": f"{var95['VaR_95pct']:.2%}",
             "Dollar": f"${var95['VaR_95pct_dollar']:,.0f}"},
            {"Metric": "CVaR 95% (ES)",        "Value": f"{var95['CVaR_95pct']:.2%}",
             "Dollar": f"${var95['CVaR_95pct_dollar']:,.0f}"},
            {"Metric": "VaR 99%",              "Value": f"{var99['VaR_99pct']:.2%}",
             "Dollar": f"${var99['VaR_99pct_dollar']:,.0f}"},
            {"Metric": "CVaR 99% (ES)",        "Value": f"{var99['CVaR_99pct']:.2%}",
             "Dollar": f"${var99['CVaR_99pct_dollar']:,.0f}"},
            {"Metric": "Max DD (median)",      "Value": f"{dd['max_dd_median']:.2%}", "Dollar": "—"},
            {"Metric": "Max DD (P90)",         "Value": f"{dd['max_dd_P90']:.2%}",    "Dollar": "—"},
            {"Metric": "Max DD (P99)",         "Value": f"{dd['max_dd_P99']:.2%}",    "Dollar": "—"},
            {"Metric": "DD Duration P90 (bars)", "Value": f"{dd['dd_duration_P90']:.0f}d", "Dollar": "—"},
            {"Metric": "Sharpe (median)",      "Value": f"{ratios['sharpe']['median']:.3f}", "Dollar": "—"},
            {"Metric": "Sortino (median)",     "Value": f"{ratios['sortino']['median']:.3f}", "Dollar": "—"},
            {"Metric": "Calmar (median)",      "Value": f"{ratios['calmar']['median']:.3f}", "Dollar": "—"},
        ]
        return pd.DataFrame(rows).set_index("Metric")


# ═══════════════════════════════════════════════════════════════
# 4.3 — CONDITIONAL METRICS PER REGIME
# ═══════════════════════════════════════════════════════════════

class ConditionalMetricsComputer:
    """
    Compute risk/return metrics conditional on starting regime.

    Hanya tersedia untuk RegimeGBM model yang punya regime_paths.
    Untuk model lain, provide partial analysis dari historical regime stats.
    """

    def __init__(
        self,
        sim_result:     SimulationResults,
        regime_stats:   dict,               # dari Phase 2
        account_size:   float = 50_000.0,
        n_steps:        int   = 63,
        ann_factor:     int   = 252,
    ):
        self.sim         = sim_result
        self.reg_stats   = regime_stats
        self.acc         = account_size
        self.n_steps     = n_steps
        self.ann_factor  = ann_factor

    def compute(self) -> dict:
        """
        Returns dict: {regime_label: {return_metrics, risk_metrics}}
        """
        if self.sim.regime_paths is None:
            # Fallback: compute dari historical regime stats
            return self._from_historical_stats()

        results = {}
        n_states = len(self.reg_stats)

        for state, s in self.reg_stats.items():
            label = s["label"]

            # Filter simulations yang START di regime ini
            # Starting regime = regime_paths[:, 0]
            mask = self.sim.regime_paths[:, 0] == int(state)
            if mask.sum() < 10:
                results[label] = {"n_simulations": int(mask.sum()), "insufficient_data": True}
                continue

            eq_subset = self.sim.equity_curves[mask]
            n_sim_sub = eq_subset.shape[0]

            ret_computer  = ReturnMetricsComputer(
                eq_subset, self.acc, n_steps=self.n_steps, annualize_factor=self.ann_factor
            )
            risk_computer = RiskMetricsComputer(
                eq_subset, self.acc, self.n_steps, self.ann_factor
            )

            ret_metrics  = ret_computer.compute()
            risk_metrics = risk_computer.compute()

            # Challenge pass rate for this starting regime
            cp_subset  = self.sim.challenge_pass[mask] if self.sim.challenge_pass is not None else None
            pass_rate  = float(cp_subset.mean()) if cp_subset is not None else None

            results[label] = {
                "n_simulations":      n_sim_sub,
                "return_metrics":     ret_metrics,
                "risk_metrics":       risk_metrics,
                "challenge_pass_rate": pass_rate,

                # Quick summary
                "mean_return_ann":    ret_metrics["mean_return_annualized"],
                "vol_ann":            s["vol_annualized"],
                "sharpe_median":      risk_metrics.get("sharpe_median", None),
                "max_dd_p90":         risk_metrics.get("max_dd_P90", None),
                "var_95pct":          risk_metrics.get("VaR_95pct", None),
            }

        return results

    def _from_historical_stats(self) -> dict:
        """Fallback: derive conditional metrics dari Phase 2 historical regime stats."""
        results = {}
        for state, s in self.reg_stats.items():
            label = s["label"]
            vol   = s["vol_annualized"]

            # Approximate VaR from normal distribution with regime vol
            daily_vol  = vol / np.sqrt(self.ann_factor)
            var_95_daily = stats.norm.ppf(0.05) * daily_vol
            var_95_period = var_95_daily * np.sqrt(self.n_steps)

            results[label] = {
                "source": "historical_phase2",
                "mean_return_ann":  s["mean_return_annualized"],
                "vol_ann":          vol,
                "sharpe_approx":    s["sharpe_approx"],
                "skewness":         s["skewness"],
                "frequency_pct":    s["frequency_pct"],
                "var_95_approx":    var_95_period,
                "max_dd_approx":    vol * np.sqrt(self.n_steps / self.ann_factor) * 2.5,
                # Rule of thumb: max DD ≈ 2.5× σ_period for random walk
            }

        return results

    def conditional_table(self) -> pd.DataFrame:
        cond = self.compute()
        rows = []
        for label, m in cond.items():
            if m.get("insufficient_data"):
                continue
            row = {"Regime": label}
            row["Ann Return"] = f"{m.get('mean_return_ann', 0):.2%}"
            row["Ann Vol"]    = f"{m.get('vol_ann', 0):.2%}"
            row["Sharpe"]     = f"{m.get('sharpe_approx', m.get('sharpe_median', 0) or 0):.2f}"
            row["VaR 95%"]    = f"{m.get('var_95pct', m.get('var_95_approx', 0)):.2%}"
            row["MaxDD P90"]  = f"{m.get('max_dd_p90', m.get('max_dd_approx', 0)):.2%}"
            if "challenge_pass_rate" in m and m["challenge_pass_rate"] is not None:
                row["Challenge Pass"] = f"{m['challenge_pass_rate']:.1%}"
            rows.append(row)
        return pd.DataFrame(rows).set_index("Regime")


# ═══════════════════════════════════════════════════════════════
# 4.4 — PROP FIRM CHALLENGE ANALYSIS
# ═══════════════════════════════════════════════════════════════

class PropFirmAnalyzer:
    """
    Detailed analysis of prop firm challenge pass/fail dari simulation output.

    Answers:
        - Berapa persen sim yang PASS challenge?
        - Yang FAIL, rata-rata fail di hari ke berapa?
        - Distribution of fail reasons (daily DD breach vs trailing DD breach)
        - Expected attempts to pass (geometric distribution)
    """

    def __init__(
        self,
        sim_result:   SimulationResults,
        account_size: float = 50_000.0,
    ):
        self.sim  = sim_result
        self.acc  = account_size
        self.rules = sim_result.trading_rules

    def compute(self) -> dict:
        cp    = self.sim.challenge_pass
        eq    = self.sim.equity_curves
        logs  = self.sim.trade_logs
        rules = self.rules
        n     = self.sim.n_simulations

        if cp is None:
            return {"error": "challenge_pass tidak tersedia"}

        pass_rate = float(cp.mean())
        fail_rate = 1 - pass_rate

        # Expected attempts to pass (geometric distribution: E[attempts] = 1/p)
        expected_attempts = 1 / pass_rate if pass_rate > 0 else float("inf")
        expected_cost     = expected_attempts  # multiply by challenge fee di luar

        # Fail day analysis: hari ke berapa equity curve mulai tidak recover?
        fail_days = []
        for i in range(n):
            if not cp[i]:  # failed simulation
                # Find first bar where trailing DD > limit
                peak      = np.maximum.accumulate(eq[i])
                trail_dd  = (peak - eq[i]) / np.maximum(peak, 1)
                breach    = np.argmax(trail_dd > (rules.max_trailing_dd if rules else 0.08))
                fail_days.append(int(breach) if breach > 0 else self.sim.n_steps)

        # Terminal equity distribution per outcome
        pass_eq  = eq[cp,  -1] if cp.sum() > 0 else np.array([self.acc])
        fail_eq  = eq[~cp, -1] if (~cp).sum() > 0 else np.array([self.acc])

        metrics = {
            # Pass/fail
            "pass_rate":            pass_rate,
            "fail_rate":            fail_rate,
            "n_pass":               int(cp.sum()),
            "n_fail":               int((~cp).sum()),
            "expected_attempts":    round(expected_attempts, 1),

            # Profit if passing
            "pass_mean_profit_pct": float((pass_eq.mean() - self.acc) / self.acc) if cp.sum() > 0 else 0,
            "pass_median_profit_pct": float((np.median(pass_eq) - self.acc) / self.acc) if cp.sum() > 0 else 0,

            # Loss if failing (cost analysis)
            "fail_mean_loss_pct":   float((self.acc - fail_eq.mean()) / self.acc) if (~cp).sum() > 0 else 0,

            # Fail day distribution
            "fail_day_mean":        float(np.mean(fail_days))   if fail_days else None,
            "fail_day_median":      float(np.median(fail_days)) if fail_days else None,
            "fail_day_P10":         float(np.percentile(fail_days, 10)) if fail_days else None,
            "fail_day_P90":         float(np.percentile(fail_days, 90)) if fail_days else None,

            # Rule parameters (untuk context)
            "max_trailing_dd_rule": rules.max_trailing_dd if rules else None,
            "daily_loss_rule":      rules.daily_loss_limit if rules else None,
            "challenge_target":     rules.challenge_target if rules else None,
        }

        return metrics

    def fail_day_histogram(self, bins: int = 20) -> pd.DataFrame:
        """Distribusi hari fail sebagai DataFrame — input untuk visualization."""
        cp  = self.sim.challenge_pass
        eq  = self.sim.equity_curves

        if cp is None:
            return pd.DataFrame()

        rules = self.rules
        fail_days = []
        for i in range(len(cp)):
            if not cp[i]:
                peak     = np.maximum.accumulate(eq[i])
                trail_dd = (peak - eq[i]) / np.maximum(peak, 1)
                breach   = np.argmax(trail_dd > (rules.max_trailing_dd if rules else 0.08))
                fail_days.append(int(breach) if breach > 0 else self.sim.n_steps)

        if not fail_days:
            return pd.DataFrame()

        counts, edges = np.histogram(fail_days, bins=bins)
        df = pd.DataFrame({
            "day_from":  edges[:-1].astype(int),
            "day_to":    edges[1:].astype(int),
            "n_fails":   counts,
            "pct_fails": counts / len(cp) * 100,
        })
        return df

    def prop_firm_table(self) -> pd.DataFrame:
        m = self.compute()
        rows = [
            {"Metric": "Pass Rate",                "Value": f"{m['pass_rate']:.1%}"},
            {"Metric": "Fail Rate",                "Value": f"{m['fail_rate']:.1%}"},
            {"Metric": "Expected Attempts to Pass","Value": f"{m['expected_attempts']:.1f}x"},
            {"Metric": "Avg Profit if Pass",       "Value": f"{m['pass_mean_profit_pct']:.2%}"},
            {"Metric": "Avg Loss if Fail",         "Value": f"{m['fail_mean_loss_pct']:.2%}"},
            {"Metric": "Avg Fail Day",             "Value": f"{m['fail_day_mean']:.1f}" if m['fail_day_mean'] else "—"},
            {"Metric": "Fail Day P10",             "Value": f"{m['fail_day_P10']:.0f}" if m['fail_day_P10'] else "—"},
            {"Metric": "Fail Day P90",             "Value": f"{m['fail_day_P90']:.0f}" if m['fail_day_P90'] else "—"},
        ]
        return pd.DataFrame(rows).set_index("Metric")


# ═══════════════════════════════════════════════════════════════
# MASTER PHASE 4 RUNNER
# ═══════════════════════════════════════════════════════════════

class Phase4Runner:
    """
    Orchestrate seluruh Phase 4 dari satu interface.

    Usage:
        runner  = Phase4Runner(phase3_results, phase2_results)
        results = runner.run()
        # results = dict {model_name: Phase4Results}
    """

    def __init__(
        self,
        phase3_results: dict,          # output dari Phase3Runner.run()
        phase2_results: dict,          # output dari Phase2Runner.run()
        account_size:   float = 50_000.0,
        target_profit:  float = 0.08,
        risk_free:      float = 0.05,
    ):
        self.p3          = phase3_results
        self.p2          = phase2_results
        self.acc         = account_size
        self.target      = target_profit
        self.rf          = risk_free
        self.all_results: dict[str, Phase4Results] = {}

    def _run_one_model(self, model_name: str, sim_res: SimulationResults) -> Phase4Results:
        print(f"\n── Analyzing: {model_name} ──")
        cfg     = sim_res.sim_config
        n_steps = cfg.n_steps if cfg else 63

        # 4.1 Return metrics
        print("    [4.1] Return metrics...")
        ret_comp = ReturnMetricsComputer(
            sim_res.equity_curves,
            account_size  = self.acc,
            target_profit = self.target,
            n_steps       = n_steps,
        )
        ret_metrics  = ret_comp.compute()
        ret_table    = ret_comp.percentile_table()

        # 4.2 Risk metrics
        print("    [4.2] Risk metrics (VaR, CVaR, MaxDD, Sortino, Calmar)...")
        risk_comp = RiskMetricsComputer(
            sim_res.equity_curves,
            account_size = self.acc,
            n_steps      = n_steps,
            risk_free    = self.rf,
        )
        risk_metrics = risk_comp.compute()
        risk_table   = risk_comp.risk_summary_table()

        # 4.3 Conditional per regime
        print("    [4.3] Conditional metrics per regime...")
        cond_comp = ConditionalMetricsComputer(
            sim_result   = sim_res,
            regime_stats = self.p2["regime_stats"],
            account_size = self.acc,
            n_steps      = n_steps,
        )
        cond_metrics = cond_comp.compute()
        cond_table   = cond_comp.conditional_table()

        # 4.4 Prop firm analysis
        print("    [4.4] Prop firm challenge analysis...")
        prop_comp    = PropFirmAnalyzer(sim_res, account_size=self.acc)
        prop_metrics = prop_comp.compute()
        prop_table   = prop_comp.prop_firm_table()

        result = Phase4Results(
            model_name          = model_name,
            ticker              = sim_res.ticker,
            n_sims              = sim_res.n_simulations,
            n_steps             = n_steps,
            return_metrics      = ret_metrics,
            risk_metrics        = risk_metrics,
            conditional_metrics = cond_metrics,
            prop_firm_metrics   = prop_metrics,
            return_table        = ret_table,
            risk_table          = risk_table,
            conditional_table   = cond_table,
            prop_firm_table     = prop_table,
        )

        return result

    def run(self) -> dict[str, Phase4Results]:
        ticker = self.p2["ticker"]
        print(f"\n{'='*60}")
        print(f"  PHASE 4 — Risk & Return Metrics | {ticker}")
        print(f"{'='*60}")

        for model_name, sim_res in self.p3.items():
            self.all_results[model_name] = self._run_one_model(model_name, sim_res)

        self._print_master_summary()
        return self.all_results

    def _print_master_summary(self):
        print(f"\n{'='*60}")
        print(f"  PHASE 4 COMPLETE — Cross-Model Summary")
        print(f"{'='*60}")

        # Header
        col_w = 16
        header = f"  {'Metric':<28}"
        for name in self.all_results:
            header += f"  {name:>{col_w}}"
        print(header)
        print(f"  {'-'*60}")

        def _row(label, extractor):
            row = f"  {label:<28}"
            for name, res in self.all_results.items():
                try:
                    val = extractor(res)
                    row += f"  {str(val):>{col_w}}"
                except Exception:
                    row += f"  {'—':>{col_w}}"
            return row

        print(_row("Mean Return (ann)",
              lambda r: f"{r.return_metrics.get('mean_return_annualized', 0):.2%}"))
        print(_row("Median Return",
              lambda r: f"{r.return_metrics.get('median_return', 0):.2%}"))
        print(_row("P(profit)",
              lambda r: f"{r.return_metrics.get('prob_profit', 0):.1%}"))
        print(_row("P(target 8%)",
              lambda r: f"{r.return_metrics.get('prob_target', 0):.1%}"))
        print(_row("VaR 95%",
              lambda r: f"{r.risk_metrics.get('VaR_95pct', 0):.2%}"))
        print(_row("CVaR 95%",
              lambda r: f"{r.risk_metrics.get('CVaR_95pct', 0):.2%}"))
        print(_row("Max DD P90",
              lambda r: f"{r.risk_metrics.get('max_dd_P90', 0):.2%}"))
        print(_row("Sharpe (median)",
              lambda r: f"{r.risk_metrics.get('sharpe_median', 0):.3f}"))
        print(_row("Sortino (median)",
              lambda r: f"{r.risk_metrics.get('sortino_median', 0):.3f}"))
        print(_row("Calmar (median)",
              lambda r: f"{r.risk_metrics.get('calmar_median', 0):.3f}"))
        print(_row("Challenge Pass Rate",
              lambda r: f"{r.prop_firm_metrics.get('pass_rate', 0):.1%}"))
        print(_row("Exp. Attempts to Pass",
              lambda r: f"{r.prop_firm_metrics.get('expected_attempts', 0):.1f}x"))
        print()

    def save_to_csv(self, output_dir: str = "output"):
        """Save semua Phase 4 tables ke CSV."""
        import os
        os.makedirs(output_dir, exist_ok=True)
        ticker = self.p2["ticker"].replace("=", "_").replace("^", "")

        for name, res in self.all_results.items():
            prefix = f"{ticker}_{name}"

            if res.return_table is not None:
                path = os.path.join(output_dir, f"{prefix}_return_percentiles.csv")
                res.return_table.to_csv(path)

            if res.risk_table is not None:
                path = os.path.join(output_dir, f"{prefix}_risk_metrics.csv")
                res.risk_table.to_csv(path)

            if res.conditional_table is not None:
                path = os.path.join(output_dir, f"{prefix}_conditional_metrics.csv")
                res.conditional_table.to_csv(path)

            if res.prop_firm_table is not None:
                path = os.path.join(output_dir, f"{prefix}_prop_firm.csv")
                res.prop_firm_table.to_csv(path)

        print(f"[Phase4] All tables saved to '{output_dir}/'")

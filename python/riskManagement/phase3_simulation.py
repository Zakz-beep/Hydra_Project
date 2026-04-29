"""
phase3_simulation.py
====================
Phase 3 — Simulation Engine

Generate ribuan possible price paths berdasarkan regime-aware models dari Phase 2.
Overlay trading rules di atas price paths → produce equity curves.

Models (berlapis):
    1. GBM baseline (sanity check)
    2. Regime-Switching GBM (μ & σ per regime)
    3. Merton Jump Diffusion (gap moves / macro catalyst)
    4. Historical Block Bootstrap (non-parametric, no underestimate tail risk)

Output: SimulationResults object berisi ribuan equity curves siap untuk Phase 4.

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


# ═══════════════════════════════════════════════════════════════
# DATA CLASSES
# ═══════════════════════════════════════════════════════════════

@dataclass
class TradingRules:
    """
    Define trading logic yang akan di-overlay ke setiap simulated price path.
    Semua nilai dalam unit yang sama dengan price path (points atau %).
    """
    # Entry
    entry_mode: str = "open_every_bar"
    # "open_every_bar" — masuk tiap bar (test sizing & exit logic)
    # "momentum"       — masuk kalau return bar sebelumnya positif
    # "mean_revert"    — masuk kalau return bar sebelumnya negatif

    # Exit
    take_profit_pct: float = 0.015    # 1.5% TP dari entry price
    stop_loss_pct:   float = 0.008    # 0.8% SL dari entry price
    max_hold_bars:   int   = 5        # time-based exit kalau TP/SL belum kena

    # Position sizing
    position_size:   float = 1.0      # multiplier (1.0 = 1 unit)
    account_size:    float = 50_000.0 # starting account (USD)
    risk_per_trade:  float = 0.01     # 1% account per trade (untuk risk-based sizing)
    use_risk_sizing: bool  = False    # True = risk-based, False = fixed unit

    # Prop firm constraints
    daily_loss_limit:     float = 0.02   # 2% daily loss limit
    max_trailing_dd:      float = 0.08   # 8% max trailing drawdown
    min_trading_days:     int   = 5      # minimum days harus trading
    challenge_target:     float = 0.08   # 8% profit target untuk pass challenge


@dataclass
class SimulationConfig:
    """Config untuk Simulation Engine."""
    n_simulations:   int   = 5_000     # jumlah Monte Carlo paths
    n_steps:         int   = 63        # trading days per simulation (1 quarter)
    dt:              float = 1/252     # time step (1 trading day)
    random_seed:     int   = 42

    # Model selection
    use_gbm:         bool  = True
    use_regime_gbm:  bool  = True
    use_jump_diff:   bool  = True
    use_bootstrap:   bool  = True

    # Jump diffusion params (Merton)
    jump_intensity:  float = 5.0       # avg jumps per year (λ)
    jump_mean:       float = -0.005    # mean jump size (log)
    jump_std:        float = 0.015     # std jump size

    # Block bootstrap
    block_size:      int   = 10        # blocks of consecutive returns


@dataclass
class SimulationResults:
    """
    Container untuk semua output Phase 3.
    Input langsung ke Phase 4 metrics computation.
    """
    model_name:      str
    ticker:          str
    n_simulations:   int
    n_steps:         int

    # Price paths: shape (n_simulations, n_steps+1)
    price_paths:     np.ndarray = field(default_factory=lambda: np.array([]))

    # Equity curves: shape (n_simulations, n_steps+1)
    equity_curves:   np.ndarray = field(default_factory=lambda: np.array([]))

    # Per-simulation trade records
    trade_logs:      list = field(default_factory=list)

    # Per-simulation regime sequences: shape (n_simulations, n_steps)
    regime_paths:    np.ndarray | None = None

    # Prop firm challenge pass/fail per simulation
    challenge_pass:  np.ndarray | None = None

    # Config snapshot
    trading_rules:   TradingRules | None = None
    sim_config:      SimulationConfig | None = None


# ═══════════════════════════════════════════════════════════════
# 3.1 — PRICE PATH GENERATORS
# ═══════════════════════════════════════════════════════════════

class GBMSimulator:
    """
    Geometric Brownian Motion — dS = μS dt + σS dW
    Baseline / sanity check. Terlalu smooth untuk real market.
    """

    def __init__(self, mu: float, sigma: float, config: SimulationConfig):
        self.mu     = mu
        self.sigma  = sigma
        self.config = config

    def simulate(self, S0: float) -> np.ndarray:
        """
        Returns price paths: shape (n_sim, n_steps+1)
        """
        cfg = self.config
        rng = np.random.default_rng(cfg.random_seed)

        dt  = cfg.dt
        n   = cfg.n_simulations
        T   = cfg.n_steps

        # Log-normal increments
        drift   = (self.mu - 0.5 * self.sigma**2) * dt
        vol     = self.sigma * np.sqrt(dt)
        Z       = rng.standard_normal((n, T))
        log_ret = drift + vol * Z

        # Accumulate
        log_paths          = np.zeros((n, T + 1))
        log_paths[:, 1:]   = np.cumsum(log_ret, axis=1)
        price_paths        = S0 * np.exp(log_paths)

        return price_paths


class RegimeSwitchingGBMSimulator:
    """
    Regime-Switching GBM — μ dan σ berubah per regime.
    Regime transitions driven oleh HMM transition matrix.

    Jauh lebih realistis dari plain GBM.
    """

    def __init__(
        self,
        regime_stats:    dict,          # dari Phase 2 regime_stats
        transition_matrix: np.ndarray,  # empirical atau HMM transmat (n_states x n_states)
        current_regime_probs: dict,     # dari Phase 2 current_regime_probs
        config: SimulationConfig,
    ):
        self.regime_stats  = regime_stats
        self.trans_mat     = transition_matrix
        self.init_probs    = np.array(list(current_regime_probs.values()))
        self.n_states      = len(regime_stats)
        self.config        = config

        # Extract μ dan σ per regime (daily dari annualized)
        self.mus   = np.array([s["mean_return_annualized"] / 252
                               for s in regime_stats.values()])
        self.sigs  = np.array([s["vol_annualized"] / np.sqrt(252)
                               for s in regime_stats.values()])

    def _simulate_regime_path(self, rng: np.random.Generator) -> np.ndarray:
        """Simulate satu sequence of regime states via Markov chain."""
        T      = self.config.n_steps
        states = np.zeros(T, dtype=int)

        # Starting regime
        states[0] = rng.choice(self.n_states, p=self.init_probs)

        for t in range(1, T):
            s         = states[t - 1]
            probs     = self.trans_mat[s]
            # Normalize (floating point safety)
            probs     = np.maximum(probs, 0)
            probs     = probs / probs.sum()
            states[t] = rng.choice(self.n_states, p=probs)

        return states

    def simulate(self, S0: float) -> tuple[np.ndarray, np.ndarray]:
        """
        Returns:
            price_paths  : (n_sim, n_steps+1)
            regime_paths : (n_sim, n_steps)
        """
        cfg = self.config
        rng = np.random.default_rng(cfg.random_seed)
        n   = cfg.n_simulations
        T   = cfg.n_steps

        price_paths  = np.zeros((n, T + 1))
        regime_paths = np.zeros((n, T), dtype=int)
        price_paths[:, 0] = S0

        for i in range(n):
            regimes        = self._simulate_regime_path(rng)
            regime_paths[i] = regimes

            mu_seq  = self.mus[regimes]
            sig_seq = self.sigs[regimes]

            Z       = rng.standard_normal(T)
            log_ret = (mu_seq - 0.5 * sig_seq**2) * cfg.dt + sig_seq * np.sqrt(cfg.dt) * Z

            price_paths[i, 1:] = S0 * np.exp(np.cumsum(log_ret))

        return price_paths, regime_paths


class MertonJumpDiffusionSimulator:
    """
    Merton Jump Diffusion — dS = μS dt + σS dW + J dN
    N = Poisson process (jump arrivals)
    J = jump size distribution (log-normal)

    Captures gap moves: post-CPI, Fed announcements, earnings gaps.
    Hampir wajib untuk NQ yang sensitive terhadap macro catalyst.
    """

    def __init__(
        self,
        mu:     float,
        sigma:  float,
        config: SimulationConfig,
    ):
        self.mu     = mu
        self.sigma  = sigma
        self.lam    = config.jump_intensity   # avg jumps/year
        self.mj     = config.jump_mean        # mean log jump
        self.sj     = config.jump_std         # std log jump
        self.config = config

    def simulate(self, S0: float) -> np.ndarray:
        """Returns price paths: (n_sim, n_steps+1)"""
        cfg = self.config
        rng = np.random.default_rng(cfg.random_seed + 1)  # different seed from GBM
        n   = cfg.n_simulations
        T   = cfg.n_steps
        dt  = cfg.dt

        # Drift adjustment untuk jump component
        # E[e^J] = exp(mj + 0.5*sj^2) → kompensasi drift
        k        = np.exp(self.mj + 0.5 * self.sj**2) - 1
        mu_adj   = self.mu - self.lam * k

        price_paths       = np.zeros((n, T + 1))
        price_paths[:, 0] = S0

        for t in range(T):
            S_prev = price_paths[:, t]

            # Diffusion component
            Z       = rng.standard_normal(n)
            diff    = (mu_adj - 0.5 * self.sigma**2) * dt + self.sigma * np.sqrt(dt) * Z

            # Jump component: Poisson arrivals
            n_jumps = rng.poisson(self.lam * dt, size=n)
            J_total = np.zeros(n)
            for i in range(n):
                if n_jumps[i] > 0:
                    jumps     = rng.normal(self.mj, self.sj, size=n_jumps[i])
                    J_total[i] = jumps.sum()

            log_ret         = diff + J_total
            price_paths[:, t + 1] = S_prev * np.exp(log_ret)

        return price_paths


class BlockBootstrapSimulator:
    """
    Historical Block Bootstrap — non-parametric simulation.
    Sample blocks of consecutive returns langsung dari historical data.
    Preserves serial correlation dan distribusi empiris.

    Guarantees no underestimation of tail risk karena pakai actual historical returns.
    """

    def __init__(
        self,
        historical_returns: pd.Series,
        config: SimulationConfig,
    ):
        self.returns    = historical_returns.dropna().values
        self.block_size = config.block_size
        self.config     = config

    def simulate(self, S0: float) -> np.ndarray:
        """Returns price paths: (n_sim, n_steps+1)"""
        cfg = self.config
        rng = np.random.default_rng(cfg.random_seed + 2)
        n   = cfg.n_simulations
        T   = cfg.n_steps
        bs  = self.block_size
        hist = self.returns

        price_paths       = np.zeros((n, T + 1))
        price_paths[:, 0] = S0

        n_blocks_needed   = int(np.ceil(T / bs))
        max_start         = len(hist) - bs

        if max_start <= 0:
            raise ValueError(f"Historical data terlalu pendek untuk block_size={bs}.")

        for i in range(n):
            # Sample random block starting indices
            starts  = rng.integers(0, max_start, size=n_blocks_needed)
            sampled = np.concatenate([hist[s:s + bs] for s in starts])[:T]

            price_paths[i, 1:] = S0 * np.exp(np.cumsum(sampled))

        return price_paths


# ═══════════════════════════════════════════════════════════════
# 3.2 — TRADE SIMULATION OVERLAY
# ═══════════════════════════════════════════════════════════════

class TradeSimulator:
    """
    Overlay trading rules di atas price paths.
    Generate equity curves dan trade logs dari setiap simulated price path.
    """

    def __init__(self, rules: TradingRules):
        self.rules = rules

    def simulate_equity_curves(
        self,
        price_paths: np.ndarray,
    ) -> tuple[np.ndarray, list, np.ndarray]:
        """
        Args:
            price_paths: (n_sim, n_steps+1)

        Returns:
            equity_curves : (n_sim, n_steps+1)
            trade_logs    : list of dicts per simulation
            challenge_pass: (n_sim,) bool array
        """
        r           = self.rules
        n_sim, T1   = price_paths.shape
        T           = T1 - 1

        equity_curves  = np.zeros((n_sim, T1))
        challenge_pass = np.zeros(n_sim, dtype=bool)
        trade_logs     = []

        for i in range(n_sim):
            prices      = price_paths[i]
            equity      = r.account_size
            eq_curve    = np.zeros(T1)
            eq_curve[0] = equity
            peak_equity = equity
            trades      = []
            daily_start = equity
            trading_days= 0
            breached    = False

            t = 1
            while t < T1 and not breached:
                # Daily reset check
                if t % 1 == 0:  # every bar (daily)
                    daily_start  = equity
                    trading_days += 1

                # Entry
                entry_price = prices[t]
                if r.entry_mode == "open_every_bar":
                    do_enter = True
                elif r.entry_mode == "momentum":
                    do_enter = (t > 1) and (prices[t] > prices[t - 1])
                elif r.entry_mode == "mean_revert":
                    do_enter = (t > 1) and (prices[t] < prices[t - 1])
                else:
                    do_enter = True

                if not do_enter:
                    eq_curve[t] = equity
                    t += 1
                    continue

                # Position sizing
                if r.use_risk_sizing:
                    risk_amt   = equity * r.risk_per_trade
                    sl_dollars = entry_price * r.stop_loss_pct
                    size       = risk_amt / sl_dollars if sl_dollars > 0 else r.position_size
                else:
                    size = r.position_size

                tp_price = entry_price * (1 + r.take_profit_pct)
                sl_price = entry_price * (1 - r.stop_loss_pct)

                # Simulate trade over hold period
                exit_price = entry_price
                exit_reason = "time"
                hold = min(r.max_hold_bars, T1 - t - 1)

                for h in range(1, hold + 1):
                    if t + h >= T1:
                        break
                    p = prices[t + h]
                    if p >= tp_price:
                        exit_price  = tp_price
                        exit_reason = "tp"
                        break
                    elif p <= sl_price:
                        exit_price  = sl_price
                        exit_reason = "sl"
                        break
                    else:
                        exit_price = p

                pnl    = (exit_price - entry_price) * size
                equity = equity + pnl

                trades.append({
                    "bar":        t,
                    "entry":      entry_price,
                    "exit":       exit_price,
                    "pnl":        pnl,
                    "exit_reason": exit_reason,
                    "equity":     equity,
                })

                # Update peak for trailing drawdown
                if equity > peak_equity:
                    peak_equity = equity

                # Check prop firm breaches
                trailing_dd = (peak_equity - equity) / peak_equity
                daily_dd    = (daily_start - equity) / daily_start if daily_start > 0 else 0

                if trailing_dd > r.max_trailing_dd:
                    breached = True
                elif daily_dd > r.daily_loss_limit:
                    breached = True

                eq_curve[t] = equity
                t += 1

            # Fill remaining bars if breached early
            for tt in range(t, T1):
                eq_curve[tt] = equity

            equity_curves[i] = eq_curve
            trade_logs.append(trades)

            # Prop firm pass check
            final_return = (equity - r.account_size) / r.account_size
            challenge_pass[i] = (
                not breached
                and final_return >= r.challenge_target
                and trading_days >= r.min_trading_days
            )

        return equity_curves, trade_logs, challenge_pass


# ═══════════════════════════════════════════════════════════════
# 3.3 — MULTI-ASSET CORRELATION (Cholesky)
# ═══════════════════════════════════════════════════════════════

class CorrelatedPathGenerator:
    """
    Generate correlated price paths untuk multi-asset simulation.
    Pakai Cholesky decomposition pada correlation matrix.
    """

    def __init__(self, correlation_matrix: np.ndarray, random_seed: int = 42):
        self.corr_mat = correlation_matrix
        self.rng      = np.random.default_rng(random_seed)

        # Validate positive semi-definite
        eigvals = np.linalg.eigvalsh(correlation_matrix)
        if np.any(eigvals < -1e-8):
            raise ValueError(
                "Correlation matrix tidak positive semi-definite. "
                "Cek data cleaning di Phase 1."
            )

        # Regularize jika ada eigenvalue sangat kecil
        self.chol = np.linalg.cholesky(
            correlation_matrix + 1e-8 * np.eye(len(correlation_matrix))
        )

    def generate_correlated_normals(self, n_sim: int, n_steps: int) -> np.ndarray:
        """
        Returns correlated Z: (n_assets, n_sim, n_steps)
        Apply ke log return formula di masing-masing asset simulator.
        """
        n_assets = len(self.corr_mat)
        Z_indep  = self.rng.standard_normal((n_assets, n_sim, n_steps))

        # Cholesky correlation: Z_corr[i] = sum_j(L[i,j] * Z_indep[j])
        Z_corr = np.einsum("ij,jkl->ikl", self.chol, Z_indep)
        return Z_corr


# ═══════════════════════════════════════════════════════════════
# MASTER PHASE 3 RUNNER
# ═══════════════════════════════════════════════════════════════

class Phase3Runner:
    """
    Orchestrate seluruh Phase 3 dari satu interface.

    Usage:
        runner  = Phase3Runner(phase2_results, sim_config, trading_rules)
        results = runner.run()
        # results = dict {model_name: SimulationResults}
    """

    def __init__(
        self,
        phase2_results: dict,
        sim_config:     SimulationConfig | None = None,
        trading_rules:  TradingRules | None     = None,
    ):
        self.p2         = phase2_results
        self.cfg        = sim_config   or SimulationConfig()
        self.rules      = trading_rules or TradingRules()
        self.all_results: dict[str, SimulationResults] = {}

    def _get_base_params(self) -> tuple[float, float, float]:
        """Extract overall μ, σ dari empirical stats, dan last price sebagai S0."""
        emp   = self.p2["dist_results"]["empirical"]["params"]
        mu    = float(emp["mean"])   * 252   # annualize daily mean
        sigma = float(emp["std"])    * np.sqrt(252)

        raw_df = self.p2.get("labeled_df")
        if raw_df is None:
            raw_df = self.p2.get("raw_df")

        S0     = float(raw_df["Close"].iloc[-1]) if raw_df is not None else 1000.0

        return mu, sigma, S0

    def _get_transition_matrix(self) -> np.ndarray:
        trans_df = self.p2["empirical_transmat"]
        return trans_df.values.astype(float)

    def _run_trade_sim(
        self, price_paths: np.ndarray, model_name: str
    ) -> tuple[np.ndarray, list, np.ndarray]:
        print(f"    Overlaying trading rules on {self.cfg.n_simulations:,} paths...")
        ts = TradeSimulator(self.rules)
        return ts.simulate_equity_curves(price_paths)

    # ─── Individual runners ───────────────────────────────────

    def run_gbm(self) -> SimulationResults:
        print("\n── [3.1a] GBM Baseline ──")
        mu, sigma, S0 = self._get_base_params()
        print(f"    μ={mu:.4f}/yr  σ={sigma:.4f}/yr  S0={S0:.2f}")

        sim         = GBMSimulator(mu, sigma, self.cfg)
        price_paths = sim.simulate(S0)
        eq, logs, cp = self._run_trade_sim(price_paths, "GBM")

        result = SimulationResults(
            model_name     = "GBM",
            ticker         = self.p2["ticker"],
            n_simulations  = self.cfg.n_simulations,
            n_steps        = self.cfg.n_steps,
            price_paths    = price_paths,
            equity_curves  = eq,
            trade_logs     = logs,
            challenge_pass = cp,
            trading_rules  = self.rules,
            sim_config     = self.cfg,
        )
        print(f"    Done. Challenge pass rate: {cp.mean():.1%}")
        return result

    def run_regime_gbm(self) -> SimulationResults:
        print("\n── [3.1b] Regime-Switching GBM ──")
        _, _, S0   = self._get_base_params()
        trans_mat  = self._get_transition_matrix()
        regime_stats      = self.p2["regime_stats"]
        current_probs     = self.p2["current_regime_probs"]

        print(f"    S0={S0:.2f}  n_states={self.p2['n_states']}")

        sim = RegimeSwitchingGBMSimulator(
            regime_stats         = regime_stats,
            transition_matrix    = trans_mat,
            current_regime_probs = current_probs,
            config               = self.cfg,
        )
        price_paths, regime_paths = sim.simulate(S0)
        eq, logs, cp = self._run_trade_sim(price_paths, "RegimeGBM")

        result = SimulationResults(
            model_name     = "RegimeGBM",
            ticker         = self.p2["ticker"],
            n_simulations  = self.cfg.n_simulations,
            n_steps        = self.cfg.n_steps,
            price_paths    = price_paths,
            equity_curves  = eq,
            trade_logs     = logs,
            regime_paths   = regime_paths,
            challenge_pass = cp,
            trading_rules  = self.rules,
            sim_config     = self.cfg,
        )
        print(f"    Done. Challenge pass rate: {cp.mean():.1%}")
        return result

    def run_jump_diffusion(self) -> SimulationResults:
        print("\n── [3.1c] Merton Jump Diffusion ──")
        mu, sigma, S0 = self._get_base_params()
        print(f"    μ={mu:.4f}  σ={sigma:.4f}  λ={self.cfg.jump_intensity}/yr  S0={S0:.2f}")

        sim         = MertonJumpDiffusionSimulator(mu, sigma, self.cfg)
        price_paths = sim.simulate(S0)
        eq, logs, cp = self._run_trade_sim(price_paths, "JumpDiff")

        result = SimulationResults(
            model_name     = "JumpDiffusion",
            ticker         = self.p2["ticker"],
            n_simulations  = self.cfg.n_simulations,
            n_steps        = self.cfg.n_steps,
            price_paths    = price_paths,
            equity_curves  = eq,
            trade_logs     = logs,
            challenge_pass = cp,
            trading_rules  = self.rules,
            sim_config     = self.cfg,
        )
        print(f"    Done. Challenge pass rate: {cp.mean():.1%}")
        return result

    def run_bootstrap(self) -> SimulationResults:
        print("\n── [3.1d] Historical Block Bootstrap ──")
        _, _, S0 = self._get_base_params()

        log_returns = self.p2.get("log_returns")
        if log_returns is None:
            raise ValueError("log_returns tidak ada di phase2_results.")

        print(f"    S0={S0:.2f}  block_size={self.cfg.block_size}  "
              f"hist_bars={len(log_returns)}")

        sim         = BlockBootstrapSimulator(log_returns, self.cfg)
        price_paths = sim.simulate(S0)
        eq, logs, cp = self._run_trade_sim(price_paths, "Bootstrap")

        result = SimulationResults(
            model_name     = "Bootstrap",
            ticker         = self.p2["ticker"],
            n_simulations  = self.cfg.n_simulations,
            n_steps        = self.cfg.n_steps,
            price_paths    = price_paths,
            equity_curves  = eq,
            trade_logs     = logs,
            challenge_pass = cp,
            trading_rules  = self.rules,
            sim_config     = self.cfg,
        )
        print(f"    Done. Challenge pass rate: {cp.mean():.1%}")
        return result

    # ─── Master run ───────────────────────────────────────────

    def run(self) -> dict[str, SimulationResults]:
        ticker = self.p2["ticker"]
        print(f"\n{'='*60}")
        print(f"  PHASE 3 — Simulation Engine | {ticker}")
        print(f"  n_sim={self.cfg.n_simulations:,}  n_steps={self.cfg.n_steps}d")
        print(f"{'='*60}")

        if self.cfg.use_gbm:
            self.all_results["GBM"] = self.run_gbm()

        if self.cfg.use_regime_gbm:
            self.all_results["RegimeGBM"] = self.run_regime_gbm()

        if self.cfg.use_jump_diff:
            self.all_results["JumpDiffusion"] = self.run_jump_diffusion()

        if self.cfg.use_bootstrap:
            self.all_results["Bootstrap"] = self.run_bootstrap()

        self._print_summary()
        return self.all_results

    def _print_summary(self):
        print(f"\n{'='*60}")
        print(f"  PHASE 3 COMPLETE — Summary")
        print(f"{'='*60}")
        print(f"  {'Model':<20} {'Pass Rate':>10} {'Med Final Eq':>14} {'P10 Eq':>12}")
        print(f"  {'-'*58}")
        rules = self.rules
        for name, res in self.all_results.items():
            final_eq   = res.equity_curves[:, -1]
            pass_rate  = res.challenge_pass.mean() if res.challenge_pass is not None else float("nan")
            med_eq     = np.median(final_eq)
            p10_eq     = np.percentile(final_eq, 10)
            print(f"  {name:<20} {pass_rate:>9.1%}  ${med_eq:>12,.0f}  ${p10_eq:>10,.0f}")
        print()

"""
main.py
=======
Entry point untuk Full Risk Management Pipeline (Phase 2 → 6).

Cara pakai:
    1. Set TICKER, PERIOD, INTERVAL, N_STATES di CONFIG di bawah
    2. Jalankan: python main.py
    3. Semua output akan di-print ke terminal + disimpan ke CSV

Pipeline:
    Phase 2 → Distributional Analysis + GARCH + HMM Regime Detection
    Phase 3 → Monte Carlo Simulation (GBM, RegimeGBM, JumpDiff, Bootstrap)
    Phase 4 → Risk Metrics (VaR, CVaR, MaxDD, Sharpe, Sortino, Calmar)
    Phase 5 → Stress Testing + Prop Firm Challenge Simulation
    Phase 6 → Decision Dashboard + Live Regime Monitor

Contoh ticker:
    Futures  : "NQ=F", "ES=F", "MNQ=F", "MES=F", "CL=F"
    Equities : "SPY", "QQQ", "AAPL", "TSLA"
    Index    : "^GSPC", "^NDX", "^VIX"
    Forex    : "EURUSD=X", "USDJPY=X"
    Crypto   : "BTC-USD", "ETH-USD"

Dependencies:
    pip install yfinance pandas numpy scipy arch hmmlearn statsmodels
"""

import os
import json
import pandas as pd
import numpy as np
import warnings
warnings.filterwarnings("ignore")

from data_layer        import build_dataset
from phase2_model      import Phase2Runner
from phase3_simulation import Phase3Runner, SimulationConfig, TradingRules
from phase4_metrics    import Phase4Runner
from phase5_stress     import Phase5Runner
from phase6_dashboard  import Phase6Runner


# ══════════════════════════════════════════════
# CONFIG — UBAH DI SINI
# ══════════════════════════════════════════════

TICKER    = "NQ=F"   # ticker Yahoo Finance
PERIOD    = "5y"     # "1y", "2y", "5y", "10y", "max"
INTERVAL  = "1d"     # "1d" untuk daily | "1h"/"15m" untuk intraday (max 60 hari)
N_STATES  = 3        # jumlah HMM regime: 2, 3, atau 4
SAVE_CSV  = True     # simpan output ke CSV?
OUTPUT_DIR = "output"  # folder output

# Simulation config
SIM_CONFIG = SimulationConfig(
    n_simulations = 5_000,     # jumlah Monte Carlo paths
    n_steps       = 63,        # trading days per simulation (1 quarter)
    dt            = 1/252,
    random_seed   = 42,
    use_gbm       = True,
    use_regime_gbm = True,
    use_jump_diff  = True,
    use_bootstrap  = True,
    jump_intensity = 5.0,
    jump_mean      = -0.005,
    jump_std       = 0.015,
    block_size     = 10,
)

# Trading rules (prop firm challenge defaults)
TRADING_RULES = TradingRules(
    entry_mode       = "open_every_bar",
    take_profit_pct  = 0.015,
    stop_loss_pct    = 0.008,
    max_hold_bars    = 5,
    position_size    = 1.0,
    account_size     = 50_000.0,
    risk_per_trade   = 0.01,
    use_risk_sizing  = False,
    daily_loss_limit = 0.02,
    max_trailing_dd  = 0.08,
    min_trading_days = 5,
    challenge_target = 0.08,
)

# Phase controls — set False utk skip phase
RUN_PHASE3 = True
RUN_PHASE4 = True
RUN_PHASE5 = True
RUN_PHASE6 = True

# Prop firm challenge fee (untuk Phase 5 ROI calculation)
CHALLENGE_FEE = 500.0


# ══════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── Step 1: Build dataset ──────────────────────────────
    print(f"\n{'━'*60}")
    print(f"  DATA LAYER — {TICKER}")
    print(f"{'━'*60}")

    dataset = build_dataset(
        ticker         = TICKER,
        period         = PERIOD,
        interval       = INTERVAL,
        outlier_thresh = 5.0,
    )

    # ── Step 2: Run Phase 2 ────────────────────────────────
    p2_runner = Phase2Runner(dataset, n_states=N_STATES)
    p2_results = p2_runner.run()

    # Inject log_returns for Phase 3 bootstrap
    p2_results["log_returns"] = dataset["log_returns"]
    p2_results["raw_df"]      = dataset["raw_df"]

    # ── Step 3: Run Phase 3 ────────────────────────────────
    p3_results = None
    if RUN_PHASE3:
        p3_runner = Phase3Runner(p2_results, SIM_CONFIG, TRADING_RULES)
        p3_results = p3_runner.run()

    # ── Step 4: Run Phase 4 ────────────────────────────────
    p4_results = None
    if RUN_PHASE4 and p3_results:
        p4_runner = Phase4Runner(p3_results, p2_results,
                                 account_size=TRADING_RULES.account_size,
                                 target_profit=TRADING_RULES.challenge_target)
        p4_results = p4_runner.run()

    # ── Step 5: Run Phase 5 ────────────────────────────────
    p5_results = None
    if RUN_PHASE5 and p3_results and p4_results:
        p5_runner = Phase5Runner(
            phase3_results = p3_results,
            phase4_results = p4_results,
            phase2_results = p2_results,
            account_size   = TRADING_RULES.account_size,
            challenge_fee  = CHALLENGE_FEE,
        )
        p5_results = p5_runner.run()

    # ── Step 6: Run Phase 6 ────────────────────────────────
    p6_output = None
    if RUN_PHASE6 and p4_results:
        p6_runner = Phase6Runner(
            phase2_results = p2_results,
            phase3_results = p3_results or {},
            phase4_results = p4_results,
            phase5_results = p5_results,
            trading_rules  = TRADING_RULES,
            account_size   = TRADING_RULES.account_size,
        )
        p6_output = p6_runner.run()

    # ── Step 7: Save outputs ───────────────────────────────
    if SAVE_CSV:
        _save_all_outputs(p2_results, p3_results, p4_results, p5_results, p6_output)

    # ── Step 8: Print regime alert ────────────────────────
    _print_regime_alert(p2_results)

    return {
        "phase2": p2_results,
        "phase3": p3_results,
        "phase4": p4_results,
        "phase5": p5_results,
        "phase6": p6_output,
    }


def _save_all_outputs(p2, p3, p4, p5, p6):
    """Save key outputs ke CSV/JSON untuk semua phases."""
    ticker = p2["ticker"].replace("=", "_").replace("^", "")

    # ── Phase 2 outputs ──
    labeled_path = os.path.join(OUTPUT_DIR, f"{ticker}_labeled.csv")
    p2["labeled_df"].to_csv(labeled_path)
    print(f"\n[Output] Labeled DataFrame → {labeled_path}")

    stats_path = os.path.join(OUTPUT_DIR, f"{ticker}_regime_stats.csv")
    p2["regime_summary_table"].to_csv(stats_path)
    print(f"[Output] Regime stats → {stats_path}")

    trans_path = os.path.join(OUTPUT_DIR, f"{ticker}_transition_matrix.csv")
    p2["empirical_transmat"].to_csv(trans_path)
    print(f"[Output] Transition matrix → {trans_path}")

    hmm_trans_path = os.path.join(OUTPUT_DIR, f"{ticker}_hmm_transmat.csv")
    p2["hmm_transmat"].to_csv(hmm_trans_path)
    print(f"[Output] HMM transmat → {hmm_trans_path}")

    dist_path = os.path.join(OUTPUT_DIR, f"{ticker}_distribution_summary.csv")
    p2["dist_summary_table"].to_csv(dist_path)
    print(f"[Output] Distribution summary → {dist_path}")

    if p2.get("cond_vol") is not None:
        vol_path = os.path.join(OUTPUT_DIR, f"{ticker}_cond_vol.csv")
        p2["cond_vol"].to_csv(vol_path, header=True)
        print(f"[Output] Conditional volatility → {vol_path}")

    # Regime stats JSON
    stats_json_path = os.path.join(OUTPUT_DIR, f"{ticker}_regime_stats_full.json")
    serializable = {}
    for state, s in p2["regime_stats"].items():
        serializable[str(state)] = {
            k: (float(v) if isinstance(v, (np.floating, np.integer)) else v)
            for k, v in s.items()
        }
    with open(stats_json_path, "w") as f:
        json.dump(serializable, f, indent=2)
    print(f"[Output] Full regime stats JSON → {stats_json_path}")

    # ── Phase 4 outputs ──
    if p4:
        from phase4_metrics import Phase4Runner as P4R
        # Use Phase4Runner's save method pattern
        for name, res in p4.items():
            prefix = f"{ticker}_{name}"
            if res.return_table is not None:
                path = os.path.join(OUTPUT_DIR, f"{prefix}_return_percentiles.csv")
                res.return_table.to_csv(path)
            if res.risk_table is not None:
                path = os.path.join(OUTPUT_DIR, f"{prefix}_risk_metrics.csv")
                res.risk_table.to_csv(path)
            if res.prop_firm_table is not None:
                path = os.path.join(OUTPUT_DIR, f"{prefix}_prop_firm.csv")
                res.prop_firm_table.to_csv(path)
        print(f"[Output] Phase 4 tables saved")

    # ── Phase 5 outputs ──
    if p5:
        if p5.historical_table is not None:
            path = os.path.join(OUTPUT_DIR, f"{ticker}_stress_historical.csv")
            p5.historical_table.to_csv(path)
            print(f"[Output] Historical stress → {path}")

        if p5.hypothetical_table is not None:
            path = os.path.join(OUTPUT_DIR, f"{ticker}_stress_hypothetical.csv")
            p5.hypothetical_table.to_csv(path)
            print(f"[Output] Hypothetical stress → {path}")

        if p5.challenge_table is not None:
            path = os.path.join(OUTPUT_DIR, f"{ticker}_challenge_sim.csv")
            p5.challenge_table.to_csv(path)
            print(f"[Output] Challenge sim → {path}")

    # ── Phase 6 outputs ──
    if p6 and p6.get("dashboard_json"):
        path = os.path.join(OUTPUT_DIR, f"{ticker}_dashboard.json")
        with open(path, "w") as f:
            json.dump(p6["dashboard_json"], f, indent=2, default=str)
        print(f"[Output] Dashboard JSON → {path}")


def _print_regime_alert(results: dict):
    """Phase 6 preview: current regime alert berdasarkan last bar."""
    current_probs = results["current_regime_probs"]
    dominant      = max(current_probs, key=current_probs.get)
    prob          = current_probs[dominant]

    hmm    = results["hmm_detector"]
    labels = hmm.REGIME_LABELS.get(hmm.n_states, [])
    state  = labels.index(dominant) if dominant in labels else None

    print(f"\n{'━'*60}")
    print(f"  ⚡ REGIME ALERT — {results['ticker']}")
    print(f"{'━'*60}")
    print(f"  Current regime  : {dominant}")
    print(f"  Confidence      : {prob:.1%}")

    if state is not None and state in results["regime_stats"]:
        s = results["regime_stats"][state]
        print(f"  Ann Return (hist): {s['mean_return_annualized']:.2%}")
        print(f"  Ann Vol (hist)  : {s['vol_annualized']:.2%}")
        print(f"  Sharpe (approx) : {s['sharpe_approx']:.2f}")

        vol = s["vol_annualized"]
        if vol > 0.30:
            recommendation = "⚠️  HIGH VOL REGIME — Pertimbangkan reduce size 40-60%"
        elif vol > 0.20:
            recommendation = "🟡 MODERATE VOL — Normal sizing dengan SL lebih lebar"
        else:
            recommendation = "🟢 LOW VOL REGIME — Normal atau slightly larger sizing"

        print(f"\n  Recommendation: {recommendation}")

    print(f"{'━'*60}\n")


# ══════════════════════════════════════════════
# QUICK MULTI-TICKER SCAN
# ══════════════════════════════════════════════

def scan_tickers(tickers: list[str], period: str = "3y", n_states: int = 3) -> pd.DataFrame:
    """
    Quick scan beberapa ticker sekaligus — compare regimes antar instrument.

    Usage:
        results = scan_tickers(["NQ=F", "SPY", "QQQ", "^VIX"])
    """
    rows = []
    for ticker in tickers:
        try:
            dataset = build_dataset(ticker, period=period, interval="1d")
            runner  = Phase2Runner(dataset, n_states=n_states)
            res     = runner.run()

            probs   = res["current_regime_probs"]
            dominant = max(probs, key=probs.get)

            row = {"ticker": ticker, "current_regime": dominant,
                   "confidence": probs[dominant]}
            for label, p in probs.items():
                row[f"prob_{label.replace(' ', '_')}"] = p

            rows.append(row)
        except Exception as e:
            rows.append({"ticker": ticker, "error": str(e)})

    df = pd.DataFrame(rows).set_index("ticker")
    print("\n[Multi-Ticker Scan Results]")
    print(df.to_string())
    return df


if __name__ == "__main__":
    results = main()

    # Uncomment untuk multi-ticker scan:
    # scan_tickers(["NQ=F", "SPY", "QQQ", "^VIX", "BTC-USD"])

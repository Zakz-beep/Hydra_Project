"""
risk_api.py — Risk Management Pipeline API
============================================
FastAPI yang connect semua Phase 2-6 dari Risk Management pipeline.

Endpoints:
  GET  /                                  → health check
  POST /api/risk/run                      → run full pipeline (Phase 2-6)
  GET  /api/risk/status                   → pipeline status / last run
  GET  /api/risk/dashboard                → latest dashboard JSON
  GET  /api/risk/decision                 → latest trading decision
  GET  /api/risk/regime                   → current regime + probabilities
  GET  /api/risk/metrics/{model}          → risk metrics for specific model
  GET  /api/risk/metrics/compare          → cross-model comparison
  GET  /api/risk/stress                   → stress test results
  GET  /api/risk/stress/historical        → historical stress detail
  GET  /api/risk/stress/hypothetical      → hypothetical stress detail
  GET  /api/risk/sensitivity              → sensitivity analysis results
  GET  /api/risk/sensitivity/{param}      → specific param sweep
  GET  /api/risk/challenge                → prop firm challenge sim results
  GET  /api/risk/sizing                   → position sizing recommendation
  POST /api/risk/refresh                  → refresh live data (feedback loop)
  GET  /api/risk/config                   → current config
  POST /api/risk/config                   → update config

Cara run:
  uvicorn risk_api:app --host 0.0.0.0 --port 8002 --reload

Dependencies:
  pip install fastapi uvicorn yfinance pandas numpy scipy arch hmmlearn
"""

import os
import sys
import time
import json
import traceback
from datetime import datetime
from typing import Optional
from threading import Thread

from fastapi import FastAPI, Query, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Add riskManagement to path
RISK_DIR = os.path.join(os.path.dirname(__file__), "riskManagement")
if RISK_DIR not in sys.path:
    sys.path.insert(0, RISK_DIR)

from riskManagement.data_layer        import build_dataset
from riskManagement.phase2_model      import Phase2Runner
from riskManagement.phase3_simulation import Phase3Runner, SimulationConfig, TradingRules
from riskManagement.phase4_metrics    import Phase4Runner
from riskManagement.phase5_stress     import Phase5Runner, HISTORICAL_SCENARIOS
from riskManagement.phase6_dashboard  import (
    Phase6Runner, DecisionEngine, PositionSizer,
    LiveRegimeMonitor, DashboardRenderer,
)

from riskManagement.risk_db import RiskDatabase
from riskManagement.module_1_gate import Phase1Gate
from riskManagement.module_2_portfolio import PortfolioManager
from riskManagement.module_3_behavior import BehavioralProfiler

import numpy as np
import pandas as pd
import asyncio

# Instantiate Core Objects
risk_db = RiskDatabase()
phase1_gate = Phase1Gate()
portfolio_manager = PortfolioManager(risk_db)
behavioral_profiler = BehavioralProfiler(risk_db)


# ═══════════════════════════════════════════════
# APP INIT
# ═══════════════════════════════════════════════

app = FastAPI(
    title="Risk Management Pipeline API",
    description=(
        "Full Quant Risk Engine — Phase 2 (Regime Detection) → Phase 6 (Decision Dashboard). "
        "Monte Carlo simulation, VaR/CVaR, stress testing, prop firm challenge sim, "
        "and real-time regime monitoring."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    async def schedule_loop():
        await asyncio.sleep(10)
        while True:
            now = datetime.now()
            # 07:00 Daily Trigger
            if now.hour == 7 and now.minute == 0:
                print("[Scheduler] 07:00 Auto Trigger: Running Daily Pipeline")
                loop = asyncio.get_event_loop()
                loop.run_in_executor(None, _run_pipeline_sync)
                await asyncio.sleep(60)
                
            # 2-Hourly Intraday Trigger (9 AM to 4 PM)
            if now.minute == 0 and now.hour % 2 == 0 and 9 <= now.hour <= 16:
                print(f"[{now.strftime('%H:%M')}] Intraday Volatility Check running...")
                if state.monitor:
                    spike = state.monitor.check_vol_spike()
                    if spike and spike.get('is_spike'):
                        print(f"!!! REGIME ALERT: {spike['message']}")
                await asyncio.sleep(60)
                
            await asyncio.sleep(30)
            
    asyncio.create_task(schedule_loop())


# ═══════════════════════════════════════════════
# GLOBAL STATE
# ═══════════════════════════════════════════════

class PipelineState:
    """Global state untuk pipeline results."""
    def __init__(self):
        self.is_running:  bool = False
        self.last_run:    str | None = None
        self.error:       str | None = None
        self.ticker:      str  = "NQ=F"

        # Config
        self.period:      str  = "5y"
        self.interval:    str  = "1d"
        self.n_states:    int  = 3
        self.n_sims:      int  = 5000
        self.n_steps:     int  = 63
        self.account_size: float = 50_000.0
        self.challenge_fee: float = 500.0

        # Trading rules
        self.entry_mode:       str   = "open_every_bar"
        self.take_profit_pct:  float = 0.015
        self.stop_loss_pct:    float = 0.008
        self.max_hold_bars:    int   = 5
        self.position_size:    float = 1.0
        self.risk_per_trade:   float = 0.01
        self.daily_loss_limit: float = 0.02
        self.max_trailing_dd:  float = 0.08
        self.challenge_target: float = 0.08

        # Results
        self.p2_results: dict | None = None
        self.p3_results: dict | None = None
        self.p4_results: dict | None = None
        self.p5_results = None
        self.p6_output:  dict | None = None
        self.dashboard_json: dict | None = None

        # Phase 6 components
        self.monitor: LiveRegimeMonitor | None = None

    def get_trading_rules(self) -> TradingRules:
        return TradingRules(
            entry_mode       = self.entry_mode,
            take_profit_pct  = self.take_profit_pct,
            stop_loss_pct    = self.stop_loss_pct,
            max_hold_bars    = self.max_hold_bars,
            position_size    = self.position_size,
            account_size     = self.account_size,
            risk_per_trade   = self.risk_per_trade,
            daily_loss_limit = self.daily_loss_limit,
            max_trailing_dd  = self.max_trailing_dd,
            challenge_target = self.challenge_target,
        )

    def get_sim_config(self) -> SimulationConfig:
        return SimulationConfig(
            n_simulations = self.n_sims,
            n_steps       = self.n_steps,
            dt            = 1/252,
            random_seed   = 42,
        )


state = PipelineState()


# ═══════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════

def _serialize(obj):
    """Convert numpy/pandas types untuk JSON."""
    if isinstance(obj, (np.floating, np.integer)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, pd.DataFrame):
        return obj.to_dict(orient="records")
    if isinstance(obj, pd.Series):
        return obj.to_dict()
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _serialize(v) for k, v in obj.__dict__.items()
                if not k.startswith("_") and not callable(v)}
    if isinstance(obj, dict):
        return {str(k): _serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_serialize(v) for v in obj]
    return obj


def _run_pipeline_sync():
    """Run full pipeline synchronously. Called in background thread."""
    global state
    state.is_running = True
    state.error      = None

    try:
        ticker = state.ticker
        print(f"\n[RiskAPI] Starting full pipeline for {ticker}...")

        # ── Phase 1: Data ──
        dataset = build_dataset(
            ticker   = ticker,
            period   = state.period,
            interval = state.interval,
        )

        # ── Phase 2: Regime Detection ──
        p2_runner = Phase2Runner(dataset, n_states=state.n_states)
        p2 = p2_runner.run()
        p2["log_returns"] = dataset["log_returns"]
        p2["raw_df"]      = dataset["raw_df"]
        state.p2_results  = p2

        # ── Phase 3: Simulation ──
        rules = state.get_trading_rules()
        cfg   = state.get_sim_config()
        p3_runner = Phase3Runner(p2, cfg, rules)
        p3 = p3_runner.run()
        state.p3_results = p3

        # ── Phase 4: Metrics ──
        p4_runner = Phase4Runner(p3, p2,
                                 account_size=state.account_size,
                                 target_profit=state.challenge_target)
        p4 = p4_runner.run()
        state.p4_results = p4

        # ── Phase 5: Stress Testing ──
        p5_runner = Phase5Runner(p3, p4, p2,
                                 account_size=state.account_size,
                                 challenge_fee=state.challenge_fee)
        p5 = p5_runner.run()
        state.p5_results = p5

        # ── Phase 6: Dashboard ──
        p6_runner = Phase6Runner(p2, p3, p4, p5,
                                  trading_rules=rules,
                                  account_size=state.account_size)
        p6 = p6_runner.run()
        state.p6_output = p6
        state.monitor   = p6.get("monitor")

        # Build dashboard JSON
        renderer = DashboardRenderer(p2, p4, p5,
                                      decision=p6.get("decision"),
                                      preferred_model="RegimeGBM")
        state.dashboard_json = renderer.to_json()

        state.last_run = datetime.now().isoformat(timespec="seconds")
        print(f"[RiskAPI] Pipeline complete for {ticker}.")

    except Exception as e:
        state.error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        print(f"[RiskAPI] Pipeline error: {e}")

    finally:
        state.is_running = False


# ═══════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════

class RunRequest(BaseModel):
    ticker:         str   = "NQ=F"
    period:         str   = "5y"
    interval:       str   = "1d"
    n_states:       int   = 3
    n_simulations:  int   = 5000
    n_steps:        int   = 63
    account_size:   float = 50_000.0
    challenge_fee:  float = 500.0

class ConfigUpdate(BaseModel):
    ticker:         Optional[str]   = None
    period:         Optional[str]   = None
    interval:       Optional[str]   = None
    n_states:       Optional[int]   = None
    n_simulations:  Optional[int]   = None
    n_steps:        Optional[int]   = None
    account_size:   Optional[float] = None
    challenge_fee:  Optional[float] = None
    # Trading rules
    entry_mode:       Optional[str]   = None
    take_profit_pct:  Optional[float] = None
    stop_loss_pct:    Optional[float] = None
    max_hold_bars:    Optional[int]   = None
    position_size:    Optional[float] = None
    risk_per_trade:   Optional[float] = None
    daily_loss_limit: Optional[float] = None
    max_trailing_dd:  Optional[float] = None
    challenge_target: Optional[float] = None

class PreTradeRequest(BaseModel):
    ticker: str
    direction: str
    lot_size: float
    entry_price: float

class PostTradeRequest(BaseModel):
    ticker: str
    direction: str
    pnl: float
    entry_time: str
    exit_time: str
    hit_sl: bool


# ═══════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status":   "ok",
        "service":  "Risk Management Pipeline API",
        "version":  "1.0.0",
        "docs":     "/docs",
        "pipeline": {
            "is_running": state.is_running,
            "last_run":   state.last_run,
            "ticker":     state.ticker,
            "error":      state.error[:200] if state.error else None,
        },
        "endpoints": [
            "POST /api/risk/run",
            "GET  /api/risk/status",
            "GET  /api/risk/dashboard",
            "GET  /api/risk/decision",
            "GET  /api/risk/regime",
            "GET  /api/risk/metrics/{model}",
            "GET  /api/risk/metrics/compare",
            "GET  /api/risk/stress",
            "GET  /api/risk/stress/historical",
            "GET  /api/risk/stress/hypothetical",
            "GET  /api/risk/sensitivity",
            "GET  /api/risk/sensitivity/{param}",
            "GET  /api/risk/challenge",
            "GET  /api/risk/sizing",
            "POST /api/risk/refresh",
            "GET  /api/risk/config",
            "POST /api/risk/config",
            "POST /api/risk/pre_trade",
            "POST /api/risk/post_trade",
        ],
    }


# ── RUN PIPELINE ─────────────────────────────────────

@app.post("/api/risk/run")
def run_pipeline(req: RunRequest, bg: BackgroundTasks):
    """
    Run full pipeline (Phase 2→6) in background.
    Poll /api/risk/status untuk track progress.
    """
    if state.is_running:
        raise HTTPException(400, "Pipeline is already running. Wait for completion.")

    # Update config
    state.ticker       = req.ticker
    state.period       = req.period
    state.interval     = req.interval
    state.n_states     = req.n_states
    state.n_sims       = req.n_simulations
    state.n_steps      = req.n_steps
    state.account_size = req.account_size
    state.challenge_fee = req.challenge_fee

    # Run in background
    bg.add_task(_run_pipeline_sync)

    return {
        "status":  "started",
        "ticker":  req.ticker,
        "message": "Pipeline started in background. Poll /api/risk/status for progress.",
        "config":  req.dict(),
    }


@app.get("/api/risk/status")
def pipeline_status():
    """Current pipeline status and last run info."""
    available_models = list(state.p4_results.keys()) if state.p4_results else []
    return {
        "is_running":       state.is_running,
        "last_run":         state.last_run,
        "ticker":           state.ticker,
        "error":            state.error,
        "phases_complete": {
            "phase2": state.p2_results is not None,
            "phase3": state.p3_results is not None,
            "phase4": state.p4_results is not None,
            "phase5": state.p5_results is not None,
            "phase6": state.p6_output  is not None,
        },
        "available_models": available_models,
    }


# ── DASHBOARD ────────────────────────────────────────

@app.get("/api/risk/dashboard")
def get_dashboard():
    """
    Full dashboard JSON — semua data yang dibutuhin web UI.
    Termasuk: regime, risk metrics, stress, decision, chart data.
    """
    if state.dashboard_json is None:
        raise HTTPException(404, "No results. Run pipeline first via POST /api/risk/run")
    return state.dashboard_json


# ── DECISION ─────────────────────────────────────────

@app.get("/api/risk/decision")
def get_decision():
    """Latest trading decision dari Phase 6 Decision Engine."""
    if state.p6_output is None or state.p6_output.get("decision") is None:
        raise HTTPException(404, "No decision available. Run pipeline first.")

    d = state.p6_output["decision"]
    return _serialize(d)


# ── REGIME ───────────────────────────────────────────

@app.get("/api/risk/regime")
def get_regime():
    """Current regime probabilities dari Phase 2 HMM."""
    if state.p2_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    probs   = state.p2_results.get("current_regime_probs", {})
    dominant = max(probs, key=probs.get) if probs else "Unknown"

    regime_stats = state.p2_results.get("regime_stats", {})
    stats_out = {}
    for s_key, s_val in regime_stats.items():
        stats_out[str(s_key)] = _serialize(s_val)

    trans = state.p2_results.get("empirical_transmat")

    return {
        "ticker":             state.ticker,
        "current_regime":     dominant,
        "confidence":         probs.get(dominant, 0),
        "regime_probs":       probs,
        "regime_stats":       stats_out,
        "transition_matrix":  trans.to_dict() if trans is not None else None,
        "n_states":           state.n_states,
    }


# ── METRICS ──────────────────────────────────────────

@app.get("/api/risk/metrics/compare")
def compare_models():
    """Cross-model risk metrics comparison."""
    if state.p4_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    comparison = {}
    for name, p4 in state.p4_results.items():
        comparison[name] = {
            "return_metrics":    _serialize(p4.return_metrics),
            "risk_metrics":      _serialize(p4.risk_metrics),
            "prop_firm_metrics": _serialize(p4.prop_firm_metrics),
        }
    return {"ticker": state.ticker, "models": comparison}


@app.get("/api/risk/metrics/{model}")
def get_model_metrics(model: str):
    """Get risk metrics untuk specific model (GBM, RegimeGBM, JumpDiffusion, Bootstrap)."""
    if state.p4_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")
    if model not in state.p4_results:
        raise HTTPException(404, f"Model '{model}' not found. Available: {list(state.p4_results.keys())}")

    p4 = state.p4_results[model]
    return {
        "ticker":            state.ticker,
        "model":             model,
        "return_metrics":    _serialize(p4.return_metrics),
        "risk_metrics":      _serialize(p4.risk_metrics),
        "conditional_metrics": _serialize(p4.conditional_metrics),
        "prop_firm_metrics": _serialize(p4.prop_firm_metrics),
        "return_table":      p4.return_table.to_dict(orient="records") if p4.return_table is not None else None,
        "risk_table":        p4.risk_table.to_dict(orient="records") if p4.risk_table is not None else None,
    }


# ── STRESS TESTING ───────────────────────────────────

@app.get("/api/risk/stress")
def get_stress_overview():
    """Stress test overview — both historical and hypothetical."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    p5 = state.p5_results
    return {
        "ticker": state.ticker,
        "historical_table":   p5.historical_table.to_dict(orient="records") if p5.historical_table is not None else None,
        "hypothetical_table": p5.hypothetical_table.to_dict(orient="records") if p5.hypothetical_table is not None else None,
    }


@app.get("/api/risk/stress/historical")
def get_historical_stress():
    """Detailed historical stress test results."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    results = {}
    for key, res in state.p5_results.historical_results.items():
        results[key] = _serialize(res)
        # Remove large arrays
        if "impact_distribution" in results[key]:
            dist = results[key]["impact_distribution"]
            results[key]["impact_distribution"] = {
                "mean":   float(np.mean(dist)),
                "median": float(np.median(dist)),
                "P10":    float(np.percentile(dist, 10)),
                "P90":    float(np.percentile(dist, 90)),
            }

    return {
        "ticker":     state.ticker,
        "n_scenarios": len(results),
        "scenarios":   results,
        "available":   list(HISTORICAL_SCENARIOS.keys()),
    }


@app.get("/api/risk/stress/hypothetical")
def get_hypothetical_stress():
    """Hypothetical stress test results."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    results = {}
    for key, res in state.p5_results.hypothetical_results.items():
        r = _serialize(res)
        if "impact_distribution" in r:
            dist = r["impact_distribution"]
            r["impact_distribution"] = {
                "mean":   float(np.mean(dist)),
                "P10":    float(np.percentile(dist, 10)),
                "P90":    float(np.percentile(dist, 90)),
            }
        results[key] = r

    return {"ticker": state.ticker, "scenarios": results}


# ── SENSITIVITY ──────────────────────────────────────

@app.get("/api/risk/sensitivity")
def get_sensitivity_overview():
    """Sensitivity analysis results — semua parameter sweeps."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    tables = {}
    for name, df in state.p5_results.sensitivity_tables.items():
        tables[name] = df.reset_index().to_dict(orient="records")

    return {
        "ticker":     state.ticker,
        "parameters": list(tables.keys()),
        "sweeps":     tables,
    }


@app.get("/api/risk/sensitivity/{param}")
def get_sensitivity_param(param: str):
    """Get specific parameter sweep results."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")
    if param not in state.p5_results.sensitivity_tables:
        raise HTTPException(404, f"Parameter '{param}' not found. Available: {list(state.p5_results.sensitivity_tables.keys())}")

    df = state.p5_results.sensitivity_tables[param]
    return {
        "ticker":    state.ticker,
        "parameter": param,
        "data":      df.reset_index().to_dict(orient="records"),
    }


# ── CHALLENGE SIM ────────────────────────────────────

@app.get("/api/risk/challenge")
def get_challenge_sim():
    """Prop firm challenge multi-attempt Monte Carlo results."""
    if state.p5_results is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    cs = state.p5_results.challenge_sim
    return {
        "ticker":          state.ticker,
        "challenge_sim":   _serialize(cs),
        "challenge_table": (state.p5_results.challenge_table.reset_index().to_dict(orient="records")
                           if state.p5_results.challenge_table is not None else None),
    }


# ── POSITION SIZING ─────────────────────────────────

@app.get("/api/risk/sizing")
def get_sizing():
    """Current position sizing recommendation."""
    if state.p6_output is None:
        raise HTTPException(404, "No results. Run pipeline first.")

    sizing = state.p6_output.get("sizing")
    decision = state.p6_output.get("decision")

    return {
        "ticker":     state.ticker,
        "sizing":     _serialize(sizing) if sizing else None,
        "decision":   _serialize(decision) if decision else None,
    }


# ── LIVE REFRESH (Feedback Loop) ────────────────────

@app.post("/api/risk/refresh")
def refresh_live():
    """
    Feedback loop: refresh live data tanpa re-run full pipeline.
    Update: current price, regime check, vol spike check.
    """
    if state.monitor is None:
        raise HTTPException(404, "No monitor initialized. Run full pipeline first.")

    status    = state.monitor.get_status()
    vol_check = state.monitor.check_vol_spike()

    return {
        "ticker":     state.ticker,
        "refreshed":  datetime.now().isoformat(timespec="seconds"),
        "status":     _serialize(status),
        "vol_check":  _serialize(vol_check) if vol_check else None,
    }


# ── USER TRIGGERED WORKFLOW (PRE & POST TRADE) ──────

@app.post("/api/risk/pre_trade")
def pre_trade_check(req: PreTradeRequest):
    """
    Module 1D Gate + Module 2C Simulation.
    Checks news and calculates recommended position based on constraints.
    """
    if state.p2_results is None:
        raise HTTPException(400, "Pipeline not run yet. Start the 07:00 baseline first (/api/risk/run).")
    
    # 1. Gate: Check high impact news in 30 mins
    has_news, events = phase1_gate.check_upcoming_news(impact_levels=["High", "Medium"], window_minutes=30)
    
    probs = state.p2_results.get("current_regime_probs", {})
    dominant = max(probs, key=probs.get) if probs else "Unknown"
    
    # Fallback default vol
    vol = 0.20 
    for state_key, s_val in state.p2_results.get("regime_stats", {}).items():
        if isinstance(s_val, dict) and "vol_annualized" in s_val:
            vol = s_val["vol_annualized"]
    
    # 3. Simulate Trade Risk & Correlation
    simulation_results = portfolio_manager.simulate_pre_trade(
        ticker=req.ticker,
        direction=req.direction,
        lot_size_user=req.lot_size,
        entry_price=req.entry_price,
        current_regime_vol=vol,
        regime_state=dominant
    )
    
    return {
        "gate_status": "WARNING" if has_news else "CLEAR",
        "gate_details": "High-impact news is releasing shortly!" if has_news else "No impending news alerts.",
        "news_warnings": events,
        "regime_context": dominant,
        "simulation": simulation_results
    }


@app.post("/api/risk/post_trade")
def post_trade_evaluation(req: PostTradeRequest):
    """
    Module 2A update + Module 3B Behaviors logic.
    Scores behavioral flags like Revenge Trading and Overtrading.
    """
    # Profiler eval
    eval_result = behavioral_profiler.evaluate_post_trade(
        ticker=req.ticker,
        direction=req.direction,
        pnl=req.pnl,
        entry_time_str=req.entry_time,
        exit_time_str=req.exit_time,
        hit_sl=req.hit_sl
    )
    
    # Context updates
    risk_db.remove_active_holding(req.ticker)
    
    # Format times safely
    try:
        et = datetime.fromisoformat(req.entry_time) if "T" in req.entry_time else datetime.strptime(req.entry_time, "%Y-%m-%d %H:%M:%S")
        xt = datetime.fromisoformat(req.exit_time)  if "T" in req.exit_time else datetime.strptime(req.exit_time, "%Y-%m-%d %H:%M:%S")
    except Exception:
        et = datetime.now()
        xt = datetime.now()
        
    risk_db.log_trade(
        ticker=req.ticker,
        direction=req.direction,
        lot_size=0, # assumed N/A mostly for simplistic tracking right now
        entry_price=0,
        exit_price=0,
        pnl=req.pnl,
        entry_time=et,
        exit_time=xt,
        hit_sl=req.hit_sl
    )
    
    return eval_result


# ── DAILY BRIEF (Module 1) ───────────────────────────

@app.get("/api/risk/daily_brief")
def get_daily_brief():
    """Module 1: Daily news brief — high impact events for today."""
    brief = phase1_gate.generate_daily_brief()
    return brief


# ── ACCOUNT STATE ────────────────────────────────────

@app.get("/api/risk/account")
def get_account():
    """Current account state (balance, equity, limits)."""
    state_data = risk_db.get_account_state()
    return _serialize(state_data)


# ── BEHAVIORAL PROFILE ──────────────────────────────

@app.get("/api/risk/behavioral")
def get_behavioral():
    """Module 3: Current behavioral score and pattern counters."""
    profile = risk_db.get_behavioral_profile()
    return _serialize(profile)


# ── CONFIG ───────────────────────────────────────────

@app.get("/api/risk/config")
def get_config():
    """Current pipeline configuration."""
    return {
        "ticker":         state.ticker,
        "period":         state.period,
        "interval":       state.interval,
        "n_states":       state.n_states,
        "n_simulations":  state.n_sims,
        "n_steps":        state.n_steps,
        "account_size":   state.account_size,
        "challenge_fee":  state.challenge_fee,
        "trading_rules": {
            "entry_mode":       state.entry_mode,
            "take_profit_pct":  state.take_profit_pct,
            "stop_loss_pct":    state.stop_loss_pct,
            "max_hold_bars":    state.max_hold_bars,
            "position_size":    state.position_size,
            "risk_per_trade":   state.risk_per_trade,
            "daily_loss_limit": state.daily_loss_limit,
            "max_trailing_dd":  state.max_trailing_dd,
            "challenge_target": state.challenge_target,
        },
    }


@app.post("/api/risk/config")
def update_config(update: ConfigUpdate):
    """Update pipeline configuration. Changes take effect on next run."""
    updates = {}
    for field, val in update.dict(exclude_none=True).items():
        if hasattr(state, field):
            setattr(state, field, val)
            updates[field] = val

    return {
        "status":  "updated",
        "changes": updates,
        "message": "Changes will take effect on next pipeline run.",
    }


# ═══════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("risk_api:app", host="0.0.0.0", port=8002, reload=True)

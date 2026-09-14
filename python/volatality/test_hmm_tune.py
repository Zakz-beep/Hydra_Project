import sys
import os
import asyncio
# Add parent dir to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api import hmm_tune_endpoint, TuningHMMRequest

async def run_test():
    req = TuningHMMRequest(
        ticker="SPY",
        features=["returns", "volatility_5", "range"],
        n_components=3,
        covariance_type="diag",
        period="1y",
        interval="1d"
    )
    print("Calling hmm_tune_endpoint directly...")
    res = await hmm_tune_endpoint(req)
    print("Success!")
    print("Ticker:", res.get("ticker"))
    print("AIC:", res.get("aic"), "BIC:", res.get("bic"))
    print("Log-Likelihood:", res.get("log_likelihood"))
    print("Current regime:", res.get("current_regime"))
    print("Transition Matrix:")
    for row in res.get("transition_matrix", []):
        print(f"  {row['from']} -> {row['to']}")
    print("State Summaries:")
    for summary in res.get("state_summary", []):
        print(f"  State {summary['regime_id']}: {summary['pct_history']}% history, Sharpe: {summary['sharpe_annualized']}, Feature averages: {summary['feature_averages']}")

if __name__ == "__main__":
    asyncio.run(run_test())

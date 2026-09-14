from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Literal
import re
import threading
import uvicorn
import json

from copula_model import run_copula_model_api
from hmm_model import run_hmm_model
from db import save_dcc_run, get_recent_runs, get_run_timeseries

app = FastAPI(title="DCC-GARCH Correlation API", version="2.0")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RunDCCRequest(BaseModel):
    tickers: list[str] = Field(min_length=2, max_length=12)
    mode: Literal['1', '2', '3', '4'] = '4'
    window: int = Field(default=20, ge=10, le=120)
    threshold: float = Field(default=.65, ge=-1, le=1)
    defensive: float = Field(default=.1, ge=0, le=1)
    cost_bps: float = Field(default=5, ge=0, le=100)

    @field_validator('tickers')
    @classmethod
    def validate_tickers(cls, values):
        names = [v.strip().upper() for v in values]
        if len(set(names)) != len(names):
            raise ValueError('Remove duplicate tickers.')
        if any(not re.fullmatch(r'[A-Z0-9^][A-Z0-9.^=\-]{0,19}', t) for t in names):
            raise ValueError('Invalid Yahoo Finance ticker.')
        return names

run_lock = threading.Lock()

@app.post("/api/dcc/run")
def run_dcc(req: RunDCCRequest):
    if not run_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail='A correlation fit is running. Wait for it to finish before retrying.')
    try:
        # 1. Run DCC-GARCH + Copula model
        valid_tickers, timeframe, history, summary, copula_details, df_bt = run_copula_model_api(
            req.tickers, req.mode, req.window, req.threshold, req.defensive, req.cost_bps)
        
        # 2. Run HMM Regime Detection on top of DCC output
        #    Use portfolio mean return + DCC avg_corr as features
        hmm_result = None
        try:
            market_ret_series = df_bt['Market_Ret']          # fraction returns
            avg_corr_series   = df_bt['Avg_Corr']            # DCC dynamic correlation
            
            # Align indices (should already match, but be safe)
            common_idx = market_ret_series.index.intersection(avg_corr_series.index)
            hmm_result = run_hmm_model(
                returns_series=market_ret_series.loc[common_idx],
                avg_corr_series=avg_corr_series.loc[common_idx],
                tickers=valid_tickers,
            )
            # Trim state_series to last 500 bars to keep payload manageable
            if hmm_result and "state_series" in hmm_result:
                hmm_result["state_series"] = hmm_result["state_series"][-500:]
        except Exception as hmm_err:
            # HMM failure is non-fatal — degrade gracefully
            hmm_result = {"error": str(hmm_err)}

        # 3. Check market status
        # Price recency is not evidence that an exchange is open.
        market_status = {t: 'unknown' for t in valid_tickers}
        
        # 4. Persist to database
        run_id = save_dcc_run(valid_tickers, timeframe, history, summary, df_bt)
        
        # 5. Format timeseries response — include HMM state per bar
        max_rows = 1000
        df_bt_tail = df_bt.tail(max_rows)
        
        # Build quick lookup: timestamp → HMM state id
        hmm_state_lookup: dict[str, int] = {}
        hmm_name_lookup: dict[str, str] = {}
        if hmm_result and "state_series" in hmm_result:
            for pt in hmm_result["state_series"]:
                hmm_state_lookup[pt["timestamp"]] = pt["state_id"]
                hmm_name_lookup[pt["timestamp"]] = pt["state_name"]

        timeseries_data = []
        for idx, row in df_bt_tail.iterrows():
            ts_str = idx.isoformat() if hasattr(idx, 'isoformat') else str(idx)
            timeseries_data.append({
                "timestamp": ts_str,
                "avg_corr": float(row['Avg_Corr']),
                "tail_dep": float(row.get('Tail_Dep', 0.0)),
                "weight": float(row['Weight']),
                "passive_equity": float(row['Passive_Equity']),
                "adaptive_equity": float(row['Adaptive_Equity']),
                "passive_dd": float(row['Passive_DD']),
                "adaptive_dd": float(row['Adaptive_DD']),
                "asset_corrs": row.get('Asset_Corrs', {}),
                "pair_corrs": row.get('Pair_Corrs', {}),
                "rolling_corrs": row.get('Rolling_Corrs', {}),
                # HMM fields (null if state not available for this bar)
                "hmm_state": hmm_state_lookup.get(ts_str, None),
                "hmm_state_name": hmm_name_lookup.get(ts_str, None),
            })
            
        return {
            "status": "success",
            "run_id": run_id,
            "tickers": valid_tickers,
            "timeframe": timeframe,
            "history": history,
            "summary": summary,
            "market_status": market_status,
            "copula_details": copula_details,
            "hmm": hmm_result,
            "timeseries": timeseries_data,
            "research": df_bt.attrs['research'],
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
    finally:
        run_lock.release()


@app.get("/api/dcc/runs")
async def get_runs(limit: int = 10):
    try:
        runs = get_recent_runs(limit)
        for r in runs:
            r['tickers'] = json.loads(r['tickers'])
        return {"status": "success", "data": runs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dcc/runs/{run_id}/timeseries")
async def get_timeseries(run_id: int):
    try:
        ts = get_run_timeseries(run_id)
        if not ts:
            raise HTTPException(status_code=404, detail="Run ID not found")
        return {"status": "success", "run_id": run_id, "data": ts}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    print("Starting DCC Correlation + HMM API on port 8004...")
    uvicorn.run("api:app", host="0.0.0.0", port=8004, reload=True)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import json

from copula_model import run_copula_model_api
from hmm_model import run_hmm_model
from db import save_dcc_run, get_recent_runs, get_run_timeseries

app = FastAPI(title="DCC-GARCH Correlation API", version="1.1")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RunDCCRequest(BaseModel):
    tickers: list[str]
    mode: str = '4'  # '1': Scalper, '2': Day Trade, '3': Swing, '4': Core

import yfinance as yf
from datetime import datetime, timezone
import pandas as pd

def check_market_status(tickers: list[str]) -> dict:
    status = {}
    try:
        df = yf.download(tickers, period="5d", interval="15m", progress=False)['Close']
        if isinstance(df, pd.Series):
            df = df.to_frame(name=tickers[0])
            
        now_utc = datetime.now(timezone.utc)
        
        for t in tickers:
            if t in df.columns:
                last_valid = df[t].dropna()
                if not last_valid.empty:
                    last_time = last_valid.index[-1]
                    if last_time.tzinfo is None:
                        last_time = last_time.tz_localize('UTC')
                    
                    diff = (now_utc - last_time).total_seconds()
                    # if last trade was within 60 minutes, consider open
                    if diff < 3600:
                        status[t] = "open"
                    else:
                        status[t] = "closed"
                else:
                    status[t] = "closed"
            else:
                status[t] = "closed"
    except Exception:
        for t in tickers:
            status[t] = "unknown"
            
    return status


@app.post("/api/dcc/run")
async def run_dcc(req: RunDCCRequest):
    try:
        # 1. Run DCC-GARCH + Copula model
        valid_tickers, timeframe, history, summary, copula_details, df_bt = run_copula_model_api(req.tickers, req.mode)
        
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
        market_status = check_market_status(valid_tickers)
        
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
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


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

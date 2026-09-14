"""BETA research API, served on 8012 through the existing Next.js rewrite."""
from datetime import datetime, timezone
from typing import Literal
import re
import threading
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from beta_research import analyze_prices

app=FastAPI(title="Beta Research API",version="2.0.0")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])
run_lock=threading.Lock()


def clean_symbol(value):
    value=value.strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,19}",value):
        raise ValueError("Invalid Yahoo ticker: "+value)
    return value


@app.get("/api/beta/analysis")
def beta_analysis(ticker: str=Query("TSLA",max_length=20), benchmark: str=Query("SPY",max_length=20),
                  period: Literal['6mo','1y','2y','5y']='1y', rolling_window: int=Query(60,ge=20,le=252),
                  compare: str=Query('',max_length=100), annualization: int=Query(252)):
    try:
        if annualization not in (252,365):raise ValueError('Annualization must be 252 or 365.')
        ticker,benchmark=clean_symbol(ticker),clean_symbol(benchmark)
        benchmarks=list(dict.fromkeys([benchmark]+[clean_symbol(v) for v in compare.split(',') if v.strip()]))
        if len(benchmarks)>4:raise ValueError('Choose up to four benchmarks including the primary benchmark.')
    except ValueError as exc:
        raise HTTPException(422,detail=str(exc)) from exc
    if not run_lock.acquire(blocking=False):
        raise HTTPException(409,detail='A beta analysis is running. Wait before retrying.')
    try:
        symbols=list(dict.fromkeys([ticker]+benchmarks))
        raw=yf.download(symbols,period=period,interval='1d',auto_adjust=True,progress=False,threads=False,timeout=15)
        captured=datetime.now(timezone.utc).isoformat()
        if raw.empty:raise ValueError('Yahoo returned no prices. Check tickers or retry when the source is available.')
        # Exclude current UTC calendar date to avoid presenting a partial daily bar as completed.
        close=raw['Close']
        close=close.loc[[d.date()<datetime.now(timezone.utc).date() for d in close.index]]
        analyses,metadata=analyze_prices(close,ticker,benchmarks,rolling_window,annualization)
        metadata.update(source='Yahoo Finance adjusted daily close',retrieved_at=captured,
                        current_utc_date_excluded=True,annualization=annualization)
        return dict(version=2,ticker=ticker,benchmark=benchmark,period=period,rolling_window=rolling_window,
                    annualization=annualization,analyses=analyses,metadata=metadata,
                    timestamp=captured,**{k:v for k,v in analyses[0].items() if k!='benchmark'})
    except ValueError as exc:
        raise HTTPException(400,detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502,detail='Beta data or calculation failed: '+str(exc)) from exc
    finally:
        run_lock.release()

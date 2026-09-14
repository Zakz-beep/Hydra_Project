"""Macro calendar, public releases and reproducible economic forecasts (port 8015)."""
import json
import math
from fastapi import FastAPI, HTTPException, Query
from macro_model import SERIES, observations, forecast
from macro_sources import dashboard, document, connect, LOCK, digest, now
from pydantic import BaseModel, Field
from macro_surprise import calculate, read_pairs, import_csv
from macro_reaction import report as reaction_report

app=FastAPI(title='VRP Macro Research',version='1.0')

@app.get('/api/macro/reactions')
def reactions(symbol: str='SPY', event_id: str | None=None, refresh: bool=False, series_filter: str='', surprise: str='all', horizon: int=60, band: float=.1):
    try: return reaction_report(symbol,event_id,refresh,series_filter,surprise,horizon,band)
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc
    except KeyError as exc: raise HTTPException(404,str(exc)) from exc

@app.get('/api/macro/surprises')
def surprises(window: int=36, neutral: float=.5):
    if window not in (12,24,36,60) or neutral not in (.25,.5,1): raise HTTPException(422,'Unsupported surprise settings')
    return calculate(read_pairs(),window,neutral)

class SurpriseImport(BaseModel):
    csv_text: str=Field(max_length=1_000_000)
    save: bool=False

@app.post('/api/macro/surprises/import')
def import_surprises(body: SurpriseImport):
    try: return import_csv(body.csv_text,body.save)
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc

@app.get('/api/macro/dashboard')
def get_dashboard(): return dashboard()

@app.get('/api/macro/catalog')
def catalog():
    return [dict(key=k,series=v[0],label=v[1],unit=v[2],frequency=v[3]) for k,v in SERIES.items()]

@app.get('/api/macro/forecast')
def get_forecast(series: str='core_cpi', window: int=Query(120), strength: float=Query(4), threshold: float | None=None, refresh: bool=False):
    if series not in SERIES or window not in (60,120,240) or strength not in (.5,4,16) or (threshold is not None and not math.isfinite(threshold)):
        raise HTTPException(422,'Unknown series or unsupported model settings')
    ident,label,unit,freq,_=SERIES[series]
    try:
        body,status=document(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={ident}',21600,force=refresh)
        s=observations(body,series)
        result=forecast(s,window,strength,threshold)
        result.update(key=series,series=ident,label=label,unit=unit,frequency=freq,window=window,strength=strength,
                      model_version='bayes-ar-v1',vintage='latest revised',source=status,generated_at=now(),
                      source_url=f'https://fred.stlouisfed.org/series/{ident}',input_hash=digest(body))
        # Preserve each data-vintage/settings forecast. Threshold only changes scenario probability.
        snapshot_id=digest(f'{series}|{window}|{strength}|{digest(body)}|bayes-ar-v1')
        stored={k:v for k,v in result.items() if k not in ('threshold','probability_above')}
        with LOCK,connect() as db:
            db.execute('INSERT OR IGNORE INTO forecasts VALUES(?,?,?)',(snapshot_id,result['generated_at'],json.dumps(stored)))
        return result
    except Exception as exc: raise HTTPException(502,f'Forecast unavailable: {exc}') from exc

@app.get('/api/macro/revisions/{event_id}')
def revisions(event_id: str):
    with LOCK,connect() as db:
        return [dict(observed_at=r['observed_at'],event=json.loads(r['payload'])) for r in db.execute('SELECT * FROM revisions WHERE id=? ORDER BY observed_at DESC LIMIT 100',(event_id,))]

@app.get('/api/macro/forecast-history')
def forecast_history(series: str='core_cpi'):
    if series not in SERIES: raise HTTPException(422,'Unknown series')
    with LOCK,connect() as db:
        rows=[json.loads(r['payload']) for r in db.execute('SELECT payload FROM forecasts ORDER BY created_at DESC LIMIT 500')]
    return [dict(generated_at=r['generated_at'],target_period=r['target_period'],mean=r['prediction']['mean'],
                 lower=r['prediction']['lower'],upper=r['prediction']['upper'],
                 source_fetched_at=r.get('source',{}).get('fetched_at'),source_stale=r.get('source',{}).get('stale',False),
                 input_hash=r['input_hash'],window=r['window'],strength=r['strength']) for r in rows if r['key']==series][:50]

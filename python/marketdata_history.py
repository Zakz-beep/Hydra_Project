"""Separate immutable MarketData archive, bounded imports and local-only research."""
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from functools import lru_cache
from contextlib import contextmanager
from urllib.parse import urlparse
import ipaddress
import json
import sqlite3
import threading
import uuid
import exchange_calendars as xcals
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from marketdata_provider import MarketDataProvider, HistoryError, NY, provider_status, chain_rows, candle_rows
from marketdata_model import reconstruct, backtest, levels, MODEL_VERSION

DB_PATH=Path(__file__).parent/'data'/'marketdata_history.db'
router=APIRouter(prefix='/api/greeks/marketdata',tags=['MarketData history'])
_guard=threading.Lock()
_jobs={}


@lru_cache(maxsize=12)
def calendar_for(year):
    return xcals.get_calendar('XNYS',start=f'{year-1}-01-01',end=f'{year+2}-12-31')


@contextmanager
def database():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn=sqlite3.connect(DB_PATH,timeout=30)
    conn.row_factory=sqlite3.Row
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS chains(ticker TEXT, day TEXT, scope INTEGER, captured TEXT, body TEXT, PRIMARY KEY(ticker,day,scope));
    CREATE TABLE IF NOT EXISTS prices(ticker TEXT, day TEXT, captured TEXT, body TEXT, PRIMARY KEY(ticker,day));
    ''')
    try:
        with conn: yield conn
    finally: conn.close()


def local_origin(request):
    # Credit-consuming mutations must not be triggered by an unrelated web page.
    origin=request.headers.get('origin')
    if not origin: return
    try:
        parsed=urlparse(origin); host=parsed.hostname
        local=host in ('localhost','127.0.0.1','::1')
        if not local:
            addr=ipaddress.ip_address(host)
            local=addr.is_private and not addr.is_unspecified
        if parsed.scheme not in ('http','https') or not local or parsed.port not in (3000,8001): raise ValueError()
    except ValueError:
        raise HTTPException(403,'Import controls require a local dashboard origin.') from None


class Window(BaseModel):
    ticker: str=Field(pattern=r'^[A-Z][A-Z0-9.\-]{0,9}$')
    start: date
    end: date
    max_dte: int=Field(default=45,ge=1,le=90)

    @model_validator(mode='after')
    def validate_window(self):
        if self.end<self.start or (self.end-self.start).days>90:
            raise ValueError('Select an ordered window of at most 90 calendar days.')
        if self.start<date(2005,1,1) or self.end>=datetime.now(NY).date():
            raise ValueError('Use completed historical dates from 2005 onward; availability depends on plan.')
        return self


class Analysis(Window):
    min_dte: int=Field(default=1,ge=0,le=90)
    weekday: int|None=Field(default=None,ge=0,le=4)
    rate: float=Field(default=.04,ge=-.05,le=.5,allow_inf_nan=False)
    dividend_yield: float=Field(default=0,ge=0,le=.5,allow_inf_nan=False)
    min_oi: int=Field(default=10,ge=1,le=1000000)
    max_spread_pct: float=Field(default=50,gt=0,le=200,allow_inf_nan=False)
    min_coverage: float=Field(default=.5,ge=0,le=1,allow_inf_nan=False)
    min_contracts: int=Field(default=20,ge=1,le=50000)
    rule: str=Field(default='positive_gex',pattern=r'^(positive_gex|negative_gex|above_flip)$')
    cost_bps: float=Field(default=5,ge=0,le=100,allow_inf_nan=False)

    @model_validator(mode='after')
    def validate_scope(self):
        if self.min_dte>self.max_dte: raise ValueError('Minimum DTE must not exceed maximum DTE.')
        return self


def cached_chain(conn,ticker,day,scope):
    return conn.execute('SELECT * FROM chains WHERE ticker=? AND day=? AND scope>=? ORDER BY scope ASC LIMIT 1',(ticker,day,scope)).fetchone()


def sessions(req):
    cal=calendar_for(req.start.year)
    return cal,[x.date().isoformat() for x in cal.sessions_in_range(req.start.isoformat(),req.end.isoformat())]


@router.get('/status')
def status(ticker: str):
    with database() as conn:
        dates=[dict(x) for x in conn.execute('SELECT day,scope,captured FROM chains WHERE ticker=? ORDER BY day',(ticker,))]
    with _guard:
        jobs=[dict(j) for j in _jobs.values() if j['ticker']==ticker]
    return {**provider_status(),'dates':dates,'jobs':jobs[-5:]}


def update(job_id,**values):
    with _guard: _jobs[job_id].update(values)


def run_import(job_id,req):
    provider=None
    try:
        cal,days=sessions(req)
        if not days: raise HistoryError('No exchange sessions in selected window.',422)
        update(job_id,total=len(days),state='running')
        with _guard: cancelled=_jobs[job_id]['cancel_requested']
        if cancelled: update(job_id,state='cancelled'); return
        with database() as conn:
            last=min(cal.next_session(days[-1]).date(),datetime.now(NY).date()-timedelta(days=1)).isoformat()
            needed=[x.date().isoformat() for x in cal.sessions_in_range(days[0],last)]
            existing={x['day'] for x in conn.execute('SELECT day FROM prices WHERE ticker=? AND day BETWEEN ? AND ?',(req.ticker,days[0],last))}
            if set(needed)-existing:
                provider=MarketDataProvider()
                bars=candle_rows(provider.candles(req.ticker,days[0],last))
                captured=datetime.now(timezone.utc).isoformat()
                for day,bar in bars.items():
                    if day in needed:
                        conn.execute('INSERT OR IGNORE INTO prices VALUES(?,?,?,?)',(req.ticker,day,captured,json.dumps(bar)))
                conn.commit()
            for i,day in enumerate(days):
                with _guard: cancelled=_jobs[job_id]['cancel_requested']
                if cancelled: update(job_id,state='cancelled'); return
                update(job_id,current_date=day)
                if not cached_chain(conn,req.ticker,day,req.max_dte):
                    if provider is None: provider=MarketDataProvider()
                    body=provider.chain(req.ticker,day,req.max_dte)
                    chain_rows(body) # Reject misaligned responses before archival.
                    conn.execute('INSERT OR IGNORE INTO chains VALUES(?,?,?,?,?)',(req.ticker,day,req.max_dte,datetime.now(timezone.utc).isoformat(),json.dumps(body,allow_nan=False)))
                    conn.commit()
                update(job_id,completed=i+1,requests=provider.requests if provider else 0)
        update(job_id,state='completed')
    except HistoryError as exc:
        update(job_id,state='failed',error=str(exc),error_code=exc.code,latest_available=exc.latest_available)
    except Exception: update(job_id,state='failed',error='Import failed during validation or storage. Saved dates are retained; inspect local configuration and retry.')
    finally:
        update(job_id,requests=provider.requests if provider else 0)
        if provider: provider.session.close()


@router.post('/imports',status_code=202)
def start_import(req: Window, request: Request):
    local_origin(request)
    identity=req.model_dump(mode='json')
    with _guard:
        for job in _jobs.values():
            if job['state'] in ('queued','running'):
                if job['parameters']==identity: return dict(job)
                raise HTTPException(409,'An import is already running. Wait or cancel it first.')
        while len(_jobs)>=50: del _jobs[next(iter(_jobs))]
        job_id=uuid.uuid4().hex
        _jobs[job_id]=dict(id=job_id,ticker=req.ticker,state='queued',parameters=identity,total=0,completed=0,requests=0,cancel_requested=False,error=None)
        result=dict(_jobs[job_id])
    launch_import(job_id,req)
    return result


def launch_import(job_id,req):
    threading.Thread(target=run_import,args=(job_id,req),daemon=True).start()


@router.get('/imports/{job_id}')
def get_import(job_id: str):
    with _guard:
        if job_id not in _jobs: raise HTTPException(404,'Import not found; after restart, retry to resume archived dates.')
        return dict(_jobs[job_id])


@router.delete('/imports/{job_id}')
def cancel_import(job_id: str, request: Request):
    local_origin(request)
    with _guard:
        if job_id not in _jobs: raise HTTPException(404,'Import not found.')
        _jobs[job_id]['cancel_requested']=True
        return dict(_jobs[job_id])


def analyze(req,detail=False):
    cal,dates=sessions(req); cfg=req.model_dump(mode='json'); days=[]; gaps=[]; price_captures={}
    with database() as conn:
        for day in dates:
            record=cached_chain(conn,req.ticker,day,req.max_dte)
            if record is None: gaps.append(dict(date=day,reason='not_imported_for_requested_expiry_scope')); continue
            rows=chain_rows(json.loads(record['body']))
            item=reconstruct(rows,req.ticker,day,cal.session_close(day).to_pydatetime(),cfg)
            item.update(captured_at=record['captured'],import_max_dte=record['scope'])
            if not detail: item.pop('contracts')
            days.append(item)
        prices={}
        if dates:
            end=cal.next_session(dates[-1]).date().isoformat()
            for row in conn.execute('SELECT * FROM prices WHERE ticker=? AND day BETWEEN ? AND ?',(req.ticker,dates[0],end)):
                prices[row['day']]=json.loads(row['body']); price_captures[row['day']]=row['captured']
    return dict(provider='marketdata.app',model_version=MODEL_VERSION,parameters=cfg,days=days,gaps=gaps,
        requested_sessions=len(dates),price_captures=price_captures,backtest=backtest(days,prices,cal,cfg),
        methodology=[
            'Historical EOD quotes; IV and Greeks reconstructed locally using European BSM. Not American exercise valuations.',
            'Call-positive / put-negative model GEX, USD per 1% underlying move; not observed dealer positions.',
            'Constant user-assumed rate and dividend yield; no vintage yield curve. Historical data may have provider revisions.',
            'OI is the provider value available before that session, reflecting preceding settlement; exact OI capture timestamp unavailable.',
            'Only same-session EOD timestamps, standard 100-share roots and filtered quotes. Coverage is modeled OI / OI passing identity, expiry and minimum-OI filters.',
            'Expired 0DTE at EOD excluded. Multi-expiry max pain unavailable. Gamma flip freezes IV/OI over 50–150% spot.',
            'Backtest: signal at D close, entry next exchange-session open, exit its close. Missing next-session prices never bridged.',
            'Long/cash illustration; cost is a fixed round-trip bps deduction per active session. Benchmark buys every eligible open and sells its close.',
            'Descriptive in-sample research, no optimizer or validated trading edge. Raw stock prices, no split/dividend adjustments.',
            'Beta(1,1) posterior summarizes positive vs negative next-session returns; ties excluded. IID approximation ignores serial dependence.'
        ])


@router.post('/analysis')
def analysis(req: Analysis):
    return analyze(req)


@router.post('/replay')
def replay(req: Analysis):
    if req.start!=req.end: raise HTTPException(422,'Replay requires a single historical date.')
    result=analyze(req,detail=True)
    if not result['days']: raise HTTPException(404,'Date/scope not imported. Import this expiry range first.')
    return result['days'][0]


class SurfaceRequest(Analysis):
    captured_at: str=Field(min_length=1,max_length=100)
    expiries: list[date]=Field(max_length=90)


@router.post('/surface-levels')
def surface_levels(req: SurfaceRequest):
    # Reconstruct the original research universe before selecting expiries:
    # filtering first would change the common spot and the reconstructed IVs.
    analysis_req=Analysis(**req.model_dump())
    day=replay(analysis_req)
    if day['captured_at']!=req.captured_at:
        raise HTTPException(409,'Historical capture changed. Run analysis again before replaying surfaces.')
    selected={d.isoformat() for d in req.expiries}
    available={r['expiry'] for r in day['contracts']}
    if selected-available:
        raise HTTPException(422,'Selected expiry is absent from this historical modeled chain.')
    rows=[r for r in day['contracts'] if r['expiry'] in selected]
    profile={}
    for row in rows:
        point=profile.setdefault(row['strike'],dict(strike=row['strike'],call=0.,put=0.,net=0.))
        point[row['side']]+=row['gex']
        point['net']+=row['gex']
    return dict(date=day['date'],captured_at=day['captured_at'],spot=day['spot'],
        model_version=MODEL_VERSION,parameters=analysis_req.model_dump(mode='json'),
        selected_expiries=sorted(selected),contracts_used=len(rows),
        levels=levels(rows,day['spot'],analysis_req.model_dump(mode='json')),
        profile=[profile[k] for k in sorted(profile)],
        expiries=[e for e in day['expiries'] if e['expiry'] in selected])

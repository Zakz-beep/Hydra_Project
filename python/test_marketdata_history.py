import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch, Mock
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
import marketdata_history as history
from marketdata_provider import chain_rows, candle_rows, HistoryError, MarketDataProvider
from marketdata_model import price, reconstruct, backtest, levels

DAY='2026-09-04'
CLOSE=datetime(2026,9,4,20,tzinfo=timezone.utc)
CFG=history.Analysis(ticker='SPY',start=DAY,end='2026-09-10',min_contracts=1).model_dump(mode='json')


def quote(side='call',strike=100,expiry='2026-09-18',oi=100):
    exp=datetime.fromisoformat(expiry+'T20:00:00+00:00')
    t=(exp-CLOSE).total_seconds()/31536000
    mid=float(price(100.,float(strike),t,CFG['rate'],CFG['dividend_yield'],.25,side=='call')) if t>0 else 1.
    return dict(optionSymbol='SPY'+exp.strftime('%y%m%d')+('C' if side=='call' else 'P')+f'{strike*1000:08d}',underlying='SPY',expiration=exp.timestamp(),
        side=side,strike=strike,bid=mid*.99,ask=mid*1.01,openInterest=oi,volume=None,underlyingPrice=100,updated=CLOSE.timestamp())


def envelope(rows):
    return dict(s='ok',**{k:[x[k] for x in rows] for k in quote()})


class ModelTests(unittest.TestCase):
    def test_inverse_iv_and_gamma_units(self):
        d=reconstruct([quote()], 'SPY',DAY,CLOSE,CFG); c=d['contracts'][0]
        self.assertAlmostEqual(c['iv'],.25,places=8)
        h=.01; t=c['t']; iv=c['iv']
        numerical=(price(100+h,100,t,.04,0,iv,True)-2*price(100,100,t,.04,0,iv,True)+price(100-h,100,t,.04,0,iv,True))/(h*h)
        self.assertAlmostEqual(c['gamma'],numerical,places=6)
        self.assertAlmostEqual(c['gex'],c['gamma']*100*100*100**2*.01)
        self.assertIsNone(d['gamma_flip']); self.assertEqual(d['max_pain'],100)
        self.assertIsNone(c['volume'])

    def test_dividend_and_theta_vega_consistency(self):
        cfg={**CFG,'dividend_yield':.03}; row=quote('put'); t=14/365
        mid=float(price(100.,100.,t,.04,.03,.3,False)); row.update(bid=mid*.99,ask=mid*1.01)
        c=reconstruct([row],'SPY',DAY,CLOSE,cfg)['contracts'][0]
        self.assertAlmostEqual(c['iv'],.3,places=8)
        h=1e-5
        theta=-(price(100,100,t+h,.04,.03,.3,False)-price(100,100,t-h,.04,.03,.3,False))/(2*h)/365
        self.assertAlmostEqual(c['theta'],theta,places=6)
        vega=(price(100,100,t,.04,.03,.3+h,False)-price(100,100,t,.04,.03,.3-h,False))/(2*h)/100
        self.assertAlmostEqual(c['vega'],vega,places=6)
        self.assertLess(c['gex'],0)

    def test_filters_missing_values_and_duplicate(self):
        valid=quote(); stale={**quote('put'),'updated':CLOSE.timestamp()-3600}
        bad={**quote(strike=110),'openInterest':None}
        d=reconstruct([valid,valid,stale,bad],'SPY',DAY,CLOSE,CFG)
        self.assertEqual(d['contracts_used'],1)
        self.assertEqual(d['oi_coverage'],.5)
        self.assertEqual(d['exclusions']['duplicate'],1)
        self.assertEqual(d['exclusions']['not_same_session_eod'],1)

    def test_no_data_no_zero_exposure(self):
        d=reconstruct([],'SPY',DAY,CLOSE,CFG)
        self.assertIsNone(d['gex']); self.assertIsNone(d['oi_coverage']); self.assertEqual(d['contracts'],[])

    def test_gamma_flip_matches_equal_gamma_analytic_root(self):
        d=reconstruct([quote('call',90),quote('put',110)],'SPY',DAY,CLOSE,CFG)
        expected=np.sqrt(90*110)*np.exp(-(.04+.5*.25**2)*14/365)
        self.assertAlmostEqual(d['gamma_flip'],expected,delta=.01)

    def test_vanna_and_charm_delta_finite_differences(self):
        d=reconstruct([quote()],'SPY',DAY,CLOSE,CFG); c=d['contracts'][0]
        from scipy.special import ndtr
        t=c['t']; iv=c['iv']; h=1e-6
        def delta(t,iv):return ndtr((.04+.5*iv**2)*t/(iv*np.sqrt(t)))
        vanna=(delta(t,iv+h)-delta(t,iv-h))/(2*h)
        charm=-(delta(t+h,iv)-delta(t-h,iv))/(2*h)/365
        self.assertAlmostEqual(c['vanna_exposure']/10000,vanna,places=6)
        self.assertAlmostEqual(c['charm_exposure']/10000,charm,places=6)

    def test_expired_zero_dte_excluded(self):
        d=reconstruct([quote(expiry=DAY)],'SPY',DAY,CLOSE,{**CFG,'min_dte':0})
        self.assertIsNone(d['gex']); self.assertEqual(d['exclusions']['expired_at_capture'],1)

    def test_early_close_same_session_expiry_is_not_intraday_history(self):
        row=quote(expiry='2025-11-28')
        stamp=datetime(2025,11,28,18,tzinfo=timezone.utc)
        row.update(updated=stamp.timestamp(),expiration=datetime(2025,11,28,21,tzinfo=timezone.utc).timestamp())
        d=reconstruct([row],'SPY','2025-11-28',stamp,{**CFG,'min_dte':0})
        self.assertIsNone(d['gex']); self.assertEqual(d['exclusions']['expired_at_capture'],1)

    def test_no_fabricated_multi_expiry_pain(self):
        d=reconstruct([quote(),quote('put',expiry='2026-09-25')],'SPY',DAY,CLOSE,CFG)
        self.assertIsNone(d['max_pain']); self.assertEqual(len(d['expiries']),2)
        self.assertTrue(all(x['max_pain']==100 for x in d['expiries']))

    def test_max_pain_matches_brute_force(self):
        rng=np.random.default_rng(14)
        for _ in range(20):
            rows=[dict(strike=int(k),oi=int(oi),side=side,expiry='2026-09-18',iv=.2,gex=10 if side=='call' else -10,vanna_exposure=0,charm_exposure=0) for side in ('call','put') for k,oi in zip(rng.integers(80,120,12),rng.integers(1,500,12))]
            strikes=sorted({x['strike'] for x in rows})
            expected=min(strikes,key=lambda k:sum(x['oi']*max(k-x['strike'] if x['side']=='call' else x['strike']-k,0) for x in rows))
            self.assertEqual(levels(rows,100,CFG,flip=False)['max_pain'],expected)

    def test_weekday_and_scope(self):
        rows=[quote(expiry='2026-09-14'),quote(expiry='2026-09-16')]
        d=reconstruct(rows,'SPY',DAY,CLOSE,{**CFG,'weekday':0})
        self.assertEqual([x['expiry'] for x in d['contracts']],['2026-09-14'])

    def test_impossible_price_has_no_clamped_iv(self):
        d=reconstruct([{**quote(),'bid':110,'ask':111}],'SPY',DAY,CLOSE,CFG)
        self.assertIsNone(d['gex']); self.assertEqual(d['exclusions']['iv_not_solvable_1_to_500_pct'],1)


class BacktestTests(unittest.TestCase):
    def day(self,day=DAY,gex=100):
        return dict(date=day,gex=gex,spot=100,gamma_flip=None,oi_coverage=1,contracts_used=20)

    def test_next_exchange_session_cost_and_initial_drawdown(self):
        bars={'2026-09-08':dict(o=100,c=90)} # Monday is Labor Day.
        b=backtest([self.day()],bars,history.calendar_for(2026),CFG)
        self.assertEqual(b['ledger'][0]['date'],'2026-09-08')
        self.assertAlmostEqual(b['total_return'],-.1005)
        self.assertAlmostEqual(b['max_drawdown'],-.1005)
        self.assertAlmostEqual(b['regimes'][0]['posterior_up'],1/3)

    def test_missing_next_session_never_bridged(self):
        b=backtest([self.day()],{'2026-09-09':dict(o=100,c=110)},history.calendar_for(2026),CFG)
        self.assertEqual(b['sessions'],0); self.assertIsNone(b['total_return'])
        self.assertEqual(b['skipped']['missing_next_session_prices'],1)

    def test_cash_no_cost_and_missing_flip_skip(self):
        bars={'2026-09-08':dict(o=100,c=110)}
        b=backtest([self.day(gex=-10)],bars,history.calendar_for(2026),CFG)
        self.assertEqual(b['total_return'],0); self.assertEqual(b['trades'],0)
        b=backtest([self.day()],bars,history.calendar_for(2026),{**CFG,'rule':'above_flip'})
        self.assertEqual(b['sessions'],0); self.assertEqual(b['skipped']['no_gamma_flip'],1)


class ProviderTests(unittest.TestCase):
    def test_aligned_arrays_and_unknown_status(self):
        self.assertEqual(len(chain_rows(envelope([quote()]))),1)
        bad=envelope([quote()]); bad['bid']=[]
        with self.assertRaises(HistoryError): chain_rows(bad)
        self.assertEqual(chain_rows({'s':'no_data'}),[])

    def test_fixed_host_scope_and_raw_price_parameters(self):
        p=MarketDataProvider(api_token='test-placeholder'); p.get=Mock(return_value={})
        p.chain('SPY',DAY,45)
        path,params=p.get.call_args.args
        self.assertEqual(path,'options/chain/SPY/'); self.assertEqual(params['expiration'],'all')
        self.assertNotIn('dte',params); self.assertNotIn('pm',params)
        p.candles('SPY',DAY,'2026-09-08')
        params=p.get.call_args.args[1]
        self.assertEqual(params['adjustsplits'],'false'); self.assertEqual(params['adjustdividends'],'false')

    def test_daily_timestamp_new_york_and_invalid_prices(self):
        stamp=datetime(2026,9,4,4,tzinfo=timezone.utc).timestamp()
        body=dict(s='ok',t=[stamp],o=[100],h=[101],l=[99],c=[100.5],v=[None])
        self.assertIn(DAY,candle_rows(body)); body['c']=[102]
        self.assertEqual(candle_rows(body),{})

    def test_error_never_exposes_raw_provider_token(self):
        session=Mock(); session.headers={}; session.get.return_value.status_code=403
        session.get.return_value.text='secret-provider-body'
        p=MarketDataProvider(session=session,api_token='test-placeholder')
        with self.assertRaises(HistoryError) as cm:p.chain('SPY',DAY,45)
        self.assertNotIn('secret',str(cm.exception))
        self.assertFalse(session.get.call_args.kwargs['allow_redirects'])

    def test_provider_http_203_is_successful_cached_data(self):
        session=Mock(); session.headers={}; session.get.return_value.status_code=203
        session.get.return_value.json.return_value=envelope([quote()])
        p=MarketDataProvider(session=session,api_token='test-placeholder')
        self.assertEqual(len(chain_rows(p.chain('SPY',DAY,45))),1)

    def test_402_freshness_extracts_only_date_without_raw_details(self):
        session=Mock(); session.headers={}; session.get.return_value.status_code=402
        session.get.return_value.json.return_value={'errmsg':'Your plan can only access fully-closed sessions; the latest available is 2026-09-10. secret-provider-body https://example.com/?token=private'}
        p=MarketDataProvider(session=session,api_token='test-placeholder')
        with self.assertRaises(HistoryError) as cm: p.chain('SPY','2026-09-11',45)
        error=cm.exception
        self.assertEqual(error.status,402); self.assertEqual(error.code,'history_freshness')
        self.assertEqual(error.latest_available,'2026-09-10')
        self.assertNotIn('secret-provider-body',str(error)); self.assertNotIn('example.com',str(error))
        self.assertIn('berikutnya',str(error)); self.assertEqual(p.requests,1)

    def test_other_402_and_invalid_dates_remain_plan_errors(self):
        from marketdata_provider import payment_error
        for body in ({'errmsg':'latest available is 2026-99-99 secret'}, {'errmsg':'Premium endpoint'},[],{}):
            error=payment_error(body,'options/chain/SPY/')
            self.assertEqual(error.status,402); self.assertIsNone(error.latest_available)
            self.assertEqual(error.code,'plan_entitlement'); self.assertNotIn('secret',str(error))


class StorageApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.patch=patch.object(history,'DB_PATH',Path(self.tmp.name)/'history.db'); self.patch.start()
        self.app=FastAPI(); self.app.include_router(history.router); self.client=TestClient(self.app)
    def tearDown(self): self.patch.stop(); self.tmp.cleanup()

    def test_cache_scope_and_capture_immutable(self):
        with history.database() as conn:
            conn.execute('INSERT INTO chains VALUES(?,?,?,?,?)',('SPY',DAY,45,'first',json.dumps(envelope([quote()]))))
            conn.execute('INSERT OR IGNORE INTO chains VALUES(?,?,?,?,?)',('SPY',DAY,45,'later','{}'))
            self.assertEqual(history.cached_chain(conn,'SPY',DAY,14)['captured'],'first')
            self.assertIsNone(history.cached_chain(conn,'SPY',DAY,60))

    def test_local_analysis_and_replay_without_provider(self):
        with history.database() as conn:
            conn.execute('INSERT INTO chains VALUES(?,?,?,?,?)',('SPY',DAY,45,'capture',json.dumps(envelope([quote()]))))
        params={**CFG,'end':DAY}
        with patch.object(history,'MarketDataProvider',side_effect=AssertionError('No network allowed')):
            r=self.client.post('/api/greeks/marketdata/analysis',json=params)
            self.assertEqual(r.status_code,200,r.text); self.assertEqual(r.json()['days'][0]['contracts_used'],1)
            self.assertNotIn('contracts',r.json()['days'][0])
            r=self.client.post('/api/greeks/marketdata/replay',json=params)
            self.assertEqual(r.status_code,200); self.assertEqual(len(r.json()['contracts']),1)

    def test_validation_and_cross_origin_credit_protection(self):
        with self.assertRaises(ValidationError): history.Analysis(**{**CFG,'min_dte':50})
        with self.assertRaises(ValidationError): history.Analysis(**{**CFG,'ticker':'../SPY'})
        r=self.client.post('/api/greeks/marketdata/imports',json=CFG,headers={'Origin':'https://unrelated.example'})
        self.assertEqual(r.status_code,403)

    def test_surface_scope_matches_replay_and_preserves_common_spot(self):
        rows=[quote('call',100,'2026-09-11',300),quote('put',95,'2026-09-11',500),
              quote('call',105,'2026-09-18',200),quote('put',100,'2026-09-18',400)]
        # A date-only reconstruction would produce a different common spot.
        rows[0]['underlyingPrice']=99.8; rows[1]['underlyingPrice']=99.8
        with history.database() as conn:
            conn.execute('INSERT INTO chains VALUES(?,?,?,?,?)',('SPY',DAY,45,'capture',json.dumps(envelope(rows))))
        params={**CFG,'end':DAY,'rate':.07,'dividend_yield':.02}
        with patch.object(history,'MarketDataProvider',side_effect=AssertionError('Surfaces must remain local')):
            replay=self.client.post('/api/greeks/marketdata/replay',json=params).json()
            payload={**params,'captured_at':'capture','expiries':['2026-09-11','2026-09-18']}
            r=self.client.post('/api/greeks/marketdata/surface-levels',json=payload)
            self.assertEqual(r.status_code,200,r.text); all_levels=r.json()
            self.assertEqual(all_levels['levels']['gex'],replay['gex'])
            self.assertEqual(all_levels['levels']['gamma_flip'],replay['gamma_flip'])
            self.assertIsNone(all_levels['levels']['max_pain'])
            self.assertAlmostEqual(sum(p['net'] for p in all_levels['profile']),replay['gex'])
            r=self.client.post('/api/greeks/marketdata/surface-levels',json={**payload,'expiries':['2026-09-11']})
            self.assertEqual(r.status_code,200,r.text); scoped=r.json()
            expected=levels([c for c in replay['contracts'] if c['expiry']=='2026-09-11'],replay['spot'],params)
            self.assertEqual(scoped['levels'],expected)
            self.assertEqual(scoped['spot'],replay['spot']); self.assertNotEqual(scoped['spot'],99.8)
            self.assertIsNotNone(scoped['levels']['max_pain'])
            self.assertTrue(all(p['call']>=0 and p['put']<=0 for p in scoped['profile']))
            empty=self.client.post('/api/greeks/marketdata/surface-levels',json={**payload,'expiries':[]}).json()
            self.assertIsNone(empty['levels']['gex']); self.assertEqual(empty['profile'],[])
            for change,code in [({'captured_at':'stale'},409),({'expiries':['2026-09-14']},422),({'end':'2026-09-08'},422)]:
                self.assertEqual(self.client.post('/api/greeks/marketdata/surface-levels',json={**payload,**change}).status_code,code)

    def test_cancel_before_chain_and_resume_saved_rows(self):
        req=history.Window(ticker='SPY',start=DAY,end=DAY)
        with history.database() as conn:
            for day in (DAY,'2026-09-08'):
                conn.execute('INSERT INTO prices VALUES(?,?,?,?)',('SPY',day,'capture',json.dumps(dict(o=100,c=100))))
        job='unit-test'; history._jobs[job]=dict(cancel_requested=True)
        with patch.object(history,'MarketDataProvider',side_effect=AssertionError('No request on cancelled job')):
            history.run_import(job,req)
        self.assertEqual(history._jobs.pop(job)['state'],'cancelled')

    def test_import_archive_then_resume_without_paid_requests(self):
        req=history.Window(ticker='SPY',start=DAY,end='2026-09-08')
        class Provider:
            def __init__(self):self.requests=0; self.session=Mock()
            def candles(self,*args):
                self.requests+=1
                ts=[datetime.fromisoformat(d+'T04:00:00+00:00').timestamp() for d in (DAY,'2026-09-08','2026-09-09')]
                return dict(s='ok',t=ts,o=[100]*3,c=[101]*3,h=[102]*3,l=[99]*3,v=[50]*3)
            def chain(self,ticker,day,scope):
                self.requests+=1
                row=quote(); row['updated']=datetime.fromisoformat(day+'T20:00:00+00:00').timestamp()
                return envelope([row])
        job='unit-import'
        with patch.object(history,'_jobs',{job:dict(cancel_requested=False)}):
            with patch.object(history,'MarketDataProvider',Provider):history.run_import(job,req)
            self.assertEqual(history._jobs[job]['state'],'completed'); self.assertEqual(history._jobs[job]['requests'],3)
            with history.database() as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM chains').fetchone()[0],2)
            with patch.object(history,'MarketDataProvider',side_effect=AssertionError('Cached import must not request')):
                history.run_import(job,req)
            self.assertEqual(history._jobs[job]['state'],'completed'); self.assertEqual(history._jobs[job]['requests'],0)

    def test_import_active_idempotency_and_global_limit(self):
        with patch.object(history,'_jobs',{}), patch.object(history,'launch_import'):
            a=self.client.post('/api/greeks/marketdata/imports',json=CFG,headers={'Origin':'http://127.0.0.1:3000'})
            b=self.client.post('/api/greeks/marketdata/imports',json=CFG)
            self.assertEqual(a.status_code,202); self.assertEqual(a.json()['id'],b.json()['id'])
            c=self.client.post('/api/greeks/marketdata/imports',json={**CFG,'ticker':'QQQ'})
            self.assertEqual(c.status_code,409)
            self.assertTrue(self.client.delete('/api/greeks/marketdata/imports/'+a.json()['id']).json()['cancel_requested'])

    def test_import_freshness_error_preserves_captures_and_exposes_available_date(self):
        from marketdata_provider import payment_error
        req=history.Window(ticker='SPY',start='2026-09-10',end='2026-09-11')
        with history.database() as conn:
            conn.execute('INSERT INTO chains VALUES(?,?,?,?,?)',('SPY','2026-09-10',45,'first',json.dumps(envelope([quote()]))))
            for day in ('2026-09-10','2026-09-11','2026-09-14'):
                conn.execute('INSERT INTO prices VALUES(?,?,?,?)',('SPY',day,'first',json.dumps(dict(o=100,c=100))))
        provider=Mock(); provider.requests=1
        provider.chain.side_effect=payment_error({'errmsg':'latest available is 2026-09-10'},'options/chain/SPY/')
        with patch.object(history,'_jobs',{'test':dict(cancel_requested=False)}), patch.object(history,'MarketDataProvider',return_value=provider):
            history.run_import('test',req)
            job=history._jobs['test']
            self.assertEqual(job['state'],'failed'); self.assertEqual(job['completed'],1)
            self.assertEqual(job['latest_available'],'2026-09-10')
            self.assertEqual(job['error_code'],'history_freshness')
        with history.database() as conn:
            self.assertIsNone(history.cached_chain(conn,'SPY','2026-09-11',45))
            self.assertEqual(history.cached_chain(conn,'SPY','2026-09-10',45)['captured'],'first')


if __name__=='__main__': unittest.main()

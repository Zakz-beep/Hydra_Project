"""Provider-free migration regressions. Credentials, orders and production DBs are never used."""
import atexit
import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

temp = tempfile.TemporaryDirectory()
atexit.register(temp.cleanup)
os.environ['GREEKS_DB_PATH'] = str(Path(temp.name)/'test.db')
from alpaca_options import AlpacaOptionsProvider, OptionsDataError, NY, DATA_URL
from Greeks import OptionsInventoryEngine
from greeks_db import GreeksDatabase
from fastapi.testclient import TestClient
import greeks_api

CONFIG={'APCA_API_KEY_ID':'fixture-key', 'APCA_API_SECRET_KEY':'fixture-secret', 'ALPACA_OPTIONS_FEED':'indicative'}


def fixture():
    now=datetime.now(timezone.utc)
    today=now.astimezone(NY).date()
    expiry=str(today+timedelta(days=7))
    contracts=[]; snaps={}
    for i, kind in enumerate(['call', 'put']):
        symbol=f"SPY{(today+timedelta(days=7)).strftime('%y%m%d')}{'C' if kind=='call' else 'P'}00100000"
        contracts.append({'symbol':symbol, 'root_symbol':'SPY', 'underlying_symbol':'SPY', 'size':'100', 'type':kind,
            'strike_price':'100', 'expiration_date':expiry, 'open_interest':'200', 'open_interest_date':str(today)})
        snaps[symbol]={'latestQuote':{'bp':2,'ap':2.2,'t':now.isoformat()}, 'latestTrade':{'p':2,'s':99,'t':now.isoformat()},
            'impliedVolatility':.25, 'greeks':{'delta':.5 if i==0 else -.5,'gamma':.03}}
    return now,contracts,snaps


def provider_fixture(contracts=None, snaps=None, volume=True):
    now,default_contracts,default_snaps=fixture()
    contracts=default_contracts if contracts is None else contracts
    snaps=default_snaps if snaps is None else snaps
    provider=AlpacaOptionsProvider(config=CONFIG)
    calls=[]
    def get(base,path,params,deadline):
        calls.append((base,path,dict(params)))
        if path.endswith('/snapshot'): return {'latestTrade':{'p':100,'t':now.isoformat()}}
        if path.endswith('/contracts'): return {'option_contracts':contracts,'next_page_token':None}
        if '/snapshots/' in path: return {'snapshots':snaps,'next_page_token':None}
        if path.endswith('/bars'):
            if not volume: raise OptionsDataError('Fixture volume unavailable')
            return {'bars':{contracts[0]['symbol']:[{'t':params['start'],'v':500}]}, 'next_page_token':None}
        raise AssertionError(path)
    provider._get=get
    return provider,calls


class AlpacaMigrationTests(unittest.TestCase):
    def test_missing_credentials_and_feed_fail_closed(self):
        with self.assertRaisesRegex(OptionsDataError,'belum dikonfigurasi'): AlpacaOptionsProvider(config={})
        with self.assertRaises(OptionsDataError): AlpacaOptionsProvider(config={**CONFIG,'ALPACA_OPTIONS_FEED':'auto'})

    def test_pagination_collects_all_pages_and_filters_expiries_explicitly(self):
        provider,_=provider_fixture()
        provider._get=Mock(side_effect=[{'snapshots':{'a':{}},'next_page_token':'next'}, {'snapshots':{'b':{}},'next_page_token':None}])
        result=provider._pages(DATA_URL,'/snapshots',{'limit':1000},'snapshots',float('inf'))
        self.assertEqual(len(result),2)
        self.assertEqual(provider._get.call_args_list[1].args[2]['page_token'],'next')

    def test_repeated_token_is_rejected_not_partial_success(self):
        provider,_=provider_fixture()
        provider._get=Mock(return_value={'snapshots':{},'next_page_token':'repeat'})
        with self.assertRaisesRegex(OptionsDataError,'Repeated'): provider._pages(DATA_URL,'/x',{},'snapshots',float('inf'))

    def test_feed_oi_dates_and_volume_are_distinct(self):
        provider,calls=provider_fixture()
        result=provider.load('SPY')
        call,put=next(iter(result['chains'].values()))
        self.assertEqual(call.iloc[0]['volume'],500)
        self.assertIsNone(put.iloc[0]['volume'])
        self.assertEqual(call.iloc[0]['openinterest'],200)
        self.assertEqual(result['provenance']['feed'],'indicative')
        self.assertEqual(result['provenance']['volume_covered'],1)
        self.assertTrue(all('expiration_date_lte' in params for _,path,params in calls if '/contracts' in path or '/snapshots/' in path))
        self.assertTrue(any(params.get('feed')=='indicative' for _,path,params in calls if '/snapshots/' in path))
        self.assertTrue(all('feed' not in params for _,path,params in calls if path.endswith('/bars')))

    def test_missing_iv_oi_crossed_quotes_and_nonstandard_are_excluded(self):
        _,contracts,snaps=fixture()
        for mutation in ['oi','iv','quote','size']:
            cs,ss=copy.deepcopy(contracts),copy.deepcopy(snaps)
            for c in cs:
                if mutation=='oi': c['open_interest']=None
                if mutation=='size': c['size']='10'
                if mutation=='iv': ss[c['symbol']]['impliedVolatility']=None
                if mutation=='quote': ss[c['symbol']]['latestQuote']['bp']=3
            provider,_=provider_fixture(cs,ss)
            with self.assertRaisesRegex(OptionsDataError,'Tidak ada kontrak'): provider.load('SPY')

    def test_volume_failure_preserves_missing_and_provenance(self):
        provider,_=provider_fixture(volume=False)
        result=provider.load('SPY')
        self.assertEqual(result['provenance']['volume_covered'],0)
        self.assertIn('partial/unavailable',result['provenance']['warnings'][-1])
        self.assertIsNone(next(iter(result['chains'].values()))[0].iloc[0]['volume'])

    def test_contract_metadata_cached_but_quotes_refreshed(self):
        provider,calls=provider_fixture()
        provider.load('SPY'); provider.load('SPY')
        self.assertEqual(sum(path.endswith('/contracts') for _,path,_ in calls),1)
        self.assertEqual(sum('/snapshots/' in path for _,path,_ in calls),2)

    def test_engine_preserves_signs_native_greeks_and_null_volume(self):
        provider,_=provider_fixture(volume=False)
        engine=OptionsInventoryEngine('SPY');engine._provider=provider
        result=engine.compute_dict()
        rows=[s for b in result['by_expiry'].values() for s in b['strikes']]
        self.assertEqual(len(rows),2)
        self.assertGreater(next(s for s in rows if s['option_type']=='call')['gex_spotgamma'],0)
        self.assertLess(next(s for s in rows if s['option_type']=='put')['gex_spotgamma'],0)
        self.assertEqual(rows[0]['provider_greeks']['gamma'],.03)
        self.assertIsNone(rows[0]['volume'])
        json.dumps(result,allow_nan=False)
        db=GreeksDatabase(':memory:');db.insert_snapshot(result)
        history=db.get_snapshot_history('SPY')
        self.assertEqual(history[0]['provenance']['feed'],'indicative')
        with db._conn() as conn: self.assertIsNone(conn.execute('SELECT volume FROM greeks_strike_archive').fetchone()[0])

    def test_legacy_research_helpers_remain_separate_from_alpaca_engine(self):
        from Greeks import _get_expiry_dates, _fetch_options_chain, _fetch_spot_price
        ticker = Mock()
        ticker.options = ('2026-09-18',)
        ticker.fast_info = {'last_price': 123.0}
        import pandas as pd
        ticker.option_chain.return_value = Mock(calls=pd.DataFrame({'strike': [120], 'openInterest': [25]}), puts=pd.DataFrame())
        self.assertEqual(_get_expiry_dates(ticker), ['2026-09-18'])
        self.assertEqual(_fetch_spot_price(ticker, 'TEST'), (123.0, 'realtime'))
        self.assertEqual(_fetch_options_chain(ticker, '2026-09-18')[0].iloc[0]['openinterest'], 25)
        provider, _ = provider_fixture()
        engine = OptionsInventoryEngine('SPY'); engine._provider = provider
        with patch('Greeks._fetch_spot_price', side_effect=AssertionError('Yahoo fallback')), patch('Greeks._fetch_options_chain', side_effect=AssertionError('Yahoo fallback')):
            self.assertEqual(engine.compute_dict()['provenance']['provider'], 'alpaca')

    def test_no_index_proxy_or_provider_downgrade(self):
        provider,_=provider_fixture()
        with self.assertRaisesRegex(OptionsDataError,'saham/ETF'):provider.load('^GSPC')
        session=Mock();session.headers={}
        session.get.return_value=Mock(status_code=403,headers={})
        provider=AlpacaOptionsProvider(session=session,config=CONFIG)
        with patch('alpaca_options.time.sleep'):
            with self.assertRaises(OptionsDataError):provider._get(DATA_URL,'/test',{},float('inf'))
        self.assertEqual(session.get.call_count,1)
        self.assertFalse(session.get.call_args.kwargs['allow_redirects'])

    def test_rate_limit_retries_are_bounded_and_errors_do_not_leak(self):
        session=Mock();session.headers={}
        session.get.return_value=Mock(status_code=429,headers={'Retry-After':'0'},text='fixture-secret')
        provider=AlpacaOptionsProvider(session=session,config=CONFIG)
        with patch('alpaca_options.time.sleep'):
            with self.assertRaises(OptionsDataError) as err:provider._get(DATA_URL,'/test',{},float('inf'))
        self.assertEqual(session.get.call_count,3)
        self.assertNotIn('fixture-secret',str(err.exception))

    def test_api_visible_config_errors_and_no_synthetic_vvix(self):
        client=TestClient(greeks_api.app)
        with patch('Greeks.AlpacaOptionsProvider',side_effect=OptionsDataError('Missing fixture key',503)):
            response=client.get('/api/greeks?ticker=TESTKEY')
        self.assertEqual(response.status_code,503)
        self.assertEqual(client.get('/api/greeks/vvix').status_code,501)
        public=client.get('/api/greeks/provider').json()
        self.assertNotIn('secret',json.dumps(public).lower())

    def test_feed_change_requires_restart_before_cross_feed_reads_or_writes(self):
        with patch('greeks_api.provider_status',return_value={'feed':'opra'}), patch('greeks_api.ACTIVE_FEED','indicative'):
            response=TestClient(greeks_api.app).get('/api/greeks?ticker=SPY')
        self.assertEqual(response.status_code,503)
        self.assertIn('Restart',response.json()['detail'])

    def test_legacy_history_is_read_only_and_retains_original_quality(self):
        import hashlib
        root=Path(temp.name)/'legacy'; (root/'data').mkdir(parents=True,exist_ok=True)
        legacy_path=root/'data'/'greeks.db'
        db=GreeksDatabase(str(legacy_path))
        provider,_=provider_fixture();engine=OptionsInventoryEngine('SPY');engine._provider=provider
        snapshot=engine.compute_dict();snapshot['data_source']='synthetic';snapshot.pop('provenance')
        db.insert_snapshot(snapshot)
        before=hashlib.sha256(legacy_path.read_bytes()).hexdigest()
        with patch('greeks_api.__file__',str(root/'greeks_api.py')):
            response=TestClient(greeks_api.app).get('/api/greeks/history?ticker=SPY&dataset=legacy-yahoo')
        self.assertEqual(response.status_code,200)
        history=response.json()['history']
        self.assertEqual(history[0]['data_source'],'synthetic')
        self.assertEqual(history[0]['provenance']['provider'],'yahoo')
        self.assertEqual(before,hashlib.sha256(legacy_path.read_bytes()).hexdigest())


if __name__=='__main__':unittest.main()

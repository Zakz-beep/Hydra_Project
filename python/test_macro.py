import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
import macro_sources as sources
from macro_api import app
from macro_model import observations, posterior, forecast


class MacroTests(unittest.TestCase):
    def test_model_surprise_scale_uses_only_forecast_prefix(self):
        values=np.random.default_rng(12).normal(.3,.12,100)
        s=pd.Series(values,index=pd.period_range('2010-01',periods=100,freq='M'))
        before=posterior(values[:-1]);row=forecast(s)['evaluation'][-1]
        sd=before['scale']*np.sqrt(before['df']/(before['df']-2))
        self.assertAlmostEqual(row['predictive_sd'],sd)
        self.assertAlmostEqual(row['model_z'],(values[-1]-before['mean'])/sd)
        s.iloc[-1]=10;changed=forecast(s)['evaluation'][-1]
        self.assertEqual(row['predictive_sd'],changed['predictive_sd']);self.assertEqual(row['model'],changed['model'])
        self.assertGreater(changed['model_z'],row['model_z'])

    def test_explicit_fred_refresh_and_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(sources,'DB',Path(tmp)/'macro.db'):
            with sources.connect() as db:db.execute('INSERT INTO documents VALUES(?,?,?,?,?)',('https://example.com','old','2025-01-01',sources.time.time()-60,None))
            with patch.object(sources,'download',return_value='fresh') as download:
                self.assertEqual(sources.document('https://example.com',21600)[0],'old');download.assert_not_called()
                self.assertEqual(sources.document('https://example.com',21600,force=True)[0],'fresh')
                sources.document('https://example.com',21600,force=True);self.assertEqual(download.call_count,1)

    def test_transient_download_retries_once(self):
        import httpx
        calls=[]
        def handler(request):
            calls.append(request)
            if len(calls)==1: raise httpx.ConnectTimeout('transient',request=request)
            return httpx.Response(200,text='csv')
        client=httpx.Client(transport=httpx.MockTransport(handler))
        with patch.object(sources.httpx,'Client',return_value=client):self.assertEqual(sources.download('https://example.com'),'csv')
        self.assertEqual(len(calls),2)

    def test_ff_timezone_impact_and_absent_actual(self):
        rows=sources.parse_ff(json.dumps([dict(title='CPI m/m',country='USD',impact='High',date='2026-03-12T08:30:00-04:00',forecast='0.3%',previous='0.2%'),dict(country='EUR',impact='High')]))
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['date'],'2026-03-12T12:30:00+00:00');self.assertIsNone(rows[0]['actual'])
        self.assertEqual(rows[0]['forecast'],'0.3%')

    def test_calendar_dst_and_no_guessed_actual(self):
        html='<table><tr><th>Year 2026</th></tr>'+''.join(f'<tr><td class="scheduled-date"><div class="release-date">{d}</div><small>8:30 AM</small></td><td class="release-title">Personal Income and Outlays, test</td></tr>' for d in ['January 30','July 30'])+'</table>'
        rows=sources.parse_bea(html)
        self.assertIn('13:30:00',rows[0]['date']);self.assertIn('12:30:00',rows[1]['date']);self.assertIsNone(rows[0]['actual'])

    def test_archive_dates_remain_date_only(self):
        self.assertEqual(sources.category('Minutes of the Federal Open Market Committee'), 'Policy')
        row=sources.parse_bls_archive('<a href="/news.release/archives/cpi_08122025.htm">July 2025 CPI</a>','cpi')[0]
        self.assertEqual(row['date'],'2025-08-12');self.assertEqual(row['precision'],'date')

    def test_income_is_not_pce_inflation(self):
        rss='<rss><channel><item><title>Personal Income and Outlays, July 2026</title><link>https://www.bea.gov/news/a</link><pubDate>Wed, 26 Aug 2026 08:30:00 EDT</pubDate><data><main><current><percentChange>0.4</percentChange></current></main></data></item></channel></rss>'
        news,rows=sources.parse_feed(rss,'BEA');self.assertEqual(len(news),1);self.assertIsNone(rows[0]['actual'])
        rss=rss.replace('Personal Income and Outlays, July 2026','GDP (Second Estimate), Q2 2026')
        row=sources.parse_feed(rss,'BEA')[1][0];self.assertEqual(row['actual'],'0.4');self.assertEqual(row['unit'],'q/q annualized %')

    def test_revisions_immutable_and_schedule_does_not_erase_values(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(sources,'DB',Path(tmp)/'macro.db'):
            e=sources.event('GDP','2026-08-26T12:30:00+00:00','BEA','https://www.bea.gov/news/gdp');e['actual']='1.5'
            sources.save_events([e]);sources.save_events([e.copy()])
            sparse=sources.event('GDP','2026-08-26','BEA',e['url'],'date');sources.save_events([sparse])
            with sources.connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM revisions').fetchone()[0],1)
            e['actual']='1.6';sources.save_events([e])
            with sources.connect() as db:
                rs=db.execute('SELECT payload FROM revisions').fetchall()
                self.assertEqual(len(rs),2);self.assertEqual(json.loads(rs[0][0])['actual'],'1.5')

    def test_monthly_transforms_and_gap_preservation(self):
        s=observations('observation_date,CPIAUCSL\n2025-01-01,100\n2025-02-01,101\n2025-04-01,103\n','cpi')
        self.assertAlmostEqual(s.iloc[1],1);self.assertTrue(np.isnan(s.iloc[2]));self.assertTrue(np.isnan(s.iloc[3]))
        payroll=observations('DATE,PAYEMS\n2025-01-01,150000\n2025-02-01,150200\n','payrolls');self.assertEqual(payroll.iloc[-1],200)
        gdp=observations('DATE,GDPC1\n2025-01-01,100\n2025-04-01,101\n','gdp');self.assertAlmostEqual(gdp.iloc[-1],(1.01**4-1)*100)

    def test_posterior_prefix_and_future_shock(self):
        rng=np.random.default_rng(10);values=rng.normal(.3,.15,140)
        s=pd.Series(values,index=pd.period_range('2010-01',periods=140,freq='M'))
        first=forecast(s,60,4);changed=s.copy();changed.iloc[-1]=1000
        after=forecast(changed,60,4)
        self.assertEqual(first['evaluation'][-1]['model'],after['evaluation'][-1]['model'])
        expected=posterior(values[:-1],60,4)['mean'];self.assertAlmostEqual(first['evaluation'][-1]['model'],expected)
        self.assertNotEqual(first['prediction']['mean'],after['prediction']['mean'])

    def test_interval_probability_and_naive_baseline(self):
        s=pd.Series(np.linspace(1,2,100),index=pd.period_range('2010-01',periods=100,freq='M'))
        r=forecast(s);self.assertLess(r['prediction']['lower'],r['prediction']['mean']);self.assertLess(r['prediction']['mean'],r['prediction']['upper'])
        self.assertGreaterEqual(r['probability_above'],0);self.assertLessEqual(r['probability_above'],1)
        self.assertAlmostEqual(r['metrics']['naive_mae'],1/99)
        self.assertAlmostEqual(forecast(s,threshold=r['prediction']['mean'])['probability_above'],.5)

    def test_insufficient_and_recent_missing_fail(self):
        for vals in [np.arange(10),np.r_[np.arange(40),np.nan]]:
            with self.assertRaises(ValueError):posterior(vals)

    def test_api_validation_failure_and_success_serialization(self):
        client=TestClient(app)
        for query in ['series=bad','window=3','strength=999','threshold=nan']:
            self.assertEqual(client.get('/api/macro/forecast?'+query).status_code,422)
        with patch('macro_api.document',side_effect=ValueError('Provider blocked')):
            self.assertEqual(client.get('/api/macro/forecast').status_code,502)
        csv='observation_date,CPILFESL\n'+'\n'.join(f'{d:%Y-%m-%d},{100+i*.3}' for i,d in enumerate(pd.date_range('2010-01-01',periods=140,freq='MS')))
        with tempfile.TemporaryDirectory() as tmp,patch.object(sources,'DB',Path(tmp)/'macro.db'),patch('macro_api.document',return_value=(csv,dict(url='https://fred.stlouisfed.org',fetched_at=sources.now(),stale=False,error=None))):
            r=client.get('/api/macro/forecast');self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['vintage'],'latest revised')
            self.assertEqual(len(client.get('/api/macro/forecast-history').json()),1)

    def test_cache_failure_retains_data_and_reports_staleness(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(sources,'DB',Path(tmp)/'macro.db'):
            with sources.connect() as db:db.execute('INSERT INTO documents VALUES(?,?,?,?,?)',('https://example.com','old','2025-01-01',0,None))
            with patch.object(sources.httpx,'Client',side_effect=RuntimeError('offline')):
                body,status=sources.document('https://example.com');self.assertEqual(body,'old');self.assertTrue(status['stale']);self.assertIn('offline',status['error'])
                self.assertEqual(sources.document('https://example.com')[0],'old')

if __name__=='__main__':unittest.main()

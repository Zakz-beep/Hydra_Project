from datetime import datetime, timezone
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import macro_sources
import macro_reaction as m
from macro_api import app

T=datetime(2026,8,10,12,30,tzinfo=timezone.utc).timestamp()
def event(**kwargs):
    return dict(id='a',title='CPI',date=datetime.fromtimestamp(T,timezone.utc).isoformat(),precision='time',source='Test',impact='High',actual='0.3%',forecast='0.2%',**kwargs)
def index(bars,splits=None):return m.PriceIndex(dict(bars=bars,splits=splits or []),T+90000)

class ReactionTests(unittest.TestCase):
    def test_baseline_does_not_use_release_bar_close(self):
        row=m.evaluate_event(event(),index([(T,100),(T+300,102),(T+1800,99),(T+3600,98),(T+86400,104)]),T+90000)
        self.assertEqual(row['baseline']['price'],100)
        self.assertAlmostEqual(row['returns']['5']['value'],2)
        self.assertAlmostEqual(row['returns']['30']['value'],-1)
        self.assertAlmostEqual(row['returns']['1440']['value'],4)

    def test_stale_baseline_and_missing_horizon_never_filled(self):
        row=m.evaluate_event(event(),index([(T-300,100),(T+300,102)]),T+90000)
        self.assertIsNone(row['baseline'])
        self.assertTrue(all(r['value'] is None for r in row['returns'].values()))
        row=m.evaluate_event(event(),index([(T,100),(T+3300,102),(T+3900,103)]),T+90000)
        self.assertIsNone(row['returns']['60']['value'])

    def test_unknown_time_future_and_immature_horizon(self):
        e=event();e.update(date='2026-08-10',precision='date')
        self.assertIsNone(m.evaluate_event(e,index([(T,100)]),T+90000)['baseline'])
        row=m.evaluate_event(event(),index([(T,100),(T+300,101)]),T+120)
        self.assertEqual(row['returns']['5']['reason'],'Horizon belum selesai')
        self.assertEqual(m.evaluate_event(event(),index([(T,100)]),T-1)['reaction_status'],'Menunggu jadwal')

    def test_offsets_sample_lag_and_no_post_target_sampling(self):
        e=event();e['date']='2026-08-10T08:32:00-04:00'
        row=m.evaluate_event(e,index([(T,100),(T+300,102),(T+600,110)]),T+90000)
        self.assertEqual(row['baseline']['lag_seconds'],120)
        self.assertEqual(row['returns']['5']['lag_seconds'],120)
        self.assertAlmostEqual(row['returns']['5']['value'],2)

    def test_split_blocks_horizon_and_replay_gaps(self):
        row=m.evaluate_event(event(),index([(T,100),(T+300,50)],[T+1]),T+90000)
        self.assertEqual(row['returns']['5']['reason'],'Stock split dalam jendela')
        path=m.replay(row,index([(T,100),(T+300,50)],[T+1]),T+90000)
        self.assertIsNone(next(p for p in path if p['minute']==5)['value'])
        self.assertIsNone(next(p for p in path if p['minute']==-5)['value'])

    def test_descriptive_labels(self):
        self.assertEqual(m.reaction_label(.2,.1,.1),'Reaksi kecil')
        self.assertEqual(m.reaction_label(.2,-.3,.1),'Reversal turun')
        self.assertEqual(m.reaction_label(-.2,-.3,.1),'Turun bertahan')
        self.assertEqual(m.reaction_label(None,.3,.1),'Naik')
        self.assertEqual(m.reaction_label(.3,None,.1),'Belum dinilai')

    def test_summary_deduplicates_timestamps_and_beta_prior(self):
        rows=[]
        for i in range(5):
            e=event();e['date']=datetime.fromtimestamp(T+i*86400,timezone.utc).isoformat()
            e['returns']={'60':{'value':1 if i<3 else -1}};rows.extend([e,e.copy()])
        s=m.summary(rows,60,.1)
        self.assertEqual(s['n'],5);self.assertAlmostEqual(s['posterior']['mean'],4/7)
        self.assertLess(s['posterior']['lower'],s['posterior']['mean'])
        self.assertIsNone(m.summary(rows[:4],60,.1)['posterior'])

    def test_source_cache_failure_and_archive_preservation(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(macro_sources,'DB',Path(tmp)/'macro.db'):
            with patch.object(m,'fetch_prices',return_value=dict(bars=[[T,100]],splits=[])) as fetch:
                first,status=m.prices('SPY');m.prices('SPY');self.assertEqual(fetch.call_count,1)
            with macro_sources.connect() as db:db.execute('UPDATE reaction_prices SET attempted=0')
            with patch.object(m,'fetch_prices',return_value=dict(bars=[[T+300,102]],splits=[])):
                archived,_=m.prices('SPY',True);self.assertEqual(len(archived['bars']),2)
                self.assertEqual(archived['captured_at'][str(int(T))],status['fetched_at'])
            with macro_sources.connect() as db:db.execute('UPDATE reaction_prices SET attempted=0')
            with patch.object(m,'fetch_prices',side_effect=ValueError('Offline')):
                cached,state=m.prices('SPY',True);self.assertTrue(state['stale']);self.assertEqual(cached['bars'],archived['bars'])

    def test_api_allowlist_filters_and_schedule_only_actual(self):
        payload=dict(bars=[[T,100],[T+300,101],[T+3600,102]],splits=[])
        e=event();e['actual']=None
        with patch.object(m,'read_pairs',return_value=[e]),patch.object(m,'prices',return_value=(payload,dict(fetched_at=None,stale=False,error=None))):
            r=TestClient(app).get('/api/macro/reactions?symbol=SPY').json()
            self.assertEqual(r['summary']['n'],1)
            self.assertIn('belum terverifikasi',r['rows'][0]['reaction_status'])
            self.assertIsNone(r['rows'][0]['score'])
            self.assertEqual(TestClient(app).get('/api/macro/reactions?symbol=SPY&surprise=above').json()['rows'],[])
            self.assertEqual(TestClient(app).get('/api/macro/reactions?symbol=INVALID').status_code,422)
            self.assertEqual(TestClient(app).get('/api/macro/reactions?horizon=17').status_code,422)

if __name__=='__main__':unittest.main()

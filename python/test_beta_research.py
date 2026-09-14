"""Provider-free regressions for the BETA workspace."""
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient
from beta_research import fit_sensitivity, rolling_sensitivity, analyze_prices, prepare_prices
from beta_api import app, run_lock


class BetaTests(unittest.TestCase):
    def test_exact_slope_intercept_and_inverse(self):
        x=np.linspace(-.03,.03,100)
        fit=fit_sensitivity(.001-2*x,x)
        self.assertAlmostEqual(fit['beta'],-2)
        self.assertAlmostEqual(fit['alpha_daily'],.001)
        self.assertAlmostEqual(fit['r_squared'],1)
        self.assertAlmostEqual(fit['correlation'],-1)

    def test_rolling_includes_its_labeled_date(self):
        x=np.tile([-.01,.01],25);y=x.copy();y[-1]=.1
        dates=list(range(50))
        rolling=rolling_sensitivity(y,x,dates,20)
        self.assertEqual(len(rolling),31)
        self.assertEqual(rolling[0]['date'],19)
        self.assertEqual(rolling[-1]['date'],49)
        self.assertAlmostEqual(rolling[-1]['beta'],fit_sensitivity(y[-20:],x[-20:],minimum=20)['beta'])
        self.assertNotAlmostEqual(rolling[-1]['beta'],rolling[-2]['beta'])

    def test_missing_and_zero_variance_are_not_beta_zero(self):
        self.assertIsNone(fit_sensitivity(np.ones(60),np.ones(60)))
        self.assertIsNone(fit_sensitivity([1]*5,[1,2,3,4,5]))
        fit=fit_sensitivity(np.zeros(60),np.linspace(-.02,.02,60))
        self.assertAlmostEqual(fit['beta'],0)
        self.assertIsNone(fit['r_squared'])

    def test_annualization_changes_scale_not_beta(self):
        rng=np.random.default_rng(3);x=rng.normal(0,.01,100);y=x+rng.normal(0,.01,100)
        a,b=fit_sensitivity(y,x,252),fit_sensitivity(y,x,365)
        self.assertEqual(a['beta'],b['beta'])
        self.assertAlmostEqual(b['total_vol_annual']/a['total_vol_annual'],np.sqrt(365/252))
        self.assertLess(a['beta_ci'][0],a['beta']);self.assertGreater(a['beta_ci'][1],a['beta'])

    def test_common_sample_and_no_fill(self):
        prices=self.prices();prices.loc[prices.index[10],'QQQ']=np.nan
        analyses,meta=analyze_prices(prices,'TSLA',['SPY','QQQ'],20)
        self.assertEqual(meta['excluded_rows'],1)
        self.assertEqual(analyses[0]['stats']['n_observations'],analyses[1]['stats']['n_observations'])
        self.assertEqual(analyses[0]['scatter_data'][9]['date'],prices.index[11].strftime('%Y-%m-%d'))

    def test_no_downside_sample_stays_missing(self):
        x=np.linspace(.001,.003,100)
        prices=pd.DataFrame({'A':100*np.cumprod(1+2*x),'M':100*np.cumprod(1+x)},index=pd.date_range('2024-01-01',periods=100))
        analyses,_=analyze_prices(prices,'A',['M'],120)
        self.assertIsNone(analyses[0]['asymmetric_beta']['beta_downside'])
        self.assertEqual(analyses[0]['asymmetric_beta']['n_down'],0)
        self.assertEqual(analyses[0]['rolling_beta'],[])

    def test_self_benchmark_is_supported(self):
        data=self.prices()['SPY']
        result,_=analyze_prices(data,'SPY',['SPY'])
        self.assertAlmostEqual(result[0]['stats']['beta'],1)
        self.assertAlmostEqual(result[0]['stats']['alpha_daily'],0)

    def test_latest_degenerate_window_does_not_reuse_old_estimate(self):
        prices=self.prices()
        prices.loc[prices.index[-25:],'SPY']=100
        result,_=analyze_prices(prices,'TSLA',['SPY'],20)
        self.assertTrue(any(p['beta'] is not None for p in result[0]['rolling_beta']))
        self.assertIsNone(result[0]['rolling_beta'][-1]['beta'])
        self.assertIsNone(result[0]['stability']['latest'])

    def test_api_errors_and_contract(self):
        client=TestClient(app)
        for query in ['ticker=BAD/NAME','period=bad','rolling_window=2','annualization=12','compare=QQQ,IWM,GLD,TLT']:
            self.assertEqual(client.get('/api/beta/analysis?'+query).status_code,422)
        with run_lock:self.assertEqual(client.get('/api/beta/analysis').status_code,409)
        raw=pd.concat({'Close':self.prices()},axis=1)
        with patch('beta_api.yf.download',return_value=raw):
            response=client.get('/api/beta/analysis?compare=QQQ&annualization=365')
        self.assertEqual(response.status_code,200,response.text[:400])
        body=response.json();self.assertEqual(body['version'],2);self.assertEqual(len(body['analyses']),2)
        self.assertEqual(body['annualization'],365)
        self.assertEqual(body['stats'],body['analyses'][0]['stats'])

    def test_missing_symbol_rejected(self):
        with self.assertRaisesRegex(ValueError,'NOPE'):prepare_prices(self.prices(),['SPY','NOPE'])

    @staticmethod
    def prices():
        values=100*np.cumprod(1+np.random.default_rng(12).normal(.001,.01,(100,3)),axis=0)
        return pd.DataFrame(values,columns=['TSLA','SPY','QQQ'],index=pd.date_range('2024-01-01',periods=100))

if __name__=='__main__':unittest.main()

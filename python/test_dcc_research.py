"""Deterministic numerical regressions; provider and database writes are mocked."""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent/'correlaction'))
from research import correlation_path, fit_dcc, simulate_exposure, pair_research
from api import app, run_lock


class ResearchTests(unittest.TestCase):
    def test_dcc_uses_previous_residual(self):
        z=np.array([[1.,.3],[-.5,1.],[2.,-1.],[.1,.5]])
        base=np.eye(2)
        before=correlation_path(z,.05,.9,base)
        changed=z.copy(); changed[2]=[20.,20.]
        after=correlation_path(changed,.05,.9,base)
        np.testing.assert_allclose(before[:3],after[:3])
        self.assertFalse(np.allclose(before[3],after[3]))
        np.testing.assert_allclose(before[0],base)

    def test_fit_valid_correlation_matrices(self):
        z=np.random.default_rng(12).normal(size=(180,3))
        matrices,diagnostics=fit_dcc(z)
        self.assertLess(diagnostics['persistence'],.999)
        self.assertTrue(diagnostics['converged'])
        self.assertTrue((np.linalg.eigvalsh(matrices)>0).all())
        np.testing.assert_allclose(np.diagonal(matrices,axis1=1,axis2=2),1)

    def test_signal_lag_simple_returns_and_initial_drawdown(self):
        ret=pd.Series([-.1,.1,-.2])
        df=simulate_exposure(ret,pd.Series([.9,.1,.9]),pd.Series([0.,0.,0.]),cost_bps=0)
        self.assertEqual(df.Weight.tolist(),[1.,.1,1.])
        self.assertAlmostEqual(df.Passive_Equity.iloc[-1],10000*.9*1.1*.8)
        self.assertAlmostEqual(df.Passive_DD.iloc[0],-10)
        self.assertAlmostEqual(df.Adaptive_Equity.iloc[1],9000*1.01)

    def test_costs_initial_entry_and_exposure_turnover(self):
        df=simulate_exposure(pd.Series([0.,0.]),pd.Series([.9,.9]),pd.Series([0.,0.]),cost_bps=10)
        self.assertAlmostEqual(df.Passive_Equity.iloc[-1],9990)
        self.assertAlmostEqual(df.Adaptive_Equity.iloc[-1],9990*(1-.9*.001))

    def test_pair_tail_counts_and_rolling_warmup(self):
        x=np.arange(100,dtype=float)
        z=np.column_stack([x,x[::-1]])
        returns=pd.DataFrame(z,columns=['A','B'])
        matrices=correlation_path(z,.03,.9)
        pairs,paths=pair_research(returns,z,matrices,20)
        pair=pairs[0]
        self.assertEqual(pair['lower_total'],10)
        self.assertEqual(pair['lower_count'],0)
        self.assertEqual(pair['posterior_mean'],1/12)
        self.assertGreater(pair['posterior_interval'][1],0)
        self.assertTrue(pd.isna(paths['A|B']['rolling'][0]))
        self.assertAlmostEqual(pair['rolling'],-1)

    def test_api_validation_and_busy(self):
        client=TestClient(app)
        for body in [{'tickers':['SPY','SPY']},{'tickers':['SPY','QQQ'],'mode':'bad'},
                     {'tickers':['SPY','QQQ'],'window':1},{'tickers':['SPY','QQQ'],'cost_bps':-1}]:
            self.assertEqual(client.post('/api/dcc/run',json=body).status_code,422)
        with run_lock:
            self.assertEqual(client.post('/api/dcc/run',json={'tickers':['SPY','QQQ']}).status_code,409)

    def test_full_run_contract_without_provider_or_db_writes(self):
        prices=pd.DataFrame(100*np.exp(np.cumsum(np.random.default_rng(14).normal(0,.01,(200,3)),axis=0)),
                            columns=['SPY','QQQ','TLT'],index=pd.date_range('2024-01-01',periods=200))
        prices.loc[prices.index[20],'TLT']=np.nan
        with patch('copula_model.yf.download',return_value={'Close':prices}), patch('api.save_dcc_run',return_value=123), patch('api.run_hmm_model',return_value={'error':'Test fixture HMM unavailable'}):
            response=TestClient(app).post('/api/dcc/run',json={'tickers':['SPY','QQQ','TLT']})
        self.assertEqual(response.status_code,200,response.text[:500])
        result=response.json()
        self.assertEqual(len(result['research']['pairs']),3)
        self.assertEqual(result['research']['dropped_rows'],1)
        self.assertEqual(result['research']['observations'],198)
        self.assertIsNone(result['timeseries'][0]['rolling_corrs']['SPY|QQQ'])
        self.assertIsNone(result['copula_details']['best_fit'])
        self.assertEqual(result['market_status']['SPY'],'unknown')

    def test_missing_asset_fails_without_silently_changing_basket(self):
        prices=pd.DataFrame({'SPY':[100.]*130},index=pd.date_range('2024-01-01',periods=130))
        with patch('copula_model.yf.download',return_value={'Close':prices}),patch('api.save_dcc_run') as save:
            response=TestClient(app).post('/api/dcc/run',json={'tickers':['SPY','NOPE']})
        self.assertEqual(response.status_code,400)
        self.assertIn('NOPE',response.json()['detail'])
        save.assert_not_called()

if __name__=='__main__':unittest.main()

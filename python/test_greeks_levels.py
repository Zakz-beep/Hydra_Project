import unittest
import numpy as np
import pandas as pd
from Greeks import _calculate_max_pain, _find_gamma_flip, _find_zero_crossings

class LevelsTests(unittest.TestCase):
    def test_no_crossing_is_not_boundary(self):
        for side in ('call', 'put'):
            self.assertIsNone(_find_gamma_flip([dict(strike=100, option_type=side, dte=30, iv=.2, oi=100)],100))

    def test_exact_zero_requires_sign_change(self):
        grid=np.array([90,100,110])
        self.assertEqual(_find_zero_crossings(grid,np.array([-1,0,1])),[100])
        for values in ([1,0,1],[0,0,0]):
            self.assertEqual(_find_zero_crossings(grid,np.array(values)),[])

    def test_missing_oi_is_unavailable(self):
        self.assertIsNone(_calculate_max_pain(pd.DataFrame(),pd.DataFrame(),100))
        self.assertIsNone(_calculate_max_pain(pd.DataFrame({'strike':[100], 'openinterest':[0]}),pd.DataFrame(),100))

    def test_payout_matches_brute_force(self):
        rng=np.random.default_rng(12)
        for _ in range(25):
            frames=[pd.DataFrame({'strike':rng.integers(80,121,20), 'openinterest':rng.integers(0,500,20)}) for _ in range(2)]
            ks=sorted(set(frames[0].strike)|set(frames[1].strike))
            expected=min(ks,key=lambda k:sum(np.maximum(k-frames[0].strike,0)*frames[0].openinterest)+sum(np.maximum(frames[1].strike-k,0)*frames[1].openinterest))
            self.assertEqual(_calculate_max_pain(*frames,100),expected)

    def test_invalid_contracts_ignored(self):
        self.assertIsNone(_find_gamma_flip([{},dict(strike=100, option_type='call',dte=2,iv=float('nan'),oi=10)],100))

    def test_scope_dedup_units_and_separate_settlement(self):
        from greeks_levels import scoped_levels
        base=dict(strike=100,option_type='call',dte=2,iv=.2,oi=100,gex_spotgamma=2)
        monday=dict(base,expiry='2026-09-14')
        wednesday=dict(base,expiry='2026-09-16',strike=110,gex_spotgamma=3)
        snap=dict(ticker='NVDA',timestamp='test',spot=100,by_expiry={'7':{'strikes':[monday,wednesday,monday]}})
        mixed=scoped_levels(snap)
        self.assertEqual(mixed['contracts'],2)
        self.assertIsNone(mixed['max_pain'])
        self.assertEqual(mixed['call_wall'],110)
        self.assertEqual(sum(r['net'] for r in mixed['profile']),5e7)
        single=scoped_levels(snap,['2026-09-14'])
        self.assertEqual(single['max_pain'],100)
        self.assertEqual(single['call_wall'],100)
        self.assertIsNone(single['put_wall'])
        self.assertEqual(scoped_levels(snap,[])['contracts'],0)
        with self.assertRaises(ValueError):scoped_levels(snap,['2026-09-15'])

    def test_levels_route_rejects_misaligned_capture(self):
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import greeks_api
        snap=dict(ticker='NVDA',timestamp='capture-one',spot=100,by_expiry={})
        with patch.object(greeks_api,'_get_snapshot',return_value=snap):
            client=TestClient(greeks_api.app)
            self.assertEqual(client.get('/api/greeks/levels?ticker=NVDA&snapshot=older').status_code,409)
            self.assertEqual(client.get('/api/greeks/levels?ticker=NVDA&expiries=2026-09-14').status_code,422)
            result=client.get('/api/greeks/levels?ticker=NVDA&snapshot=capture-one')
            self.assertEqual(result.status_code,200)
            self.assertIsNone(result.json()['max_pain'])

if __name__=='__main__': unittest.main()

"""Levels from eligible, deduplicated contracts at actual settlement dates."""
import pandas as pd
from Greeks import _calculate_max_pain, _find_gamma_flip, RISK_FREE_RATE

def inventory_rows(snapshot):
    unique = {}
    for bucket in snapshot.get('by_expiry', {}).values():
        for row in bucket.get('strikes', []):
            unique.setdefault((row['expiry'], row['option_type'], row['strike']), row)
    return list(unique.values())

def expiry_pain(rows, spot):
    result = []
    for expiry in sorted({r['expiry'] for r in rows}):
        subset = [r for r in rows if r['expiry'] == expiry]
        frames = [pd.DataFrame([{'strike':r['strike'], 'openinterest':r['oi']} for r in subset if r['option_type']==side]) for side in ('call','put')]
        result.append({'expiry':expiry, 'contracts':len(subset), 'max_pain':_calculate_max_pain(*frames, spot)})
    return result

def scoped_levels(snapshot, expiries=None):
    rows = inventory_rows(snapshot)
    available = {r['expiry'] for r in rows}
    selected = available if expiries is None else set(expiries)
    if not selected.issubset(available):
        raise ValueError('Expiry is not present in this eligible inventory.')
    rows = [r for r in rows if r['expiry'] in selected]
    profile = {}
    for r in rows:
        p = profile.setdefault(r['strike'],dict(strike=r['strike'],call=0.,put=0.,net=0.,vanna=0.,charm=0.))
        p[r['option_type']] += r['gex_spotgamma'] * 1e7
        p['net'] += r['gex_spotgamma'] * 1e7
        p['vanna'] += r.get('vanna_exp',0.)
        p['charm'] += r.get('charm_exp',0.)
    profile = sorted(profile.values(),key=lambda r:r['strike'])
    calls = [r for r in profile if r['call']>0]
    puts = [r for r in profile if r['put']<0]
    pain = expiry_pain(rows,snapshot['spot'])
    return dict(ticker=snapshot['ticker'], timestamp=snapshot['timestamp'], expiries=sorted(selected), contracts=len(rows),
        profile=profile, call_wall=max(calls,key=lambda r:r['call'])['strike'] if calls else None,
        put_wall=min(puts,key=lambda r:r['put'])['strike'] if puts else None,
        gamma_flip=_find_gamma_flip(rows,snapshot['spot'],snapshot.get('provenance',{}).get('risk_free_rate',RISK_FREE_RATE)),
        max_pain=pain[0]['max_pain'] if len(pain)==1 else None, by_actual_expiry=pain,
        basis='Eligible OI only. Call-positive/put-negative BSM GEX, USD per 1% spot move. Walls maximize side GEX, not OI. Max pain minimizes fixed-OI intrinsic payout separately per expiry; lowest strike wins ties. Flip searches 50–150% of spot at fixed IV/OI; no sampled crossing is null. Not observed dealer positions or price forecasts.')

"""EOD research only: reconstruct European BSM from historical bid/ask, never live Greeks."""
from collections import Counter
from datetime import date
import re
import numpy as np
from scipy.special import ndtr
from scipy.stats import beta
from marketdata_provider import NY, instant, number

MODEL_VERSION = 'marketdata-bsm-eod-v1'


def price(s, k, t, r, q, iv, call):
    d1 = (np.log(s/k)+(r-q+.5*iv*iv)*t)/(iv*np.sqrt(t))
    d2 = d1-iv*np.sqrt(t)
    return np.where(call, s*np.exp(-q*t)*ndtr(d1)-k*np.exp(-r*t)*ndtr(d2),
                    k*np.exp(-r*t)*ndtr(-d2)-s*np.exp(-q*t)*ndtr(-d1))


def reconstruct(rows, ticker, day, close, cfg):
    excluded = Counter()
    eligible = []
    seen = set()
    oi_total = 0.
    for row in rows:
        match = re.fullmatch(r'([A-Z.]+)(\d{6})([CP])(\d{8})', str(row['optionSymbol']))
        expiry, updated = instant(row['expiration']), instant(row['updated'])
        k, oi, bid, ask, s = [number(row[x]) for x in ('strike','openInterest','bid','ask','underlyingPrice')]
        side = row['side']
        if not match or match[1] != ticker or row['underlying'] != ticker or not expiry or not updated:
            excluded['identity_or_timestamp'] += 1; continue
        expday = expiry.astimezone(NY).date()
        if match[2] != expday.strftime('%y%m%d') or side not in ('call','put') or match[3] != ('C' if side=='call' else 'P') or k is None or k <= 0 or abs(int(match[4])/1000-k)>1e-6:
            excluded['nonstandard_or_mismatched_contract'] += 1; continue
        dte = (expday-date.fromisoformat(day)).days
        if not cfg['min_dte'] <= dte <= cfg['max_dte'] or (cfg['weekday'] is not None and expday.weekday() != cfg['weekday']):
            excluded['expiry_filter'] += 1; continue
        if row['optionSymbol'] in seen:
            excluded['duplicate'] += 1; continue
        seen.add(row['optionSymbol'])
        if oi is None or oi < cfg['min_oi'] or oi != int(oi):
            excluded['missing_or_filtered_oi'] += 1; continue
        oi_total += oi
        local = updated.astimezone(NY)
        if local.date().isoformat()!=day or updated < close or local.hour*60+local.minute > 16*60+15:
            excluded['not_same_session_eod'] += 1; continue
        t = (expiry-updated).total_seconds()/(365*86400)
        if t <= 0 or expday.isoformat() == day:
            # EOD cannot recover the pre-close exposure of same-session expiry,
            # including early closes when the provider still encodes 16:00 expiry.
            excluded['expired_at_capture'] += 1; continue
        if bid is None or ask is None or bid<=0 or ask<bid or (ask-bid)/((bid+ask)/2)*100 > cfg['max_spread_pct'] or s is None or s<=0:
            excluded['invalid_or_wide_quote'] += 1; continue
        eligible.append(dict(symbol=row['optionSymbol'], expiry=expday.isoformat(), side=side, strike=k,
            oi=oi, volume=number(row['volume']), bid=bid, ask=ask, spot=s, t=t, updated=updated.isoformat()))
    spot = float(np.median([x['spot'] for x in eligible])) if eligible else None
    aligned = [x for x in eligible if abs(x['spot']/spot-1)<=.005]
    excluded['spot_alignment'] += len(eligible)-len(aligned)
    contracts=[]
    if aligned:
        k=np.array([x['strike'] for x in aligned]); t=np.array([x['t'] for x in aligned]); call=np.array([x['side']=='call' for x in aligned])
        mid=np.array([(x['bid']+x['ask'])/2 for x in aligned]); r=cfg['rate']; q=cfg['dividend_yield']
        low=np.full(len(k),.01); high=np.full(len(k),5.)
        valid=(mid>=price(spot,k,t,r,q,low,call)) & (mid<=price(spot,k,t,r,q,high,call))
        for _ in range(60):
            iv=(low+high)/2
            below=price(spot,k,t,r,q,iv,call)<mid
            low=np.where(below,iv,low); high=np.where(below,high,iv)
        iv=(low+high)/2; root=np.sqrt(t); disc=np.exp(-q*t)
        d1=(np.log(spot/k)+(r-q+.5*iv*iv)*t)/(iv*root); d2=d1-iv*root
        phi=np.exp(-.5*d1*d1)/np.sqrt(2*np.pi)
        delta=disc*(ndtr(d1)-np.where(call,0,1)); gamma=disc*phi/(spot*iv*root)
        vega=spot*disc*phi*root/100
        vanna=-disc*phi*d2/iv
        d1prime=((r-q+.5*iv*iv)*t-np.log(spot/k))/(2*iv*t**1.5)
        charm=(q*delta-disc*phi*d1prime)/365
        theta=(-spot*disc*phi*iv/(2*root)+np.where(call,q*spot*disc*ndtr(d1)-r*k*np.exp(-r*t)*ndtr(d2),-q*spot*disc*ndtr(-d1)+r*k*np.exp(-r*t)*ndtr(-d2)))/365
        for i,x in enumerate(aligned):
            if not valid[i]: excluded['iv_not_solvable_1_to_500_pct']+=1; continue
            sign=1 if call[i] else -1; weight=sign*x['oi']*100
            contracts.append({**x, 'iv':float(iv[i]), 'delta':float(delta[i]), 'gamma':float(gamma[i]),
                'vega':float(vega[i]), 'theta':float(theta[i]), 'gex':float(gamma[i]*weight*spot*spot*.01),
                'vanna_exposure':float(vanna[i]*weight), 'charm_exposure':float(charm[i]*weight)})
    summary=levels(contracts,spot,cfg)
    return dict(date=day, spot=spot, raw_contracts=len(rows), contracts_used=len(contracts),
        oi_coverage=sum(x['oi'] for x in contracts)/oi_total if oi_total else None,
        exclusions={k:v for k,v in excluded.items() if v}, **summary,
        expiries=[dict(expiry=e, **levels([x for x in contracts if x['expiry']==e],spot,cfg,flip=False)) for e in sorted({x['expiry'] for x in contracts})], contracts=contracts)


def levels(rows, spot, cfg, flip=True):
    result=dict(gex=None,gross_gex=None,gamma_flip=None,call_wall=None,put_wall=None,max_pain=None,vanna_exposure=None,charm_exposure=None,mean_iv=None)
    if not rows: return result
    result.update({key:sum(x[key] for x in rows) for key in ('gex','vanna_exposure','charm_exposure')})
    result['gross_gex']=sum(abs(x['gex']) for x in rows)
    result['mean_iv']=sum(x['iv']*x['oi'] for x in rows)/sum(x['oi'] for x in rows) if sum(x['oi'] for x in rows)>0 else None
    for side in ('call','put'):
        profile=Counter()
        for x in rows:
            if x['side']==side: profile[x['strike']]+=abs(x['gex'])
        if profile and max(profile.values())>0: result[side+'_wall']=max(sorted(profile),key=profile.get)
    if len({x['expiry'] for x in rows})==1 and sum(x['oi'] for x in rows)>0:
        # Cumulative strike weights avoid quadratic payout scans.
        strikes=sorted({x['strike'] for x in rows}); c=Counter(); p=Counter()
        for x in rows: (c if x['side']=='call' else p)[x['strike']]+=x['oi']
        cw=ck=0.; pw=sum(p.values()); pk=sum(k*v for k,v in p.items()); payouts=[]
        for k in strikes:
            cw+=c[k]; ck+=k*c[k]; pw-=p[k]; pk-=k*p[k]
            payouts.append(k*cw-ck+pk-k*pw)
        result['max_pain']=strikes[int(np.argmin(payouts))]
    if flip and result['gross_gex']>0:
        k=np.array([x['strike'] for x in rows]); t=np.array([x['t'] for x in rows]); iv=np.array([x['iv'] for x in rows])
        w=np.array([(1 if x['side']=='call' else -1)*x['oi']*100 for x in rows])
        grid=np.linspace(spot*.5,spot*1.5,401); y=[]
        for block in np.array_split(grid,17):
            s=block[:,None]; d1=(np.log(s/k)+(cfg['rate']-cfg['dividend_yield']+.5*iv*iv)*t)/(iv*np.sqrt(t))
            g=np.exp(-cfg['dividend_yield']*t)*np.exp(-.5*d1*d1)/np.sqrt(2*np.pi)/(s*iv*np.sqrt(t))
            y.extend(np.sum(g*w*s*s*.01,axis=1).tolist())
        roots=[]
        for i in range(len(grid)-1):
            if y[i]*y[i+1]<0: roots.append(float(grid[i]-y[i]*(grid[i+1]-grid[i])/(y[i+1]-y[i])))
            elif 0<i<len(grid)-1 and y[i]==0 and y[i-1]*y[i+1]<0: roots.append(float(grid[i]))
        result['gamma_flip']=min(roots,key=lambda x:abs(x-spot)) if roots else None
    return result


def backtest(days, prices, calendar, cfg):
    ledger=[]; skipped=Counter(); groups={'positive':[],'negative':[]}; equity=benchmark=peak=1.; drawdown=0.
    for d in days:
        if d.get('gex') is None or d.get('oi_coverage') is None or d['oi_coverage']<cfg['min_coverage'] or d['contracts_used']<cfg['min_contracts']:
            skipped['missing_or_low_coverage_chain']+=1; continue
        next_day=calendar.next_session(d['date']).date().isoformat(); bar=prices.get(next_day)
        if not bar: skipped['missing_next_session_prices']+=1; continue
        ret=bar['c']/bar['o']-1
        group='positive' if d['gex']>0 else 'negative' if d['gex']<0 else None
        if group: groups[group].append(ret)
        rule=cfg['rule']
        if rule=='above_flip' and d['gamma_flip'] is None: skipped['no_gamma_flip']+=1; continue
        active=(d['gex']>0 if rule=='positive_gex' else d['gex']<0 if rule=='negative_gex' else d['spot']>d['gamma_flip'])
        net=ret-cfg['cost_bps']/10000 if active else 0.
        equity*=1+net; benchmark*=1+ret-cfg['cost_bps']/10000
        peak=max(peak,equity); drawdown=min(drawdown,equity/peak-1)
        ledger.append(dict(signal_date=d['date'],date=next_day,gex=d['gex'],active=bool(active),open=bar['o'],close=bar['c'],gross_return=ret,net_return=net,equity=equity,benchmark=benchmark))
    regimes=[]
    for name,values in groups.items():
        wins=sum(v>0 for v in values); losses=sum(v<0 for v in values); a=1+wins; b=1+losses
        regimes.append(dict(regime=name,n=len(values),ties=len(values)-wins-losses,mean_return=float(np.mean(values)) if values else None,
            mean_absolute_return=float(np.mean(np.abs(values))) if values else None, posterior_up=a/(a+b),
            credible_interval=[float(beta.ppf(.025,a,b)),float(beta.ppf(.975,a,b))],prior='Beta(1,1)'))
    trades=[x for x in ledger if x['active']]
    return dict(ledger=ledger,regimes=regimes,skipped=dict(skipped),sessions=len(ledger),trades=len(trades),
        total_return=equity-1 if ledger else None,benchmark_return=benchmark-1 if ledger else None,
        max_drawdown=drawdown if ledger else None,win_rate=sum(x['net_return']>0 for x in trades)/len(trades) if trades else None)

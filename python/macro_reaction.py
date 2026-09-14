"""Descriptive event-aligned price returns; no inferred release times or causal claims."""
import bisect
import json
import math
import statistics
import threading
import time
from datetime import datetime, timedelta, timezone
from scipy.stats import beta
from macro_sources import connect, LOCK, now
from macro_surprise import calculate, read_pairs, timestamp

ASSETS = {'SPY':'S&P 500 ETF', 'QQQ':'Nasdaq-100 ETF', 'GLD':'Gold ETF proxy',
          'UUP':'USD bullish ETF proxy', 'TLT':'20+ year Treasury ETF', 'BTC-USD':'Bitcoin / USD'}
HORIZONS = (5, 30, 60, 1440)
PRICE_LOCKS = {key:threading.Lock() for key in ASSETS}


def fetch_prices(symbol):
    import yfinance as yf
    end = datetime.now(timezone.utc)
    frame = yf.Ticker(symbol).history(start=end-timedelta(days=59), end=end, interval='5m',
        prepost=True, auto_adjust=False, back_adjust=False, actions=True, repair=False,
        keepna=True, timeout=20, raise_errors=True)
    if frame.empty: raise ValueError('Yahoo returned no 5-minute prices')
    bars, splits = {}, []
    for index, row in frame.iterrows():
        if index.tzinfo is None: raise ValueError('Price timestamps have no timezone')
        start = int(index.timestamp())
        # Yahoo timestamps identify bar starts. Only a completed bar can be sampled.
        close_at = start + 300
        if close_at > end.timestamp(): continue
        split = float(row.get('Stock Splits', 0))
        if math.isfinite(split) and split != 0: splits.append(start)
        close = float(row['Close'])
        if math.isfinite(close) and close > 0: bars[close_at] = close
    if not bars: raise ValueError('No valid completed bars returned')
    return dict(bars=sorted(bars.items()), splits=splits)


def prices(symbol, refresh=False):
    with PRICE_LOCKS[symbol]:
        with LOCK, connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS reaction_prices(symbol TEXT PRIMARY KEY, payload TEXT, fetched_at TEXT, attempted REAL, error TEXT)')
            old = db.execute('SELECT * FROM reaction_prices WHERE symbol=?', (symbol,)).fetchone()
        cooldown = 60 if refresh else 300 if old and old['error'] else 900
        if old and time.time()-old['attempted'] < cooldown:
            return json.loads(old['payload']), dict(fetched_at=old['fetched_at'], stale=bool(old['error']), error=old['error'])
        try:
            payload = fetch_prices(symbol)
            stamp, error = now(), None
            # Keep captured prices after they leave Yahoo's rolling window. Each close retains provenance.
            previous = json.loads(old['payload']) if old else dict(bars=[],splits=[])
            captured = {float(t):[p,previous.get('captured_at',{}).get(str(int(t)),old['fetched_at'] if old else None)] for t,p in previous['bars']}
            captured.update({float(t):[p,stamp] for t,p in payload['bars']})
            retained = sorted(captured)[-200_000:]
            payload['bars'] = [[t,captured[t][0]] for t in retained]
            payload['captured_at'] = {str(int(t)):captured[t][1] for t in retained}
            payload['splits'] = sorted(set(previous.get('splits',[])+payload.get('splits',[])))
        except Exception as exc:
            payload = json.loads(old['payload']) if old else dict(bars=[],splits=[])
            stamp = old['fetched_at'] if old else None
            error = f'{type(exc).__name__}: {str(exc)[:250]}'
        with LOCK, connect() as db:
            db.execute('INSERT OR REPLACE INTO reaction_prices VALUES(?,?,?,?,?)', (symbol,json.dumps(payload),stamp,time.time(),error))
        return payload, dict(fetched_at=stamp, stale=bool(error), error=error)


class PriceIndex:
    def __init__(self, payload, as_of):
        self.bars = sorted((float(t),float(p)) for t,p in payload['bars'] if t <= as_of and math.isfinite(p) and p > 0)
        self.times = [b[0] for b in self.bars]
        self.splits = payload.get('splits',[])
        self.captured = payload.get('captured_at',{})

    def sample(self, target):
        i = bisect.bisect_right(self.times,target)-1
        if i < 0 or target-self.times[i] >= 300: return None
        return self.bars[i]

    def crosses_split(self, start, end):
        return any(start <= split <= end for split in self.splits)


def reaction_label(early, late, band):
    if late is None: return 'Belum dinilai'
    if abs(late) <= band: return 'Reaksi kecil'
    if early is not None and abs(early) > band and early*late < 0: return 'Reversal naik' if late > 0 else 'Reversal turun'
    if early is not None and abs(early) > band: return 'Naik bertahan' if late > 0 else 'Turun bertahan'
    return 'Naik' if late > 0 else 'Turun'


def evaluate_event(event, index, as_of):
    row = {**event, 'baseline':None, 'returns':{}, 'reaction_status':None}
    try: release = timestamp(event['date']).timestamp() if event.get('precision') == 'time' else None
    except (ValueError,TypeError): release = None
    reason = 'Waktu rilis tidak diketahui' if release is None else 'Menunggu jadwal' if release > as_of else None
    base = index.sample(release) if reason is None else None
    if reason is None and base is None: reason = 'Harga sebelum rilis tidak tersedia / pasar tutup'
    if base: row['baseline'] = dict(price=base[1],sampled_at=datetime.fromtimestamp(base[0],timezone.utc).isoformat(),lag_seconds=release-base[0],captured_at=index.captured.get(str(int(base[0]))))
    row['reaction_status'] = reason or ('Actual tersedia di sumber' if event.get('actual') is not None else 'Jadwal berlalu; actual belum terverifikasi')
    for minutes in HORIZONS:
        target = release+minutes*60 if release is not None else None
        missing = reason
        if missing is None and target > as_of: missing = 'Horizon belum selesai'
        sample = index.sample(target) if missing is None else None
        if missing is None and sample is None: missing = 'Harga horizon tidak tersedia / pasar tutup'
        if missing is None and index.crosses_split(base[0],sample[0]): missing = 'Stock split dalam jendela'
        row['returns'][str(minutes)] = dict(value=None if missing else (sample[1]/base[1]-1)*100,
            reason=missing, sampled_at=datetime.fromtimestamp(sample[0],timezone.utc).isoformat() if sample else None,
            captured_at=index.captured.get(str(int(sample[0]))) if sample else None,
            lag_seconds=target-sample[0] if sample else None)
    return row


def replay(event, index, as_of):
    if not event or not event['baseline']: return []
    release = timestamp(event['date']).timestamp()
    baseline = event['baseline']['price']
    base_time = timestamp(event['baseline']['sampled_at']).timestamp()
    points = []
    for minute in range(-30,1441,5):
        target = release+minute*60
        bar = index.sample(target) if target <= as_of else None
        valid = bar is not None and not index.crosses_split(min(base_time,bar[0]),max(base_time,bar[0]))
        points.append(dict(minute=minute, time=datetime.fromtimestamp(target,timezone.utc).isoformat(),
            value=(bar[1]/baseline-1)*100 if valid else None, price=bar[1] if valid else None))
    return points


def summary(rows, horizon, band):
    # Several series/providers can describe the same timestamp: do not count the same return twice.
    unique = {timestamp(r['date']).timestamp():r['returns'][str(horizon)]['value'] for r in rows if r['returns'][str(horizon)]['value'] is not None}
    values = list(unique.values()); n = len(values); positive = sum(v > 0 for v in values)
    posterior = None
    if n >= 5:
        a,b = 1+positive,1+n-positive
        posterior = dict(mean=a/(a+b),lower=float(beta.ppf(.1,a,b)),upper=float(beta.ppf(.9,a,b)),positive=positive)
    return dict(n=n,median=statistics.median(values) if values else None,
        small=sum(abs(v)<=band for v in values),posterior=posterior)


def report(symbol='SPY', event_id=None, refresh=False, series_filter='', surprise='all', horizon=60, band=.1):
    if symbol not in ASSETS: raise ValueError('Unsupported reaction asset')
    if horizon not in HORIZONS or band not in (.05,.1,.25,.5) or surprise not in ('all','above','below','neutral','unscored'):
        raise ValueError('Unsupported reaction settings')
    cutoff = datetime.now(timezone.utc); as_of = cutoff.timestamp()
    events = calculate(read_pairs(),as_of=cutoff.isoformat())['rows']
    # Keep historical coverage visible even when the rolling intraday feed cannot price it.
    events = events[:500]
    eligible = any(e.get('precision') == 'time' and timestamp(e['date']) <= cutoff for e in events)
    payload,status = prices(symbol,refresh) if eligible else (dict(bars=[],splits=[]),dict(fetched_at=None,stale=False,error=None))
    index = PriceIndex(payload,as_of)
    rows = [evaluate_event(e,index,as_of) for e in events]
    for row in rows:
        row['series_key'] = '|'.join([row['source'],row['title'],row.get('unit') or ''])
        row['overlaps'] = []
        if row.get('precision') == 'time':
            t = timestamp(row['date']).timestamp()
            row['overlaps'] = [dict(id=e['id'],title=e['title'],date=e['date'],source=e['source']) for e in events
                if e['id'] != row['id'] and e.get('precision') == 'time' and 0 <= timestamp(e['date']).timestamp()-t <= 86400]
    series = sorted({r['series_key'] for r in rows})
    if series_filter: rows = [r for r in rows if r['series_key']==series_filter]
    rows = [r for r in rows if surprise=='all' or
        (surprise=='unscored' and r['score'] is None) or
        (r['score'] is not None and (surprise=='above' and r['score']>.5 or surprise=='below' and r['score']<-.5 or surprise=='neutral' and abs(r['score'])<=.5))]
    for row in rows: row['label'] = reaction_label(row['returns']['5']['value'] if horizon != 5 else None,row['returns'][str(horizon)]['value'],band)
    selected = next((r for r in rows if r['id']==event_id),None)
    if event_id and selected is None: raise KeyError('Release not found in captured history')
    if selected is None: selected = next((r for r in rows if r['returns'][str(horizon)]['value'] is not None),rows[0] if rows else None)
    return dict(symbol=symbol,assets=[dict(symbol=k,label=v) for k,v in ASSETS.items()],rows=rows,
        series=series,horizon=horizon,band=band,summary=summary(rows,horizon,band),
        selected_id=selected['id'] if selected else None,path=replay(selected,index,as_of),generated_at=now(),
        price_source={**status,'provider':'Yahoo Finance / yfinance','interval':'5m','prepost':True,
            'first_bar':datetime.fromtimestamp(index.times[0],timezone.utc).isoformat() if index.times else None,
            'last_bar':datetime.fromtimestamp(index.times[-1],timezone.utc).isoformat() if index.times else None},
        methodology='Completed 5m close before release; horizon close at or before target (<5m lag); simple price returns; +1d = 24 wall-clock hours; no filling across closures; no causal attribution')

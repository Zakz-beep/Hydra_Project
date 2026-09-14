"""Per-release consensus surprises. No inferred actuals, pooling or market-return claims."""
import csv
import io
import json
import math
import re
import statistics
from bisect import bisect_left
from datetime import datetime, timezone
from urllib.parse import urlparse
from macro_sources import connect, LOCK, digest, now


def numeric(raw, unit=None):
    if raw is None or isinstance(raw, bool): return None
    text=str(raw).strip().replace('\u2212','-')
    match=re.fullmatch(r'([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+-]?\.\d+)\s*(%|K|M|B|bps)?',text,re.I)
    if not match: return None
    value=float(match[1].replace(',','')); suffix=(match[2] or '').lower()
    declared=(unit or '').strip().lower()
    if suffix=='%': kind='percent'
    elif suffix=='bps': kind='bps'
    elif suffix in ('k','m','b'):
        kind='count'; value*=dict(k=1e3,m=1e6,b=1e9)[suffix]
    elif declared=='thousands': kind='count'; value*=1e3
    elif '%' in declared or declared=='percent': kind='percent'
    else: kind=declared or 'number'
    if not math.isfinite(value) or abs(value)>1e15: return None
    return value,kind


def timestamp(value):
    dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    if dt.tzinfo is None: raise ValueError('Release date must include time and UTC offset')
    return dt.astimezone(timezone.utc)


def classify(score, neutral):
    if score is None: return 'Unscored'
    if abs(score)<=neutral: return 'Neutral'
    return 'Above expectations' if score>0 else 'Below expectations'


def calculate(events, window=36, neutral=.5, as_of=None):
    cutoff=timestamp(as_of) if as_of else datetime.now(timezone.utc)
    rows=[]
    for event in events:
        if event.get('impact') != 'High' or event.get('currency','USD')!='USD': continue
        row={**event, 'surprise':None,'score':None,'centered_z':None,'history_n':0,'history_mean':None,'history_sd':None,
             'status':'Missing actual / consensus', 'classification':'Unscored','magnitude':None,'actual_number':None,'forecast_number':None,'surprise_unit':None}
        try:
            date=timestamp(event['date']) if event.get('precision')=='time' else None
        except (ValueError,TypeError): date=None
        if date is None:
            row['status']='Release time unknown';rows.append(row);continue
        if date>cutoff: continue
        actual=numeric(event.get('actual'),event.get('unit')); expected=numeric(event.get('forecast'),event.get('unit'))
        if actual is None or expected is None:
            if event.get('actual') is not None and event.get('forecast') is not None: row['status']='Unsupported numeric values'
            rows.append(row);continue
        if actual[1]!=expected[1]: row['status']='Unit mismatch';rows.append(row);continue
        series=re.sub(r'\s+',' ',event.get('series',event['title']).lower()).strip()
        # Exact event definition/source/unit buckets; never pool CPI y/y with m/m or release vintages.
        group=(event['source'],series,actual[1],(event.get('unit') or '').lower().strip())
        difference=actual[0]-expected[0]
        if not math.isfinite(difference): row['status']='Numeric range exceeded';rows.append(row);continue
        row.update(surprise=difference,actual_number=actual[0],forecast_number=expected[0],surprise_unit='pp' if actual[1]=='percent' else actual[1],_group=group,_date=date)
        rows.append(row)
    valid=[r for r in rows if r['surprise'] is not None]
    groups={}
    for row in valid: groups.setdefault(row['_group'],[]).append(row)
    for group in groups.values(): group.sort(key=lambda r:r['_date'])
    dates={key:[r['_date'] for r in group] for key,group in groups.items()}
    for row in valid:
        # Equal timestamps cannot train each other. Current/future observations are excluded.
        end=bisect_left(dates[row['_group']],row['_date'])
        prior=groups[row['_group']][max(0,end-window):end]
        values=[r['surprise'] for r in prior]; row['history_n']=len(values)
        if len(values)<12: row['status']='Insufficient history (need 12 prior releases)';continue
        mean=statistics.mean(values); sd=statistics.stdev(values)
        row.update(history_mean=mean,history_sd=sd)
        if not math.isfinite(sd) or sd<=max(1e-12,abs(mean)*1e-12): row['status']='Historical variance is zero';continue
        score=row['surprise']/sd; centered=(row['surprise']-mean)/sd
        if not math.isfinite(score) or not math.isfinite(centered): row['status']='Numeric range exceeded';continue
        row.update(score=score,centered_z=centered,status='Scored',classification=classify(score,neutral),
                   magnitude='Neutral' if abs(score)<=neutral else 'Extreme' if abs(score)>=2 else 'Large' if abs(score)>=1 else 'Modest')
    for row in rows:row.pop('_group',None);row.pop('_date',None)
    rows.sort(key=lambda r:r['date'],reverse=True)
    return dict(rows=rows,window=window,neutral=neutral,min_history=12,generated_at=now(),
                paired=sum(r['surprise'] is not None for r in rows),scored=sum(r['score'] is not None for r in rows),
                methodology='surprise=(actual-consensus); score=surprise/sample_sd(prior surprises); centered_z=(surprise-prior_mean)/prior_sd',
                vintage='Descriptive latest captured/imported pairs; not a first-release vintage-correct backtest')


def init_imports(db):
    db.execute('CREATE TABLE IF NOT EXISTS surprise_imports(id TEXT, captured_at TEXT, payload TEXT, PRIMARY KEY(id,captured_at))')


def read_pairs():
    with LOCK,connect() as db:
        init_imports(db)
        events=[{**json.loads(r['payload']), 'provenance':'Provider snapshot', 'captured_at':r['last_seen']} for r in db.execute('SELECT * FROM events')]
        latest={}
        for r in db.execute('SELECT * FROM surprise_imports ORDER BY captured_at'):
            latest[r['id']]={**json.loads(r['payload']),'captured_at':r['captured_at']}
    return events+list(latest.values())


def import_csv(text, save=False):
    if len(text.encode('utf-8'))>1_000_000: raise ValueError('CSV exceeds 1 MB')
    reader=csv.DictReader(io.StringIO(text.lstrip('\ufeff')))
    required={'series','date','actual','forecast','unit','source_url'}
    if not reader.fieldnames or not required<=set(reader.fieldnames): raise ValueError('Required columns: '+', '.join(sorted(required)))
    rows=[]; seen=set(); stamp=now()
    for i,item in enumerate(reader,2):
        if i>1001: raise ValueError('Maximum 1000 rows per import')
        series=(item.get('series') or '').strip(); unit=(item.get('unit') or '').strip().lower(); url=(item.get('source_url') or '').strip()
        if not series or len(series)>150: raise ValueError(f'Row {i}: supply a stable series name (max 150 characters)')
        if unit not in ('percent','thousands','count','index','number','bps'): raise ValueError(f'Row {i}: invalid unit')
        parsed=urlparse(url)
        if parsed.scheme!='https' or not parsed.hostname or len(url)>1000: raise ValueError(f'Row {i}: source_url must be HTTPS')
        if item.get('currency','USD')!='USD' or item.get('impact','High')!='High': raise ValueError(f'Row {i}: only USD High impact supported')
        try: date=timestamp(item.get('date','')).isoformat()
        except (ValueError,TypeError): raise ValueError(f'Row {i}: date requires ISO time and UTC offset')
        if timestamp(date)>timestamp(stamp): raise ValueError(f'Row {i}: actual cannot be imported for a future release')
        actual=numeric(item.get('actual'),unit); expected=numeric(item.get('forecast'),unit)
        if actual is None or expected is None or actual[1]!=expected[1]: raise ValueError(f'Row {i}: actual/forecast must be numeric and use compatible units')
        expected_kind={'thousands':'count','percent':'percent'}.get(unit,unit)
        if actual[1]!=expected_kind: raise ValueError(f'Row {i}: values conflict with declared unit')
        if max(abs(actual[0]),abs(expected[0]))>1e15: raise ValueError(f'Row {i}: magnitude is out of range')
        provider=f'Imported · {parsed.hostname.lower()}'
        key=digest(provider+'|'+re.sub(r'\s+',' ',series.lower())+'|'+date+'|'+unit)
        if key in seen: raise ValueError(f'Row {i}: duplicate series/date/unit')
        seen.add(key)
        rows.append(dict(id=key,title=series,series=series,date=date,precision='time',source=provider,url=url,category='Imported',
                         impact='High',currency='USD',unit=unit,actual=item['actual'].strip(),forecast=item['forecast'].strip(),provenance='User-imported · unverified vintage'))
    if not rows: raise ValueError('CSV contains no release rows')
    if save:
        with LOCK,connect() as db:
            init_imports(db)
            for row in rows:
                payload=json.dumps(row,sort_keys=True)
                old=db.execute('SELECT payload FROM surprise_imports WHERE id=? ORDER BY captured_at DESC LIMIT 1',(row['id'],)).fetchone()
                if not old or old['payload']!=payload: db.execute('INSERT INTO surprise_imports VALUES(?,?,?)',(row['id'],stamp,payload))
    return dict(count=len(rows),saved=save,preview=rows[:5])

"""Public-source scrapers with bounded requests, SQLite cache and observed revision history."""
from __future__ import annotations
import hashlib
import json
import re
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo
import httpx
from bs4 import BeautifulSoup

DB = Path(__file__).resolve().parent / 'data' / 'macro.db'
LOCK = threading.RLock()
NY = ZoneInfo('America/New_York')
FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
BEA = 'https://www.bea.gov/news/schedule/full'
FED = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
FEEDS = {'BEA': 'https://apps.bea.gov/rss/rss.xml', 'Federal Reserve': 'https://www.federalreserve.gov/feeds/press_monetary.xml'}


def now(): return datetime.now(timezone.utc).isoformat()
def digest(value): return hashlib.sha256(value.encode()).hexdigest()[:24]


@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript('''
      CREATE TABLE IF NOT EXISTS documents(url TEXT PRIMARY KEY, body TEXT, fetched_at TEXT, attempted REAL, error TEXT);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, payload TEXT, first_seen TEXT, last_seen TEXT);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT, observed_at TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS forecasts(id TEXT PRIMARY KEY, created_at TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS headlines(id TEXT PRIMARY KEY, payload TEXT);
    ''')
    try:
        with db:
            yield db
    finally:
        db.close()


DOCUMENT_LOCKS={}

def document(url, ttl=3600, force=False):
    with LOCK:
        guard=DOCUMENT_LOCKS.setdefault(url,threading.Lock())
    with guard:
        return _document(url,ttl,force)


def download(url):
    # Retry a transient connection/read failure once; do not retry HTTP 403/429.
    with httpx.Client(timeout=httpx.Timeout(20,connect=10), follow_redirects=True) as client:
        for attempt in range(2):
            try:
                with client.stream('GET',url) as response:
                    response.raise_for_status()
                    chunks=[]; size=0
                    for part in response.iter_bytes():
                        size+=len(part)
                        if size>4_000_000: raise ValueError('Source response exceeds 4 MB')
                        chunks.append(part)
                    return b''.join(chunks).decode('utf-8-sig',errors='replace')
            except httpx.TransportError:
                if attempt: raise


def _document(url, ttl, force):
    with LOCK, connect() as db:
        old = db.execute('SELECT * FROM documents WHERE url=?', (url,)).fetchone()
    cache_seconds=30 if force else (300 if old and old['error'] else ttl)
    if old and time.time()-old['attempted'] < cache_seconds:
        if not old['body']: raise ValueError(old['error'])
        return old['body'], dict(url=url, fetched_at=old['fetched_at'], stale=bool(old['error']), error=old['error'])
    try:
        body=download(url)
        stamp=now()
        with LOCK, connect() as db:
            db.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)', (url, body, stamp, time.time(), None))
        return body, dict(url=url, fetched_at=stamp, stale=False, error=None)
    except Exception as exc:
        message = f'{type(exc).__name__}: {str(exc)[:220]}'
        with LOCK, connect() as db:
            db.execute('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)',
                       (url, old['body'] if old else None, old['fetched_at'] if old else None, time.time(), message))
        if old and old['body']:
            return old['body'], dict(url=url, fetched_at=old['fetched_at'], stale=True, error=message)
        raise ValueError(message) from exc


def safe_url(url):
    return url if urlparse(url).scheme == 'https' else None


def category(title):
    t=title.lower()
    if any(s in t for s in ['cpi', 'inflation', 'ppi', 'price index', 'personal income', 'pce']): return 'Inflation'
    if any(s in t for s in ['payroll', 'employment', 'job', 'unemployment', 'earnings']): return 'Labor'
    if any(s in t for s in ['fomc', 'federal open market', 'federal funds', 'discount rate', 'powell', 'monetary']): return 'Policy'
    return 'Growth'


def event(title, date, source, url, precision='time', **kwargs):
    return dict(id=digest(source+'|'+(url if source != 'Forex Factory' else title+'|'+date)),
                title=title, date=date, precision=precision, source=source, url=safe_url(url),
                category=category(title), impact='High', impact_basis='provider' if source=='Forex Factory' else 'curated major USD release',
                actual=None, forecast=None, previous=None, unit=None, **kwargs)


def parse_ff(body):
    data=json.loads(body)
    if not isinstance(data, list): raise ValueError('Calendar response is not a list')
    rows=[]
    for item in data:
        if item.get('country') != 'USD' or item.get('impact') != 'High': continue
        dt=datetime.fromisoformat(item['date'])
        if dt.tzinfo is None: raise ValueError('Calendar timestamp has no timezone')
        row=event(item['title'], dt.astimezone(timezone.utc).isoformat(), 'Forex Factory', 'https://www.forexfactory.com/calendar')
        # Weekly export may omit actual entirely. Never substitute previous or forecast.
        row.update({key: str(item[key]).strip() if item.get(key) is not None and str(item[key]).strip() else None for key in ('actual','forecast','previous')})
        rows.append(row)
    return rows


def parse_bea(body):
    soup=BeautifulSoup(body, 'html.parser'); rows=[]
    for table in soup.select('table'):
        match=re.search(r'Year\s+(20\d{2})', table.get_text(' ', strip=True))
        if not match: continue
        year=match[1]
        for tr in table.select('tr'):
            title=tr.select_one('.release-title'); day=tr.select_one('.release-date'); clock=tr.select_one('.scheduled-date small')
            if not title or not day: continue
            name=title.get_text(' ', strip=True)
            if not (name.startswith('Gross Domestic Product,') or name.startswith('Personal Income and Outlays') or name.startswith('GDP (')): continue
            dt=datetime.strptime(f'{day.get_text(strip=True)} {year} '+(clock.get_text(strip=True) if clock else '12:00 AM'), '%B %d %Y %I:%M %p').replace(tzinfo=NY)
            a=tr.select_one('a[href]'); url=urljoin(BEA, a['href']) if a else BEA+'#'+dt.date().isoformat()+'-'+digest(name)
            rows.append(event(name, dt.astimezone(timezone.utc).isoformat() if clock else dt.date().isoformat(), 'BEA', url, 'time' if clock else 'date'))
    if not rows: raise ValueError('BEA calendar schema changed or no major releases found')
    return rows


def parse_fed_archive(body):
    soup=BeautifulSoup(body, 'html.parser'); rows={}
    for a in soup.select('a[href]'):
        match=re.search(r'/newsevents/pressreleases/monetary(20\d{6})a\.htm$', a['href'])
        if not match: continue
        date=datetime.strptime(match[1], '%Y%m%d').date().isoformat()
        if int(date[:4]) < datetime.now().year-6: continue
        row=event('FOMC statement', date, 'Federal Reserve', urljoin(FED,a['href']), 'date')
        rows[row['id']]=row
    if not rows: raise ValueError('No FOMC statement archive links found')
    return list(rows.values())


def parse_bls_archive(body, product):
    rows=[]; soup=BeautifulSoup(body,'html.parser')
    for a in soup.select('a[href]'):
        match=re.search(r'/archives/'+product+r'_(\d{8})\.htm$', a['href'])
        if not match: continue
        date=datetime.strptime(match[1], '%m%d%Y').date().isoformat()
        if int(date[:4]) < datetime.now().year-6: continue
        rows.append(event(a.get_text(' ',strip=True),date,'BLS',urljoin('https://www.bls.gov',a['href']),'date'))
    if not rows: raise ValueError('No BLS archive links found')
    return rows


def parse_feed(body, source):
    if '<!DOCTYPE' in body.upper() or '<!ENTITY' in body.upper(): raise ValueError('Unexpected XML declaration')
    root=ET.fromstring(body.lstrip('\ufeff')); news=[]; events=[]
    for node in root.findall('.//item')[:100]:
        title=node.findtext('title','').strip(); url=safe_url(node.findtext('link','').strip())
        if not title or not url: continue
        try: dt=parsedate_to_datetime(node.findtext('pubDate','')).astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError): continue
        news.append(dict(id=digest(url), title=title, url=url, date=dt, source=source, category=category(title)))
        national_gdp=bool(re.match(r'^(Gross Domestic Product[, (]|GDP \()',title)) and 'by State' not in title
        major=(source=='BEA' and (national_gdp or title.startswith('Personal Income and Outlays'))) or (source=='Federal Reserve' and ('FOMC statement' in title or 'Minutes of the Federal Open Market Committee' in title))
        if major:
            row=event(title,dt,source,url)
            # BEA main field for income reports is PERSONAL INCOME, not PCE inflation.
            if national_gdp:
                value=node.findtext('data/main/current/percentChange')
                row.update(actual=value.strip() if value else None, unit='q/q annualized %')
            events.append(row)
    if not news: raise ValueError('RSS feed contains no recognized items')
    return news, events


def save_events(rows):
    stamp=now()
    with LOCK, connect() as db:
        for row in rows:
            old=db.execute('SELECT * FROM events WHERE id=?',(row['id'],)).fetchone()
            if old:
                prior=json.loads(old['payload'])
                # A schedule/date-only archive must not erase a richer RSS observation.
                if row['precision']=='date' and prior['precision']=='time': row={**row,'date':prior['date'],'precision':'time'}
                for field in ('actual','forecast','previous','unit'):
                    if row[field] is None: row[field]=prior.get(field)
            payload=json.dumps(row,sort_keys=True)
            if not old or old['payload'] != payload:
                db.execute('INSERT INTO revisions VALUES(?,?,?)',(row['id'],stamp,payload))
            db.execute('INSERT OR REPLACE INTO events VALUES(?,?,?,?)',(row['id'],payload,old['first_seen'] if old else stamp,stamp))


SYNC_LOCK=threading.Lock()
SUMMARY=None
SYNC_TIME=0.


def dashboard():
    global SUMMARY,SYNC_TIME
    with SYNC_LOCK:
        if SUMMARY and time.monotonic()-SYNC_TIME<300: return SUMMARY
        jobs=[('Forex Factory',FF,parse_ff),('BEA schedule',BEA,parse_bea),('FOMC archive',FED,parse_fed_archive)]
        jobs += [(f'BLS {p} archive',f'https://www.bls.gov/bls/news-release/{p}.htm',lambda body,p=p:parse_bls_archive(body,p)) for p in ('cpi','empsit')]
        jobs += [(name,url,None) for name,url in FEEDS.items()]
        def run(job):
            name,url,parser=job
            try:
                body,status=document(url,3600 if url==FF or parser is None else 86400)
                news,rows=([],parser(body)) if parser else parse_feed(body,name)
                save_events(rows)
                return news,dict(name=name,count=len(rows),**status)
            except Exception as exc: return [],dict(name=name,url=url,error=str(exc)[:260],stale=True,fetched_at=None,count=0)
        news=[]; statuses=[]
        with ThreadPoolExecutor(max_workers=3) as pool:
            for articles,status in pool.map(run,jobs):news.extend(articles);statuses.append(status)
        with LOCK,connect() as db:
            for article in news:
                db.execute('INSERT OR REPLACE INTO headlines VALUES(?,?)',(article['id'],json.dumps(article)))
            news=[json.loads(r['payload']) for r in db.execute('SELECT payload FROM headlines')]
            rows=[{**json.loads(r['payload']),'first_seen':r['first_seen'],'last_seen':r['last_seen']} for r in db.execute('SELECT * FROM events')]
        SUMMARY=dict(events=sorted(rows,key=lambda x:x['date'],reverse=True), news=sorted(news,key=lambda x:x['date'],reverse=True),sources=statuses,generated_at=now())
        SYNC_TIME=time.monotonic()
        return SUMMARY

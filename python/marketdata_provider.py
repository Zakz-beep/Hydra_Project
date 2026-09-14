"""MarketData EOD adapter. Fixed host, server-only bearer token, no redirects."""
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import math
import os
import re
import threading
import time
import requests

NY = ZoneInfo('America/New_York')
_pace = threading.Lock()
_last = 0.

class HistoryError(RuntimeError):
    def __init__(self, message, status=502, code=None, latest_available=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.latest_available = latest_available


def payment_error(body, path):
    # Extract only a validated date from the documented entitlement response.
    # Never forward arbitrary provider text, links, credentials or account details.
    message=' '.join(str(body.get(k,'')) for k in ('errmsg','error','message')) if isinstance(body,dict) else ''
    match=re.search(r'latest available is (\d{4}-\d{2}-\d{2})(?!\d)',message,re.I)
    latest=None
    if match:
        try: latest=date.fromisoformat(match[1]).isoformat()
        except ValueError: pass
    if latest:
        note=(' Quotes options menjadi historical setelah pembukaan sesi bursa berikutnya; penutupan Jumat bisa belum tersedia sepanjang akhir pekan.'
              if path.startswith('options/') else '')
        return HistoryError(f'MarketData HTTP 402: batas freshness paket. Tanggal terbaru yang tersedia: {latest}.{note} Ubah tanggal Sampai ke tanggal tersebut. Arsip yang sudah tersimpan tetap tersedia.',402,'history_freshness',latest)
    return HistoryError('MarketData HTTP 402: data atau fitur yang diminta belum termasuk akses paket akun. Periksa batas umur history dan entitlement di akun MarketData. Ini berbeda dari token salah (401) atau limit kredit (429). Arsip yang sudah tersimpan tetap tersedia.',402,'plan_entitlement')

def token():
    value = os.environ.get('MARKETDATA_API_TOKEN', '')
    if not value:
        path = Path(__file__).with_name('.env.marketdata')
        if path.exists():
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                key, sep, candidate = line.partition('=')
                if sep and key.strip() == 'MARKETDATA_API_TOKEN':
                    value = candidate.strip().strip('\"\'')
    return value.strip()

def provider_status():
    return dict(provider='marketdata.app', configured=bool(token()), config_file='python/.env.marketdata',
                resolution='EOD', greeks='locally reconstructed; historical provider Greeks unavailable')

def number(value):
    if isinstance(value, bool): return None
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError): return None

def instant(value):
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, timezone.utc)
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt.astimezone(timezone.utc) if dt.tzinfo else None
    except (ValueError, TypeError, OverflowError, OSError): return None

def columns(body, names, anchor):
    if body.get('s') == 'no_data': return []
    if body.get('s') != 'ok' or not isinstance(body.get(anchor), list):
        raise HistoryError('MarketData returned an invalid data envelope.')
    size = len(body[anchor])
    if size > 50000: raise HistoryError('Response exceeds the supported contract limit.')
    for name in names:
        if not isinstance(body.get(name), list) or len(body[name]) != size:
            raise HistoryError(f'MarketData column {name} is missing or misaligned.')
    return [{k: body[k][i] for k in names} for i in range(size)]

class MarketDataProvider:
    def __init__(self, session=None, api_token=None):
        credential = token() if api_token is None else api_token
        if not credential:
            raise HistoryError('Isi MARKETDATA_API_TOKEN di python/.env.marketdata, lalu refresh konfigurasi.', 503)
        self.session = session or requests.Session()
        self.session.headers.update({'Authorization': f'Bearer {credential}', 'Accept': 'application/json'})
        self.requests = 0

    def get(self, path, params):
        global _last
        with _pace:
            time.sleep(max(0, .4 - (time.monotonic() - _last)))
            _last = time.monotonic()
        # No automatic retries: even ambiguous network errors may consume account credits.
        try:
            self.requests += 1
            r = self.session.get('https://api.marketdata.app/v1/' + path, params={**params, 'dateformat':'unix'},
                                 timeout=(5, 30), allow_redirects=False)
        except requests.RequestException:
            raise HistoryError('MarketData network request failed. Retry the import to resume cached dates.') from None
        if r.status_code in (401, 403):
            raise HistoryError('MarketData access denied: check token, plan history limit and entitlement.', 503)
        if r.status_code == 429:
            raise HistoryError('MarketData credit/rate limit reached. Import stopped; saved dates are retained.', 429)
        if r.status_code == 402:
            try: body=r.json()
            except ValueError: body={}
            raise payment_error(body,path)
        if 300 <= r.status_code < 400: raise HistoryError('MarketData redirect rejected; token was not forwarded.')
        try: body = r.json()
        except ValueError: raise HistoryError('MarketData returned invalid JSON.') from None
        if r.status_code == 404 and isinstance(body, dict) and body.get('s') == 'no_data': return body
        if r.status_code not in (200,203) or not isinstance(body, dict) or body.get('s') not in ('ok','no_data'):
            raise HistoryError(f'MarketData request failed (HTTP {r.status_code}); raw provider errors are withheld.')
        if body.get('next_page_token') or body.get('nextPageToken'):
            raise HistoryError('Unexpected paginated response; partial chains are not accepted.')
        return body

    def chain(self, ticker, day, max_dte):
        # Explicit all + date range: omitted expiration would select only the next monthly expiry.
        return self.get(f'options/chain/{ticker}/', {'date':day, 'expiration':'all', 'from':day,
            'to':(date.fromisoformat(day)+timedelta(days=max_dte)).isoformat(), 'nonstandard':'false'})

    def candles(self, ticker, start, end):
        return self.get(f'stocks/candles/D/{ticker}/', {'from':start,'to':end,
            'adjustsplits':'false','adjustdividends':'false','extended':'false'})

CHAIN_COLUMNS = ('optionSymbol','underlying','expiration','side','strike','bid','ask','openInterest','volume','underlyingPrice','updated')

def chain_rows(body):
    return columns(body, CHAIN_COLUMNS, 'optionSymbol')

def candle_rows(body):
    result = {}
    for r in columns(body, ('t','o','h','l','c','v'), 't'):
        stamp = instant(r['t'])
        vals = {k:number(r[k]) for k in ('o','h','l','c','v')}
        if stamp is None or any(vals[k] is None or vals[k]<=0 for k in ('o','h','l','c')): continue
        if not vals['l'] <= min(vals['o'],vals['c']) <= max(vals['o'],vals['c']) <= vals['h']: continue
        day = stamp.astimezone(NY).date().isoformat()
        if day in result: raise HistoryError('Duplicate daily candles; ambiguous session prices.')
        result[day] = {'date':day, **vals}
    return result

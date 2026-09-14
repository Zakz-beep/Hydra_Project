"""Read-only Alpaca options adapter. No orders, silent feed changes or synthetic fallback."""
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
import math
import os
import re
import threading
import time
import requests
import pandas as pd

NY = ZoneInfo('America/New_York')
DATA_URL = 'https://data.alpaca.markets'
_pace_lock = threading.Lock()
_last_request = 0.0


class OptionsDataError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def settings():
    # Dedicated local file; deliberately no shell interpolation or executable config.
    values = {}
    path = Path(__file__).with_name('.env.alpaca')
    if path.is_file():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip().startswith(('APCA_', 'ALPACA_')):
                values[key.strip()] = value.strip().strip('\"\'')
    values.update({k: v for k, v in os.environ.items() if k.startswith(('APCA_', 'ALPACA_'))})
    return values


def provider_status():
    config = settings()
    return {'provider': 'alpaca', 'feed': config.get('ALPACA_OPTIONS_FEED', 'indicative'),
            'stock_feed': config.get('ALPACA_STOCK_FEED', 'iex'),
            'credentials_configured': bool(config.get('APCA_API_KEY_ID') and config.get('APCA_API_SECRET_KEY')),
            'account_environment': config.get('ALPACA_ACCOUNT_ENV', 'paper'),
            'config_file': 'python/.env.alpaca', 'orders_enabled': False}


def finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def timestamp(value):
    try:
        result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError):
        return None


class AlpacaOptionsProvider:
    def __init__(self, session=None, config=None):
        config = settings() if config is None else config
        self.feed = config.get('ALPACA_OPTIONS_FEED', 'indicative')
        self.stock_feed = config.get('ALPACA_STOCK_FEED', 'iex')
        environment = config.get('ALPACA_ACCOUNT_ENV', 'paper')
        if self.feed not in ('indicative', 'opra') or self.stock_feed not in ('iex', 'sip') or environment not in ('paper', 'live'):
            raise OptionsDataError('Invalid Alpaca feed/account settings. See docs/alpaca-options-migration.md.', 503)
        self.trading_url = 'https://paper-api.alpaca.markets' if environment == 'paper' else 'https://api.alpaca.markets'
        key, secret = config.get('APCA_API_KEY_ID'), config.get('APCA_API_SECRET_KEY')
        if not key or not secret:
            raise OptionsDataError('Alpaca belum dikonfigurasi. Isi APCA_API_KEY_ID dan APCA_API_SECRET_KEY di python/.env.alpaca, lalu Refresh source. Jangan kirim secret ke chat.', 503)
        self.session = session or requests.Session()
        self.session.headers.update({'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret})
        self._contracts_cache = None

    def _get(self, base, path, params, deadline):
        global _last_request
        for attempt in range(3):
            if time.monotonic() >= deadline:
                raise OptionsDataError('Alpaca request exceeded the bounded fetch time. Retry later.')
            with _pace_lock:
                time.sleep(max(0, .35 - (time.monotonic() - _last_request)))
                _last_request = time.monotonic()
            try:
                response = self.session.get(base + path, params=params, timeout=(5, min(15, max(1, deadline-time.monotonic()))), allow_redirects=False)
            except requests.RequestException:
                if attempt < 2:
                    time.sleep(.5 * (attempt+1))
                    continue
                raise OptionsDataError('Alpaca network request failed. Credentials and response bodies are not logged.') from None
            if response.status_code == 200:
                try:
                    body = response.json()
                    if isinstance(body, dict): return body
                except ValueError:
                    pass
                raise OptionsDataError('Alpaca returned an invalid JSON object.')
            if response.status_code in (401, 403):
                raise OptionsDataError(f'Alpaca {response.status_code}: periksa API key, paper/live environment dan entitlement feed {self.feed}. Feed tidak diturunkan otomatis.', 503)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 2:
                    retry = finite(response.headers.get('Retry-After'))
                    if retry is not None and retry > 5:
                        raise OptionsDataError('Alpaca rate limit. Wait before refreshing.', 429)
                    time.sleep(max(.5, retry or attempt+1))
                    continue
            raise OptionsDataError(f'Alpaca returned HTTP {response.status_code}. Check symbol, entitlement or retry later.', 429 if response.status_code == 429 else 502)

    def _pages(self, base, path, params, field, deadline):
        result, seen = [], set()
        params = dict(params)
        for _ in range(100):
            body = self._get(base, path, params, deadline)
            if field not in body or not isinstance(body[field], (list, dict)):
                raise OptionsDataError(f'Alpaca response is missing {field}.')
            result.append(body[field])
            token = body.get('next_page_token')
            if not token: return result
            if token in seen: raise OptionsDataError('Repeated Alpaca pagination token; incomplete chain rejected.')
            seen.add(token); params['page_token'] = token
        raise OptionsDataError('Alpaca pagination safety limit reached; incomplete chain rejected.')

    def load(self, symbol):
        symbol = symbol.strip().upper()
        if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,14}', symbol):
            raise OptionsDataError('Alpaca options membutuhkan underlying saham/ETF AS. Gunakan SPY/QQQ, bukan ^GSPC/^NDX; ETF bukan kontrak index yang sama.', 422)
        now = datetime.now(timezone.utc)
        today = now.astimezone(NY).date()
        end_date = today + timedelta(days=45)
        deadline = time.monotonic() + 80
        stock = self._get(DATA_URL, f'/v2/stocks/{symbol}/snapshot', {'feed': self.stock_feed}, deadline)
        spot, spot_time, spot_basis = None, None, None
        for key, price_field in [('latestTrade', 'p'), ('dailyBar', 'c'), ('prevDailyBar', 'c')]:
            item = stock.get(key) or {}
            price, stamp = finite(item.get(price_field)), timestamp(item.get('t'))
            if price and price > 0 and stamp and stamp <= now + timedelta(minutes=1):
                spot, spot_time, spot_basis = price, stamp.isoformat(), key
                break
        if spot is None: raise OptionsDataError('Alpaca underlying price/timestamp unavailable. No synthetic spot is substituted.')
        filters = {'underlying_symbols': symbol, 'status': 'active', 'expiration_date_gte': str(today), 'expiration_date_lte': str(end_date), 'limit': 10000}
        cache_key = (symbol, str(today), str(end_date))
        if self._contracts_cache and self._contracts_cache[0] == cache_key and time.monotonic()-self._contracts_cache[1] < 900:
            contracts, contracts_captured = self._contracts_cache[2:]
        else:
            pages = self._pages(self.trading_url, '/v2/options/contracts', filters, 'option_contracts', deadline)
            contracts = {c['symbol']: c for page in pages for c in page if c.get('symbol')}
            contracts_captured = datetime.now(timezone.utc).isoformat()
            self._contracts_cache = (cache_key, time.monotonic(), contracts, contracts_captured)
        if not contracts: raise OptionsDataError(f'No Alpaca contracts for {symbol} within 0–45 calendar days.', 404)
        pages = self._pages(DATA_URL, f'/v1beta1/options/snapshots/{symbol}',
            {'feed': self.feed, 'expiration_date_gte': str(today), 'expiration_date_lte': str(end_date), 'limit': 1000}, 'snapshots', deadline)
        snapshots = {k: v for page in pages for k, v in page.items()}
        rows, excluded = [], Counter()
        for contract_symbol, c in contracts.items():
            snap = snapshots.get(contract_symbol)
            # Current exposure model assumes standard 100-share deliverables only.
            if finite(c.get('size')) != 100 or c.get('root_symbol') != symbol:
                excluded['nonstandard_contract'] += 1; continue
            oi, strike = finite(c.get('open_interest')), finite(c.get('strike_price'))
            oi_date = c.get('open_interest_date')
            try:
                oi_day = datetime.strptime(oi_date, '%Y-%m-%d').date()
                expiry = datetime.strptime(c['expiration_date'], '%Y-%m-%d').date()
            except (TypeError, ValueError, KeyError):
                excluded['missing_date'] += 1; continue
            if not today <= expiry <= end_date or oi_day > today or (today-oi_day).days > 7:
                excluded['outdated_or_invalid_date'] += 1; continue
            if expiry == today and now.astimezone(NY).hour >= 16:
                excluded['expiry_at_or_after_standard_close'] += 1; continue
            if oi is None or oi < 10 or not oi.is_integer() or strike is None or strike <= 0:
                excluded['missing_or_low_oi'] += 1; continue
            if not isinstance(snap, dict): excluded['missing_snapshot'] += 1; continue
            q = snap.get('latestQuote') or {}
            bid, ask, qt = finite(q.get('bp')), finite(q.get('ap')), timestamp(q.get('t'))
            if bid is None or ask is None or bid <= 0 or ask < bid or qt is None or qt > now+timedelta(minutes=1) or now-qt > timedelta(days=7):
                excluded['invalid_or_old_quote'] += 1; continue
            iv = finite(snap.get('impliedVolatility'))
            if iv is None or not .01 <= iv <= 5:
                excluded['missing_iv'] += 1; continue
            if c.get('type') not in ('call', 'put'): excluded['invalid_type'] += 1; continue
            rows.append({'contract_symbol': contract_symbol, 'strike': strike, 'openinterest': int(oi), 'volume': None,
                'bid': bid, 'ask': ask, 'lastprice': (bid+ask)/2, 'impliedvolatility': iv,
                'expiry': str(expiry), 'option_type': c['type'], 'oi_date': oi_date,
                'quote_timestamp': qt.isoformat(), 'trade_timestamp': (snap.get('latestTrade') or {}).get('t'),
                'provider_greeks': {k: finite(v) for k,v in (snap.get('greeks') or {}).items() if k in ('delta','gamma','theta','vega','rho')},
                'contract_size': 100})
        if not rows: raise OptionsDataError('Tidak ada kontrak Alpaca dengan OI bertanggal, IV dan quote valid. Coverage kosong tidak dijadikan exposure nol.')
        # Volume is fetched in batches, independently of the latest-trade size.
        volume_warnings = []
        volume_date = max(timestamp(row['quote_timestamp']).astimezone(NY).date() for row in rows)
        volume_start = datetime.combine(volume_date, datetime.min.time(), NY).astimezone(timezone.utc)
        volume_next_day = datetime.combine(volume_date+timedelta(days=1), datetime.min.time(), NY).astimezone(timezone.utc)
        volume_end = min(now-timedelta(minutes=16), volume_next_day-timedelta(microseconds=1))
        volumes = {}
        if volume_end > volume_start:
            try:
                for start in range(0, len(rows), 100):
                    symbols = [r['contract_symbol'] for r in rows[start:start+100]]
                    pages = self._pages(DATA_URL, '/v1beta1/options/bars', {'symbols': ','.join(symbols), 'timeframe': '1Day',
                        'start': volume_start.isoformat(), 'end': volume_end.isoformat(), 'limit': 10000}, 'bars', deadline)
                    for page in pages:
                        for sym, bars in page.items():
                            valid = [b for b in bars if timestamp(b.get('t')) and timestamp(b['t']).astimezone(NY).date() == volume_date and finite(b.get('v')) is not None and finite(b.get('v')) >= 0]
                            if valid: volumes[sym] = int(sum(float(b['v']) for b in valid))
            except OptionsDataError as exc:
                volume_warnings.append('Volume coverage partial/unavailable: '+str(exc))
        for row in rows: row['volume'] = volumes.get(row['contract_symbol'])
        chains = {}
        for expiry in sorted({row['expiry'] for row in rows}):
            chains[expiry] = tuple(pd.DataFrame([r for r in rows if r['expiry']==expiry and r['option_type']==kind]) for kind in ('call','put'))
        quote_dates = [r['quote_timestamp'] for r in rows]
        provenance = {'provider': 'alpaca', 'feed': self.feed, 'stock_feed': self.stock_feed,
            'retrieved_at': datetime.now(timezone.utc).isoformat(), 'contracts_retrieved_at': contracts_captured,
            'spot_timestamp': spot_time, 'spot_basis': spot_basis, 'quote_oldest': min(quote_dates), 'quote_newest': max(quote_dates),
            'oi_dates': sorted({r['oi_date'] for r in rows}), 'contract_count': len(contracts), 'snapshot_count': len(snapshots),
            'eligible_contracts': len(rows), 'excluded': dict(excluded), 'pagination_complete': True,
            'volume_date': str(volume_date), 'volume_requested_end': volume_end.isoformat(), 'volume_covered': len(volumes),
            'greeks_basis': 'Dashboard BSM from Alpaca IV; Alpaca Greeks preserved separately. Vanna/Charm locally modeled.',
            'warnings': [
                'Indicative: trades delayed and quotes modified; not executable OPRA quotes.' if self.feed=='indicative' else 'OPRA feed selected; quote timestamps still require inspection.',
                f'Underlying uses {self.stock_feed.upper()} {spot_basis}. Underlying and options observations are not synchronized.',
                'OI is dated contract metadata, not live positioning. Only standard 100-share contracts with OI >= 10, IV and a valid two-sided quote are included.',
                'Coverage is the filtered 0–45 calendar-day universe; excluded contracts are not zero exposure. Model signs are call-positive/put-negative, not observed dealer inventory.',
                'BSM assumes European exercise and zero dividend yield with the configured rate; US American options and ex-dividend effects can differ. Provider Greeks are not mixed into model exposure.',
                'The legacy model uses calendar DTE with a 0.5-day floor for 0DTE, not exact minutes to exchange expiry. Same-date contracts at/after 16:00 New York are conservatively excluded.',
                'Volume comes from Alpaca daily historical bars requested through a delayed cutoff; missing bars stay unavailable. It is not latest-trade size, sweep identification or aggressor flow.',
            ] + volume_warnings}
        return {'spot': spot, 'chains': chains, 'provenance': provenance, 'asof_date': today}

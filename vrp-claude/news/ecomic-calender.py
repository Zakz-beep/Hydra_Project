# ================================================================
#  Economic Calendar Scraper v3
#  Primary  : nfs.faireconomy.media  (FF JSON mirror, no auth)
#  Fallback  : Financial Modeling Prep (free API key)
#
#  FMP free key → https://site.financialmodelingprep.com/register
# ================================================================
# !pip install requests pandas

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


import requests
import pandas as pd

pd.set_option('display.max_colwidth', 55)
pd.set_option('display.max_rows', 80)


# ─── KONFIGURASI ────────────────────────────────────────────────

# 'thisweek' | 'nextweek' | 'lastweek' | 'today'
PERIOD = 'thisweek'

# Kosongkan [] untuk semua currency
CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD']

# Kosongkan [] untuk semua impact
IMPACTS = ['High', 'Medium']

# FMP API key — daftar gratis di https://site.financialmodelingprep.com/register
# Isi string kosong '' jika tidak pakai FMP (fallback dinonaktifkan)
FMP_API_KEY = ''

# Output
OUTPUT_DIR  = Path('output')
OUTPUT_NAME = 'econ_calendar'
OUTPUT_DIR.mkdir(exist_ok=True)


# ─── CONSTANTS ──────────────────────────────────────────────────

IMPACT_EMOJI = {'High': '🔴', 'Medium': '🟡', 'Low': '⚪', 'Holiday': '📅', 'Non-Economic': '➖', 'Unknown': '❔'}
IMPACT_COLOR = {'High': '#ef4444', 'Medium': '#f59e0b', 'Low': '#94a3b8', 'Holiday': '#60a5fa', 'Non-Economic': '#e2e8f0', 'Unknown': '#d1d5db'}

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'application/json',
}

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _period_to_dates(period: str) -> tuple[datetime, datetime]:
    now = _now()
    if period == 'today':
        s = now.replace(hour=0, minute=0, second=0, microsecond=0)
        return s, s + timedelta(hours=23, minutes=59, seconds=59)
    if period == 'nextweek':
        s = (now + timedelta(days=7 - now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        return s, s + timedelta(days=6, hours=23, minutes=59, seconds=59)
    if period == 'lastweek':
        s = (now - timedelta(days=now.weekday() + 7)).replace(hour=0, minute=0, second=0, microsecond=0)
        return s, s + timedelta(days=6, hours=23, minutes=59, seconds=59)
    # thisweek
    s = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return s, s + timedelta(days=6, hours=23, minutes=59, seconds=59)


# ─── SOURCE 1 : Faireconomy FF JSON Mirror ───────────────────────
#
#  Public JSON feed yang mirror data Forex Factory.
#  URL: https://nfs.faireconomy.media/ff_calendar_{period}.json
#  No auth, no scraping, return JSON array langsung.

class FaireconomyScraper:
    BASE = 'https://nfs.faireconomy.media/ff_calendar_{period}.json'

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def _map_period(self, period: str) -> list[str]:
        """Map period ke list of JSON feed names."""
        return {
            'thisweek': ['thisweek'],
            'nextweek': ['nextweek'],
            'lastweek': ['lastweek'],
            'today':    ['thisweek'],   # filter by date setelahnya
        }.get(period, ['thisweek'])

    def fetch(
        self,
        period:     str              = 'thisweek',
        currencies: list[str] | None = None,
        impacts:    list[str] | None = None,
    ) -> pd.DataFrame:
        feed_names = self._map_period(period)
        all_records = []

        for feed in feed_names:
            url = self.BASE.format(period=feed)
            ts  = int(_now().timestamp())           # cache-bust
            print(f'[FE]  GET {url}')

            try:
                resp = self.session.get(url, params={'version': ts}, timeout=15)
                resp.raise_for_status()
                data = resp.json()
            except requests.RequestException as e:
                print(f'[FE]  [X] Request failed: {e}')
                continue
            except json.JSONDecodeError:
                print('[FE]  [X] JSON decode failed.')
                continue

            if not isinstance(data, list):
                print(f'[FE]  [X] Unexpected response type: {type(data)}')
                continue

            for ev in data:
                # Parse datetime — FF feed pakai ISO 8601 dengan offset ET
                raw_dt = ev.get('date', '')
                try:
                    dt_et  = datetime.fromisoformat(raw_dt)           # aware
                    dt_wib = dt_et.astimezone(timezone(timedelta(hours=7)))
                    date_str = dt_wib.strftime('%a %d %b')
                    time_str = dt_wib.strftime('%H:%M') + ' WIB'
                    dt_for_filter = dt_wib
                except Exception:
                    date_str = raw_dt[:10]
                    time_str = ''
                    dt_for_filter = None

                # Filter 'today'
                if period == 'today' and dt_for_filter:
                    today_wib = _now().astimezone(timezone(timedelta(hours=7))).date()
                    if dt_for_filter.date() != today_wib:
                        continue

                all_records.append({
                    'date':     date_str,
                    'time':     time_str,
                    'currency': ev.get('country', '').upper(),
                    'impact':   ev.get('impact', 'Unknown'),
                    'event':    ev.get('title', ''),
                    'actual':   ev.get('actual',   '') or '',
                    'forecast': ev.get('forecast', '') or '',
                    'previous': ev.get('previous', '') or '',
                    'source':   'Faireconomy (FF Mirror)',
                })

        df = pd.DataFrame(all_records)
        if df.empty:
            return df

        if currencies:
            df = df[df['currency'].isin([c.upper() for c in currencies])]
        if impacts:
            df = df[df['impact'].isin(impacts)]

        print(f'[FE]  [OK] {len(df)} events fetched.')
        return df.reset_index(drop=True)


# ─── SOURCE 2 : Financial Modeling Prep (Fallback) ───────────────
#
#  Free tier: 250 req/day
#  Register : https://site.financialmodelingprep.com/register
#  Endpoint : https://financialmodelingprep.com/api/v3/economic_calendar

class FMPScraper:
    BASE = 'https://financialmodelingprep.com/api/v3/economic_calendar'

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def fetch(
        self,
        period:     str              = 'thisweek',
        currencies: list[str] | None = None,
        impacts:    list[str] | None = None,
    ) -> pd.DataFrame:
        if not self.api_key:
            print('[FMP] [WARN] API key kosong, skip.')
            return pd.DataFrame()

        date_from, date_to = _period_to_dates(period)
        params = {
            'from':    date_from.strftime('%Y-%m-%d'),
            'to':      date_to.strftime('%Y-%m-%d'),
            'apikey':  self.api_key,
        }

        print(f'[FMP] GET {self.BASE}')
        print(f'[FMP] Range: {params["from"]} → {params["to"]}')

        try:
            resp = self.session.get(self.BASE, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            print(f'[FMP] [X] Request failed: {e}')
            return pd.DataFrame()
        except json.JSONDecodeError:
            print('[FMP] [X] JSON decode failed.')
            return pd.DataFrame()

        if isinstance(data, dict) and 'Error Message' in data:
            print(f'[FMP] [X] API error: {data["Error Message"]}')
            return pd.DataFrame()

        records = []
        for ev in data:
            raw_dt = ev.get('date', '')
            try:
                dt = datetime.fromisoformat(raw_dt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                dt_wib   = dt.astimezone(timezone(timedelta(hours=7)))
                date_str = dt_wib.strftime('%a %d %b')
                time_str = dt_wib.strftime('%H:%M') + ' WIB'
            except Exception:
                date_str = raw_dt[:10]
                time_str = ''

            impact_raw = ev.get('impact', ev.get('change', ''))
            impact = {
                'High':   'High',
                'Medium': 'Medium',
                'Low':    'Low',
            }.get(str(impact_raw).strip(), 'Unknown')

            def _clean(val):
                return str(val).strip() if val not in (None, '', 'None') else ''

            records.append({
                'date':     date_str,
                'time':     time_str,
                'currency': ev.get('currency', ev.get('country', '')).upper(),
                'impact':   impact,
                'event':    ev.get('event', '').strip(),
                'actual':   _clean(ev.get('actual')),
                'forecast': _clean(ev.get('estimate', ev.get('forecast'))),
                'previous': _clean(ev.get('previous')),
                'source':   'FMP',
            })

        df = pd.DataFrame(records)
        if df.empty:
            return df

        if currencies:
            df = df[df['currency'].isin([c.upper() for c in currencies])]
        if impacts:
            df = df[df['impact'].isin(impacts)]

        print(f'[FMP] [OK] {len(df)} events fetched.')
        return df.reset_index(drop=True)


# ─── ORCHESTRATOR ────────────────────────────────────────────────

class EconCalendar:
    def __init__(self, fmp_key: str = ''):
        self.fe  = FaireconomyScraper()
        self.fmp = FMPScraper(api_key=fmp_key)

    def fetch(
        self,
        period:     str              = 'thisweek',
        currencies: list[str] | None = None,
        impacts:    list[str] | None = None,
    ) -> pd.DataFrame:
        # Primary: Faireconomy FF mirror
        df = self.fe.fetch(period=period, currencies=currencies, impacts=impacts)

        # Fallback: FMP (only if API key provided)
        if df.empty and self.fmp.api_key:
            print('[AUTO] Faireconomy gagal → fallback ke FMP...')
            df = self.fmp.fetch(period=period, currencies=currencies, impacts=impacts)

        return df

    def display_styled(self, df: pd.DataFrame):
        if df.empty:
            print('⚠️  Data kosong.')
            return
        out = df.copy()
        out['impact'] = out['impact'].map(lambda x: f"{IMPACT_EMOJI.get(x, '❔')} {x}")

        def _color(val: str) -> str:
            for k, c in IMPACT_COLOR.items():
                if k in val:
                    return f'color:{c};font-weight:bold'
            return ''

        print(out)

    def summary(self, df: pd.DataFrame):
        if df.empty:
            print('⚠️  Data kosong.')
            return
        print('━' * 48)
        print('  📊 RINGKASAN')
        print('━' * 48)
        print(f'  Total events : {len(df)}')
        print(f'  Source       : {df["source"].unique().tolist()}')
        print(f'  Period       : {PERIOD}')
        print()
        print('  Per currency:')
        print(df.groupby('currency').size().sort_values(ascending=False).to_string())
        print()
        print('  Per impact:')
        print(df.groupby('impact').size().sort_values(ascending=False).to_string())

    def save(self, df: pd.DataFrame, fmt: str = 'both'):
        if df.empty:
            print('  [WARN] Tidak ada data untuk di-export.')
            return
        ts   = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')
        base = OUTPUT_DIR / f'{OUTPUT_NAME}_{ts}'
        if fmt in ('csv', 'both'):
            p = base.with_suffix('.csv')
            df.to_csv(p, index=False, encoding='utf-8-sig')
            print(f'  [CSV]  -> {p}')
        if fmt in ('json', 'both'):
            p = base.with_suffix('.json')
            df.to_json(p, orient='records', indent=2, force_ascii=False)
            print(f'  [JSON] -> {p}')


# ─── RUN ─────────────────────────────────────────────────────────

cal = EconCalendar(fmp_key=FMP_API_KEY)

df = cal.fetch(
    period     = PERIOD,
    currencies = CURRENCIES or None,
    impacts    = IMPACTS    or None,
)

cal.summary(df)
cal.display_styled(df)
cal.save(df, fmt='both')


# ─── FILTER TAMBAHAN (uncomment yg dibutuhin) ────────────────────

# High impact only
# display(df[df['impact'] == 'High'].reset_index(drop=True))

# Filter currency tertentu
# display(df[df['currency'] == 'USD'].reset_index(drop=True))

# Cari event by keyword
# display(df[df['event'].str.contains('CPI', case=False, na=False)].reset_index(drop=True))
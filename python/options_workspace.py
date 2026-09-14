"""Selected-contract research and one shared, read-only Alpaca options stream."""
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import json
import re
import time
import uuid

import msgpack
from websockets.asyncio.client import connect
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from alpaca_options import AlpacaOptionsProvider, OptionsDataError, DATA_URL, finite, timestamp, settings

router = APIRouter(prefix='/api/greeks/contracts', tags=['Contract workspace'])


def contract_symbol(value):
    value = value.strip().upper()
    match = re.fullmatch(r'([A-Z][A-Z0-9.]{0,5})(\d{6})([CP])(\d{8})', value)
    if not match:
        raise OptionsDataError('Use an OCC option symbol from the contract selector.', 422)
    try:
        datetime.strptime(match[2], '%y%m%d')
    except ValueError:
        raise OptionsDataError('Invalid contract expiration date.', 422) from None
    if int(match[4]) <= 0:
        raise OptionsDataError('Invalid contract strike.', 422)
    return value


def market_event(item):
    """Whitelist wire fields; preserve zero sizes, reject invalid numeric data."""
    if not isinstance(item, dict) or item.get('T') not in ('q', 't'):
        return None
    stamp = timestamp(item.get('t'))
    if not stamp or stamp > datetime.now(timezone.utc) + timedelta(minutes=1):
        return None
    wire_time = item['t'] if isinstance(item['t'],str) and 'T' in item['t'] else stamp.isoformat()
    event = {'type': 'quote' if item['T'] == 'q' else 'trade', 'symbol': item.get('S'),
             'timestamp': wire_time, 'received_at': datetime.now(timezone.utc).isoformat()}
    if item['T'] == 'q':
        bid, ask = finite(item.get('bp')), finite(item.get('ap'))
        if bid is None or ask is None or bid < 0 or ask < 0:
            return None
        event.update(bid=bid, ask=ask, bid_size=finite(item.get('bs')), ask_size=finite(item.get('as')),
                     crossed=ask < bid, bid_exchange=str(item.get('bx', ''))[:12], ask_exchange=str(item.get('ax', ''))[:12])
    else:
        price, size = finite(item.get('p')), finite(item.get('s'))
        if price is None or price <= 0 or size is None or size < 0 or not size.is_integer():
            return None
        event.update(price=price, size=int(size), exchange=str(item.get('x', ''))[:12])
    event['condition'] = str(item.get('c', ''))[:32]
    return event


def normalize_bars(pages, symbol, end):
    bars = {}
    for page in pages:
        for item in page.get(symbol, []) or []:
            stamp = timestamp(item.get('t'))
            values = {k: finite(item.get(k)) for k in ('o','h','l','c','v')}
            if not stamp or stamp > end or any(v is None for v in values.values()):
                continue
            o,h,l,c,v = (values[k] for k in ('o','h','l','c','v'))
            if min(o,h,l,c) <= 0 or v < 0 or h < max(o,c,l) or l > min(o,c,h):
                continue
            bars[int(stamp.timestamp())] = {'time':int(stamp.timestamp()), 'open':o,'high':h,'low':l,'close':c,'volume':v}
    return sorted(bars.values(), key=lambda b:b['time'])


@lru_cache(maxsize=64)
def load_contract(symbol, interval, days, cache_slot, feed):
    provider = AlpacaOptionsProvider()
    if provider.feed != feed:
        raise OptionsDataError('Feed changed during request; refresh.', 503)
    now = datetime.now(timezone.utc)
    end = now - timedelta(minutes=16)
    start = end - timedelta(days=days)
    deadline = time.monotonic() + 45
    warnings = []
    snapshot = {}
    try:
        response = provider._get(DATA_URL, '/v1beta1/options/snapshots', {'symbols':symbol,'feed':feed}, deadline)
        snapshot = (response.get('snapshots') or {}).get(symbol) or {}
    except OptionsDataError as exc:
        warnings.append('Snapshot unavailable: '+str(exc))
    # Historical aggregates have no feed parameter. Never append indicative
    # executions into these bars or infer aggressor direction from candles.
    pages = provider._pages(DATA_URL, '/v1beta1/options/bars', {'symbols':symbol, 'timeframe':interval,
        'start':start.isoformat(), 'end':end.isoformat(), 'limit':10000, 'sort':'asc'}, 'bars', deadline)
    bars = normalize_bars(pages, symbol, end)
    quote = market_event({**(snapshot.get('latestQuote') or {}), 'T':'q','S':symbol})
    trade = market_event({**(snapshot.get('latestTrade') or {}), 'T':'t','S':symbol})
    return {'symbol':symbol, 'feed':feed, 'interval':interval, 'bars':bars, 'quote':quote, 'trade':trade,
            'iv':finite(snapshot.get('impliedVolatility')), 'greeks':{k:finite((snapshot.get('greeks') or {}).get(k)) for k in ('delta','gamma','theta','vega','rho')},
            'captured_at':now.isoformat(), 'requested_start':start.isoformat(), 'requested_end':end.isoformat(),
            'warnings':warnings, 'bars_basis':'Alpaca historical trade aggregates; delayed cutoff, last bar may be partial. Missing intervals are not filled.',
            'greeks_basis':'Alpaca snapshot estimates, refreshed with history; not a streaming Greeks channel.'}


@router.get('/{symbol}/history')
def history(symbol: str, interval: str = Query('5Min', pattern=r'^(1Min|5Min|15Min|1Day)$'), days: int = Query(5, ge=1, le=20)):
    try:
        return load_contract(contract_symbol(symbol), interval, days, int(time.time()//30), settings().get('ALPACA_OPTIONS_FEED','indicative'))
    except OptionsDataError as exc:
        raise HTTPException(exc.status, detail=str(exc)) from None


class StreamFailure(Exception):
    pass


class OptionsStreamHub:
    """One upstream per API process. Bounded clients and queues; no tape archive."""
    def __init__(self):
        self.clients = {}
        self.changed = asyncio.Event()
        self.task = None
        self.feed = None
        self.acknowledged = set()
        self.sequence = 0

    def emit(self, message, symbol=None):
        self.sequence += 1
        for _, (wanted, queue) in list(self.clients.items()):
            if symbol and wanted != symbol:
                continue
            if queue.full():
                # An explicit discontinuity is more honest than a silent tape loss.
                while not queue.empty(): queue.get_nowait()
                queue.put_nowait({'type':'status','state':'gap','message':'Slow consumer: events dropped. Tape is incomplete.'})
            queue.put_nowait({**message, 'sequence':self.sequence, 'feed':self.feed})

    async def add(self, symbol):
        config = settings()
        feed = config.get('ALPACA_OPTIONS_FEED','indicative')
        if feed not in ('indicative','opra') or not config.get('APCA_API_KEY_ID') or not config.get('APCA_API_SECRET_KEY'):
            raise OptionsDataError('Configure Alpaca credentials and a valid options feed.',503)
        if self.clients and feed != self.feed:
            raise OptionsDataError('Stop existing streams before changing feed.',409)
        if len(self.clients) >= 20 or len({v[0] for v in self.clients.values()} | {symbol}) > 10:
            raise OptionsDataError('Workspace limit: 20 viewers / 10 distinct contracts. Stop another stream first.',429)
        self.feed = feed
        key, queue = uuid.uuid4().hex, asyncio.Queue(maxsize=256)
        self.clients[key] = (symbol, queue)
        queue.put_nowait({'type':'status','state':'subscribed' if symbol in self.acknowledged else 'connecting',
                         'feed':feed,'message':'Listening for quote/trade events; market data may be idle.'})
        self.changed.set()
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run(config))
        return key, queue

    async def remove(self, key):
        self.clients.pop(key, None)
        self.changed.set()
        if not self.clients and self.task:
            task, self.task = self.task, None
            task.cancel()
            with suppress(asyncio.CancelledError): await task
            self.acknowledged.clear()

    async def run(self, config):
        attempt = 0
        while self.clients:
            try:
                self.emit({'type':'status','state':'connecting','message':'Connecting to Alpaca options stream.'})
                # Official fixed host, TLS validation and no redirect forwarding.
                async with connect(f'wss://stream.data.alpaca.markets/v1beta1/{self.feed}',
                    additional_headers={'Content-Type':'application/msgpack'}, open_timeout=12,
                    ping_interval=20, ping_timeout=20, close_timeout=3, max_size=2**20, max_queue=16) as ws:
                    if ws.request.headers.get('Host') != 'stream.data.alpaca.markets':
                        raise StreamFailure('Unexpected stream host; credentials were not sent.')
                    await ws.send(msgpack.packb({'action':'auth','key':config['APCA_API_KEY_ID'],'secret':config['APCA_API_SECRET_KEY']},use_bin_type=True))
                    authenticated = False
                    async with asyncio.timeout(15):
                        while not authenticated:
                            for item in msgpack.unpackb(await ws.recv(), raw=False, timestamp=3):
                                if item.get('T') == 'error': raise StreamFailure(f"Alpaca stream rejected authentication (code {item.get('code')}). Check credentials, feed entitlement or another client connection.")
                                authenticated |= item.get('T') == 'success' and item.get('msg') == 'authenticated'
                    attempt = 0
                    subscribed = set()
                    receive = asyncio.create_task(ws.recv())
                    change = asyncio.create_task(self.changed.wait())
                    try:
                        while self.clients:
                            desired = {v[0] for v in self.clients.values()}
                            for action, symbols in [('unsubscribe',subscribed-desired),('subscribe',desired-subscribed)]:
                                if symbols: await ws.send(msgpack.packb({'action':action,'quotes':sorted(symbols),'trades':sorted(symbols)},use_bin_type=True))
                            subscribed = desired
                            done,_ = await asyncio.wait([receive,change],return_when=asyncio.FIRST_COMPLETED)
                            if change in done:
                                self.changed.clear()
                                change = asyncio.create_task(self.changed.wait())
                            if receive in done:
                                messages = msgpack.unpackb(receive.result(),raw=False,timestamp=3)
                                for item in messages:
                                    if item.get('T') == 'error': raise StreamFailure(f"Alpaca stream error (code {item.get('code')}); check entitlement or subscription limits.")
                                    if item.get('T') == 'subscription':
                                        self.acknowledged = set(item.get('quotes',[])) & set(item.get('trades',[]))
                                        for symbol in self.acknowledged:
                                            self.emit({'type':'status','state':'subscribed','message':'Subscription confirmed. No events can mean an idle or closed market.'},symbol)
                                    event = market_event(item)
                                    if event and event['symbol'] in desired: self.emit(event,event['symbol'])
                                receive = asyncio.create_task(ws.recv())
                    finally:
                        for task in (receive,change): task.cancel()
                        for task in (receive,change):
                            with suppress(asyncio.CancelledError, Exception): await task
            except asyncio.CancelledError:
                raise
            except StreamFailure as exc:
                self.emit({'type':'status','state':'error','message':str(exc)})
                return
            except Exception:
                attempt += 1
                self.acknowledged.clear()
                self.emit({'type':'status','state':'reconnecting','message':f'Connection interrupted; tape has a gap. Retry in {min(30,2**min(attempt,5))}s. No missing trades are reconstructed.'})
                await asyncio.sleep(min(30,2**min(attempt,5)))


hub = OptionsStreamHub()


@router.get('/status')
async def stream_status():
    return {'feed':hub.feed, 'viewers':len(hub.clients),
            'requested_contracts':len({c[0] for c in hub.clients.values()}),
            'confirmed_contracts':len(hub.acknowledged),
            'worker_running':bool(hub.task and not hub.task.done()),
            'limits':{'viewers':20,'contracts':10},'orders_enabled':False}


@router.get('/{symbol}/stream')
async def stream(symbol: str, request: Request):
    try:
        symbol = contract_symbol(symbol)
        key, queue = await hub.add(symbol)
    except OptionsDataError as exc:
        raise HTTPException(exc.status,detail=str(exc)) from None

    async def events():
        try:
            while not await request.is_disconnected():
                try:
                    item = await asyncio.wait_for(queue.get(),timeout=12)
                    yield 'data: '+json.dumps(item,allow_nan=False)+'\n\n'
                    if item.get('state') == 'error': break
                except asyncio.TimeoutError:
                    yield 'data: '+json.dumps({'type':'heartbeat','received_at':datetime.now(timezone.utc).isoformat()})+'\n\n'
        finally:
            await hub.remove(key)
    return StreamingResponse(events(),media_type='text/event-stream',headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})

"""No account keys/network required. Stream lifecycle and market-data semantics."""
import asyncio
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch, Mock
import msgpack
from alpaca_options import OptionsDataError
from options_workspace import contract_symbol, market_event, normalize_bars, load_contract, OptionsStreamHub

SYMBOL='SPY260918C00765000'
OTHER='SPY260918P00765000'
CONFIG={'ALPACA_OPTIONS_FEED':'indicative','APCA_API_KEY_ID':'fake','APCA_API_SECRET_KEY':'test-secret'}


class DataTests(unittest.TestCase):
    def test_occ_validation_rejects_urls_bad_dates_and_zero_strikes(self):
        self.assertEqual(contract_symbol(SYMBOL.lower()),SYMBOL)
        for invalid in ['https://example.com','*','SPY261332C00765000','SPY260918C00000000']:
            with self.assertRaises(OptionsDataError): contract_symbol(invalid)

    def test_events_accept_msgpack_datetime_and_preserve_zero_sizes(self):
        now=datetime.now(timezone.utc)
        payload=msgpack.packb([{'T':'q','S':SYMBOL,'t':now,'bp':1.2,'ap':1.3,'bs':0,'as':2}],datetime=True)
        item=msgpack.unpackb(payload,raw=False,timestamp=3)[0]
        event=market_event(item)
        self.assertEqual(event['bid_size'],0)
        self.assertEqual(event['type'],'quote')
        self.assertIn('T',event['timestamp'])
        self.assertNotIn('secret',str(event))
        self.assertTrue(market_event({**item,'bp':2})['crossed'])
        for change in [{'bp':float('nan')},{'t':str(now+timedelta(days=1))},{'T':'unknown'}]:
            self.assertIsNone(market_event({**item,**change}))

    def test_trade_size_is_not_daily_volume(self):
        event=market_event({'T':'t','S':SYMBOL,'t':datetime.now(timezone.utc),'p':2.1,'s':5})
        self.assertEqual(event['size'],5)
        self.assertNotIn('volume',event)
        self.assertNotIn('side',event)

    def test_bars_sorted_deduplicated_and_invalid_bars_excluded(self):
        now=datetime.now(timezone.utc)
        bar={'t':now.isoformat(),'o':2,'h':3,'l':1,'c':2.5,'v':10}
        result=normalize_bars([{SYMBOL:[bar,{**bar,'v':12},{**bar,'t':(now+timedelta(minutes=1)).isoformat()}, {**bar,'h':0}]}],SYMBOL,now)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['volume'],12)

    def test_history_cutoff_pagination_missing_greeks_and_no_feed_on_bars(self):
        provider=Mock(feed='indicative')
        provider._get.return_value={'snapshots':{SYMBOL:{}}}
        provider._pages.return_value=[{SYMBOL:[]}]
        load_contract.cache_clear()
        with patch('options_workspace.AlpacaOptionsProvider',return_value=provider):
            result=load_contract(SYMBOL,'5Min',5,1,'indicative')
        params=provider._pages.call_args.args[2]
        self.assertNotIn('feed',params)
        self.assertEqual(params['symbols'],SYMBOL)
        self.assertGreater((datetime.now(timezone.utc)-datetime.fromisoformat(params['end'])).total_seconds(),15*60)
        self.assertEqual(result['bars'],[])
        self.assertIsNone(result['iv'])
        self.assertTrue(all(v is None for v in result['greeks'].values()))


class FakeSocket:
    def __init__(self):
        self.queue=asyncio.Queue(); self.sent=[]; self.commands=asyncio.Queue()
        self.request=Mock(headers={'Host':'stream.data.alpaca.markets'})
    async def send(self, raw):
        item=msgpack.unpackb(raw,raw=False);self.sent.append(item);self.commands.put_nowait(item)
        if item['action']=='auth':
            await self.queue.put([{'T':'success','msg':'authenticated'}])
        elif item['action']=='subscribe':
            await self.queue.put([{'T':'subscription','quotes':item['quotes'],'trades':item['trades']}])
    async def recv(self):
        return msgpack.packb(await self.queue.get(),datetime=True)
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass


async def until(queue,predicate):
    async with asyncio.timeout(2):
        while True:
            item=await queue.get()
            if predicate(item):return item


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_connection_filters_symbols_and_disconnect_cleans_up(self):
        hub=OptionsStreamHub();socket=FakeSocket()
        with patch('options_workspace.settings',return_value=CONFIG),patch('options_workspace.connect',return_value=socket) as connect:
            a,qa=await hub.add(SYMBOL)
            await until(qa,lambda e:e.get('state')=='subscribed')
            b,qb=await hub.add(SYMBOL)
            c,qc=await hub.add(OTHER)
            await until(qc,lambda e:e.get('state')=='subscribed')
            await socket.queue.put([{'T':'t','S':SYMBOL,'t':datetime.now(timezone.utc),'p':2,'s':3}])
            self.assertEqual((await until(qa,lambda e:e['type']=='trade'))['size'],3)
            self.assertEqual((await until(qb,lambda e:e['type']=='trade'))['symbol'],SYMBOL)
            self.assertEqual(connect.call_count,1)
            self.assertTrue(qc.empty())
            await hub.remove(a); await hub.remove(b)
            command=await until(socket.commands,lambda e:e['action']=='unsubscribe')
            self.assertIn(SYMBOL,command['quotes'])
            await hub.remove(c)
            self.assertIsNone(hub.task)
            self.assertFalse(hub.clients)

    async def test_queue_overflow_reports_gap_and_is_bounded(self):
        hub=OptionsStreamHub();queue=asyncio.Queue(maxsize=4)
        hub.clients={'test':(SYMBOL,queue)}
        for i in range(5):hub.emit({'type':'trade','price':i},SYMBOL)
        messages=[]
        while not queue.empty():messages.append(queue.get_nowait())
        self.assertTrue(any(m.get('state')=='gap' for m in messages))
        self.assertLessEqual(len(messages),4)

    async def test_redirect_host_never_receives_credentials(self):
        hub=OptionsStreamHub();socket=FakeSocket();socket.request.headers={'Host':'other.example'}
        with patch('options_workspace.settings',return_value=CONFIG),patch('options_workspace.connect',return_value=socket):
            key,queue=await hub.add(SYMBOL)
            result=await until(queue,lambda e:e.get('state')=='error')
            self.assertIn('credentials were not sent',result['message'])
            self.assertEqual(socket.sent,[])
            await hub.remove(key)

    async def test_configuration_and_viewer_limits(self):
        hub=OptionsStreamHub()
        with patch('options_workspace.settings',return_value={}):
            with self.assertRaises(OptionsDataError):await hub.add(SYMBOL)
        hub.clients={str(i):(SYMBOL,asyncio.Queue()) for i in range(20)};hub.feed='indicative'
        with patch('options_workspace.settings',return_value=CONFIG):
            with self.assertRaises(OptionsDataError):await hub.add(SYMBOL)


if __name__=='__main__':unittest.main()

const { test } = require('node:test'); const assert = require('node:assert/strict');
const ts = require('typescript'); const fs = require('node:fs');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { parseTrades, mergeTrades, parseBook, flowStats, depthStats, volumeProfile } = require('../app/lib/chart-studio/orderflow.ts');
const raw = (tid, side = 'B', time = 1700000000000, px = '100', sz = '2') => ({ coin: 'xyz:TSLA', tid, time, side, px, sz });
test('trade identity includes time + coin + tid; side, invalid data and symbol isolation', () => {
  const parsed = parseTrades([raw(1), raw(2, 'A'), raw(3, 'S'), raw(4, 'B', 1, 'NaN'), { ...raw(5), coin: 'BTC' }], 'xyz:TSLA');
  assert.deepEqual(parsed.map(t => t.side), ['buy', 'sell']);
  const next = mergeTrades(parsed, parseTrades([raw(1), raw(1, 'B', 1700000000100)], 'xyz:TSLA'));
  assert.equal(next.length, 3); assert.equal(mergeTrades(next, [], 1700000000050).length, 1);
  assert.equal(mergeTrades(next, [], 0, 2).length, 2);
});
test('CVD uses executed side and size; book imbalance uses resting size separately', () => {
  const trades = parseTrades([raw(1), raw(2, 'A', 1700000001000, '101', '1')], 'xyz:TSLA');
  const stats = flowStats(trades, 1000); assert.equal(stats.delta, 1); assert.equal(stats.buyRatio, 2/3); assert.deepEqual(stats.cvd.map(t => t.value), [2, 1]);
  const book = parseBook({ coin: 'xyz:TSLA', time: 1, levels: [[{ px: '99', sz: '3', n: 2 }], [{ px: '101', sz: '1', n: 1 }]] }, 'xyz:TSLA');
  const depth = depthStats(book, 10); assert.equal(depth.spread, 2); assert.equal(depth.imbalance, .5);
  assert.equal(parseBook({ ...book, coin: 'OTHER' }, 'xyz:TSLA'), null);
  assert.equal(parseBook({ coin: 'xyz:TSLA', time: 1, levels: [[{ px: '102', sz: '1', n: 1 }], [{ px: '101', sz: '1', n: 1 }]] }, 'xyz:TSLA'), null);
});
test('trade profile conserves volume and buy/sell, POC and contiguous value area', () => {
  const trades = parseTrades([raw(1, 'B', 1, '100', '1'), raw(2, 'A', 2, '104', '8'), raw(3, 'B', 3, '108', '1')], 'xyz:TSLA');
  const p = volumeProfile('trades', trades, [], 8, .7);
  assert.equal(p.total, 10); assert.equal(p.poc, 104.5); assert.equal(p.val, 104); assert.equal(p.vah, 105); assert.equal(p.actualValueArea, .8);
  assert.equal(p.bins.reduce((n,b)=>n+b.buy,0), 2); assert.equal(p.bins.reduce((n,b)=>n+b.sell,0), 8);
});
test('candle profile conserves volume, handles flat bars and never infers trade direction', () => {
  const bars = [{ time: 1, open: 1, high: 5, low: 1, close: 4, volume: 90 }, { time: 2, open: 3, high: 3, low: 3, close: 3, volume: 10 }];
  for (const count of [24,48,96]) { const p = volumeProfile('candles', [], bars, count); assert.ok(Math.abs(p.total - 100) < 1e-9); assert.equal(p.bins.reduce((n,b)=>n+b.buy+b.sell,0),0); assert.ok(p.actualValueArea >= .7); }
  const flat = volumeProfile('candles', [], [bars[1]]); assert.equal(flat.bins.length,1); assert.equal(flat.poc,3); assert.equal(flat.total,10);
  assert.equal(volumeProfile('trades',[],[]), null);
});

test('flow hub shares a socket, batches messages, preserves qualified symbols and releases it', async () => {
  const originalWS = global.WebSocket, originalFetch = global.fetch; const sockets = [];
  class Socket { static OPEN = 1; readyState = 0; sent = []; constructor(){sockets.push(this)} send(s){this.sent.push(JSON.parse(s))} close(){this.closed=true;this.onclose?.()} }
  global.WebSocket = Socket; global.fetch = async () => ({ok:true,json:async()=>[]});
  let off1, off2;
  try {
    const { subscribeOrderFlow } = require('../app/lib/chart-studio/orderflowStream.ts'); const events=[];
    off1=subscribeOrderFlow('xyz:TSLA', e=>events.push(e));off2=subscribeOrderFlow('xyz:TSLA',()=>{});
    assert.equal(sockets.length,1); const ws=sockets[0];ws.readyState=1;ws.onopen();
    assert.deepEqual(ws.sent.map(m=>m.subscription),[{type:'trades',coin:'xyz:TSLA'},{type:'l2Book',coin:'xyz:TSLA'}]);
    const data=[raw(1,'B',Date.now()),raw(1,'B',Date.now())]; data[1]=data[0];
    ws.onmessage({data:JSON.stringify({channel:'trades',data})});
    await new Promise(r=>setTimeout(r,600));
    assert.equal(events.find(e=>e.type==='flow' && e.trades.length)?.trades.length,1);
    off1();assert.ok(!ws.closed);off2();assert.ok(ws.closed);
  } finally {off1?.();off2?.();global.WebSocket=originalWS;global.fetch=originalFetch;}
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript'); const fs = require('node:fs');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, f);
const { normalizeBars, mergeBar, fourHourBars } = require('../app/lib/chart-studio/types.ts');
const bar = (time, close = 12) => ({ time, open: 10, high: 15, low: 9, close, volume: 100 });

test('HIP-3 catalog preserves venue and collateral, excludes delisted and resolves search aliases', () => {
  const { buildCatalog, searchCatalog } = require('../app/lib/chart-studio/hyperliquidCatalog.ts');
  const catalog = buildCatalog([
    { collateralToken: 0, universe: [{ name: 'BTC' }, { name: 'TSLAUSDT.P' }] },
    { collateralToken: 0, universe: [{ name: 'xyz:TSLA' }, { name: 'xyz:NVDA' }] },
    { collateralToken: 360, universe: [{ name: 'other:TSLA' }, { name: 'old:TSLA', isDelisted: true }] },
  ], { tokens: [{ index: 360, name: 'USDH' }, { index: 0, name: 'USDC' }] });
  assert.equal(catalog.length, 5);
  assert.equal(catalog.find(i => i.symbol === 'other:TSLA').collateral, 'USDH');
  assert.deepEqual(searchCatalog(catalog, 'tslausdt.p').map(i => i.symbol), ['TSLAUSDT.P', 'xyz:TSLA', 'other:TSLA']);
  assert.deepEqual(searchCatalog(catalog, 'xyz:TSLAUSDC.P').map(i => i.symbol), ['xyz:TSLA']);
  assert.deepEqual(searchCatalog(catalog, 'BTCUSDT.P').map(i => i.symbol), ['BTC']);
  assert.equal(searchCatalog(catalog, '', 'hip3').length, 3);
  assert.equal(searchCatalog(catalog, 'tsla', 'native').length, 1);
  assert.equal(searchCatalog(catalog, 'does-not-exist').length, 0);
});
test('candles sorted and deduplicated; invalid OHLC rejected', () => {
  assert.deepEqual(normalizeBars([bar(2), bar(1), bar(2, 13), { ...bar(3), high: 1 }]).map(b => [b.time, b.close]), [[1, 12], [2, 13]]);
});
test('rollover appends and corrections replace volume instead of double counting', () => {
  let data = mergeBar([bar(1)], bar(2)); data = mergeBar(data, bar(2, 14)); data = mergeBar(data, bar(1, 11));
  assert.equal(data.length, 2); assert.equal(data[1].volume, 100); assert.equal(data[0].close, 11);
});
test('4h resample does not bridge sessions or missing hour buckets', () => {
  const times = ['2026-09-01T13:30Z', '2026-09-01T14:30Z', '2026-09-01T17:30Z', '2026-09-02T13:30Z'];
  const result = fourHourBars(times.map(t => bar(Date.parse(t) / 1000)), 'America/New_York');
  assert.equal(result.length, 3); assert.equal(result[0].volume, 200);
});
test('market identity rejects unknown provider or unsupported interval', () => {
  const { parseMarket } = require('../app/lib/chart-studio/providers.ts');
  assert.throws(() => parseMarket(new URLSearchParams('provider=unknown&symbol=BTC&interval=1h')), /Invalid/);
  assert.throws(() => parseMarket(new URLSearchParams('provider=yahoo&symbol=SPY&interval=2s')), /Invalid/);
  assert.equal(parseMarket(new URLSearchParams('provider=yahoo&symbol=%5EGSPC&interval=1d')).instrument.symbol, '^GSPC');
});
test('market subscribers share one upstream socket and last unsubscribe closes it', () => {
  const original = global.WebSocket; const sockets = [];
  class MockSocket {
    static OPEN = 1;
    readyState = 0; sent = []; closed = false;
    constructor() { sockets.push(this); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.closed = true; this.onclose?.(); }
  }
  global.WebSocket = MockSocket;
  const { subscribeCandles } = require('../app/lib/chart-studio/stream.ts');
  const events = []; let offA, offB;
  try {
    offA = subscribeCandles('TEST', '1h', e => events.push(e));
    offB = subscribeCandles('TEST', '1h', () => {});
    assert.equal(sockets.length, 1); const ws = sockets[0]; ws.readyState = 1; ws.onopen();
    assert.equal(ws.sent.length, 2); assert.equal(ws.sent[0].subscription.type, 'candle');
    ws.onmessage({ data: JSON.stringify({ channel: 'candle', data: { t: 1700000000000, o: '10', h: '12', l: '9', c: '11', v: '50' } }) });
    assert.equal(events.find(e => e.type === 'bar').bar.time, 1700000000);
    offA(); assert.equal(ws.closed, false); offB(); assert.equal(ws.closed, true);
  } finally { offA?.(); offB?.(); global.WebSocket = original; }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);
const { filterContracts, contractsCSV } = require('../app/lib/greeksExplorer.ts');
const { fetchGreeks } = require('../app/lib/greeks.ts');
const { exposureByStrike, strongestOIStrike } = require('../app/lib/greeksExposure.ts');
const defaults = { bucket: 'all', side: 'all', search: '', minOI: 0, nearSpot: false, sort: 'gex' };
const contract = { expiry: '2026-09-11', strike: 100, option_type: 'call', oi: 10, volume: 5, iv: .2, dte: 6, delta: .5, gamma: .01, gex_spotgamma: 2, vanna_exp: 3, charm_exp: -4 };
const snapshot = { ticker: 'SPY', timestamp: '2026-09-05T12:00:00', data_source: 'live', spot: 100, signals: {}, by_expiry: { '0': { strikes: [contract] }, '7': { strikes: [contract] } } };

test('selecting a later bucket keeps contracts also present in earlier buckets', () => {
  const rows = filterContracts(snapshot, { ...defaults, bucket: '7' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bucket, '7');
});
test('all-bucket view counts each expiry/type/strike only once', () => {
  assert.equal(filterContracts(snapshot, defaults).length, 1);
});
test('CSV preserves exposure units and escapes provider formula fields', () => {
  const csv = contractsCSV({ ...snapshot, ticker: '=SUM(A1)' }, [{ ...contract, bucket: '7' }]);
  assert.ok(csv.includes("'" + '=SUM(A1)'));
  assert.ok(csv.includes('"20000000"'));
});
test('incomplete exposure payload is rejected before rendering', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => snapshot });
  try { await assert.rejects(fetchGreeks('SPY'), /tidak lengkap/); }
  finally { global.fetch = original; }
});
test('exposure aggregates unique contracts, preserves put sign and converts GEX only', () => {
  const data = { ...snapshot, by_expiry: { ...snapshot.by_expiry, '14': { strikes: [{ ...contract, option_type: 'put', oi: 30, gex_spotgamma: -1, vanna_exp: -1, charm_exp: 2 }] } } };
  const rows = exposureByStrike(data, 'all', 'gex');
  assert.deepEqual(rows, [{ strike: 100, call: 2e7, put: -1e7, net: 1e7, callOI: 10, putOI: 30 }]);
  assert.equal(exposureByStrike(data, 'all', 'vanna')[0].net, 2);
  assert.equal(exposureByStrike(data, 'all', 'charm')[0].net, -2);
  assert.equal(exposureByStrike(data, '7', 'gex')[0].net, 2e7);
});
test('empty or zero OI does not invent a key level', () => {
  assert.equal(strongestOIStrike([], 'callOI'), null);
  assert.equal(strongestOIStrike([{ strike: 100, callOI: 0, putOI: 0 }], 'putOI'), null);
  assert.equal(exposureByStrike({ ...snapshot, by_expiry: {} }, 'all', 'gex').length, 0);
});

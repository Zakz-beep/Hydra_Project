const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, f);
const { interpolateSmile, collectExpirySmiles, buildVolatilitySurface } = require('../app/lib/volatilitySurface.ts');
const row = (strike, dte, iv, side = 'call', oi = 20) => ({ strike, dte, expiry: `2026-09-${String(dte + 5).padStart(2, '0')}`, iv, option_type: side, oi });
const snapshot = { spot: 100, by_expiry: { 7: { strikes: [row(80, 1, .3), row(100, 1, .2), row(120, 1, .25), row(85, 5, .35), row(105, 5, .22), row(125, 5, .27)] }, 30: { strikes: [row(90, 20, .4), row(110, 20, .24), row(130, 20, .3)] } } };
const options = { side: 'all', minOI: 10, rangePct: 30, quality: 'smooth' };

test('ragged strikes form a finite, bounded grid using actual expiries, not buckets', () => {
  const grid = buildVolatilitySurface(snapshot, options);
  assert.equal(grid.reason, undefined);
  assert.equal(grid.smiles.length, 3);
  assert.equal(grid.y[0], 1); assert.equal(grid.y.at(-1), 20);
  assert.equal(grid.x[0], 90); assert.equal(grid.x.at(-1), 120);
  assert.equal(grid.z.length, 48); assert.equal(grid.z[0].length, 96);
  assert.ok(grid.z.flat().every(v => Number.isFinite(v) && v >= 20 && v <= 40));
});
test('cubic interpolation preserves observations, positivity, and local extrema', () => {
  const f = interpolateSmile([0, 1, 3, 4], [20, 40, 10, 30]);
  assert.deepEqual([0, 1, 3, 4].map(f), [20, 40, 10, 30]);
  for (let i = 0; i <= 400; i++) {
    const x = i / 100, value = f(x);
    const bounds = x <= 1 ? [20, 40] : x <= 3 ? [10, 40] : [10, 30];
    assert.ok(value >= bounds[0] && value <= bounds[1]);
  }
  assert.equal(f(-.01), null); assert.equal(f(4.01), null);
  assert.equal(interpolateSmile([1, 1], [20, 30])(1), null);
  assert.equal(interpolateSmile([1, 3], [20, 40])(2), 30);
});
test('OI weighting and contract deduplication retain actual expiry identity', () => {
  const s = { spot: 100, by_expiry: { 7: { strikes: [row(100, 5, .2), row(100, 5, .4, 'put', 60)] }, 14: { strikes: [row(100, 5, .2)] } } };
  const smiles = collectExpirySmiles(s, 'all', 10);
  assert.equal(smiles.length, 1); assert.equal(smiles[0].points[0].iv, 35); assert.equal(smiles[0].points[0].oi, 80);
});
test('OTM selection uses puts below spot and calls above; bad IV is excluded', () => {
  const s = { spot: 100, by_expiry: { 7: { strikes: [row(90, 5, .2, 'put'), row(90, 5, .8), row(110, 5, .3), row(110, 5, .9, 'put'), row(120, 5, NaN), row(130, 5, 0)] } } };
  assert.deepEqual(collectExpirySmiles(s, 'otm', 10)[0].points.map(p => p.iv), [20, 30]);
});
test('insufficient data or disjoint strike support returns an explanation, not fake values', () => {
  assert.ok(buildVolatilitySurface({ spot: 100 }, options).reason);
  const s = { spot: 100, by_expiry: { 7: { strikes: [row(80, 1, .2), row(90, 1, .3), row(110, 5, .4), row(120, 5, .3)] } } };
  assert.ok(buildVolatilitySurface(s, options).reason);
  assert.equal(buildVolatilitySurface(s, options).z.length, 0);
});
test('fast mode caps GPU vertices regardless of input size', () => {
  const grid = buildVolatilitySurface(snapshot, { ...options, quality: 'fast' });
  assert.equal(grid.z.flat().length, 48 * 24);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText, filename);
const {historicalDTE, historicalExpiries, historicalSurface} = require('../app/lib/historicalSurface.ts');
const {buildVolatilitySurface, collectExpirySmiles} = require('../app/lib/volatilitySurface.ts');
const day = {date:'2026-09-04',captured_at:'capture-1',spot:100,
  contracts:['2026-09-11','2026-09-14','2026-09-18'].flatMap((expiry,i) => [90,100,110].flatMap(strike => ['call','put'].map(side =>
    ({expiry,strike,side,oi:100,iv:.2+i*.05}))))};
test('historical DTE and intersections use reference date, including weekend days', () => {
  assert.equal(historicalDTE(day.date,'2026-09-14'),10);
  assert.deepEqual(historicalExpiries(day,7,''),['2026-09-11']);
  assert.deepEqual(historicalExpiries(day,null,'1'),['2026-09-14']);
  assert.deepEqual(historicalExpiries(day,7,'1'),[]);
  assert.deepEqual(historicalExpiries(day,0,''),[]);
});
test('archive adapter preserves model IV, actual expiries and finite shared-support grid', () => {
  const input=historicalSurface(day,'SPY',['2026-09-11','2026-09-14']);
  assert.equal(input.data_source,'marketdata-historical-bsm');
  const grid=buildVolatilitySurface(input,{side:'otm',minOI:10,rangePct:15,quality:'smooth'});
  assert.equal(grid.reason,undefined);
  assert.deepEqual(grid.smiles.map(s=>s.dte),[7,10]);
  assert.ok(grid.x[0]>=90 && grid.x.at(-1)<=110);
  assert.ok(grid.z.flat().every(v=>Number.isFinite(v) && v>=20 && v<=25));
  const single=historicalSurface(day,'SPY',['2026-09-14']);
  assert.equal(collectExpirySmiles(single,'all',10)[0].points[0].iv,25);
  assert.ok(buildVolatilitySurface(single,{side:'all',minOI:10,rangePct:15,quality:'smooth'}).reason);
});
test('date/capture changes redraw input; missing spot and selected inventory stay unavailable', () => {
  assert.equal(historicalSurface({...day,spot:null},'SPY',[]),null);
  const a=historicalSurface(day,'SPY',[]);
  const b=historicalSurface({...day,date:'2026-09-08'},'SPY',['2026-09-14']);
  assert.notEqual(a.timestamp,b.timestamp);
  assert.deepEqual(collectExpirySmiles(a,'all',0),[]);
  assert.equal(collectExpirySmiles(b,'all',10)[0].dte,6);
});

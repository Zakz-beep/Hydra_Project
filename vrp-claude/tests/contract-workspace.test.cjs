const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
require.extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
const {newerObservation,spread}=require('../app/lib/contractWorkspace.ts');
test('older replayed events do not overwrite newer quotes',()=>{
  const latest={timestamp:'2026-09-12T12:00:00Z',bid:2};
  assert.equal(newerObservation(latest,{timestamp:'2026-09-12T11:59:59Z',bid:1}),latest);
  assert.equal(newerObservation(latest,{timestamp:'invalid'}),latest);
  assert.equal(newerObservation(null,latest),latest);
  const precise={timestamp:'2026-09-12T12:00:00.123456789Z'};
  assert.equal(newerObservation(precise,{timestamp:'2026-09-12T12:00:00.123456001Z'}),precise);
});
test('no midpoint or relative spread from missing, zero bid or crossed quotes',()=>{
  assert.equal(spread(null),null);assert.equal(spread({bid:0,ask:1}),null);assert.equal(spread({bid:2,ask:1}),null);
  assert.deepEqual(spread({bid:1,ask:3}),{mid:2,absolute:2,percent:100});
});

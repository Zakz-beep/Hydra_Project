const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
require.extensions['.ts']=(mod,filename)=>mod._compile(ts.transpileModule(require('node:fs').readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
const {expiryWeekday,actualExpiries,bucketExpiries,surfaceScope}=require('../app/lib/optionExpiries.ts');
const {filterContracts}=require('../app/lib/greeksExplorer.ts');
const rows=[{expiry:'2026-09-14',option_type:'call',strike:100,oi:100},{expiry:'2026-09-16',option_type:'put',strike:110,oi:200}];
const data={spot:100,by_expiry:{7:{expiry_dates:rows.map(r=>r.expiry),strikes:rows}}};
test('Monday and Wednesday use actual dates and scope surface and chain consistently',()=>{
  assert.equal(expiryWeekday(rows[0].expiry),'Monday');
  assert.equal(expiryWeekday(rows[1].expiry),'Wednesday');
  assert.deepEqual(actualExpiries(data),rows.map(r=>r.expiry));
  const scoped=surfaceScope(data,['2026-09-16']);
  assert.deepEqual(scoped.by_expiry[7].strikes,[rows[1]]);
  assert.equal(data.by_expiry[7].strikes.length,2);
  const f={bucket:'all',side:'all',search:'',minOI:0,nearSpot:false,sort:'strike',weekday:'Monday'};
  assert.deepEqual(filterContracts(data,f).map(r=>r.expiry),['2026-09-14']);
  assert.equal(filterContracts(data,{...f,weekday:'Tuesday'}).length,0);
  assert.equal(surfaceScope(data,[]).by_expiry[7].strikes.length,0);
});
test('DTE selection intersects weekday dates and never substitutes an absent 0DTE bucket',()=>{
  const later={expiry:'2026-09-21',option_type:'call',strike:100,oi:100};
  const inventory={...data,by_expiry:{...data.by_expiry,14:{expiry_dates:[later.expiry],strikes:[later]}}};
  assert.deepEqual(bucketExpiries(inventory,'0'),[]);
  assert.deepEqual(bucketExpiries(inventory,'7').filter(e=>expiryWeekday(e)==='Monday'),['2026-09-14']);
  assert.deepEqual(bucketExpiries(inventory,'14'),['2026-09-21']);
  assert.equal(bucketExpiries(inventory,'all').length,3);
});

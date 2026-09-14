const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {aggregateFootprint,suggestedStep,footprintCsv}=require('../app/lib/chart-studio/footprint.ts');
const settings={interval:60,step:1,ratio:3,minimum:0,stack:3,units:'base'};
const t=(id,price,side,size=1,time=60001)=>({id:String(id),price,side,size,time});
test('footprint conserves executed volume, deduplicates and never substitutes candle direction',()=>{
 const raw=[t(1,100,'sell',2),t(2,101,'buy',7),t(2,101,'buy',7),t(3,100,'buy',3,120000)];const result=aggregateFootprint(raw,settings);
 assert.equal(result.trades,3);assert.equal(result.total,12);assert.equal(result.delta,8);assert.deepEqual(result.bars.map(b=>b.time),[60,120]);assert.equal(result.bars[0].poc,101.5);assert.equal(result.bars[0].levels[1].buyImbalance,true);assert.equal(result.bars[0].levels.reduce((s,l)=>s+l.volume,0),result.bars[0].volume);
});
test('diagonal and stacked imbalance require real adjacent denominators',()=>{
 const raw=[];let id=0;for(let p=100;p<105;p++){raw.push(t(++id,p,'sell',1));raw.push(t(++id,p,'buy',4));}
 const b=aggregateFootprint(raw,settings).bars[0];assert.equal(b.levels[0].buyImbalance,false);assert.ok(b.levels.slice(1).every(r=>r.stackedBuy));assert.ok(b.levels.every(r=>!r.sellImbalance));
 const isolated=aggregateFootprint([t(1,100,'sell'),t(2,102,'buy',9)],settings).bars[0];assert.ok(isolated.levels.every(r=>!r.buyImbalance));
 assert.ok(aggregateFootprint(raw,{...settings,minimum:5}).bars[0].levels.every(r=>!r.buyImbalance));
});
test('decimal price boundaries, quote notional and sorted OHLC',()=>{
 const result=aggregateFootprint([t(3,.3,'sell',2,62000),t(1,.1,'buy',4,60000),t(2,.2,'buy',3,61000)],{...settings,step:.1,units:'quote'});
 assert.deepEqual(result.bars[0].levels.map(r=>r.index),[1,2,3]);assert.equal(result.bars[0].open,.1);assert.equal(result.bars[0].close,.3);assert.ok(Math.abs(result.total-1.6)<1e-9);assert.ok(Math.abs(result.delta-.4)<1e-9);
});
test('tiny increments bounded without losing volume, empty input, CSV and bad settings',()=>{
 const result=aggregateFootprint([t(1,100,'sell'),t(2,200,'buy')],{...settings,step:.00000001});assert.equal(result.coarsened,true);assert.equal(result.total,2);assert.ok((200-100)/result.step<=240);
 assert.equal(aggregateFootprint([],settings).bars.length,0);assert.throws(()=>aggregateFootprint([],{...settings,step:0}));assert.match(footprintCsv(result.bars),/bid_sell,ask_buy/);assert.ok(suggestedStep(.000005)>0);
});
test('20k fills aggregate with conservation and bounded rows',()=>{const raw=Array.from({length:20000},(_,i)=>t(i,90000+i%100,i%2?'buy':'sell',.01,1700000000000+i*30));const start=performance.now(),result=aggregateFootprint(raw,{...settings,step:5});assert.equal(result.trades,20000);assert.ok(Math.abs(result.total-200)<1e-8);assert.ok(performance.now()-start<1000);});
test('subnormal increments remain finite even for a single traded price',()=>{for(const step of [1e-320,1e-20]){const result=aggregateFootprint([t(1,90000,'buy')],{...settings,step});assert.ok(Number.isFinite(result.step));const row=result.bars[0].levels[0];assert.ok(row.high>row.low);assert.ok(Number.isSafeInteger(row.index));assert.equal(result.total,1);}});

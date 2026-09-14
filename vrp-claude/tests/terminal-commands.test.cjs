const {test}=require('node:test'); const assert=require('node:assert/strict'); const ts=require('typescript'),fs=require('node:fs');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {COMMAND_REGISTRY,parseCommand,findCommand,normalizeTicker,formatCommand,stateFromUrl,commandUrl,searchCommands}=require('../app/lib/terminal/commands.ts');
const current={page:'vrp',ticker:'SPY'};

test('AGT resolves Agent Center without a ticker and uses the local proxy',async()=>{
 assert.deepEqual(parseCommand('AGT',current).state,{page:'agent-center',ticker:'SPY'});
 assert.deepEqual(parseCommand('MCP',current).state,{page:'agent-center',ticker:'SPY'});
 assert.ok(parseCommand('SPY AGT',current).error);
 const rewrites=await require('../next.config.js').rewrites();const {pathToRegexp}=require('next/dist/compiled/path-to-regexp');
 assert.equal(pathToRegexp(rewrites.at(-1).source).test('/api/agent-center/overview'),false);
});

test('ECO resolves a local USD research page and excludes its proxy from VRP fallback',async()=>{
 assert.deepEqual(parseCommand('ECO',current).state,{page:'macro',ticker:'SPY'});
 assert.ok(parseCommand('NVDA ECO',current).error);
 const rewrites=await require('../next.config.js').rewrites();
 const fallback=rewrites.at(-1);
 const {pathToRegexp}=require('next/dist/compiled/path-to-regexp');
 const expression=pathToRegexp(fallback.source);
 assert.equal(expression.test('/api/macro/forecast'),false);
 assert.equal(expression.test('/api/macro/dashboard'),false);
 assert.equal(expression.test('/api/signal-log'),true);
});
test('commands resolve both orders, case, optional GO and ticker-only/function-only',()=>{
 for(const raw of ['nvda gex','GEX NVDA',' NVDA GEX <GO> '])assert.deepEqual(parseCommand(raw,current).state,{page:'gex',ticker:'NVDA'});
 assert.deepEqual(parseCommand('GEX',current).state,{page:'gex',ticker:'SPY'});assert.deepEqual(parseCommand('qqq',current).state,{page:'vrp',ticker:'QQQ'});
});
test('invalid commands never return a target',()=>{
 for(const raw of ['', 'NVDA DOESNOTEXIST','SPY GEX ignored','GP GEX','<script>','foo:bar:baz GP','SPY COT','BTCUSDT.P GEX','xyz:TSLA VRP'])assert.ok(parseCommand(raw,current).error,raw);
});
test('ticker format preserves provider-qualified canonical names and Yahoo punctuation',()=>{
 for(const [a,b] of [['XYZ:tsla','xyz:TSLA'],['bbri.jk','BBRI.JK'],['^vix','^VIX'],['btc-usd','BTC-USD'],['es=f','ES=F']])assert.equal(normalizeTicker(a),b);
 assert.equal(parseCommand('TSLAUSDT.P GP',current).state.ticker,'TSLAUSDT.P');assert.equal(normalizeTicker('https://bad'),null);
});
test('registry identifiers are unique and every function has a page renderer',()=>{
 const identifiers=new Map(); const source=fs.readFileSync(require('path').resolve(__dirname,'../app/page.tsx'),'utf8');
 for(const c of COMMAND_REGISTRY){for(const id of [c.code,c.page,...c.aliases]){const k=id.toLowerCase();assert.ok(!identifiers.has(k)||identifiers.get(k)===c.page,k);identifiers.set(k,c.page)}assert.ok(source.includes(`nav.activePage === "${c.page}"`),c.code)}
});
test('all page links and legacy aliases round-trip while keeping unrelated params',()=>{
 for(const c of COMMAND_REGISTRY){const state={page:c.page,ticker:'QQQ'};const url=commandUrl(state,'https://test.local/?keep=yes');assert.deepEqual(stateFromUrl(url,current).state,state);assert.equal(url.searchParams.get('keep'),'yes');assert.deepEqual(parseCommand(formatCommand(state),{...current,ticker:'QQQ'}).state,state)}
 for(const [alias,page] of [['greeks','gex'],['lwc','gp'],['volatility','vol'],['gru','regime']])assert.equal(stateFromUrl(new URL(`https://test.local/?view=${alias}`),current).state.page,page);
 assert.ok(stateFromUrl(new URL('https://test.local/?view=nope'),current).error);
});
test('directory finds labels/topics and local functions reject ignored tickers',()=>{
 assert.ok(searchCommands('gamma').some(c=>c.code==='GEX'));assert.ok(searchCommands('chart studio').some(c=>c.code==='GP'));
 assert.equal(parseCommand('COT',current).state.ticker,'SPY');assert.equal(formatCommand({page:'cot',ticker:'SPY'}),'COT');assert.ok(parseCommand('NVDA COT',current).error);assert.equal(findCommand('greeks').code,'GEX');
});

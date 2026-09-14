const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const start = Date.parse('2026-01-01T00:00:00Z');
const rows = Array.from({length:150}, (_, i) => ({ date: new Date(start+i*86400000).toISOString().slice(0,10), vix:20, rv_trailing:i<30?null:15, rv_forward:i<120?18:null, trailing_returns:22, forward_returns:i<120?21:0, forward_target:new Date(start+(i+30)*86400000).toISOString().slice(0,10), vol_spread:i<30?null:5, variance_spread:i<30?null:175, forward_variance_gap:i<120?76:null }));
const volatility={rows,latest:rows.at(-1),retrieved_at:'2026-06-01T12:00:00Z',source:'Deterministic browser fixture',underlying:'S&P 500',implied:'VIX',horizon_days:30,annual_days:365,spx_last_date:rows.at(-1).date,vix_last_date:rows.at(-1).date,method:'Daily-close squared log returns.',limitations:['Current date excluded. Forward windows overlap.'],evaluation:{samples:120,mean_forward_variance_gap:76,vix_above_forward_pct:100}};
const constituents={etf:'SPY',rows:[{symbol:'NVDA',name:'NVIDIA Corp',weight:.08,beta:2,correlation:.6,relative_return_20:4.7,samples:60,asof:'2026-05-29',error:null},{symbol:'AAPL',name:'Apple Inc',weight:.06,beta:1.1,correlation:.75,relative_return_20:-1.2,samples:60,asof:'2026-05-29',error:null}],coverage:.14,window:60,price_asof:'2026-05-29',retrieved_at:'2026-06-01T12:00:00Z',holdings_asof:null,source:'Fixture holdings',note:'Top holdings only; effective date unavailable.'};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let failVol=false;
  await page.route('**/api/greeks?**',r=>r.fulfill({status:503,json:{error:'Main snapshot unavailable for independence test'}}));
  await page.route('**/api/greeks/rv-vix',r=>r.fulfill({status:failVol?502:200,json:failVol?{detail:'Source temporarily unavailable'}:volatility}));
  await page.route('**/api/greeks/etf-constituents?**',r=>{const etf=new URL(r.request().url()).searchParams.get('etf');return r.fulfill({json:{...constituents,etf}})});
  await page.route('**/api/greeks/constituent-exposure?**',r=>{const ticker=new URL(r.request().url()).searchParams.get('ticker');return r.fulfill({json:{ticker,source:'live',timestamp:'2026-06-01T10:00:00',stale:false,net_gex:ticker==='SPY'?-100000000:50000000,gross_gex:200000000,balance:ticker==='SPY'?-.5:.25,gamma_flip:100,spot:105,note:'Model, not dealer inventory'}})});
  await page.goto('http://127.0.0.1:3000/?view=greeks&ticker=NVDA',{waitUntil:'domcontentloaded'});
  await page.getByRole('tab',{name:'RV vs VIX',exact:true}).click();
  const vol=page.getByRole('region',{name:'RV versus VIX research'});
  await vol.getByText('5.73%',{exact:true}).waitFor();
  assert.match(await vol.textContent(),/Underlying tetap S&P 500/);
  assert.equal(await page.getByText('Snapshot belum tersedia. Pilih ticker atau coba lagi.',{exact:true}).count(),0);
  assert.equal(await page.getByText(/Main snapshot unavailable for independence test/).count(),0);
  await page.getByLabel('Volatility units').selectOption('annual');
  await vol.getByText('20.00%',{exact:true}).waitFor();await vol.getByText('15.00%',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Forward evaluation',exact:true}).click();await vol.getByText('18.00%',{exact:true}).waitFor();
  assert.match(await vol.textContent(),/120/);
  const download=page.waitForEvent('download');await vol.getByRole('button',{name:'Export CSV',exact:true}).click();assert.match((await download).suggestedFilename(),/spx-vix/);
  await page.getByLabel('Volatility history range').selectOption('90');
  const out=path.join(__dirname,'../../.ua/greeks-research');fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:path.join(out,'rv-vix-desktop.png'),fullPage:true});
  failVol=true;await vol.getByRole('button',{name:'Reload daily data'}).click();await vol.getByRole('button',{name:'Retry data'}).waitFor();
  failVol=false;await vol.getByRole('button',{name:'Retry data'}).click();await vol.getByText('20.00%',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'ETF constituents',exact:true}).click();
  const etf=page.getByRole('region',{name:'ETF constituent research'});
  await etf.getByText('14.00%',{exact:true}).waitFor();assert.equal(await page.getByLabel('ETF selection').inputValue(),'SPY');
  await page.getByLabel('Filter constituents').fill('NVDA');assert.equal(await etf.locator('tbody tr').count(),1);
  await page.getByRole('button',{name:'Compare SPY and NVDA GEX',exact:true}).click();
  await etf.getByText('Model negative',{exact:true}).waitFor();await etf.getByText('Model positive',{exact:true}).waitFor();
  assert.match(await etf.textContent(),/model signs differ/i);
  await page.getByLabel('Filter constituents').fill('');await page.getByLabel('Constituent returns window').selectOption('20');
  await etf.locator('tbody tr').first().waitFor();
  await page.screenshot({path:path.join(out,'etf-desktop.png'),fullPage:true});
  for(const width of [1024,768,320]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'ETF viewport '+width);
    await page.screenshot({path:path.join(out,'etf-'+width+'.png'),fullPage:true});
    await page.getByRole('tab',{name:'RV vs VIX',exact:true}).click();await page.getByText('5.73%',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'RV viewport '+width);
    await page.screenshot({path:path.join(out,'rv-'+width+'.png'),fullPage:true});
    await page.getByRole('tab',{name:'ETF constituents',exact:true}).click();await page.getByLabel('ETF selection').waitFor();
  }
  assert.deepEqual(errors,[]);
  console.log('PASS independent panels without main snapshot, horizon/scale switching, matured outcomes, CSV, provider failure/retry, ETF weights, opposite GEX signs, filtering and 320–1440px layouts.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

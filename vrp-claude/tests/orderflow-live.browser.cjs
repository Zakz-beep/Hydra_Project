const { chromium } = require('playwright'); const assert = require('node:assert/strict');
const path = require('node:path'); const fs = require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:3000/terminal',{waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Order flow',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.cs-flow-header [role=status]')?.textContent==='Live' && document.querySelectorAll('.cs-tape-row').length>1 && document.querySelectorAll('.cs-depth-row').length>1,{timeout:60000});
    await page.getByRole('button',{name:'Volume profile',exact:true}).click();
    await page.getByLabel('Volume profile source').selectOption('trades');
    await page.getByLabel('Volume profile range').selectOption('loaded');
    await page.waitForFunction(()=>document.querySelector('.cs-profile-note')?.textContent.includes('Executed volume'),{timeout:15000});
    const dest=path.resolve(__dirname,'../../.ua/chart-studio');fs.mkdirSync(dest,{recursive:true});
    await page.screenshot({path:path.join(dest,'orderflow-live-btc.png'),fullPage:true});
    const times=await page.evaluate(()=>new Promise(resolve=>{let previous=performance.now();const start=previous,deltas=[];function sample(t){deltas.push(t-previous);previous=t;if(t-start<2500)requestAnimationFrame(sample);else resolve(deltas.slice(1).sort((a,b)=>a-b));}requestAnimationFrame(sample);}));
    console.log('Live BTC frame timing:',{medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)]});
    const png=page.waitForEvent('download');await page.getByLabel('Export chart PNG').click();assert.ok((await png).suggestedFilename().endsWith('.png'));
    await page.locator('.cs-symbol-button').click();await page.getByLabel('Search instruments').fill('xyz:TSLA');
    await page.locator('.cs-search-results > button').filter({has:page.locator('strong',{hasText:/^xyz:TSLA$/})}).click();
    await page.waitForFunction(()=>document.querySelector('.cs-chart-header h1')?.textContent.includes('xyz:TSLA') && !document.querySelector('.cs-chart-empty') && document.querySelector('.cs-flow-header [role=status]')?.textContent==='Live' && document.querySelectorAll('.cs-tape-row').length>1,{timeout:60000});
    await page.getByLabel('Volume profile source').selectOption('trades');await page.getByLabel('Volume profile range').selectOption('loaded');
    await page.screenshot({path:path.join(dest,'orderflow-live-tsla.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log('PASS live BTC + HIP-3 TSLA trades/book, profiles, chart PNG, frame timing');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

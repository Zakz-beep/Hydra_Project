const { chromium } = require('playwright'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } }); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const now = Math.floor(Date.now()/3600000)*3600;
    const bars = Array.from({ length: 400 }, (_,i)=>({time:now-(399-i)*3600,open:100+Math.sin(i/8)*5,close:100+Math.cos(i/8)*5,high:107,low:93,volume:100+i}));
    await page.route('**/api/chart-studio/bars?**', route=>route.fulfill({json:{bars,timezone:'UTC',currency:'USDC',note:'Browser fixture',asOf:Date.now()}}));
    await page.route('**/api/chart-studio/stream?**', route=>route.abort());
    await page.addInitScript(() => {
      const Native = window.EventSource; window.__flowClosed = 0; window.__flowOpened = 0;
      window.EventSource = class {
        constructor(url) {
          if (!String(url).includes('/orderflow?')) return new Native(url);
          window.__flowOpened++; window.__flowSocket = this;
          this.timer = setTimeout(() => {
            const time = Date.now()-1000;
            const trade = (id, side, price, size) => ({ id, side, price, size, time });
            const book = {time: Date.now(),bids:[{price:99,size:3,orders:1},{price:98,size:1,orders:1}],asks:[{price:101,size:1,orders:1},{price:102,size:1,orders:1}]};
            this.onmessage?.({data:JSON.stringify({type:'status',status:'Live'})});
            this.onmessage?.({data:JSON.stringify({type:'flow',trades:[trade('1','buy',100,5),trade('2','sell',101,2),trade('1','buy',100,5)],book})});
          },50);
        }
        close(){clearTimeout(this.timer); window.__flowClosed++;}
      };
    });
    await page.goto('http://127.0.0.1:3000/terminal', {waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Order flow',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.cs-flow-metrics')?.textContent.includes('+3'));
    assert.match(await page.locator('.cs-flow-metrics').innerText(),/Buy volume\s+5/);
    assert.equal(await page.locator('.cs-tape-row:not(.cs-depth-labels)').count(),2);
    await page.getByRole('button',{name:'Volume profile',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.cs-profile-levels b')?.textContent!=='—');
    await page.getByLabel('Volume profile source').selectOption('trades');
    await page.waitForFunction(()=>document.querySelector('.cs-profile-note')?.textContent.includes('7 base'));
    await page.getByLabel('Volume profile range').selectOption('loaded');
    await page.waitForFunction(()=>document.querySelector('.cs-profile-note')?.textContent.includes('7 base'));
    await page.getByLabel('Minimum trade notional').fill('300');
    assert.equal(await page.locator('.cs-tape-row:not(.cs-depth-labels)').count(),1);
    assert.match(await page.locator('.cs-flow-metrics').innerText(),/\+3/);
    const download = page.waitForEvent('download'); await page.getByLabel('Export captured trades').click();
    const exported = fs.readFileSync(await (await download).path(),'utf8'); assert.equal(exported.split('\n').length,3);
    const dest=path.resolve(__dirname,'../../.ua/chart-studio'); fs.mkdirSync(dest,{recursive:true});
    await page.screenshot({path:path.join(dest,'orderflow-desktop.png'),fullPage:true});
    await page.evaluate(()=>window.__flowSocket.onmessage({data:JSON.stringify({type:'flow',trades:[],book:null,gap:true})}));
    await page.getByText(/Connection gap detected/).waitFor();
    await page.getByLabel('Reset order flow').click();
    await page.waitForFunction(()=>document.querySelector('.cs-flow-metrics')?.textContent.includes('+0'));
    await page.getByRole('button',{name:'Replay',exact:true}).click();
    await page.getByText('Order flow is paused during replay.',{exact:false}).waitFor();
    assert.ok(await page.evaluate(()=>window.__flowClosed)>=2);
    await page.getByLabel('Volume profile source').selectOption('candles');
    await page.getByLabel('Volume profile rows').selectOption('96');
    await page.getByLabel('Value area percent').selectOption('80');
    await page.getByRole('button',{name:'Exit',exact:true}).click();
    await page.getByRole('button',{name:'Markets',exact:true}).click();
    await page.getByRole('button',{name:/SPY YAHOO FINANCE/}).click();
    await page.getByText(/Select a Hyperliquid market for executed trades/).waitFor();
    for(const width of [768,390,320]){
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
      await page.screenshot({path:path.join(dest,`orderflow-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]); console.log('PASS flow: dedup/delta, depth, trade profile, tape filter, CSV, reset/gap, replay, Yahoo, responsive');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

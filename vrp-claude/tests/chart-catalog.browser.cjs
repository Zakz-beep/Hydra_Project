const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    const guideDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'AI guide .md' }).click();
    const download = await guideDownload; assert.equal(download.suggestedFilename(), 'INDICATOR_AI_GUIDE.md');
    const guide = fs.readFileSync(await download.path(), 'utf8');
    const examples = [...guide.matchAll(/```python\n([\s\S]*?)```/g)].map(m => m[1]);
    assert.equal(examples.length, 2);
    const checks = await page.evaluate(async codes => {
      const worker = new Worker('/chart-studio/python-worker.js'); let id = 0;
      const candles = (length, flat = false) => Array.from({ length }, (_, i) => ({ time: 1700000000 + i * 3600, open: flat ? 10 : 10 + i, high: flat ? 11 : 12 + i, low: flat ? 9 : 9 + i, close: flat ? 10 : 11 + i, volume: 100 }));
      const run = (code, bars, compare = bars) => new Promise((resolve, reject) => {
        const current = ++id; const timeout = setTimeout(() => reject(Error('Python guide example timed out')), 120000);
        worker.onmessage = ({ data }) => { if (data.id === current && (data.result || data.error)) { clearTimeout(timeout); resolve(data); } };
        worker.postMessage({ id: current, code, payload: { datasets: { chart: bars, compare }, symbol: 'xyz:TSLA', interval: '1h' } });
      });
      const outputs = [];
      for (const code of codes) {
        outputs.push(await run(code, candles(60), candles(60, true)));
        outputs.push(await run(code, candles(40), candles(40, true)));
        outputs.push(await run(code, candles(3)));
        outputs.push(await run(code, candles(40, true)));
        outputs.push(await run(code, candles(40).map(b => ({ ...b, close: 0 }))));
      }
      worker.terminate(); return outputs;
    }, examples);
    for (const output of checks) assert.ok(output.result, output.error);
    for (const start of [0, 5]) for (const plot of checks[start + 1].result.plots) {
      if (plot.kind === 'hline') continue;
      const full = checks[start].result.plots.find(p => p.id === plot.id);
      assert.deepEqual(full.data.filter(p => p.time <= 1700000000 + 39 * 3600), plot.data, 'Guide indicator must be causal');
    }
    assert.equal(checks[0].result.plots[0].data.filter(p => p.value === null).length, 19);
    assert.ok(checks[8].result.plots[0].data.every(p => p.value === null));
    console.log('PASS guide download and 10 real Python runs: examples, warmup, short/constant/zero data, causality');
    await page.locator('.cs-symbol-button').click();
    await page.waitForFunction(() => document.querySelector('.cs-market-filters span')?.textContent.includes('active'), { timeout: 45000 });
    await page.getByRole('button', { name: /Show more markets/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.cs-search-results > button').length > 50, { timeout: 15000 });
    await page.getByRole('button', { name: 'HIP-3 / Builders', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.cs-search-results strong')].length > 0 && [...document.querySelectorAll('.cs-search-results strong')].every(e => e.textContent.includes(':')), { timeout: 15000 });
    await page.getByRole('textbox', { name: 'Search instruments' }).fill('tslausdt.p');
    const result = page.locator('.cs-search-results > button').filter({ has: page.locator('strong', { hasText: /^xyz:TSLA$/ }) });
    await result.waitFor({ timeout: 15000 });
    assert.match(await result.innerText(), /USDC/);
    const dest = path.resolve(__dirname, '../../.ua/chart-studio'); fs.mkdirSync(dest, { recursive: true });
    await page.screenshot({ path: path.join(dest, 'hip3-search.png'), fullPage: true });
    await result.click();
    await page.waitForFunction(() => document.querySelector('.cs-chart-header h1')?.textContent.includes('xyz:TSLA') && !document.querySelector('.cs-chart-empty'), { timeout: 45000 });
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), { timeout: 120000 });
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-inspector-content')?.textContent.includes('Mark price'), { timeout: 45000 });
    await page.screenshot({ path: path.join(dest, 'live-tsla-hip3.png'), fullPage: true });
    console.log('PASS live HIP-3 discovery, pagination, alias selection, TSLA candles, Python overlay, asset context');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

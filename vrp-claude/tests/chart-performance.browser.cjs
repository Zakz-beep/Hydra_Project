const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    const end = Math.floor(Date.now() / 3600000) * 3600;
    const bars = Array.from({ length: 20000 }, (_, i) => ({ time: end - (19999 - i) * 3600, open: 100 + i * .01, close: 100.2 + i * .01, high: 101 + i * .01, low: 99 + i * .01, volume: 100 + i % 20 }));
    const code = 'def calculate(ctx):\n    b=ctx.data.ohlcv()\n    for i in range(5):\n        ctx.plot.line(f"MA {i}", b.close.rolling(10 + 5*i).mean())\n    ctx.plot.line("RS", b.close.pct_change()*100, pane="Returns")\n    ctx.plot.histogram("Volume", b.volume, pane="Volume")';
    await page.addInitScript(({ bars, code }) => localStorage.setItem('vrp.chart-studio.v1', JSON.stringify({ version: 1, name: 'Performance fixture', instrument: { provider: 'hyperliquid', symbol: 'BTC', name: 'Bitcoin perpetual' }, interval: '1h', light: false, watchlist: [], studies: [{ id: 'benchmark', name: 'Benchmark', code, params: {}, enabled: true, auto: false }], drawings: { 'hyperliquid:BTC': Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, type: 'trend', color: '#eab86b', points: [{ time: bars[19800 + i].time, price: bars[19800 + i].close + (i % 5) }, { time: bars[19850 + i].time, price: bars[19850 + i].close - (i % 5) }] })) } })), { bars, code });
    await page.route('**/api/chart-studio/bars?*', route => route.fulfill({ json: { bars, currency: 'USDC', timezone: 'UTC', note: 'Performance fixture', asOf: Date.now() } }));
    await page.route('**/api/chart-studio/stream?*', route => route.abort());
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-drawing-id]'); await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), { timeout: 120000 });
    const python = await page.locator('.cs-console').innerText();
    const box = await page.locator('.cs-chart-stage').boundingBox();
    const measure = page.evaluate(() => new Promise(resolve => { const frames = []; let previous; function frame(t) { if (previous) frames.push(t - previous); previous = t; if (frames.length < 180) requestAnimationFrame(frame); else resolve(frames); } requestAnimationFrame(frame); }));
    for (let i = 0; i < 8; i++) { await page.mouse.move(box.x + 300, box.y + 160); await page.mouse.down(); await page.mouse.move(box.x + 350 + i * 8, box.y + 150, { steps: 12 }); await page.mouse.up(); await page.mouse.wheel(i % 2 ? -80 : 80, 0); }
    const frames = (await measure).sort((a, b) => a - b);
    const report = { candles: 20000, lineStudies: 5, oscillatorPanes: 2, drawings: 100, browser: await browser.version(), viewport: '1440x1000', mode: 'headless Chrome; dev build; deterministic fixture', medianFrameMs: frames[Math.floor(frames.length * .5)], p95FrameMs: frames[Math.floor(frames.length * .95)], python, errors };
    const dest = path.resolve(__dirname, '../../.ua/chart-studio'); fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'performance.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(dest, 'performance.png') }); assert.deepEqual(errors, []); console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

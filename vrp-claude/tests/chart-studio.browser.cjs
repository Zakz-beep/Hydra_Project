const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const out = path.resolve(__dirname, '../../.ua/chart-studio'); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  if (!process.env.CHART_LIVE) {
    await page.route('**/api/chart-studio/bars?*', async route => {
      const u = new URL(route.request().url()); const step = ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 })[u.searchParams.get('interval')] || 3600;
      const end = Math.floor(Date.now() / 1000 / step) * step; const base = u.searchParams.get('symbol') === 'SPY' ? 650 : 92000;
      const bars = Array.from({ length: 900 }, (_, i) => { const open = base + i * base * .00003 + Math.sin(i / 14) * base * .005; const close = open + Math.sin(i * .7) * base * .001; return { time: end - (899 - i) * step, open, close, high: Math.max(open, close) + base * .0006, low: Math.min(open, close) - base * .0006, volume: 100 + i % 80 }; });
      await route.fulfill({ json: { bars, currency: u.searchParams.get('provider') === 'yahoo' ? 'USD' : 'USDC', timezone: 'UTC', note: 'Deterministic browser test fixture', asOf: Date.now() } });
    });
    await page.route('**/api/chart-studio/stream?*', route => route.abort());
    await page.route('**/api/chart-studio/search?*', route => route.fulfill({ json: [{ provider: 'yahoo', symbol: 'SPY', name: 'SPDR S&P 500 ETF' }] }));
  }
  try {
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.cs-chart-canvas canvas', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.cs-chart-empty'), { timeout: 45000 });
    console.log('Chart loaded');
    await page.getByRole('button', { name: 'Open Python Studio', exact: true }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed') || document.querySelector('.cs-console-output.cs-error'), { timeout: 150000 });
    const consoleText = await page.locator('.cs-console').innerText();
    const scriptError = await page.locator('.cs-console-output.cs-error').allTextContents();
    console.log('Python:', consoleText, scriptError);
    assert.match(consoleText, /Completed/, scriptError.join('\n'));
    assert.ok(await page.locator('.cs-chart-canvas canvas').count() >= 4, 'Python oscillator pane exists');
    await page.getByRole('button', { name: 'Trendline', exact: true }).click();
    const box = await page.locator('.cs-drawing-layer').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 70); await page.mouse.down(); await page.mouse.move(box.x + 360, box.y + 140, { steps: 10 }); await page.mouse.up();
    await page.waitForSelector('[data-drawing-id]');
    await page.getByRole('button', { name: 'Freehand brush', exact: true }).click();
    await page.mouse.move(box.x + 420, box.y + 80); await page.mouse.down();
    for (let i = 0; i < 20; i++) await page.mouse.move(box.x + 420 + i * 5, box.y + 80 + Math.sin(i / 3) * 20);
    await page.mouse.up();
    assert.equal(await page.locator('[data-drawing-id]').count(), 2);
    await page.getByRole('button', { name: 'Undo drawing', exact: true }).click();
    assert.equal(await page.locator('[data-drawing-id]').count(), 1);
    await page.getByRole('button', { name: 'Redo drawing', exact: true }).click();
    assert.equal(await page.locator('[data-drawing-id]').count(), 2);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle light theme' }).click();
    await page.screenshot({ path: path.join(out, 'light.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle light theme' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-drawing-id]');
    await page.getByRole('button', { name: 'Open Python Studio', exact: true }).click();
    assert.equal(await page.locator('[data-drawing-id]').count(), 2, 'Drawing persistence');
    await page.getByRole('button', { name: '1d', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.cs-chart-empty'));
    assert.equal(await page.locator('[data-drawing-id]').count(), 2, 'Timeframe keeps drawings');
    await page.getByRole('button', { name: /SPY YAHOO FINANCE/ }).click();
    await page.waitForFunction(() => document.querySelector('.cs-chart-header h1')?.textContent.includes('SPY') && !document.querySelector('.cs-chart-empty'));
    assert.equal(await page.locator('[data-drawing-id]').count(), 0, 'Provider/instrument isolates drawings');
    await page.getByLabel('Python code').fill('def calculate(ctx):\n    while True:\n        pass\n');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Computing'), { timeout: 120000 });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Stopped'));
    console.log('Stop interrupts infinite Python loop');
    for (const width of [320, 768, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(out, `width-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No horizontal overflow at ${width}`);
    }
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS chart, Python, drawings, history, provider switch, Stop, theme, responsive');
  } finally { fs.writeFileSync(path.join(out, 'browser-errors.json'), JSON.stringify(errors, null, 2)); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

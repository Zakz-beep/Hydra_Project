const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('vrp.chart-studio.v1', JSON.stringify({ version: 1, name: 'Market Sessions', instrument: { provider: 'hyperliquid', symbol: 'BTC', name: 'Bitcoin perpetual' }, interval: '1h', drawings: {}, studies: [], watchlist: [], light: false })));
    const start = Date.parse('2026-07-01T00:00:00Z') / 1000;
    const bars = Array.from({ length: 24 * 10 }, (_, i) => {
      const open = 60000 + Math.sin(i / 8) * 250 + Math.sin(i / 50) * 700;
      const close = open + Math.sin(i) * 80;
      return { time: start + i * 3600, open, high: Math.max(open, close) + 35, low: Math.min(open, close) - 35, close, volume: 100 + i };
    });
    await page.route('**/api/chart-studio/bars?**', r => r.fulfill({ json: { bars, currency: 'USD', timezone: 'UTC', asOf: Date.now() } }));
    await page.route('**/api/chart-studio/stream?**', r => r.abort());
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open Python Studio' }).click();
    await page.locator('.cs-python input[type=file]').setInputFiles(path.join(__dirname, '../../indicators/custom/market_sessions.py'));
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed in'), { timeout: 120000 });
    assert.equal(await page.locator('.cs-diagnostic').count(), 0);
    await page.waitForFunction(() => document.querySelectorAll('[data-drawing-id^="study:"]').length >= 15);
    assert.match(await page.locator('.cs-python-logs').textContent(), /Europe\/London 0800–1700.*UTC 07:00–16:00/);
    assert.match(await page.locator('.cs-python-logs').textContent(), /America\/New_York 0800–1700.*UTC 12:00–21:00/);
    await page.getByRole('button', { name: 'Configure market_sessions', exact: true }).click();
    await page.getByRole('tab', { name: 'Inputs', exact: true }).click();
    await page.getByLabel('Input show_running_high_low', { exact: true }).fill('1');
    await page.getByLabel('Input show_session_open', { exact: true }).fill('1');
    await page.getByLabel('Input sessions_per_market', { exact: true }).fill('6');
    await page.getByRole('button', { name: 'Run indicator', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-indicator-message')?.textContent.includes('Style previews'));
    await page.getByRole('tab', { name: 'Style', exact: true }).click();
    assert.equal(await page.locator('[data-plot-style]').count(), 30);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Collapse Python editor' }).click();
    const out = path.join(__dirname, '../../.ua/market-sessions'); fs.mkdirSync(out, { recursive: true });
    await page.waitForTimeout(600);
    await page.mouse.move(700, 450);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, 'chart.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS Python import, real browser timezone runtime, 3 session boxes/labels, editable Inputs, and 30 styled outputs.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'The Greeks', exact: true }).click();
    const candles = page.waitForResponse(r => r.url().includes('/api/chart-studio/bars?') && r.url().includes('symbol=SPY'));
    await page.getByRole('button', { name: 'Use SPY Yahoo chart', exact: true }).click();
    const bars = await (await candles).json(); assert.ok(bars.bars?.length > 10, JSON.stringify(bars));
    await page.getByRole('button', { name: 'Add complete indicator', exact: true }).click();
    const response = page.waitForResponse(r => r.url().includes('/api/greeks/chart-data?'));
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const payload = await (await response).json();
    assert.equal(payload.meta.source, 'live'); assert.ok(payload.chain.length > 0);
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), null, { timeout: 120000 });
    const logs = await page.locator('.cs-console-output').innerText();
    assert.match(logs, /THE GREEKS \/ SPY \/ live/); assert.match(logs, /Filtered GEX USD\/1%/);
    await page.screenshot({ path: path.resolve(__dirname, '../../.ua/chart-studio/greeks-live.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, source: payload.meta.source, contracts: payload.chain.length, history: payload.history.length, candles: bars.bars.length, snapshot: payload.snapshot.timestamp, spot: payload.snapshot.spot }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

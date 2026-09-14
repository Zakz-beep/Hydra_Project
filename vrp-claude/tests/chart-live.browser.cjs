const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('.cs-chart-empty') && document.querySelector('.cs-chart-canvas canvas'), { timeout: 60000 });
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), { timeout: 120000 });
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-data-details') && document.querySelector('.cs-inspector-content')?.textContent.includes('Mark price'), { timeout: 30000 });
    console.log('Hyperliquid live:', await page.locator('.cs-feed-status').innerText());
    const dest = path.resolve(__dirname, '../../.ua/chart-studio'); fs.mkdirSync(dest, { recursive: true }); await page.screenshot({ path: path.join(dest, 'live-hyperliquid.png'), fullPage: true });
    await page.getByRole('button', { name: 'Markets', exact: true }).click(); await page.getByRole('button', { name: /SPY YAHOO FINANCE/ }).click();
    await page.waitForFunction(() => !document.querySelector('.cs-chart-empty') && document.querySelector('.cs-chart-header h1')?.textContent.includes('SPY'), { timeout: 45000 });
    await page.getByRole('button', { name: 'Run', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), { timeout: 120000 });
    await page.screenshot({ path: path.join(dest, 'live-yahoo.png'), fullPage: true });
    assert.deepEqual(errors, []); console.log('PASS actual Hyperliquid candles/context + actual Yahoo candles + Python overlays');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

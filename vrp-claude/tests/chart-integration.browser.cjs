const { chromium } = require('playwright'); const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/paper/**', route => route.fulfill({ json: { balance: 10000, positions: [], history: [] } }));
    await page.goto('http://127.0.0.1:3000/?view=lwc', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.chart-studio', { timeout: 60000 });
    await page.waitForFunction(() => !document.querySelector('.cs-chart-empty'), { timeout: 45000 });
    await page.getByRole('button', { name: 'Paper & macro', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Chart Studio' }).waitFor();
    await page.getByRole('button', { name: 'Back to Chart Studio' }).click();
    await page.waitForSelector('.chart-studio'); await page.waitForFunction(() => !document.querySelector('.cs-chart-empty'), { timeout: 45000 });
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await page.getByLabel('Replay position').waitFor();
    const before = await page.getByLabel('Replay position').inputValue();
    await page.getByRole('button', { name: 'Next replay candle' }).click();
    assert.equal(Number(await page.getByLabel('Replay position').inputValue()), Number(before) + 1);
    await page.getByRole('button', { name: 'Exit', exact: true }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.cs-console')?.textContent.includes('Completed'), { timeout: 120000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export chart PNG', exact: true }).click();
    const download = await downloadPromise; assert.match(download.suggestedFilename(), /chart.png$/);
    const exportPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click(); const exported = await exportPromise;
    const workspacePath = await exported.path(); assert.ok(workspacePath);
    assert.deepEqual(errors, []); console.log('PASS embedded LWC, legacy paper navigation (mock account), replay step, Python, PNG/workspace export');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

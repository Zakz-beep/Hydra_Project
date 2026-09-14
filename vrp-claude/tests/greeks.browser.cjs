// Run with NODE_PATH pointing to a runtime that provides Playwright.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const output = path.resolve(__dirname, '../../.ua/runtime');
const makeSnapshot = ticker => {
  const spot = ticker === 'QQQ' ? 500 : 650;
  const by_expiry = Object.fromEntries([0, 7, 30].map((bucket, bi) => {
    const strikes = Array.from({ length: 31 }, (_, i) => ['call', 'put'].map(side => {
      const strike = spot - 75 + i * 5;
      const oi = Math.round(16000 * Math.exp(-Math.pow((i - (side === 'call' ? 18 : 12)) / 6, 2))) + 100;
      const gamma = oi / 1000 * (side === 'call' ? 1 : -1) * (bi + 1);
      return { strike, expiry: `2026-${bi === 2 ? '10' : '09'}-${bi === 0 ? '05' : '11'}`, dte: bucket, option_type: side, oi, volume: Math.round(oi / 3), mid_price: 5, iv: .25, delta: side === 'call' ? .5 : -.5, gamma: .02, theta: -.1, vega: .2, rho: .03, vanna: .04, charm: -.02, gex_spotgamma: gamma, gex_raw: gamma, vanna_exp: gamma * 100000, charm_exp: -gamma * 50000, delta_exp: 0, vega_exp: 0 };
    })).flat();
    const net = strikes.reduce((sum, s) => sum + s.gex_spotgamma, 0);
    return [bucket, { dte_bucket: bucket, expiry_dates: [strikes[0].expiry], n_strikes: strikes.length, total_oi_calls: 200000, total_oi_puts: 180000, pcr_oi: .9, net_gex_spotgamma: net, net_gex_raw: net, net_vanna: 200000, net_charm: -300000, net_dai: 0, net_vex: 10000, gross_gex: 800, gross_vanna: 1, gross_charm: 1, gross_vex: 1, max_pain: spot - 5, gamma_flip: spot - 12, largest_gex_strike: spot + 15, largest_gex_value: 12, strikes }];
  }));
  return { ticker, spot, timestamp: '2026-09-05T12:00:00', data_source: 'synthetic', total_net_gex: 21.4, total_gross_gex: 821, total_net_vanna: 2600000, total_net_charm: -1500000, total_net_dai: 1000, total_net_vex: 500000, gamma_flip: spot - 12, gex_regime: 'POSITIVE_GAMMA', signals: { gex_regime: 'POSITIVE_GAMMA', gex_desc: 'Positive net gamma under the positioning model.', vanna_signal: 'POSITIVE_VANNA', vanna_desc: 'Inventory is sensitive to changes in implied volatility.', charm_signal: 'NEGATIVE_CHARM', charm_desc: 'Time decay changes aggregate delta exposure.', dai_bias: 'NEUTRAL', dai_desc: 'Balanced aggregate dealer delta.', vex_signal: 'POSITIVE', vex_desc: '', dgci: 28, dgci_desc: 'Moderate positive gamma concentration.' }, cache: { age_seconds: 20, ttl_seconds: 180, stale: false, refreshing: false }, by_expiry };
};

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.GREEKS_TEST_BROWSER || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  let failSnapshot = false;
  let historyCalls = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = {};
    let status = 200;
    if (url.pathname === '/api/greeks') {
      status = failSnapshot ? 503 : 200;
      body = failSnapshot ? { error: 'Test feed unavailable' } : makeSnapshot(url.searchParams.get('ticker') || 'SPY');
    } else if (url.pathname === '/api/greeks/history') {
      historyCalls++;
      body = { ticker: url.searchParams.get('ticker'), n: 0, history: [] };
    } else if (url.pathname === '/api/greeks/signals/log') body = { n: 0, signals: [] };
    else if (url.pathname === '/api/greeks/backtest') body = { total_signals: 0, newly_evaluated: 0, by_horizon: { 1: { total: 0, correct: 0, win_rate: null }, 5: { total: 0, correct: 0, win_rate: null }, 20: { total: 0, correct: 0, win_rate: null } }, by_signal_value: {} };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  try {
    await page.goto('http://127.0.0.1:3000/?view=greeks', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('heading', { name: 'Exposure by strike', exact: true }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: /Auto on/ }).click();
    await page.screenshot({ path: path.join(output, 'greeks-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Vanna', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Vanna', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('Exposure expiry bucket').selectOption('7');
    await page.getByText('Bucket max pain', { exact: true }).waitFor();
    await page.getByLabel('Exposure strike range').selectOption('5');
    await page.getByText(/View chart data/).click();
    await page.getByRole('button', { name: 'QQQ', exact: true }).click();
    await page.getByText('$500.00', { exact: true }).waitFor();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.locator('section[aria-label="Greeks workspace"]').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `Greeks workspace overflow at ${width}px`);
      if (width === 320) await page.screenshot({ path: path.join(output, 'greeks-mobile.png'), fullPage: true });
    }
    await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('tab', { name: 'Strikes', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('heading', { name: 'Strike explorer' }).waitFor();
    await page.getByLabel('Option type').selectOption('call');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export filtered CSV' }).click();
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().includes('QQQ'));
    failSnapshot = true;
    await page.getByRole('button', { name: 'SPY', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Test feed unavailable' }).waitFor();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await page.getByText('Belum ada histori snapshot untuk SPY.').waitFor();
    assert.ok(historyCalls > 0, 'History must load without a live snapshot');
    await page.getByRole('tab', { name: 'Signals', exact: true }).click();
    await page.getByText('Belum ada perubahan sinyal untuk SPY.').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: exposure controls, bucket levels, ticker changes, 4 viewport widths, keyboard tabs, CSV download, history/signals during snapshot failure, no browser exceptions.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

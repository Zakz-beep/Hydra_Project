const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const out = path.resolve(__dirname, '../../.ua/runtime');
const fallback = { ticker: 'SPY', timestamp: '2026-09-05T12:00:00', data_source: 'synthetic', spot: 100, total_net_gex: 2, total_gross_gex: 10, total_net_vanna: 1, total_net_charm: -1, total_net_dai: 0, total_net_vex: 1, gamma_flip: 99, signals: {}, by_expiry: {} };
for (const [i, dte] of [1, 5, 12, 25].entries()) {
  const expiry = `2026-09-${String(5 + dte).padStart(2, '0')}`;
  const strikes = Array.from({ length: 25 }, (_, j) => ['call', 'put'].map(option_type => {
    const strike = 70 + j * 2.5 + i * .5;
    return { strike, option_type, expiry, dte, iv: .18 + Math.pow((strike - 100) / 100, 2) * 2 + i * .02, oi: 100, volume: 5, gex_spotgamma: option_type === 'call' ? 1 : -1, vanna_exp: 100, charm_exp: -100 };
  })).flat();
  fallback.by_expiry[dte] = { dte_bucket: dte, expiry_dates: [expiry], strikes, total_oi_calls: 2500, total_oi_puts: 2500, n_strikes: 50, gamma_flip: 99, max_pain: 100, net_gex_spotgamma: 0 };
}
const fixture = process.env.GREEKS_SURFACE_FIXTURE ? JSON.parse(fs.readFileSync(process.env.GREEKS_SURFACE_FIXTURE, 'utf8').replace(/^\uFEFF/, '')) : fallback;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  let version = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(u.pathname === '/api/greeks' ? { ...fixture, ticker: u.searchParams.get('ticker'), timestamp: version ? '2026-09-05T12:01:00' : fixture.timestamp, cache: { stale: false, refreshing: false, age_seconds: 1, ttl_seconds: 180 } } : {}) });
  });
  try {
    await page.goto('http://127.0.0.1:3000/?view=greeks', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Exposure by strike', exact: true }).waitFor({ timeout: 90000 });
    await page.getByRole('tab', { name: 'Surfaces', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.js-plotly-plot')?.data?.[0]?.z, { timeout: 120000 });
    const plot = page.locator('.js-plotly-plot');
    const metrics = await plot.evaluate(g => {
      g._testRenders = 0; g.on('plotly_afterplot', () => g._testRenders++);
      const t = g.data[0]; return { rows: t.y.length, columns: t.x.length, holes: t.z.flat().filter(v => !Number.isFinite(v)).length, cells: t.z.flat().length, pixelRatio: g._context.plotGlPixelRatio };
    });
    assert.equal(metrics.holes, 0); assert.equal(metrics.cells, 4608); assert.equal(metrics.pixelRatio, 1);
    await page.getByRole('button', { name: /Auto on/ }).click();
    await page.waitForTimeout(1500);
    metrics.unrelatedControlRedraws = await plot.evaluate(g => g._testRenders);
    assert.equal(metrics.unrelatedControlRedraws, 0);
    await page.getByRole('button', { name: 'Refresh source', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh source', exact: true }).waitFor();
    await page.waitForTimeout(500);
    assert.equal(await plot.evaluate(g => g._testRenders), 0, 'cache-only polls should not redraw');
    await page.locator('section[aria-label="Volatility term structure analysis"]').screenshot({ path: path.join(out, 'vol-surface-after.png') });
    // Rotate with a real pointer gesture, then deliver a new snapshot.
    const rect = await plot.boundingBox();
    await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5);
    await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .65, rect.y + rect.height * .65, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(500);
    // The live WebGL camera changes during orbit before the layout is committed.
    const camera = await plot.evaluate(g => g._fullLayout.scene._scene.getCamera());
    version++;
    await page.getByRole('button', { name: 'Refresh source', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh source', exact: true }).waitFor();
    await page.waitForTimeout(600);
    const afterCamera = await plot.evaluate(g => g._fullLayout.scene._scene.getCamera());
    for (const key of ['eye', 'up', 'center']) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(afterCamera[key][axis] - camera[key][axis]) < 1e-5, 'camera should survive new snapshots');
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.js-plotly-plot')?._fullLayout?.scene?.camera?.eye?.x === 1.5);
    const expiries = await page.getByLabel('Smile expiry').locator('option').evaluateAll(nodes => nodes.map(n => n.value));
    assert.ok(expiries.length >= 2);
    await page.getByLabel('Smile expiry').selectOption(expiries.at(-1));
    await page.getByLabel('Surface rendering quality').selectOption('fast');
    await page.waitForFunction(() => document.querySelector('.js-plotly-plot')?.data?.[0]?.z?.length === 24);
    await page.getByLabel('Surface strike range').selectOption('5');
    await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.js-plotly-plot')?.data?.[0]?.type === 'heatmap');
    await page.locator('section[aria-label="Volatility term structure analysis"]').screenshot({ path: path.join(out, 'vol-surface-heatmap.png') });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(250);
      const overflow = await page.locator('section[aria-label="Volatility term structure analysis"]').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `surface overflow at ${width}px`);
      if (width === 320) await page.locator('section[aria-label="Volatility term structure analysis"]').screenshot({ path: path.join(out, 'vol-surface-mobile.png') });
    }
    if (!process.env.GREEKS_SURFACE_FIXTURE) {
      await page.getByLabel('Surface minimum OI').selectOption('500');
      await page.getByText(/Need at least two expiries/).waitFor();
      assert.equal(await plot.count(), 0);
      await page.getByLabel('Surface minimum OI').selectOption('10');
      await plot.waitFor();
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'vol-surface-results.json'), JSON.stringify(metrics, null, 2));
    console.log('PASS: finite surface, no redundant redraw, camera persistence/reset, heatmap, slices, filters, 4 widths, no exceptions.', JSON.stringify(metrics));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

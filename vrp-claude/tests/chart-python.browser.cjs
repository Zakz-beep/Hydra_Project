const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage(); await page.goto('http://127.0.0.1:3000/terminal', { waitUntil: 'domcontentloaded' });
    const results = await page.evaluate(async () => {
      const worker = new Worker('/chart-studio/python-worker.js'); let id = 0;
      const bars = [10, 11, 12, 13].map((close, i) => ({ time: 1700000000 + i * 3600, open: close, high: close + 1, low: close - 1, close, volume: 10 }));
      const run = (code, params = {}) => new Promise(resolve => {
        const current = ++id; worker.onmessage = ({ data }) => { if (data.id === current && (data.result || data.error)) resolve(data); };
        worker.postMessage({ id: current, code, payload: { datasets: { chart: bars }, params, symbol: 'TEST', interval: '1h' } });
      });
      const checks = {};
      checks.ema = await run('def calculate(ctx):\n    b=ctx.data.ohlcv()\n    ctx.plot.line("ema", b.close.ewm(span=3, adjust=False).mean())');
      checks.warmup = await run('def calculate(ctx):\n    ctx.plot.line("sma", ctx.data.ohlcv().close.rolling(3).mean())');
      checks.color = await run('def calculate(ctx):\n    ctx.plot.line("bad", ctx.data.ohlcv().close, color="not-a-color")');
      checks.infinity = await run('def calculate(ctx):\n    ctx.plot.hline("bad", float("inf"))');
      checks.duplicate = await run('def calculate(ctx):\n    ctx.plot.hline("x", 1)\n    ctx.plot.hline("x", 2)');
      checks.parameter = await run('def calculate(ctx):\n    n=ctx.input.int("length", default=3, min=2, max=5)\n    ctx.plot.hline("n", n)', { length: 6 });
      checks.dataset = await run('def calculate(ctx):\n    ctx.data.ohlcv("missing")');
      checks.scipy = await run('from scipy.special import expit\ndef calculate(ctx):\n    ctx.plot.hline("sigmoid", float(expit(0)))');
      checks.markers = await run('def calculate(ctx):\n    b=ctx.data.ohlcv()\n    ctx.plot.marker("buy", b.close > 11, text="Buy")\n    ctx.draw.box("zone", b.index[0], b.index[-1], 14, 9)');
      worker.terminate(); return checks;
    });
    assert.deepEqual(results.ema.result.plots[0].data.map(p => p.value), [10, 10.5, 11.25, 12.125]);
    assert.deepEqual(results.warmup.result.plots[0].data.map(p => p.value), [null, null, 11, 12]);
    assert.match(results.color.error, /six-digit hex/); assert.match(results.infinity.error, /finite/);
    assert.match(results.duplicate.error, /Duplicate output ID/); assert.match(results.parameter.error, /between 2 and 5/);
    assert.match(results.dataset.error, /unavailable/); assert.equal(results.scipy.result.plots[0].value, .5);
    assert.equal(results.markers.result.plots[0].data.length, 2); assert.equal(results.markers.result.plots[1].kind, 'box');
    console.log('PASS 9 real Python SDK cases: numeric parity, warmup, validation, scipy, markers, zones');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

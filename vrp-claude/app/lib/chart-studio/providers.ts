import { Bar, Dataset, Instrument, INTERVALS, Interval, fourHourBars, normalizeBars, seconds } from './types';
import { hyperInfo } from './hyperliquidInfo';
import { getHyperliquidCatalog } from './hyperliquidCatalog';
export { hyperInfo } from './hyperliquidInfo';

const cache = new Map<string, { until: number; data: Dataset }>();
export function parseMarket(params: URLSearchParams): { instrument: Instrument; interval: Interval } {
  const provider = params.get('provider') || 'hyperliquid';
  const symbol = params.get('symbol') || 'BTC';
  const interval = params.get('interval') || '1h';
  if (!['hyperliquid', 'yahoo'].includes(provider) || !/^[\w.^=:@/-]{1,40}$/.test(symbol) || !INTERVALS.includes(interval as Interval)) throw new Error('Invalid provider, symbol or interval');
  return { instrument: { provider: provider as Instrument['provider'], symbol, name: symbol }, interval: interval as Interval };
}
export function hyperBar(c: Record<string, unknown>): Bar {
  return { time: Number(c.t) / 1000, open: Number(c.o), high: Number(c.h), low: Number(c.l), close: Number(c.c), volume: Number(c.v) };
}
export async function getBars(instrument: Instrument, interval: Interval): Promise<Dataset> {
  const key = `${instrument.provider}:${instrument.symbol}:${interval}`;
  const hit = cache.get(key); if (hit && hit.until > Date.now()) return hit.data;
  let data: Dataset;
  if (instrument.provider === 'hyperliquid') {
    const [rows, catalog] = await Promise.all([
      hyperInfo({ type: 'candleSnapshot', req: { coin: instrument.symbol, interval, startTime: Date.now() - seconds(interval) * 1000 * 1500, endTime: Date.now() } }),
      getHyperliquidCatalog(),
    ]);
    const market = catalog.find(i => i.symbol === instrument.symbol);
    if (!market) throw new Error('Instrument is not an active Hyperliquid market. Select a contract in Market explorer.');
    if (!Array.isArray(rows)) throw new Error('No candle history for this Hyperliquid instrument');
    data = { bars: normalizeBars(rows.map(hyperBar)), timezone: 'UTC', currency: market.collateral || 'Unknown', note: `Perpetual · ${market.venue === 'native' ? 'Hyperliquid' : market.venue + ' / HIP-3'} · collateral ${market.collateral || 'unknown'} · native candles · volume in base asset`, asOf: Date.now() };
  } else {
    const native = interval === '4h' ? '1h' : interval;
    const range = interval === '1m' ? '5d' : interval === '1d' ? '5y' : '1mo';
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(instrument.symbol)}?interval=${native}&range=${range}&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!r.ok) throw new Error(`Yahoo returned ${r.status}. Please retry shortly.`);
    const raw = await r.json(); const result = raw.chart?.result?.[0];
    if (!result) throw new Error(raw.chart?.error?.description || 'No Yahoo history for this symbol');
    const q = result.indicators?.quote?.[0];
    if (!q) throw new Error('Yahoo response has no OHLCV');
    let bars = normalizeBars((result.timestamp || []).map((time: number, j: number) => ({ time, open: q.open[j] ?? NaN, high: q.high[j] ?? NaN, low: q.low[j] ?? NaN, close: q.close[j] ?? NaN, volume: q.volume[j] ?? 0 })));
    const timezone = result.meta?.exchangeTimezoneName || 'UTC';
    if (interval === '4h') bars = fourHourBars(bars, timezone);
    data = { bars, timezone, currency: result.meta?.currency || 'USD', note: `Regular session · raw OHLC · Yahoo may be delayed${interval === '4h' ? ' · session-bucketed 4h' : ''}`, asOf: Date.now() };
  }
  if (!data.bars.length) throw new Error('No candles available for this symbol and timeframe');
  if (cache.size > 100) cache.clear(); cache.set(key, { until: Date.now() + 10000, data });
  return data;
}

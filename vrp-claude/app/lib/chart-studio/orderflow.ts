import { Bar } from './types';

export interface FlowTrade { id: string; time: number; price: number; size: number; side: 'buy' | 'sell' }
export interface BookLevel { price: number; size: number; orders: number }
export interface FlowBook { time: number; bids: BookLevel[]; asks: BookLevel[] }
export interface ProfileBin { low: number; high: number; volume: number; buy: number; sell: number }
export interface VolumeProfile { bins: ProfileBin[]; total: number; poc: number; val: number; vah: number; actualValueArea: number; source: 'trades' | 'candles'; from: number; to: number }

export function parseTrades(raw: unknown, symbol: string): FlowTrade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(t => {
    if (!t || t.coin !== symbol || !['B', 'A'].includes(t.side)) return [];
    const time = Number(t.time), price = Number(t.px), size = Number(t.sz);
    if (![time, price, size].every(Number.isFinite) || time <= 0 || price <= 0 || size <= 0 || !Number.isSafeInteger(t.tid)) return [];
    return [{ id: `${symbol}:${time}:${t.tid}`, time, price, size, side: t.side === 'B' ? 'buy' as const : 'sell' as const }];
  });
}
export function mergeTrades(previous: FlowTrade[], incoming: FlowTrade[], cutoff = 0, cap = 20000): FlowTrade[] {
  const byId = new Map<string, FlowTrade>();
  for (const t of previous) if (t.time >= cutoff) byId.set(t.id, t);
  for (const t of incoming) if (t.time >= cutoff) byId.set(t.id, t);
  return Array.from(byId.values()).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).slice(-cap);
}
export function parseBook(raw: unknown, symbol: string): FlowBook | null {
  const b = raw as { coin: string; time: number; levels: { px: string; sz: string; n: number }[][] } | null;
  if (!b || b.coin !== symbol || !Number.isFinite(b.time) || b.time <= 0 || !Array.isArray(b.levels) || b.levels.length !== 2) return null;
  const levels = (xs: typeof b.levels[0]) => Array.isArray(xs) ? xs.map(x => ({ price: Number(x.px), size: Number(x.sz), orders: Number(x.n) })).filter(x => [x.price, x.size, x.orders].every(Number.isFinite) && x.price > 0 && x.size > 0 && x.orders >= 0) : [];
  const bids = levels(b.levels[0]).sort((a, z) => z.price - a.price).slice(0, 20);
  const asks = levels(b.levels[1]).sort((a, z) => a.price - z.price).slice(0, 20);
  if (bids.length && asks.length && bids[0].price >= asks[0].price) return null;
  return { time: b.time, bids, asks };
}
export function flowStats(trades: FlowTrade[], bucketMs = 10000) {
  let buy = 0, sell = 0; const buckets = new Map<number, number>();
  for (const t of trades) {
    if (t.side === 'buy') buy += t.size; else sell += t.size;
    const time = Math.floor(t.time / bucketMs) * bucketMs;
    buckets.set(time, (buckets.get(time) || 0) + (t.side === 'buy' ? t.size : -t.size));
  }
  let cumulative = 0;
  const cvd = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([time, delta]) => ({ time, delta, value: cumulative += delta }));
  return { buy, sell, delta: buy - sell, buyRatio: buy + sell ? buy / (buy + sell) : null, cvd };
}
export function depthStats(book: FlowBook | null, count: number) {
  const bids = book?.bids.slice(0, count) || [], asks = book?.asks.slice(0, count) || [];
  const bidSize = bids.reduce((n, b) => n + b.size, 0), askSize = asks.reduce((n, b) => n + b.size, 0);
  const spread = bids.length && asks.length ? asks[0].price - bids[0].price : null;
  const mid = bids.length && asks.length ? (asks[0].price + bids[0].price) / 2 : null;
  return { bids, asks, bidSize, askSize, spread, spreadBps: spread != null && mid ? spread / mid * 10000 : null, imbalance: bidSize + askSize ? (bidSize - askSize) / (bidSize + askSize) : null };
}

export function volumeProfile(source: 'trades' | 'candles', trades: FlowTrade[], bars: Bar[], rows = 48, valueArea = .7): VolumeProfile | null {
  const points = source === 'trades' ? trades.map(t => ({ low: t.price, high: t.price, volume: t.size, side: t.side, time: t.time / 1000 })) : bars.filter(b => b.volume > 0).map(b => ({ low: b.low, high: b.high, volume: b.volume, side: '' as string, time: b.time }));
  if (!points.length) return null;
  let low = Infinity, high = -Infinity, from = Infinity, to = -Infinity;
  for (const p of points) { low = Math.min(low, p.low); high = Math.max(high, p.high); from = Math.min(from, p.time); to = Math.max(to, p.time); }
  const count = high === low ? 1 : Math.max(8, Math.min(120, Math.round(rows)));
  const step = high === low ? Math.max(Math.abs(low) * .0001, 1e-8) : (high - low) / count;
  if (high === low) low -= step / 2;
  const bins: ProfileBin[] = Array.from({ length: count }, (_, i) => ({ low: low + i * step, high: low + (i + 1) * step, volume: 0, buy: 0, sell: 0 }));
  const index = (price: number) => Math.max(0, Math.min(count - 1, Math.floor((price - low) / step)));
  for (const p of points) {
    const first = index(p.low), last = index(p.high);
    for (let i = first; i <= last; i++) {
      // Uniform candle range allocation is an estimate, never aggressor delta.
      const fraction = p.high === p.low ? 1 : Math.max(0, Math.min(p.high, bins[i].high) - Math.max(p.low, bins[i].low)) / (p.high - p.low);
      const volume = p.volume * fraction; bins[i].volume += volume;
      if (p.side === 'buy') bins[i].buy += volume; if (p.side === 'sell') bins[i].sell += volume;
    }
  }
  const total = bins.reduce((n, b) => n + b.volume, 0); if (!total) return null;
  let poc = 0; bins.forEach((b, i) => { if (b.volume > bins[poc].volume) poc = i; });
  let left = poc, right = poc, covered = bins[poc].volume;
  const target = total * Math.max(.5, Math.min(.95, valueArea));
  while (covered < target && (left > 0 || right < bins.length - 1)) {
    const below = left > 0 ? bins[left - 1].volume : -1, above = right < bins.length - 1 ? bins[right + 1].volume : -1;
    if (above > below) covered += bins[++right].volume; else covered += bins[--left].volume;
  }
  return { bins, total, poc: (bins[poc].low + bins[poc].high) / 2, val: bins[left].low, vah: bins[right].high, actualValueArea: covered / total, source, from, to };
}

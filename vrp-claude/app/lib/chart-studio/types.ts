export type Provider = 'hyperliquid' | 'yahoo';
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type Interval = typeof INTERVALS[number];
export interface Instrument { provider: Provider; symbol: string; name: string; venue?: string; collateral?: string }
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface MarketContext { markPrice: number; oraclePrice: number; openInterest: number; funding: number; volume24h: number; asOf: number }
export interface Dataset { bars: Bar[]; timezone: string; currency: string; note: string; asOf: number; market?: MarketContext }
export interface Point { time: number; price: number }
export type Tool = 'cursor' | 'trend' | 'ray' | 'horizontal' | 'vertical' | 'rectangle' | 'fib' | 'brush' | 'text' | 'measure' | 'long' | 'short' | 'eraser';
export interface Drawing { id: string; type: Exclude<Tool, 'cursor' | 'eraser'>; points: Point[]; color: string; text?: string; name?: string; hidden?: boolean; locked?: boolean; lineWidth?: number; lineStyle?: 'solid' | 'dashed' | 'dotted'; fillOpacity?: number; opacity?: number }
export interface Plot { id: string; kind: 'line' | 'histogram' | 'area' | 'hline' | 'marker' | 'box'; pane: string; color: string; title: string; data: { time: number; value?: number | null; text?: string }[]; value?: number; endTime?: number; top?: number; bottom?: number }
export interface Parameter { name: string; value: number; min: number; max: number; step: number }
export interface Study { id: string; name: string; code: string; params: Record<string, number>; enabled: boolean; auto: boolean; styles?: Record<string, Partial<import('./plotStyle').PlotStyle>> }
export interface StudyResult { plots: Plot[]; inputs: Parameter[]; duration: number; logs: string[]; context: string; code: string; params: Record<string, number> }
export interface Workspace { version: 1; name: string; instrument: Instrument; interval: Interval; drawings: Record<string, Drawing[]>; studies: Study[]; watchlist: Instrument[]; light: boolean; appearance?: import('./appearance').ChartAppearance; greeks?: { enabled: boolean; ticker: string }; chartType?: string; logScale?: boolean; compare?: { key: string; interval: Interval }; viewport?: { key: string; from: number; to: number } }
export const keyOf = (i: Instrument) => `${i.provider}:${i.symbol}`;
export const seconds = (i: Interval) => ({ '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 })[i];
export const WATCHLIST: Instrument[] = [
  { provider: 'hyperliquid', symbol: 'BTC', name: 'Bitcoin perpetual' },
  { provider: 'hyperliquid', symbol: 'ETH', name: 'Ethereum perpetual' },
  { provider: 'hyperliquid', symbol: 'SOL', name: 'Solana perpetual' },
  { provider: 'yahoo', symbol: 'SPY', name: 'SPDR S&P 500 ETF' },
  { provider: 'yahoo', symbol: 'QQQ', name: 'Invesco QQQ Trust' },
  { provider: 'yahoo', symbol: 'AAPL', name: 'Apple Inc.' },
  { provider: 'yahoo', symbol: 'NVDA', name: 'NVIDIA Corporation' },
];
export function normalizeBars(rows: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const b of rows) if ([b.time, b.open, b.high, b.low, b.close, b.volume].every(Number.isFinite) && b.time > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close) && b.volume >= 0) map.set(Math.floor(b.time), { ...b, time: Math.floor(b.time) });
  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}
export function mergeBar(bars: Bar[], bar: Bar): Bar[] {
  if (!normalizeBars([bar]).length) return bars;
  const last = bars.at(-1);
  if (!last || bar.time > last.time) return [...bars, bar].slice(-20000);
  if (bar.time === last.time) return [...bars.slice(0, -1), bar];
  return normalizeBars([...bars, bar]).slice(-20000);
}
export function fourHourBars(rows: Bar[], timezone: string): Bar[] {
  const buckets = new Map<string, Bar>();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const bar of rows) {
    const parts = Object.fromEntries(fmt.formatToParts(bar.time * 1000).map(p => [p.type, p.value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const anchor = timezone === 'America/New_York' ? 570 : 0;
    const key = `${parts.year}-${parts.month}-${parts.day}:${Math.floor((minute - anchor) / 240)}`;
    const old = buckets.get(key);
    buckets.set(key, old ? { ...old, high: Math.max(old.high, bar.high), low: Math.min(old.low, bar.low), close: bar.close, volume: old.volume + bar.volume } : { ...bar });
  }
  return Array.from(buckets.values());
}

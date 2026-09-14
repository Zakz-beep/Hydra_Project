import type { GreeksSnapshot, StrikeGreeks, OIChangeItem } from '../greeks';
export interface GreeksInput {
  snapshot: GreeksSnapshot | null;
  chain: (StrikeGreeks & { bucket: string })[];
  history: (Omit<GreeksSnapshot, 'time'> & { time: number })[];
  oi_changes: OIChangeItem[];
  meta: { ticker: string; observed_at: number; snapshot_time: number | null; source: string; contract_size: number; replay?: boolean; cutoff?: number; warnings?: string[]; [key: string]: unknown };
}
export function prepareGreeksInput(raw: GreeksInput, ticker: string, cutoff: number, replay: boolean): GreeksInput {
  if (!raw?.meta || raw.meta.ticker !== ticker || !Array.isArray(raw.chain) || !Array.isArray(raw.history) || !raw.snapshot || !Number.isFinite(raw.snapshot.spot) || raw.snapshot.spot <= 0) throw new Error('Greeks dataset is incomplete or belongs to another ticker');
  const history = raw.history.filter(h => Number.isFinite(h.time) && h.time <= cutoff).slice(-500);
  return { ...raw, history, snapshot: replay ? null : raw.snapshot, chain: replay ? [] : raw.chain, oi_changes: replay ? [] : raw.oi_changes || [], meta: { ...raw.meta, replay, cutoff, snapshot_time: replay ? null : raw.meta.snapshot_time } };
}
export async function fetchGreeksInput(ticker: string, cutoff: number, replay: boolean, signal: AbortSignal): Promise<GreeksInput> {
  const response = await fetch(`/api/greeks/chart-data?${new URLSearchParams({ ticker, history_limit: '500' })}`, { signal, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.detail || 'Greeks service unavailable. Start the Python backend, then Run again.');
  return prepareGreeksInput(result, ticker, cutoff, replay);
}

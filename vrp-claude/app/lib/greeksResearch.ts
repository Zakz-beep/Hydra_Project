export interface VolatilityRow {
  date: string; vix: number; rv_trailing: number | null; rv_forward: number | null;
  trailing_returns: number; forward_returns: number; forward_target: string;
  vol_spread: number | null; variance_spread: number | null; forward_variance_gap: number | null;
}
export interface VolatilityResearch {
  rows: VolatilityRow[]; latest: VolatilityRow; retrieved_at: string; source: string;
  underlying: string; implied: string; horizon_days: number; annual_days: number;
  spx_last_date: string; vix_last_date: string; method: string; limitations: string[];
  evaluation: { samples: number; mean_forward_variance_gap: number | null; vix_above_forward_pct: number | null };
}
export interface Constituent {
  symbol: string; name: string; weight: number; samples: number; beta: number | null;
  correlation: number | null; relative_return_20: number | null; asof: string | null; error: string | null;
}
export interface ConstituentResearch {
  etf: string; rows: Constituent[]; coverage: number; window: number; price_asof: string;
  retrieved_at: string; holdings_asof: string | null; source: string; note: string;
}
export interface ExposureSummary {
  ticker: string; source: string; timestamp: string | null; stale: boolean;
  net_gex: number | null; gross_gex: number | null; balance: number | null;
  gamma_flip: number | null; spot: number | null; note: string;
}
export async function researchFetch<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/greeks/${path}`, { signal, cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : payload.error || 'Research data could not be loaded.');
  return payload as T;
}
export function researchCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([[keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}
export const numberLabel = (n: number | null | undefined, digits = 2) => n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

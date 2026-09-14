export interface HistoryParameters {
  ticker: string; start: string; end: string; min_dte: number; max_dte: number;
  weekday: number | null; rate: number; dividend_yield: number; min_oi: number;
  max_spread_pct: number; min_coverage: number; min_contracts: number;
  rule: 'positive_gex' | 'negative_gex' | 'above_flip'; cost_bps: number;
}
export interface HistoricalLevels {
  gex: number | null; gross_gex: number | null; gamma_flip: number | null;
  call_wall: number | null; put_wall: number | null; max_pain: number | null;
  vanna_exposure: number | null; charm_exposure: number | null; mean_iv: number | null;
}
export interface HistoricalContract {
  symbol: string; expiry: string; side: string; strike: number; oi: number; volume: number | null;
  bid: number; ask: number; iv: number; delta: number; gamma: number; theta: number; vega: number; gex: number;
}
export interface HistoricalDay extends HistoricalLevels {
  date: string; spot: number | null; raw_contracts: number; contracts_used: number;
  oi_coverage: number | null; exclusions: Record<string, number>; captured_at: string;
  expiries: (HistoricalLevels & { expiry: string })[]; contracts?: HistoricalContract[];
}
export interface ImportJob {
  id: string; state: string; total: number; completed: number; requests: number;
  current_date?: string; error: string | null; cancel_requested: boolean;
  error_code?: string | null; latest_available?: string | null;
}
export interface HistoricalSurfaceLevels {
  date: string; captured_at: string; spot: number | null; model_version: string;
  parameters: HistoryParameters; selected_expiries: string[]; contracts_used: number;
  levels: HistoricalLevels; expiries: HistoricalDay['expiries'];
  profile: {strike: number; call: number; put: number; net: number}[];
}
export interface HistoryStatus {
  configured: boolean; dates: {day: string; scope: number; captured: string}[]; jobs: ImportJob[];
}
export interface HistoryAnalysis {
  parameters: HistoryParameters; model_version: string; days: HistoricalDay[];
  gaps: {date: string; reason: string}[]; requested_sessions: number; methodology: string[];
  backtest: {
    sessions: number; trades: number; total_return: number | null; benchmark_return: number | null;
    max_drawdown: number | null; win_rate: number | null; skipped: Record<string, number>;
    ledger: {signal_date: string; date: string; gex: number; active: boolean; open: number; close: number;
      gross_return: number; net_return: number; equity: number; benchmark: number}[];
    regimes: {regime: string; n: number; ties: number; mean_return: number | null; mean_absolute_return: number | null;
      posterior_up: number; credible_interval: number[]; prior: string}[];
  };
}
export async function marketdata<T>(path: string, body?: unknown, method = body ? 'POST' : 'GET', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/greeks/marketdata/${path}`, {
    method, headers: body ? {'Content-Type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined, signal,
  });
  const value = await response.json();
  if (!response.ok) {
    const detail = value.detail;
    throw new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((x: {msg: string}) => x.msg).join(' · ') : `Request failed (${response.status})`);
  }
  return value;
}
export function downloadResearch(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

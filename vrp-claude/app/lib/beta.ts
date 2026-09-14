export type Interval = [number, number];
export interface BetaStats {
  beta: number; beta_ci: Interval; beta_se: number;
  alpha_daily: number; alpha_annual: number; alpha_ci_daily: Interval;
  r_squared: number | null; correlation: number | null;
  idiosyncratic_vol_daily: number; idiosyncratic_vol_annual: number;
  total_vol_annual: number; n_observations: number;
  covariance_method: string; hac_lags: number | null;
  residual_quantiles: [number, number, number]; market_range: Interval;
  bayesian: { prior_mean: number; prior_sd: number; mean: number; interval: Interval };
}
export interface BetaObservation {
  date: string; asset_return: number; market_return: number; fitted: number; residual: number;
}
export interface BetaAnalysis {
  benchmark: string; stats: BetaStats;
  asymmetric_beta: {
    beta_upside: number | null; beta_downside: number | null;
    up_ci: Interval | null; down_ci: Interval | null;
    n_up: number; n_down: number; n_flat: number;
    mean_asset_up: number | null; mean_asset_down: number | null;
  };
  scatter_data: BetaObservation[];
  rolling_beta: { date: string; start: string; beta: number | null; low: number | null; high: number | null; r_squared: number | null }[];
  stability: { latest: number | null; min: number | null; max: number | null; change: number | null };
  events: BetaObservation[];
  regression_line: { x_min: number; x_max: number; y_min: number; y_max: number };
  price_info: { asset_last_price: number; bench_last_price: number; data_start: string; data_end: string };
}
export interface BetaResponse {
  version: number; ticker: string; benchmark: string; period: string;
  rolling_window: number; annualization: number; analyses: BetaAnalysis[]; timestamp: string;
  metadata: { source: string; retrieved_at: string; current_utc_date_excluded: boolean;
    downloaded_rows: number; aligned_prices: number; excluded_rows: number;
    observations: number; first_return: string; last_return: string; warnings: string[] };
}
export interface BetaConfig { ticker: string; benchmarks: string; period: string; window: number; annualization: number }
export const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
export const pct = (value: number | null | undefined) => value == null ? '—' : `${number(value * 100)}%`;
export const interval = (value: Interval | null) => value ? `${number(value[0])} to ${number(value[1])}` : 'Unavailable';
export async function fetchBeta(config: BetaConfig, signal: AbortSignal): Promise<BetaResponse> {
  const benchmarks = Array.from(new Set(config.benchmarks.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)));
  if (!benchmarks.length || benchmarks.length > 4) throw new Error('Masukkan 1–4 benchmark, dipisahkan koma.');
  const query = new URLSearchParams({ ticker: config.ticker.trim().toUpperCase(), benchmark: benchmarks[0], compare: benchmarks.slice(1).join(','), period: config.period, rolling_window: String(config.window), annualization: String(config.annualization) });
  const response = await fetch(`/api/beta/analysis?${query}`, { signal, cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `BETA request failed (${response.status}). Periksa server dan parameter.`);
  if (body?.version !== 2 || !body?.analyses?.length) throw new Error('Backend BETA belum versi 2. Restart server lewat launcher dashboard.');
  return body;
}
export function downloadBeta(data: BetaResponse, format: 'json' | 'csv') {
  const rows = [['asset', 'benchmark', 'beta', 'ci95_low', 'ci95_high', 'r_squared', 'residual_vol_annual', 'beta_up', 'beta_down', 'n', 'first_return', 'last_return', 'annualization', 'retrieved_at'], ...data.analyses.map(a => [data.ticker, a.benchmark, a.stats.beta, ...a.stats.beta_ci, a.stats.r_squared, a.stats.idiosyncratic_vol_annual, a.asymmetric_beta.beta_upside, a.asymmetric_beta.beta_downside, a.stats.n_observations, data.metadata.first_return, data.metadata.last_return, data.annualization, data.metadata.retrieved_at])];
  const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const content = format === 'json' ? JSON.stringify(data, null, 2) : rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `beta-${data.ticker}-${data.metadata.last_return}.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

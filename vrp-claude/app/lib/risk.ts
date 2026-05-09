// vrp-claude/app/lib/risk.ts
// Types & fetch helpers for Risk Management Pipeline API (port 8002)
// Aligned to Module 1-3 architecture

// ─────────────────────────────────────────────────
// Types — Pipeline Status
// ─────────────────────────────────────────────────

export interface RiskStatus {
  is_running:       boolean;
  last_run:         string | null;
  ticker:           string;
  error:            string | null;
  phases_complete: {
    phase2: boolean;
    phase3: boolean;
    phase4: boolean;
    phase5: boolean;
    phase6: boolean;
  };
  available_models: string[];
}

// ─────────────────────────────────────────────────
// Types — Regime (Module 1)
// ─────────────────────────────────────────────────

export interface RegimeStat {
  label:                    string;
  n_observations:           number;
  frequency_pct:            number;
  mean_return_annualized:   number;
  vol_annualized:           number;
  sharpe_approx:            number;
  skewness:                 number;
  excess_kurtosis:          number;
  avg_duration_days:        number;
  max_duration_days:        number;
}

export interface RegimeInfo {
  ticker:            string;
  current_regime:    string;
  confidence:        number;
  regime_probs:      Record<string, number>;
  regime_stats:      Record<string, RegimeStat>;
  transition_matrix: Record<string, Record<string, number>> | null;
  n_states:          number;
}

// ─────────────────────────────────────────────────
// Types — Daily Brief (Module 1)
// ─────────────────────────────────────────────────

export interface DailyBriefEvent {
  time:     string;
  country:  string;
  title:    string;
  forecast: string;
  previous: string;
}

export interface DailyBrief {
  date:                string;
  total_events_today:  number;
  high_impact_count:   number;
  high_impact_events:  DailyBriefEvent[];
  status?:             string; // fallback when no data
}

// ─────────────────────────────────────────────────
// Types — Account State
// ─────────────────────────────────────────────────

export interface AccountState {
  id:              number;
  balance:         number;
  equity:          number;
  margin_used:     number;
  daily_loss_limit: number;
  max_trailing_dd: number;
  last_updated:    string;
}

// ─────────────────────────────────────────────────
// Types — Behavioral Profile (Module 3)
// ─────────────────────────────────────────────────

export interface BehavioralProfile {
  id:              number;
  score:           number;
  revenge_count:   number;
  overtrade_count: number;
  fomo_count:      number;
  last_trade_time: string;
}

// ─────────────────────────────────────────────────
// Types — Pre-Trade (Module 1 + 2)
// ─────────────────────────────────────────────────

export interface PreTradeRequest {
  ticker:      string;
  direction:   string;
  lot_size:    number;
  entry_price: number;
}

export interface PreTradeScenario {
  lot_size:               number;
  risk_dollars:           number;
  percent_of_daily_budget?: number;
  target_risk_pct?:       number;
  is_rejected:            boolean;
}

export interface PreTradeSimulation {
  ticker:               string;
  direction:            string;
  entry_price:          number;
  tp_target:            number;
  sl_options:           Record<string, number>;  // tight, normal, wide
  correlation_warnings: string[];
  scenarios: {
    user:        PreTradeScenario;
    recommended: PreTradeScenario;
  };
}

export interface PreTradeResponse {
  gate_status:    "CLEAR" | "WARNING";
  gate_details:   string;
  news_warnings:  Array<{
    time:    string;
    country: string;
    title:   string;
    impact:  string;
  }>;
  regime_context: string;
  simulation:     PreTradeSimulation;
}

// ─────────────────────────────────────────────────
// Types — Post-Trade (Module 3)
// ─────────────────────────────────────────────────

export interface PostTradeRequest {
  ticker:     string;
  direction:  string;
  pnl:        number;
  entry_time: string;
  exit_time:  string;
  hit_sl:     boolean;
}

export interface PostTradeResponse {
  pnl:              number;
  behavioral_flags: string[];
  old_score:        number;
  new_score:        number;
  deductions:       number;
}

// ─────────────────────────────────────────────────
// Types — Monte Carlo Metrics (from Phase 4 pipeline)
// ─────────────────────────────────────────────────

export interface ReturnMetrics {
  mean_return:              number;
  median_return:            number;
  mean_return_annualized:   number;
  std_return_annualized:    number;
  P10_return:               number;
  P25_return:               number;
  P50_return:               number;
  P75_return:               number;
  P90_return:               number;
  mean_pnl:                 number;
  median_pnl:               number;
  P10_pnl:                  number;
  P90_pnl:                  number;
  prob_profit:              number;
  prob_target:              number;
  prob_loss_gt_5pct:        number;
  prob_loss_gt_10pct:       number;
  expected_value_dollar:    number;
  ev_per_dollar_risked:     number;
  skewness:                 number;
  excess_kurtosis:          number;
}

export interface RiskMetrics {
  VaR_95pct:          number;
  CVaR_95pct:         number;
  VaR_95pct_dollar:   number;
  CVaR_95pct_dollar:  number;
  VaR_99pct:          number;
  CVaR_99pct:         number;
  VaR_99pct_dollar:   number;
  CVaR_99pct_dollar:  number;
  max_dd_mean:        number;
  max_dd_median:      number;
  max_dd_P50:         number;
  max_dd_P75:         number;
  max_dd_P90:         number;
  max_dd_P95:         number;
  max_dd_P99:         number;
  max_dd_worst:       number;
  dd_duration_mean:   number;
  dd_duration_median: number;
  dd_duration_P90:    number;
  dd_duration_worst:  number;
  sharpe_mean:        number;
  sharpe_median:      number;
  sharpe_P10:         number;
  sharpe_P90:         number;
  sortino_mean:       number;
  sortino_median:     number;
  sortino_P10:        number;
  sortino_P90:        number;
  calmar_mean:        number;
  calmar_median:      number;
  calmar_P10:         number;
  calmar_P90:         number;
}

export interface PropFirmMetrics {
  pass_rate:               number;
  fail_rate:               number;
  n_pass:                  number;
  n_fail:                  number;
  expected_attempts:       number;
  pass_mean_profit_pct:    number;
  pass_median_profit_pct:  number;
  fail_mean_loss_pct:      number;
  fail_day_mean:           number | null;
  fail_day_median:         number | null;
  fail_day_P10:            number | null;
  fail_day_P90:            number | null;
  max_trailing_dd_rule:    number;
  daily_loss_rule:         number;
  challenge_target:        number;
}

export interface ModelMetrics {
  return_metrics:    ReturnMetrics;
  risk_metrics:      RiskMetrics;
  prop_firm_metrics: PropFirmMetrics;
}

export interface MetricsCompare {
  ticker: string;
  models: Record<string, ModelMetrics>;
}

// ─────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────

async function riskFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? `Risk API error ${res.status}`);
  }
  return res.json();
}

/** Run the full pipeline in background. */
export async function runRiskPipeline(
  ticker = "NQ=F",
  opts?: {
    n_simulations?: number;
    n_steps?: number;
    account_size?: number;
  }
): Promise<{ status: string; ticker: string; message: string }> {
  return riskFetch("/api/risk/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, ...opts }),
  });
}

/** Poll pipeline status. */
export async function fetchRiskStatus(): Promise<RiskStatus> {
  return riskFetch("/api/risk/status");
}

/** Current regime from HMM. */
export async function fetchRiskRegime(): Promise<RegimeInfo> {
  return riskFetch("/api/risk/regime");
}

/** Cross-model metrics comparison. */
export async function fetchMetricsCompare(): Promise<MetricsCompare> {
  return riskFetch("/api/risk/metrics/compare");
}

/** Daily news brief (Module 1). */
export async function fetchDailyBrief(): Promise<DailyBrief> {
  return riskFetch("/api/risk/daily_brief");
}

/** Account state (balance, equity, limits). */
export async function fetchAccountState(): Promise<AccountState> {
  return riskFetch("/api/risk/account");
}

/** Behavioral profile (Module 3 score + counters). */
export async function fetchBehavioralProfile(): Promise<BehavioralProfile> {
  return riskFetch("/api/risk/behavioral");
}

/** Pre-trade gate check (Module 1+2). */
export async function preTradeCheck(req: PreTradeRequest): Promise<PreTradeResponse> {
  return riskFetch("/api/risk/pre_trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

/** Post-trade behavioral evaluation (Module 3). */
export async function postTradeEvaluation(req: PostTradeRequest): Promise<PostTradeResponse> {
  return riskFetch("/api/risk/post_trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
}

// ─────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────

export function fmtPctRisk(val: number | null | undefined): string {
  if (val == null) return "N/A";
  return `${(val * 100).toFixed(2)}%`;
}

export function fmtMoney(val: number | null | undefined): string {
  if (val == null) return "N/A";
  return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function fmtRatio(val: number | null | undefined): string {
  if (val == null) return "N/A";
  return val.toFixed(3);
}

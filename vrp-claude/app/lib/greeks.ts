// vrp-claude/app/lib/greeks.ts
// Types & fetch helpers untuk Greeks / Options Inventory Engine

export interface GreeksSignals {
  gex_regime:    string;
  gex_desc:      string;
  vanna_signal:  string;
  vanna_desc:    string;
  charm_signal:  string;
  charm_desc:    string;
  dai_bias:      string;
  dai_desc:      string;
  vex_signal:    string;
  vex_desc:      string;
  dgci?:         number;
  dgci_desc?:    string;
}

export interface OptionsProvenance {
  provider: string; feed: string; stock_feed?: string; retrieved_at?: string; contracts_retrieved_at?: string;
  spot_timestamp?: string; spot_basis?: string; quote_oldest?: string; quote_newest?: string; oi_dates?: string[];
  contract_count?: number; snapshot_count?: number; eligible_contracts?: number; modeled_contracts?: number;
  volume_covered?: number; volume_date?: string; volume_requested_end?: string;
  excluded?: Record<string, number>; greeks_basis?: string; risk_free_rate?: number; warnings?: string[];
}

export interface StrikeGreeks {
  strike:       number;
  expiry:       string;
  dte:          number;
  option_type:  string;
  oi:           number;
  volume:       number | null;
  contract_symbol?: string;
  oi_date?: string;
  quote_timestamp?: string;
  provider_greeks?: Record<string, number | null>;
  mid_price:    number;
  iv:           number;
  delta:        number;
  gamma:        number;
  theta:        number;
  vega:         number;
  rho:          number;
  vanna:        number;
  charm:        number;
  gex_spotgamma:number;
  gex_raw:      number;
  vanna_exp:    number;
  charm_exp:    number;
  delta_exp:    number;
  vega_exp:     number;
}


export interface ExpiryBucket {
  dte_bucket:         number;
  expiry_dates:       string[];
  n_strikes:          number;
  total_oi_calls:     number;
  total_oi_puts:      number;
  pcr_oi:             number;
  net_gex_spotgamma:  number;
  net_gex_raw:        number;
  net_vanna:          number;
  net_charm:          number;
  net_dai:            number;
  net_vex:            number;
  gross_gex:          number;
  gross_vanna:        number;
  gross_charm:        number;
  gross_vex:          number;
  max_pain:           number | null;
  gamma_flip:         number | null;
  largest_gex_strike: number | null;
  largest_gex_value:  number | null;
  strikes?:           StrikeGreeks[];
}

export interface GreeksSnapshot {
  provenance?: OptionsProvenance;
  timestamp:       string;
  ticker:          string;
  spot:            number;
  data_source:     "live" | "synthetic" | "mixed";
  cache?: { age_seconds: number; ttl_seconds: number; stale: boolean; refreshing: boolean; refresh_error?: string | null };
  persistence_warning?: string;
  
  total_net_gex:   number;
  total_net_vanna: number;
  total_net_charm: number;
  total_net_dai:   number;
  total_net_vex:   number;
  total_gross_gex: number;
  
  gex_regime:      string;
  gamma_flip:      number | null;
  
  signals:         GreeksSignals;
  by_expiry?:      Record<string, ExpiryBucket>;
  
  // Custom diproses dari history API
  time?:           string; 
}

// ─────────────────────────────────────────────────
// APIs Returns
// ─────────────────────────────────────────────────
export interface GreeksHistoryResponse {
  ticker:  string;
  n:       number;
  history: GreeksSnapshot[];
}

export interface GreeksTSResponse {
  ticker: string;
  n: number;
  series: { time: string; spot: number; total_net_gex: number; total_gross_gex: number; gex_regime: string; gamma_flip: number | null }[];
}

export interface HorizonSummary {
  total:    number;
  correct:  number;
  win_rate: number | null;
}

export interface GreeksBacktestResponse {
  ticker:          string;
  total_signals:   number;
  newly_evaluated: number;
  by_horizon: {
    1:  HorizonSummary;
    5:  HorizonSummary;
    20: HorizonSummary;
  };
  by_signal_value: Record<string, HorizonSummary>;
}

export interface GreeksSignalLogEntry {
  id:             number;
  timestamp:      string;
  ticker:         string;
  signal_type:    string;
  signal_value:   string;
  prev_value:     string | null;
  spot_at_signal: number;
  gex_at_signal:  number | null;
  description:    string;
}

export interface GreeksSignalLogResponse {
  ticker:  string;
  n:       number;
  signals: GreeksSignalLogEntry[];
}

export interface OIChangeItem {
  strike:       number;
  option_type:  string;
  expiry:       string;
  dte:          number;
  dte_bucket:   number;
  oi_new:       number;
  oi_old:       number;
  delta_oi:     number;
  volume_new:   number;
  volume_old:   number;
  delta_volume: number;
  iv_new:       number;
  gex_new:      number;
  vanna_new:    number;
  charm_new:    number;
}

export interface OIChangeResponse {
  ticker:     string;
  oi_changes: OIChangeItem[];
}

// ─────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────

export async function fetchGreeks(ticker: string, force = false, signal?: AbortSignal): Promise<GreeksSnapshot> {
  const url = `/api/greeks?ticker=${encodeURIComponent(ticker)}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store", signal });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : payload?.error || `Greeks request failed (${res.status}).`);
  const totals = ["spot", "total_net_gex", "total_gross_gex", "total_net_vanna", "total_net_charm", "total_net_dai", "total_net_vex"];
  if (!payload || typeof payload.ticker !== "string" || typeof payload.timestamp !== "string"
    || !totals.every(key => Number.isFinite(payload[key])) || payload.spot <= 0
    || !payload.signals || typeof payload.signals !== "object"
    || !["live", "mixed", "synthetic"].includes(payload.data_source)) {
    throw new Error("Respons Greeks tidak lengkap. Coba muat ulang snapshot.");
  }
  return payload;
}

export async function fetchOIChange(ticker: string): Promise<OIChangeResponse> {
  const res = await fetch(`/api/greeks/oi-change?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("OI change fetch failed");
  return res.json();
}

export interface VVIXReplicationResult {
  replicated_vvix: number;
  actual_vvix:     number;
  deviation:       number;
  accuracy_pct:    number;
  t1_days:         number;
  t2_days:         number;
  t1_date:         string;
  t2_date:         string;
  var_1:           number;
  var_2:           number;
  is_fallback?:    boolean;
  fallback_reason?: string;
}

export async function fetchVVIXReplication(): Promise<VVIXReplicationResult> {
  const res = await fetch(`/api/greeks/vvix`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'VVIX replication unavailable.');
  }
  return res.json();
}

export async function fetchGreeksHistory(ticker: string, n = 50, signal?: AbortSignal, dataset = 'current'): Promise<GreeksHistoryResponse> {
  const res = await fetch(`/api/greeks/history?ticker=${encodeURIComponent(ticker)}&n=${n}&dataset=${encodeURIComponent(dataset)}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error("Greeks history fetch failed");
  return res.json();
}

export async function fetchGreeksBacktest(ticker: string, signal?: AbortSignal): Promise<GreeksBacktestResponse> {
  const res = await fetch(`/api/greeks/backtest?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error("Greeks backtest fetch failed");
  return res.json();
}

export async function fetchGreeksSignalLog(ticker: string, n = 50, signal?: AbortSignal): Promise<GreeksSignalLogResponse> {
  const res = await fetch(`/api/greeks/signals/log?ticker=${encodeURIComponent(ticker)}&n=${n}`, { cache: "no-store", signal });
  if (!res.ok) throw new Error("Greeks signals fetch failed");
  return res.json();
}

// Helper formatting
export function fmtGex(val: number): string {
  if (!Number.isFinite(val)) return "--";
  const sign = val >= 0 ? "+" : "-";
  const absVal = Math.abs(val);
  
  if (absVal >= 1e9) {
    return `${sign}$${(absVal / 1e9).toFixed(2)}B`;
  } else if (absVal >= 1e6) {
    return `${sign}$${(absVal / 1e6).toFixed(2)}M`;
  } else if (absVal >= 1e3) {
    return `${sign}$${(absVal / 1e3).toFixed(2)}K`;
  }
  return `${sign}$${absVal.toFixed(2)}`;
}

// The engine stores gamma * OI * 100 * spot² / 1e9, without the 1% factor.
// Convert only at the presentation boundary; persisted model values stay intact.
export function fmtGammaExposure(modelGex: number): string {
  return fmtGex(modelGex * 1e7);
}

// ─────────────────────────────────────────────────
// Gamma Bounce Score (GBS) types
// ─────────────────────────────────────────────────

export interface GBSWallComponents {
  gex_score:    number;
  oi_score:     number;
  prox_score:   number;
  vanna_bonus:  number;
  rvol_penalty: number;
}

export interface GBSWall {
  strike:       number;
  dist_pct:     number;
  total_gex:    number;
  total_oi:     number;
  net_vanna:    number;
  wall_type:    "CALL_WALL" | "PUT_WALL";
  behavior:     string;
  price_action: "BOUNCE_DOWN" | "BOUNCE_UP";
  score:        number;
  components:   GBSWallComponents;
}

export interface GBSResponse {
  timestamp:          string;
  ticker:             string;
  spot:               number;
  total_net_gex:      number;
  gex_regime:         string;
  overall_score:      number;
  regime:             "EXTREME" | "STRONG" | "MODERATE" | "WEAK" | "MINIMAL";
  vix_change:         number;
  rvol:               number;
  rvol_regime:        "EXTREME_VOL" | "HIGH" | "NORMAL" | "LOW";
  today_volume:       number;
  avg_volume_20:      number;
  total_net_vanna:    number;
  total_net_charm:    number;
  nearest_resistance: GBSWall | null;
  nearest_support:    GBSWall | null;
  walls:              GBSWall[];
  message?:           string;
}

export async function fetchGBS(ticker: string, force = false): Promise<GBSResponse> {
  const url = `/api/greeks/gbs?ticker=${encodeURIComponent(ticker)}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("GBS fetch failed");
  return res.json();
}

// ─────────────────────────────────────────────────
// Expected Move types
// ─────────────────────────────────────────────────

export interface EMPeriod {
  label:          string;
  trading_days:   number;
  iv_used:        number;
  em_1sigma:      number;
  em_2sigma:      number;
  em_1sigma_pct:  number;
  em_2sigma_pct:  number;
  upper_1s:       number;
  lower_1s:       number;
  upper_2s:       number;
  lower_2s:       number;
}

export interface EMByExpiry {
  bucket:         string;
  label:          string;
  dte:            number;
  atm_strike:     number;
  atm_iv:         number;
  em_1sigma:      number;
  em_2sigma:      number;
  em_1sigma_pct:  number;
  em_2sigma_pct:  number;
  upper_1s:       number;
  lower_1s:       number;
  upper_2s:       number;
  lower_2s:       number;
}

export interface ExpectedMoveResponse {
  timestamp:            string;
  ticker:               string;
  spot:                 number;
  prev_close:           number;
  day_high:             number;
  day_low:              number;
  actual_move:          number;
  actual_move_pct:      number;
  actual_range:         number;
  actual_range_pct:     number;
  annualized_iv:        number;
  em_1d:                number;
  overextension:        number;
  overextension_regime: "EXTREME" | "EXTENDED" | "AT_BOUNDARY" | "WITHIN_RANGE";
  range_utilization:    number;
  standard_periods:     EMPeriod[];
  by_expiry:            EMByExpiry[];
}

export async function fetchExpectedMove(ticker: string, force = false): Promise<ExpectedMoveResponse> {
  const url = `/api/greeks/expected-move?ticker=${encodeURIComponent(ticker)}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Expected Move fetch failed");
  return res.json();
}

// ─────────────────────────────────────────────────
// Simulator types
// ─────────────────────────────────────────────────

export interface GreeksSimStrike {
  strike:     number;
  orig_gex:   number;
  sim_gex:    number;
  orig_vanna: number;
  sim_vanna:  number;
  orig_charm: number;
  sim_charm:  number;
}

export interface GreeksSimulatorResponse {
  timestamp:          string;
  ticker:             string;
  orig_spot:          number;
  new_spot:           number;
  total_orig_gex:     number;
  total_sim_gex:      number;
  total_orig_vanna:   number;
  total_sim_vanna:    number;
  total_orig_charm:   number;
  total_sim_charm:    number;
  orig_gamma_flip:    number | null;
  sim_gamma_flip:     number | null;
  chart_data:         GreeksSimStrike[];
}

export async function fetchGreeksSimulator(
  ticker: string,
  spotShiftPct: number,
  ivShiftPct: number,
  daysForward: number
): Promise<GreeksSimulatorResponse> {
  const url = `/api/greeks/simulate?ticker=${encodeURIComponent(
    ticker
  )}&spot_shift_pct=${spotShiftPct}&iv_shift_pct=${ivShiftPct}&days_forward=${daysForward}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Greeks simulator fetch failed");
  return res.json();
}

// ─────────────────────────────────────────────────
// Unusual Options Activity (UOA) types
// ─────────────────────────────────────────────────

export interface UnusualOptionActivity {
  strike: number;
  expiry: string;
  dte: number;
  option_type: "CALL" | "PUT" | string;
  volume: number;
  oi: number;
  ratio: number;
  mid_price: number;
  premium: number;
  sentiment: "BULLISH" | "BEARISH";
  activity_type: "Block Trade" | "Institutional Sweep" | "Sweep" | "Unusual Volume" | string;
  iv: number;
  dist_pct: number;
}

export interface UnusualOptionsResponse {
  timestamp: string;
  ticker: string;
  spot: number;
  count: number;
  activities: UnusualOptionActivity[];
  error?: string;
  suggestion?: string;
}

export async function fetchUnusualOptions(
  ticker: string,
  minVolume = 100,
  volOiRatio = 1.5,
  force = false
): Promise<UnusualOptionsResponse> {
  const url = `/api/greeks/unusual-activity?ticker=${encodeURIComponent(
    ticker
  )}&min_volume=${minVolume}&vol_oi_ratio=${volOiRatio}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Unusual Options Activity fetch failed");
  return res.json();
}

// ─────────────────────────────────────────────────
// Single Option BSM Simulator types
// ─────────────────────────────────────────────────

export interface SingleBSMResponse {
  price?: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;
  charm: number;
}

export async function fetchBSM(
  spot: number,
  strike: number,
  dte: number,
  iv: number,
  optionType: string
): Promise<SingleBSMResponse> {
  const url = `/api/greeks/bsm?spot=${spot}&strike=${strike}&dte=${dte}&iv=${iv}&option_type=${optionType}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("BSM calculation failed");
  return res.json();
}

export interface BSMCurvePoint {
  spot: number;
  price?: number;
  pnl?: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna: number;
  charm: number;
}

export interface BSMCurveResponse {
  strike: number;
  base_spot: number;
  dte: number;
  iv: number;
  curve: BSMCurvePoint[];
}

export async function fetchBSMCurve(
  spot: number,
  strike: number,
  dte: number,
  iv: number,
  optionType: string,
  rangePct: number = 0.15,
  steps: number = 50
): Promise<BSMCurveResponse> {
  const url = `/api/greeks/bsm/curve?spot=${spot}&strike=${strike}&dte=${dte}&iv=${iv}&option_type=${optionType}&range_pct=${rangePct}&steps=${steps}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("BSM curve calculation failed");
  return res.json();
}

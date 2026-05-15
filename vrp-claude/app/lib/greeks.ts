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

export interface StrikeGreeks {
  strike:       number;
  expiry:       string;
  dte:          number;
  option_type:  string;
  oi:           number;
  volume:       number;
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
  timestamp:       string;
  ticker:          string;
  spot:            number;
  data_source:     "live" | "synthetic";
  
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

// ─────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────

export async function fetchGreeks(ticker: string, force = false): Promise<GreeksSnapshot> {
  const url = `/api/greeks?ticker=${encodeURIComponent(ticker)}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Greeks fetch failed");
  return res.json();
}

export async function fetchGreeksHistory(ticker: string, n = 50): Promise<GreeksHistoryResponse> {
  const res = await fetch(`/api/greeks/history?ticker=${encodeURIComponent(ticker)}&n=${n}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Greeks history fetch failed");
  return res.json();
}

export async function fetchGreeksBacktest(ticker: string): Promise<GreeksBacktestResponse> {
  const res = await fetch(`/api/greeks/backtest?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Greeks backtest fetch failed");
  return res.json();
}

export async function fetchGreeksSignalLog(ticker: string, n = 50): Promise<GreeksSignalLogResponse> {
  const res = await fetch(`/api/greeks/signals/log?ticker=${encodeURIComponent(ticker)}&n=${n}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Greeks signals fetch failed");
  return res.json();
}

// Helper formatting
export function fmtGex(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "--";
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

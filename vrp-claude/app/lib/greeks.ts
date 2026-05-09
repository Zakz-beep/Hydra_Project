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
  series: { time: string; spot: number; total_net_gex: number; gex_regime: string; gamma_flip: number | null }[];
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
  // Misal dalam billions, atau minimal 2 desimal
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}`;
}

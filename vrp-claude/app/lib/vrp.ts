// vrp.ts — Types & fetch helpers untuk VRP Signal Engine
// Updated: includes rv_engine fields (Approach 2 & 3)

export type SignalType =
  | "STRONG_SHORT_VOL"
  | "MILD_SHORT_VOL"
  | "NEUTRAL"
  | "MILD_LONG_VOL"
  | "STRONG_LONG_VOL";

export interface HARCoefficients {
  c:      number;
  beta_d: number;
  beta_w: number;
  beta_m: number;
  r2?:    number;
}

export interface RVEngineData {
  timestamp:            string;
  ticker:               string;
  spot:                 number;
  is_market_open:       boolean;
  session_elapsed_pct:  number;   // 0.0 – 1.0
  data_source:          "live" | "synthetic";

  // Candle counts
  n_candles_5m:         number;
  n_candles_15m:        number;

  // Raw components
  rv_intraday_raw:      number;
  rv_intraday_raw_pct:  number;
  rv_yesterday:         number;
  rv_yesterday_pct:     number;
  hv20:                 number;
  hv20_pct:             number;

  // Approach 2 — Blended
  blend_weight:         number;
  rv_blended:           number;
  rv_blended_pct:       number;

  // Approach 3 — HAR + intraday update
  rv_har_base:          number;
  rv_har_base_pct:      number;
  rv_har_updated:       number;
  rv_har_updated_pct:   number;
  har_coefficients:     HARCoefficients;

  // Display (15m candles)
  rv_display_15m:       number;
  rv_display_15m_pct:   number;
}

export interface VRPSnapshot {
  time:   string;
  iv:     number;
  rv:     number;
  vrp:    number;
  signal: SignalType;
}

export interface VRPResult {
  ticker:      string;
  spot:        number;
  timestamp:   string;
  data_source: "live" | "synthetic";

  // Volatility metrics
  iv:          number;
  rv:          number;
  rv_har:      number;
  hv20:        number;
  n_candles:   number;

  // VRP
  vrp_raw:     number;
  vrp_z:       number;
  vrp_vs_har:  number;

  // Signal
  signal:      SignalType;
  signal_desc: string;

  // Pct formatted
  iv_pct:      number;
  rv_pct:      number;
  rv_har_pct:  number;
  hv20_pct:    number;
  vrp_raw_pct: number;

  // History snapshots
  history:     VRPSnapshot[];

  // RV Engine data (Approach 2 & 3)
  rv_engine?:  RVEngineData;
}

export interface AppConfig {
  ticker:         string;
  risk_free_rate: number;
  trading_days:   number;
  min_candles:    number;
  vrp_roll_days:  number;
  har_history:    number;
}

// ─────────────────────────────────────────────────
// Signal metadata helpers
// ─────────────────────────────────────────────────

export const SIGNAL_META: Record<SignalType, {
  label:    string;
  color:    string;
  bg:       string;
  border:   string;
  icon:     string;
  strength: number; // 1–5
}> = {
  STRONG_SHORT_VOL: {
    label:    "Strong Short Vol",
    color:    "text-emerald-400",
    bg:       "bg-emerald-950/60",
    border:   "border-emerald-500/40",
    icon:     "↓↓",
    strength: 5,
  },
  MILD_SHORT_VOL: {
    label:    "Mild Short Vol",
    color:    "text-emerald-300",
    bg:       "bg-emerald-950/40",
    border:   "border-emerald-500/20",
    icon:     "↓",
    strength: 3,
  },
  NEUTRAL: {
    label:    "Neutral",
    color:    "text-zinc-400",
    bg:       "bg-zinc-900/40",
    border:   "border-zinc-700/30",
    icon:     "→",
    strength: 1,
  },
  MILD_LONG_VOL: {
    label:    "Mild Long Vol",
    color:    "text-amber-300",
    bg:       "bg-amber-950/40",
    border:   "border-amber-500/20",
    icon:     "↑",
    strength: 3,
  },
  STRONG_LONG_VOL: {
    label:    "Strong Long Vol",
    color:    "text-red-400",
    bg:       "bg-red-950/60",
    border:   "border-red-500/40",
    icon:     "↑↑",
    strength: 5,
  },
};

// ─────────────────────────────────────────────────
// Backtest types (SQLite)
// ─────────────────────────────────────────────────

export interface HorizonSummary {
  total:    number;
  correct:  number;
  win_rate: number | null;
  avg_pnl:  number;
}

export interface BacktestResult {
  ticker:          string;
  total_signals:   number;
  newly_evaluated: number;
  by_horizon: {
    1:  HorizonSummary;
    5:  HorizonSummary;
    20: HorizonSummary;
  };
  by_signal_type: Record<string, {
    total:    number;
    correct:  number;
    win_rate: number | null;
  }>;
}

// ─────────────────────────────────────────────────
// Signal Log types (SQLite)
// ─────────────────────────────────────────────────

export interface SignalLogEntry {
  id:             number;
  timestamp:      string;
  ticker:         string;
  signal:         SignalType;
  prev_signal:    SignalType | null;
  vrp_z:          number;
  spot_at_signal: number;
  iv_at_signal:   number;
  rv_at_signal:   number;
  outcome_1d:     "correct" | "incorrect" | "neutral" | null;
  outcome_5d:     "correct" | "incorrect" | "neutral" | null;
  outcome_20d:    "correct" | "incorrect" | "neutral" | null;
}

export interface SignalLogResponse {
  ticker:  string;
  n:       number;
  signals: SignalLogEntry[];
}

// ─────────────────────────────────────────────────
// DB Stats types
// ─────────────────────────────────────────────────

export interface DBStats {
  vrp_snapshots:       number;
  rv_engine_snapshots: number;
  har_daily_rv:        number;
  signal_log:          number;
  signal_outcomes:     number;
  tickers:             string[];
  db_size_kb:          number;
}

// ─────────────────────────────────────────────────
// Fetch helpers
// ─────────────────────────────────────────────────

const BASE = "";

export async function fetchVRP(ticker: string): Promise<VRPResult> {
  const res = await fetch(`${BASE}/api/vrp?ticker=${encodeURIComponent(ticker)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Fetch failed");
  }
  return res.json();
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`, { cache: "no-store" });
  if (!res.ok) throw new Error("Config fetch failed");
  return res.json();
}

export async function updateConfig(cfg: Partial<AppConfig>): Promise<AppConfig> {
  const current = await fetchConfig();
  const res = await fetch(`${BASE}/api/config`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ ...current, ...cfg }),
  });
  if (!res.ok) throw new Error("Config update failed");
  const data = await res.json();
  return data.config;
}

export async function fetchBacktest(ticker: string): Promise<BacktestResult> {
  const res = await fetch(`/api/backtest?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Backtest fetch failed");
  return res.json();
}

export async function fetchSignalLog(ticker: string, n = 30): Promise<SignalLogResponse> {
  const res = await fetch(`/api/signals?ticker=${encodeURIComponent(ticker)}&n=${n}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Signal log fetch failed");
  return res.json();
}

export async function fetchDBStats(): Promise<DBStats> {
  const res = await fetch("/api/db/stats", { cache: "no-store" });
  if (!res.ok) throw new Error("DB stats fetch failed");
  return res.json();
}

// ─────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────

export function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

export function fmtPct(n: number, decimals = 2): string {
  return `${n.toFixed(decimals)}%`;
}

export function fmtZ(z: number): string {
  const sign = z >= 0 ? "+" : "";
  return `${sign}${z.toFixed(2)}σ`;
}

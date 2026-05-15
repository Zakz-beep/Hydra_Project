// vrp-claude/app/lib/dispersion.ts
// Types & fetch helpers untuk Dispersion Trading & SVI Surface Fitting API

// ─────────────────────────────────────────────────
// SVI Types
// ─────────────────────────────────────────────────

export interface SVIParams {
  a: number;     // level varians keseluruhan
  b: number;     // kemiringan sayap (konveksitas)
  rho: number;   // korelasi/skewness (-1 < ρ < 1)
  m: number;     // pergeseran horizontal
  sigma: number; // kelancaran di sekitar m
}

export interface SVICurvePoint {
  strike: number;
  svi_iv: number; // dalam persen, mis. 18.5
}

export interface SVIMarketPoint {
  strike: number;
  market_iv: number; // dalam persen
  type: "call" | "put";
  oi: number;
}

export interface SVIResponse {
  timestamp: string;
  ticker: string;
  spot: number;
  expiry: string;
  dte: number;
  T: number;
  params: SVIParams;
  rmse: number;
  fit_quality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "INSUFFICIENT_DATA";
  is_arbitrage_free: boolean;
  n_market_points: number;
  market_points: SVIMarketPoint[];
  curve_points: SVICurvePoint[];
}

// ─────────────────────────────────────────────────
// Correlation Types
// ─────────────────────────────────────────────────

export interface ConstituentData {
  ticker: string;
  weight: number;
  weight_pct?: number;
  atm_iv: number | null;
  contribution: number;
  market_cap?: number | null;
  sector_name?: string | null;
}

export interface CorrelationResponse {
  timestamp: string;
  index: string;
  dte: number;
  window_days: number;
  index_atm_iv: number | null;
  implied_correlation: number | null;
  realized_correlation: number | null;
  spread: number | null;
  spread_pct: number | null;
  weights_method?: string;
  coverage?: string;
  constituents: ConstituentData[];
}

// ─────────────────────────────────────────────────
// Signal Types
// ─────────────────────────────────────────────────

export type DispersionSignal = "SHORT_DISPERSION" | "LONG_DISPERSION" | "NEUTRAL" | "NO_DATA";

export interface TradeLeg {
  ticker: string;
  action: "BUY" | "SELL";
  instrument: string;
  weight?: number;
  atm_iv: number;
  rationale: string;
}

export interface TradeBlueprint {
  strategy: string;
  index_leg: TradeLeg;
  constituent_legs: TradeLeg[];
  profit_condition: string;
  risk: string;
  spread_edge: string;
}

export interface DispersionSignalResponse {
  timestamp: string;
  index: string;
  dte: number;
  window_days: number;
  index_atm_iv: number | null;
  signal: DispersionSignal;
  signal_strength: number;
  spread: number | null;
  spread_pct: number | null;
  implied_corr: number | null;
  realized_corr: number | null;
  description: string;
  trade_blueprint: TradeBlueprint | null;
  weights_method?: string;
  coverage?: string;
}

// ─────────────────────────────────────────────────
// Scan Types
// ─────────────────────────────────────────────────

export interface DispersionScanRow {
  index: string;
  index_atm_iv: number | null;
  implied_correlation: number | null;
  realized_correlation: number | null;
  spread: number | null;
  signal: DispersionSignal;
  signal_strength: number;
  description: string;
  weights_method?: string;
  coverage?: string;
}

export interface DispersionScanResponse {
  timestamp: string;
  dte: number;
  window_days: number;
  scan_results: DispersionScanRow[];
  n_results: number;
}

// ─────────────────────────────────────────────────
// Market Cap / Weights Types
// ─────────────────────────────────────────────────

export interface WeightsConstituent {
  ticker: string;
  weight: number;
  weight_pct: number;
  market_cap: number | null;
  market_cap_fmt: string | null;
  sector_name: string | null;
}

export interface WeightsResponse {
  timestamp: string;
  index: string;
  method: string;
  method_label: string;
  coverage: string;
  n_constituents: number;
  total_market_cap: number | null;
  total_market_cap_fmt: string | null;
  constituents: WeightsConstituent[];
}

// ─────────────────────────────────────────────────
// Fetch Helpers
// ─────────────────────────────────────────────────

export async function fetchSVI(ticker: string, dte = 30, force = false): Promise<SVIResponse> {
  const url = `/api/dispersion/svi?ticker=${encodeURIComponent(ticker)}&dte=${dte}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`SVI fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDispersionCorrelation(
  index: string,
  dte = 30,
  window = 30,
  force = false
): Promise<CorrelationResponse> {
  const url = `/api/dispersion/correlation?index=${encodeURIComponent(index)}&dte=${dte}&window=${window}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Correlation fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDispersionSignal(
  index: string,
  dte = 30,
  window = 30,
  force = false
): Promise<DispersionSignalResponse> {
  const url = `/api/dispersion/signal?index=${encodeURIComponent(index)}&dte=${dte}&window=${window}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Dispersion signal fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchDispersionScan(dte = 30, window = 30, force = false): Promise<DispersionScanResponse> {
  const url = `/api/dispersion/scan?dte=${dte}&window=${window}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Dispersion scan fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchWeights(index: string, force = false): Promise<WeightsResponse> {
  const url = `/api/dispersion/weights?index=${encodeURIComponent(index)}${force ? "&force=true" : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Weights fetch failed: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────
// Formatting Helpers
// ─────────────────────────────────────────────────

export function fmtCorr(val: number | null): string {
  if (val === null || val === undefined) return "--";
  return `${(val * 100).toFixed(1)}%`;
}

export function fmtSpread(val: number | null): string {
  if (val === null || val === undefined) return "--";
  const pct = val * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function fmtCap(val: number | null | undefined): string {
  if (val === null || val === undefined) return "--";
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`;
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  return `$${val.toLocaleString()}`;
}

export function getMethodBadge(method: string): { label: string; color: string } {
  switch (method) {
    case "sector_proxy":      return { label: "DYNAMIC · SECTOR ETF", color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/40" };
    case "market_cap_top10":   return { label: "DYNAMIC · MARKET CAP", color: "text-blue-400 bg-blue-500/15 border-blue-500/40" };
    case "static_fallback":    return { label: "STATIC FALLBACK", color: "text-amber-400 bg-amber-500/15 border-amber-500/40" };
    default:                   return { label: method.toUpperCase(), color: "text-zinc-400 bg-zinc-700/20 border-zinc-700/40" };
  }
}

export function getSignalColor(signal: DispersionSignal): string {
  switch (signal) {
    case "SHORT_DISPERSION": return "text-emerald-400";
    case "LONG_DISPERSION":  return "text-red-400";
    case "NEUTRAL":          return "text-zinc-400";
    default:                 return "text-zinc-600";
  }
}

export function getSignalBg(signal: DispersionSignal): string {
  switch (signal) {
    case "SHORT_DISPERSION": return "bg-emerald-500/15 border-emerald-500/40";
    case "LONG_DISPERSION":  return "bg-red-500/15 border-red-500/40";
    case "NEUTRAL":          return "bg-zinc-700/20 border-zinc-700/40";
    default:                 return "bg-zinc-800/20 border-zinc-800/40";
  }
}

export function getSignalLabel(signal: DispersionSignal): string {
  switch (signal) {
    case "SHORT_DISPERSION": return "SHORT DISPERSION";
    case "LONG_DISPERSION":  return "LONG DISPERSION";
    case "NEUTRAL":          return "NEUTRAL";
    default:                 return "NO DATA";
  }
}

export interface DCCTimeseries {
  timestamp: string;
  avg_corr: number;
  weight: number;
  passive_equity: number;
  adaptive_equity: number;
  passive_dd: number;
  adaptive_dd: number;
  tail_dep: number;
  hmm_state?: number | null;
  hmm_state_name?: string | null;
}

// ── HMM Types ───────────────────────────────────────────────────────────────
export interface HMMStateSummary {
  state_id: number;
  name: string;
  count: number;
  pct_history: number;
  mean_return: number;
  mean_vol: number;
  mean_corr: number;
  max_return: number;
  min_return: number;
  sharpe_proxy: number;
  expected_dd_pct: number;
}

export interface HMMTransitionRow {
  from: string;
  to: Record<string, number>;
}

export interface HMMTransitionProb {
  to_state: string;
  probability: number;
}

export interface HMMStatePoint {
  timestamp: string;
  state_id: number;
  state_name: string;
  return_pct: number;
  vol_pct: number;
  avg_corr: number;
  proba: Record<string, number>;
}

export interface HMMResult {
  tickers: string[];
  log_likelihood: number;
  n_states: number;
  current_regime: number;
  current_regime_name: string;
  current_posteriors: Record<string, number>;
  stay_probability: number;
  transition_probs: HMMTransitionProb[];
  state_summary: HMMStateSummary[];
  transition_matrix: HMMTransitionRow[];
  state_series: HMMStatePoint[];
  error?: string;
}

export interface DCCSummary {
  final_passive_equity: number;
  final_adaptive_equity: number;
  max_passive_dd: number;
  max_adaptive_dd: number;
}

export interface USpacePoint {
  u1: number;
  u2: number;
}

export interface ReturnPoint {
  r1: number;
  r2: number;
}

export interface DensityCell {
  x: number;
  y: number;
  count: number;
}

export interface CopulaDetails {
  pair: string[];
  lambda_L: number;
  lambda_U: number;
  best_fit: "Clayton" | "Gumbel" | "Student-t" | "Gaussian";
  u_space_points: USpacePoint[];
  returns_points: ReturnPoint[];
  density_grid: DensityCell[];
  returns_range: { r1_min: number; r1_max: number; r2_min: number; r2_max: number };
  lower_tail_returns: ReturnPoint[];
  percentiles: { r1_p1: number; r1_p5: number; r2_p1: number; r2_p5: number };
  tail_dep_series_recent: { timestamp: string; tail_dep: number }[];
}

export interface DCCRunResponse {
  status: string;
  run_id: number;
  tickers: string[];
  timeframe: string;
  history: string;
  summary: DCCSummary;
  market_status: Record<string, string>;
  copula_details: CopulaDetails;
  hmm?: HMMResult;
  timeseries: DCCTimeseries[];
}

export interface DCCRunRequest {
  tickers: string[];
  mode: string;
}

const API_BASE = "/api/dcc";

export async function runDCCModel(req: DCCRunRequest): Promise<DCCRunResponse> {
  const res = await fetch(`${API_BASE}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(req),
  });
  
  if (!res.ok) {
    let errDetail = "Unknown error";
    try {
      const errJson = await res.json();
      errDetail = errJson.detail || errDetail;
    } catch (e) {}
    throw new Error(`DCC API Error: ${errDetail}`);
  }
  
  return res.json();
}

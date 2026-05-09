// ── Types ─────────────────────────────────────────────────────────────────────

export interface HARParams {
  const: number;
  RV_Daily: number;
  RV_Weekly: number;
  RV_Monthly: number;
}

export interface HARRVResult {
  dates: string[];
  fitted_rv: number[];
  rv_daily: number[];
  rv_weekly: number[];
  rv_monthly: number[];
  har_predict: number[];
  next_forecast: number;
  params: HARParams;
  rsquared: number;
}

export interface StateSummaryItem {
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
  mean_har_rv?: number;
}

export interface TransitionMatrixRow {
  from: string;
  to: Record<string, number>;
}

export interface TransitionProb {
  to_state: string;
  probability: number;
}

export interface StateSeriesPoint {
  timestamp: string;
  state_id: number;
  state_name: string;
  return_pct: number;
  vol_pct: number;
  avg_corr: number;
  har_rv?: number;
  proba: Record<string, number>;
}

export interface HMMResult {
  tickers: string[];
  n_features: number;
  log_likelihood: number;
  n_states: number;
  current_regime: number;
  current_regime_name: string;
  current_posteriors: Record<string, number>;
  stay_probability: number;
  transition_probs: TransitionProb[];
  state_summary: StateSummaryItem[];
  transition_matrix: TransitionMatrixRow[];
  state_series: StateSeriesPoint[];
}

export interface CombinedMeta {
  tickers: string[];
  use_har_in_hmm: boolean;
  har_next_forecast: number;
  hmm_current_regime: string;
  hmm_n_features: number;
}

export interface CombinedResult {
  status: string;
  tickers: string[];
  rv_ticker: string;
  meta: CombinedMeta;
  har_rv: HARRVResult;
  hmm: HMMResult;
}

export interface MSARRegimeSummary {
  regime_id: number;
  name: string;
  daily_mean_pct: number;
  daily_vol_pct: number;
  ann_return_pct: number;
  ann_vol_pct: number;
  sharpe: number;
  ar_coefficients: Record<string, number>;
}

export interface MSARPositionSizing {
  regime_id: number;
  name: string;
  full_kelly_pct: number;
  half_kelly_pct: number;
}

export interface MSARVaRCVaR {
  regime_id: number;
  name: string;
  risk_metrics: Array<{
    confidence: number;
    var_pct: number;
    cvar_pct: number;
  }>;
}

export interface MSARFilteredProb {
  timestamp: string;
  regime_id: number;
  regime_name: string;
  probabilities: Record<string, number>;
}

export interface MSARForecastStep {
  step: number;
  expected_return_pct: number;
  expected_vol_pct: number;
  regime_probabilities: Record<string, number>;
}

export interface MSARPriceForecastStep {
  step: number;
  price_mid: number;
  price_upper_95: number;
  price_lower_95: number;
}

export interface MSARResult {
  status: string;
  ticker: string;
  last_price: number;
  model_spec: {
    type: string;
    k_regimes: number;
    ar_order: number;
    n_observations: number;
    log_likelihood: number;
    aic: number;
    bic: number;
  };
  regime_summary: MSARRegimeSummary[];
  position_sizing: MSARPositionSizing[];
  var_cvar: MSARVaRCVaR[];
  current_regime: {
    regime_id: number;
    regime_name: string;
    probability: number;
    posteriors: Record<string, number>;
    as_of: string;
  };
  transition_matrix: TransitionMatrixRow[];
  filtered_probabilities: MSARFilteredProb[];
  forecast: {
    n_days: number;
    regime_forecast: MSARForecastStep[];
    price_forecast?: {
      last_price: number;
      series: MSARPriceForecastStep[];
    };
  };
}

// ── API Client ────────────────────────────────────────────────────────────────

const BASE = "http://localhost:8006";

export async function fetchVolHAR(ticker: string, period = "2y"): Promise<{ status: string; ticker: string; har_rv: HARRVResult }> {
  const res = await fetch(`${BASE}/api/vol/har`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, period }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "HAR-RV fetch failed");
  }
  return res.json();
}

export async function fetchVolCombined(
  tickers: string[],
  period = "2y",
  useHarInHmm = true
): Promise<CombinedResult> {
  const res = await fetch(`${BASE}/api/vol/combined`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers, period, use_har_in_hmm: useHarInHmm }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Combined pipeline fetch failed");
  }
  return res.json();
}

export async function fetchVolMSAR(
  ticker: string,
  period = "2y",
  k_regimes = 2,
  ar_order = 2,
  forecast_days = 10
): Promise<MSARResult> {
  const res = await fetch(`${BASE}/api/vol/msar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, period, k_regimes, ar_order, forecast_days }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "MSAR fetch failed");
  }
  return res.json();
}

// ── HAR-CJ Types ─────────────────────────────────────────────────────────────

export interface HARCJCurrentState {
  date: string;
  gk_rv: number;
  gk_vol_ann_pct: number;
  jump: number;
  continuous: number;
  jump_pct_of_rv: number;
  next_rv_forecast: number;
  next_vol_forecast_ann_pct: number;
  vix?: number | null;
  vrp?: number | null;
}

export interface HARCJDecompositionPoint {
  date: string;
  gk_rv: number;
  naive_rv: number;
  park_rv: number;
  jump: number;
  continuous: number;
  gk_vol_ann_pct: number;
  vix?: number | null;
  vrp?: number | null;
}

export interface HARCJFittedPoint {
  date: string;
  actual_rv: number | null;
  predicted_rv: number;
}

export interface HARCJFeatureImportance {
  feature: string;
  coefficient: number;
  abs_coef: number;
}

export interface HARCJModelSpec {
  type: string;
  features: string[];
  n_observations: number;
  date_range: string;
}

export interface HARCJResult {
  status: string;
  ticker: string;
  model_spec: HARCJModelSpec;
  current_state: HARCJCurrentState;
  har_cj: {
    coefficients: Record<string, number>;
    r_squared: number;
    next_forecast: number;
  };
  feature_importance: HARCJFeatureImportance[];
  rv_decomposition: HARCJDecompositionPoint[];
  fitted_vs_actual: HARCJFittedPoint[];
}

export async function fetchVolHARCJ(
  ticker: string,
  period = "2y",
  include_cross_asset = true
): Promise<HARCJResult> {
  const res = await fetch(`${BASE}/api/vol/har-cj`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, period, include_cross_asset }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "HAR-CJ fetch failed");
  }
  return res.json();
}

// ── Kalman HAR-CJ Types ──────────────────────────────────────────────────────

export interface KalmanModelSpec {
  type: string;
  n_states: number;
  obs_noise: number;
  trans_noise: number;
  window_vol: number;
  n_observations: number;
  date_range: string;
}

export interface KalmanCurrentState {
  date: string;
  actual_vol_pct: number;
  kalman_har_cj_pct: number;
  yz_24h_pct: number;
  gk_intraday_pct: number;
}

export interface KalmanForecast {
  forecast_log_rv: number;
  forecast_vol_pct: number;
  jump_dominant: boolean;
  regime: string;
  betas: {
    intercept: number;
    C_d: number;
    C_w: number;
    C_m: number;
    J_d: number;
    J_w: number;
    J_m: number;
  };
}

export interface KalmanMetrics {
  r2_log_rv: number;
  mse_log_rv: number;
  rmse_log_rv: number;
  mae_log_rv: number;
  r2_vol_pct: number;
  mse_vol_pct: number;
  rmse_vol_pct: number;
  mae_vol_pct: number;
}

export interface KalmanVolSeriesPoint {
  date: string;
  actual_vol_pct: number;
  kalman_har_cj_pct: number;
  yz_24h_pct: number;
  gk_intraday_pct: number;
  return_pct: number;
  close: number;
  log_c: number;
  log_j: number;
}

export interface KalmanBetasSeriesPoint {
  date: string;
  intercept: number;
  beta_C_d: number;
  beta_C_w: number;
  beta_C_m: number;
  beta_J_d: number;
  beta_J_w: number;
  beta_J_m: number;
}

export interface KalmanCalibrationPoint {
  date: string;
  open: number;
  close: number;
  return_pct: number;
  yz_24h_pct: number;
  gk_intraday_pct: number;
  kalman_har_cj_pct: number;
}

export interface KalmanHARCJResult {
  status: string;
  ticker: string;
  model_spec: KalmanModelSpec;
  current_state: KalmanCurrentState;
  forecast: KalmanForecast;
  metrics: KalmanMetrics;
  calibration_table: KalmanCalibrationPoint[];
  vol_series: KalmanVolSeriesPoint[];
  betas_series: KalmanBetasSeriesPoint[];
}

export async function fetchVolKalmanHARCJ(
  ticker: string,
  period = "730d",
  lookback = 120
): Promise<KalmanHARCJResult> {
  const res = await fetch(`${BASE}/api/vol/har-kalman`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, period, lookback }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Kalman HAR-CJ fetch failed");
  }
  return res.json();
}

// ── Hybrid Arbitrage API ──────────────────────────────────────────────────────

export interface HybridOptionOpp {
  strike: number;
  type: "call" | "put";
  expiry: string;
  dte: number;
  oi: number;
  volume: number;
  bid: number;
  ask: number;
  mid_price: number;
  market_iv: number;
  market_iv_pct: number;
  ai_fair_price: number;
  mispricing_dollar: number;
  mispricing_pct: number;
  signal: "FAIR" | "OVERVALUED" | "UNDERVALUED";
  action: "HOLD" | "BUY" | "SELL";
  market_delta: number;
  ai_delta: number;
  market_gamma: number;
  market_vega: number;
  hedge_shares: number;
  hedge_direction: "BUY" | "SELL" | "NONE";
  hedge_desc: string;
}

export interface HybridVolSurfacePoint {
  strike: number;
  dte: number;
  market_iv_pct: number;
  ai_fair_vol_pct: number;
  iv_spread_pct: number;
  type: "call" | "put";
  moneyness: number;
}

export interface HybridArbResult {
  status: string;
  ticker: string;
  timestamp: string;
  spot: number;
  data_source: string;
  ai_model: {
    type: string;
    fair_vol_pct: number;
    current_rv_pct: number;
    look_back_days: number;
    rv_22d_history: number[];
  };
  market_summary: {
    avg_market_iv_pct: number;
    median_market_iv_pct: number;
    ai_fair_vol_pct: number;
    iv_spread_pct: number;
    regime: "IV_RICH" | "IV_CHEAP" | "IV_FAIR";
    regime_desc: string;
    n_options_scanned: number;
    n_overvalued: number;
    n_undervalued: number;
  };
  top_overvalued: HybridOptionOpp[];
  top_undervalued: HybridOptionOpp[];
  vol_surface: HybridVolSurfacePoint[];
}

export async function fetchHybridArb(ticker: string = "SPY"): Promise<HybridArbResult> {
  const res = await fetch(`${BASE}/api/vol/hybrid-arbitrage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Hybrid Arbitrage fetch failed");
  }
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const STATE_COLORS: Record<number, { text: string; bg: string; border: string; fill: string }> = {
  0: { text: "text-red-400",    bg: "bg-red-950/40",     border: "border-red-500/40",     fill: "#ef4444" },
  1: { text: "text-amber-400",  bg: "bg-amber-950/40",   border: "border-amber-500/40",   fill: "#f59e0b" },
  2: { text: "text-emerald-400",bg: "bg-emerald-950/40", border: "border-emerald-500/40", fill: "#10b981" },
};

export const STATE_ICONS: Record<number, string> = {
  0: "▼",
  1: "◈",
  2: "▲",
};

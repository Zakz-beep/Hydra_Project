// ── GRU Market Regime API types & fetch helpers ────────────────────────────

export interface RegimePrediction {
  date: string;
  regime: "Sideways" | "Bullish" | "Bearish";
  regime_idx: number;
  confidence_pct: number;
  volatility_daily_pct: number;
  volatility_annualized_pct: number;
  probabilities: {
    Sideways: number;
    Bullish: number;
    Bearish: number;
  };
  ticker: string;
  timestamp: string;
}

export interface ModelStatus {
  ticker: string;
  model_loaded: boolean;
  scaler_loaded: boolean;
  model_path: string;
  model_exists: boolean;
  scaler_exists: boolean;
  feature_count: number;
  metrics?: {
    train_loss: number;
    val_loss: number;
    val_mse: number;
    val_rmse: number;
    val_mae: number;
    train_accuracy: number;
    val_accuracy: number;
    is_overfitting: boolean;
    overfitting_status: string;
  };
}

export interface TrainResult {
  status: string;
  message: string;
  model_path: string;
  sample_prediction: RegimePrediction;
}

const BASE = "/api/regime";

export async function fetchRegimePrediction(ticker: string): Promise<RegimePrediction> {
  const res = await fetch(`${BASE}/predict?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Regime prediction failed");
  }
  return res.json();
}

export async function fetchModelStatus(ticker: string): Promise<ModelStatus> {
  const res = await fetch(`${BASE}/status?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) throw new Error("Failed to fetch model status");
  return res.json();
}

export async function triggerTraining(ticker: string, epochs: number = 200): Promise<TrainResult> {
  const res = await fetch(`${BASE}/train?ticker=${encodeURIComponent(ticker)}&epochs=${epochs}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Training failed");
  }
  return res.json();
}

// ── Style helpers ──────────────────────────────────────────────────────────

export const REGIME_STYLES = {
  Sideways: {
    bg: "bg-amber-950/40",
    border: "border-amber-500/40",
    text: "text-amber-400",
    dot: "bg-amber-400",
    gradient: "from-amber-500/20 to-amber-600/5",
  },
  Bullish: {
    bg: "bg-emerald-950/40",
    border: "border-emerald-500/40",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    gradient: "from-emerald-500/20 to-emerald-600/5",
  },
  Bearish: {
    bg: "bg-red-950/40",
    border: "border-red-500/40",
    text: "text-red-400",
    dot: "bg-red-400",
    gradient: "from-red-500/20 to-red-600/5",
  },
} as const;

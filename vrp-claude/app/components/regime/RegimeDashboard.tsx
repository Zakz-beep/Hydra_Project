"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  RegimePrediction, ModelStatus,
  fetchRegimePrediction, fetchModelStatus, triggerTraining,
  REGIME_STYLES,
} from "../../lib/regime";

// ═══════════════════════════════════════════════════════════════════════════════
//  GRU Market Regime Dashboard
//  Connects to regime_api.py (port 8007)
// ═══════════════════════════════════════════════════════════════════════════════

export default function RegimeDashboard() {
  const [ticker, setTicker]       = useState("SPY");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [prediction, setPrediction] = useState<RegimePrediction | null>(null);
  const [status, setStatus]       = useState<ModelStatus | null>(null);
  const [training, setTraining]   = useState(false);
  const [trainLog, setTrainLog]   = useState<string | null>(null);
  const [epochs, setEpochs]       = useState(200);

  // ── Fetch prediction + status ──────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pred, stat] = await Promise.all([
        fetchRegimePrediction(ticker).catch(() => null),
        fetchModelStatus(ticker),
      ]);
      setPrediction(pred);
      setStatus(stat);
    } catch (e: any) {
      setError(e.message ?? "Connection failed");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Train handler ──────────────────────────────────────────────────────────
  const handleTrain = async () => {
    setTraining(true);
    setTrainLog(null);
    setError(null);
    try {
      const result = await triggerTraining(ticker, epochs);
      setTrainLog(result.message);
      setPrediction(result.sample_prediction);
      // Refresh status
      const stat = await fetchModelStatus(ticker);
      setStatus(stat);
    } catch (e: any) {
      setError(e.message ?? "Training failed");
    } finally {
      setTraining(false);
    }
  };

  const regime = prediction?.regime ?? "Sideways";
  const style = REGIME_STYLES[regime];
  const probs = prediction?.probabilities;

  return (
    <div className="space-y-5">

      {/* ── Control Panel ────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Ticker
            </label>
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-violet-500/60 transition-colors w-28"
              placeholder="SPY"
            />
          </div>

          <button
            onClick={fetchAll}
            disabled={loading}
            className="px-4 py-2 rounded-md border border-zinc-700 text-sm font-mono text-zinc-300
              hover:border-zinc-500 hover:bg-zinc-800/50 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loading ? "Loading..." : "Predict"}
          </button>

          <div className="ml-auto flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                Epochs
              </label>
              <input
                type="number"
                value={epochs}
                onChange={e => setEpochs(Math.max(1, Math.min(500, Number(e.target.value))))}
                className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200
                  focus:outline-none focus:border-violet-500/60 transition-colors w-20"
              />
            </div>
            <button
              onClick={handleTrain}
              disabled={training}
              className={`px-4 py-2 rounded-md border text-sm font-mono transition-all cursor-pointer
                ${training
                  ? "border-amber-600/50 bg-amber-950/30 text-amber-400 animate-pulse"
                  : "border-violet-600/50 bg-violet-950/30 text-violet-300 hover:bg-violet-900/40"
                }`}
            >
              {training ? "Training..." : "Train Model"}
            </button>
          </div>
        </div>

        {/* Description */}
        <p className="text-[10px] font-mono text-zinc-600 mt-3">
          GRU Neural Network · Dual-Head (Regime + Volatility) · Macro-Enriched Features · 5-day Forward Realized Vol
        </p>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          {error}
        </div>
      )}

      {/* ── Training Success Log ──────────────────────────────────────────── */}
      {trainLog && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 text-sm font-mono text-emerald-400">
          {trainLog}
        </div>
      )}

      {/* ── Loading Skeleton ──────────────────────────────────────────────── */}
      {loading && !prediction && (
        <div className="space-y-4">
          <div className="h-48 rounded-xl bg-zinc-800/40 animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* ── Model Status (when no model is trained) ───────────────────────── */}
      {status && !status.model_loaded && !loading && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-6 py-10 text-center space-y-3">
          <p className="text-3xl">🧠</p>
          <p className="text-zinc-400 font-mono text-sm">
            Model belum di-train untuk <span className="text-zinc-200 font-bold">{ticker}</span>
          </p>
          <p className="text-zinc-600 font-mono text-[11px]">
            Klik &quot;Train Model&quot; untuk memulai training GRU regime predictor
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PREDICTION RESULT
         ═══════════════════════════════════════════════════════════════════════ */}
      {prediction && (
        <div className="space-y-4">

          {/* ── Regime Hero Card ──────────────────────────────────────────── */}
          <div className={`rounded-xl border ${style.border} bg-gradient-to-br ${style.gradient}
            backdrop-blur-sm px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${style.dot} animate-pulse`} />
                <span className={`text-2xl font-mono font-bold ${style.text}`}>
                  {regime}
                </span>
                <span className="text-[11px] font-mono text-zinc-500 bg-zinc-900/60 rounded px-2 py-0.5">
                  {prediction.confidence_pct.toFixed(1)}% confidence
                </span>
              </div>
              <div className="flex gap-4 text-[11px] font-mono text-zinc-500">
                <span>{prediction.ticker}</span>
                <span>Date: <span className="text-zinc-300">{prediction.date}</span></span>
              </div>
            </div>

            {/* Volatility mini card */}
            <div className="text-right space-y-1">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                5d FWD Volatility
              </p>
              <p className="text-xl font-mono font-bold text-zinc-200">
                {prediction.volatility_annualized_pct.toFixed(2)}%
                <span className="text-[11px] text-zinc-500 ml-1">ann.</span>
              </p>
              <p className="text-[11px] font-mono text-zinc-500">
                {prediction.volatility_daily_pct.toFixed(4)}% daily
              </p>
            </div>
          </div>

          {/* ── Probability Bars ──────────────────────────────────────────── */}
          {probs && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-4">
                Regime Probability Distribution
              </p>
              <div className="space-y-3">
                {(["Sideways", "Bullish", "Bearish"] as const).map(name => {
                  const prob = probs[name];
                  const pct = (prob * 100).toFixed(1);
                  const s = REGIME_STYLES[name];
                  const isActive = name === regime;
                  return (
                    <div key={name}>
                      <div className="flex justify-between text-[12px] font-mono mb-1">
                        <span className={`${s.text} ${isActive ? "font-bold" : ""}`}>
                          {isActive && "● "}{name}
                        </span>
                        <span className={`${isActive ? "text-zinc-100 font-bold" : "text-zinc-400"}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${s.dot} transition-all duration-700 ease-out`}
                          style={{
                            width: `${prob * 100}%`,
                            opacity: isActive ? 1 : 0.5,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stacked bar */}
              <div className="mt-4">
                <div className="flex h-5 rounded-full overflow-hidden gap-0.5">
                  {(["Sideways", "Bullish", "Bearish"] as const).map(name => {
                    const s = REGIME_STYLES[name];
                    return (
                      <div
                        key={name}
                        className={`h-full ${s.dot} transition-all duration-700 ease-out`}
                        style={{ width: `${probs[name] * 100}%`, opacity: name === regime ? 1 : 0.4 }}
                        title={`${name}: ${(probs[name] * 100).toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Metrics Grid ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile
              label="Regime"
              value={regime}
              sub={`idx: ${prediction.regime_idx}`}
              color={style.text}
            />
            <MetricTile
              label="Confidence"
              value={`${prediction.confidence_pct.toFixed(1)}%`}
              sub={prediction.confidence_pct > 50 ? "strong signal" : prediction.confidence_pct > 40 ? "moderate" : "weak signal"}
              color={prediction.confidence_pct > 50 ? "text-emerald-400" : prediction.confidence_pct > 40 ? "text-amber-400" : "text-zinc-400"}
            />
            <MetricTile
              label="Daily σ"
              value={`${prediction.volatility_daily_pct.toFixed(4)}%`}
              sub="5d fwd realized"
              color="text-cyan-400"
            />
            <MetricTile
              label="Annualized σ"
              value={`${prediction.volatility_annualized_pct.toFixed(2)}%`}
              sub="×√252"
              color="text-indigo-400"
            />
          </div>

          {/* ── Model Info ────────────────────────────────────────────────── */}
          {status && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                Model Info
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
                <div>
                  <span className="text-zinc-600">Status</span>
                  <span className={`ml-2 ${status.model_loaded ? "text-emerald-400" : "text-red-400"}`}>
                    {status.model_loaded ? "● Loaded" : "○ Not Loaded"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-600">Features</span>
                  <span className="ml-2 text-zinc-300">{status.feature_count}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Scaler</span>
                  <span className={`ml-2 ${status.scaler_loaded ? "text-emerald-400" : "text-red-400"}`}>
                    {status.scaler_loaded ? "● Ready" : "○ Missing"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-600">Timestamp</span>
                  <span className="ml-2 text-zinc-300">
                    {prediction.timestamp ? new Date(prediction.timestamp).toLocaleTimeString() : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Training Metrics ────────────────────────────────────────────────── */}
          {status?.metrics && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4 mt-4">
              <div className="flex justify-between items-center mb-3">
                <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider">
                  Latest Training Metrics
                </p>
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${status.metrics.is_overfitting ? "bg-red-950/50 text-red-400" : "bg-emerald-950/50 text-emerald-400"}`}>
                  {status.metrics.overfitting_status}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] font-mono">
                <div>
                  <span className="text-zinc-600">Val MSE</span>
                  <span className="ml-2 text-zinc-300">{status.metrics.val_mse.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Val RMSE</span>
                  <span className="ml-2 text-zinc-300">{status.metrics.val_rmse.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Val MAE</span>
                  <span className="ml-2 text-zinc-300">{status.metrics.val_mae.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Val Loss</span>
                  <span className="ml-2 text-zinc-300">{status.metrics.val_loss.toFixed(6)}</span>
                </div>
                <div>
                  <span className="text-zinc-600">Train Acc</span>
                  <span className="ml-2 text-zinc-300">{(status.metrics.train_accuracy * 100).toFixed(2)}%</span>
                </div>
                <div>
                  <span className="text-zinc-600">Val Acc</span>
                  <span className="ml-2 text-zinc-300">{(status.metrics.val_accuracy * 100).toFixed(2)}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small helper component ──────────────────────────────────────────────────
function MetricTile({ label, value, sub, color }: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-4 py-3">
      <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-mono font-bold mt-1 ${color}`}>{value}</p>
      <p className="text-[10px] font-mono text-zinc-600 mt-0.5">{sub}</p>
    </div>
  );
}

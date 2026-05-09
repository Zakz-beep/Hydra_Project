"use client";

import React, { useState, useCallback } from "react";
import {
  fetchVolHARCJ,
  HARCJResult,
} from "../../lib/volatility";
import {
  ComposedChart, Area, Line, Bar,
  BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ReferenceLine,
} from "recharts";

const PERIOD_OPTIONS = [
  { value: "6mo", label: "6M" },
  { value: "1y", label: "1Y" },
  { value: "2y", label: "2Y" },
  { value: "5y", label: "5Y" },
];

export default function HARCJChart({ initialTicker }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker || "SPY");
  const [period, setPeriod] = useState("2y");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<HARCJResult | null>(null);

  const handleRun = useCallback(async () => {
    const t = ticker.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVolHARCJ(t, period, true);
      setData(res);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker, period]);

  // ── Prepare chart data ─────────────────────────────────────────────────────
  const decompData = data?.rv_decomposition.map(d => ({
    date: d.date,
    Continuous: +(d.continuous * 100).toFixed(4),
    Jump: +(d.jump * 100).toFixed(4),
    VIX: d.vix ?? 0,
    GK_Vol: +d.gk_vol_ann_pct.toFixed(2),
  })) ?? [];

  const fittedData = data?.fitted_vs_actual.map(d => ({
    date: d.date,
    Actual: d.actual_rv !== null ? +(d.actual_rv * 100).toFixed(4) : null,
    Predicted: +(d.predicted_rv * 100).toFixed(4),
  })) ?? [];

  const featureData = data?.feature_importance.map(f => ({
    name: f.feature,
    value: +f.coefficient.toFixed(6),
    abs: +f.abs_coef.toFixed(6),
  })) ?? [];

  const vrpData = data?.rv_decomposition
    .filter(d => d.vrp !== null && d.vrp !== undefined)
    .map(d => ({
      date: d.date,
      VRP: +((d.vrp ?? 0) * 100).toFixed(4),
    })) ?? [];

  const cs = data?.current_state;
  const coefs = data?.har_cj?.coefficients;

  return (
    <div className="space-y-5">

      {/* ── Control Panel ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-teal-500/20 bg-gradient-to-r from-zinc-900 via-teal-950/10 to-zinc-900 px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📉</span>
          <h3 className="text-sm font-mono font-semibold text-teal-300 tracking-wider">
            HAR-CJ VOLATILITY DECOMPOSITION
          </h3>
          <span className="text-[9px] font-mono text-zinc-600 ml-auto">
            Jump × Continuous × OLS Forecast
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-8 gap-3 items-end">
          <div className="sm:col-span-3 flex flex-col gap-1">
            <label className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Ticker</label>
            <input
              type="text"
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-teal-500/60 transition-colors"
              placeholder="SPY"
            />
          </div>
          <div className="sm:col-span-3 flex flex-col gap-1">
            <label className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">History Period</label>
            <div className="flex gap-1.5">
              {PERIOD_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setPeriod(o.value)}
                  className={`flex-1 px-2 py-2 rounded-md text-xs font-mono transition-all
                    ${period === o.value
                      ? "bg-teal-600/30 text-teal-300 border border-teal-500/40"
                      : "bg-zinc-900 text-zinc-500 border border-zinc-700 hover:text-zinc-300"
                    }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <button
              onClick={handleRun}
              disabled={loading}
              className={`w-full px-4 py-2 rounded-md text-sm font-mono font-semibold transition-all
                ${loading
                  ? "bg-zinc-800 text-zinc-500 cursor-wait"
                  : "bg-teal-600/20 text-teal-300 border border-teal-500/40 hover:bg-teal-600/30 hover:shadow-lg hover:shadow-teal-500/10"
                }`}
            >
              {loading ? "◌ Computing..." : "▶ Run HAR-CJ"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          ⚠ {error}
        </div>
      )}

      {loading && !data && (
        <div className="space-y-3">
          <div className="h-40 rounded-xl bg-zinc-800/40 animate-pulse" />
          <div className="h-64 rounded-xl bg-zinc-800/40 animate-pulse" />
        </div>
      )}

      {data && cs && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* ── Hero Metrics ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Current Vol */}
            <div className="rounded-xl border border-teal-500/20 bg-teal-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Current GK Vol</p>
              <p className="text-xl font-mono font-bold text-teal-300 mt-1">
                {cs.gk_vol_ann_pct.toFixed(2)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Annualized</p>
            </div>

            {/* Forecast Vol */}
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Forecast Vol</p>
              <p className="text-xl font-mono font-bold text-cyan-300 mt-1">
                {cs.next_vol_forecast_ann_pct.toFixed(2)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Next-day HAR-CJ</p>
            </div>

            {/* Jump % */}
            <div className="rounded-xl border border-orange-500/20 bg-orange-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Jump % of RV</p>
              <p className={`text-xl font-mono font-bold mt-1 ${
                cs.jump_pct_of_rv > 30 ? "text-red-400" : cs.jump_pct_of_rv > 15 ? "text-orange-400" : "text-emerald-400"
              }`}>
                {cs.jump_pct_of_rv.toFixed(1)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">
                {cs.jump_pct_of_rv > 30 ? "⚠ High Jump Activity" : cs.jump_pct_of_rv > 15 ? "Moderate" : "✓ Low Jumps"}
              </p>
            </div>

            {/* VRP */}
            {cs.vrp !== null && cs.vrp !== undefined && (
              <div className="rounded-xl border border-purple-500/20 bg-purple-950/10 px-4 py-3">
                <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Variance Risk Premium</p>
                <p className={`text-xl font-mono font-bold mt-1 ${
                  cs.vrp > 0 ? "text-emerald-400" : "text-red-400"
                }`}>
                  {(cs.vrp * 100).toFixed(3)}
                </p>
                <p className="text-[9px] font-mono text-zinc-600">
                  {cs.vrp > 0 ? "VIX > RV (Fear Premium)" : "RV > VIX (Unusual)"}
                </p>
              </div>
            )}
          </div>

          {/* ── Model R² & Coefficients ──────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                HAR-CJ OLS Model — {data.model_spec.date_range}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600">R²</span>
                <span className={`text-sm font-mono font-bold ${
                  data.har_cj.r_squared > 0.3 ? "text-emerald-400" : data.har_cj.r_squared > 0.15 ? "text-amber-400" : "text-red-400"
                }`}>
                  {(data.har_cj.r_squared * 100).toFixed(2)}%
                </span>
              </div>
            </div>
            {coefs && (
              <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                {Object.entries(coefs).map(([key, val]) => (
                  <div key={key} className="rounded-lg bg-zinc-800/50 px-3 py-2 text-center">
                    <p className="text-[9px] font-mono text-zinc-500">{key}</p>
                    <p className={`text-sm font-mono font-bold ${
                      val > 0 ? "text-teal-400" : "text-orange-400"
                    }`}>
                      {val.toFixed(4)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Stacked Area: Continuous + Jump Decomposition ─────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                RV Decomposition — Continuous vs Jump (×100)
              </p>
              <p className="text-[9px] font-mono text-zinc-600">
                Green = Diffusive | Orange = Discontinuous
              </p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={decompData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(decompData.length / 8)} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: 11, fontFamily: "monospace" }}
                    labelStyle={{ color: "#a1a1aa" }}
                  />
                  <Area type="monotone" dataKey="Continuous" stackId="1" fill="#10b981" fillOpacity={0.4} stroke="#10b981" strokeWidth={0} />
                  <Area type="monotone" dataKey="Jump" stackId="1" fill="#f97316" fillOpacity={0.5} stroke="#f97316" strokeWidth={0} />
                  {decompData.some(d => d.VIX > 0) && (
                    <Line type="monotone" dataKey="VIX" stroke="#8b5cf6" strokeWidth={1} dot={false} strokeDasharray="4 2" yAxisId={0} />
                  )}
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Fitted vs Actual ──────────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                HAR-CJ Forecast vs Actual RV (×100)
              </p>
              <p className="text-[9px] font-mono text-zinc-600">
                Gray = Actual | Teal = HAR-CJ OLS Fit
              </p>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={fittedData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(fittedData.length / 8)} />
                  <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: 11, fontFamily: "monospace" }}
                    labelStyle={{ color: "#a1a1aa" }}
                  />
                  <Line type="monotone" dataKey="Actual" stroke="#a1a1aa" strokeWidth={1} dot={false} />
                  <Line type="monotone" dataKey="Predicted" stroke="#14b8a6" strokeWidth={1.5} dot={false} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Bottom Row: Feature Importance + VRP ──────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Feature Importance */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                HAR-CJ Coefficient Importance
              </p>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={featureData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: "#71717a" }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#a1a1aa" }} width={55} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: 11, fontFamily: "monospace" }}
                    />
                    <Bar dataKey="value" fill="#14b8a6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* VRP Time Series */}
            {vrpData.length > 0 && (
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                  Variance Risk Premium (×100)
                </p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={vrpData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(vrpData.length / 6)} />
                      <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#18181b", borderColor: "#3f3f46", borderRadius: "8px", fontSize: 11, fontFamily: "monospace" }}
                        labelStyle={{ color: "#a1a1aa" }}
                      />
                      <ReferenceLine y={0} stroke="#71717a" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="VRP" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} strokeWidth={1} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* ── Explanatory Note ──────────────────────────────────────── */}
          <div className="rounded-xl border border-teal-500/15 bg-teal-950/5 px-5 py-4">
            <p className="text-[10px] font-mono text-teal-300/70 leading-relaxed">
              <strong>HAR-CJ Model Note:</strong> This panel decomposes Realized Variance (GK estimator) into its <strong>Continuous</strong> (diffusive)
              and <strong>Jump</strong> (discontinuous) components using Bipower Variation.
              The HAR-CJ OLS model uses daily/weekly/monthly lags of both C and J to forecast next-day RV.
              When Jump % is high (&gt;30%), expect elevated tail risk and wider VaR bounds.
              The Variance Risk Premium (VRP = VIX² - RV) measures the market&apos;s fear premium above realized volatility.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}

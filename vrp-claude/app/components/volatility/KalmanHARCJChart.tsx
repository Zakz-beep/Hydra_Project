"use client";

import React, { useState, useCallback } from "react";
import {
  fetchVolKalmanHARCJ,
  KalmanHARCJResult,
} from "../../lib/volatility";
import {
  ComposedChart, Area, Line, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ReferenceLine,
} from "recharts";

export default function KalmanHARCJChart({ initialTicker }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker || "SPY");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<KalmanHARCJResult | null>(null);
  const [subTab, setSubTab] = useState<"vol" | "betas" | "cj" | "cal">("vol");

  const handleRun = useCallback(async () => {
    const t = ticker.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVolKalmanHARCJ(t, "730d", 120);
      setData(res);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  const volData = data?.vol_series.map(d => ({
    date: d.date,
    Realized: +d.actual_vol_pct.toFixed(4),
    Kalman: +d.kalman_har_cj_pct.toFixed(4),
    YangZhang: +d.yz_24h_pct.toFixed(4),
    GarmanKlass: +d.gk_intraday_pct.toFixed(4),
  })) ?? [];

  const betasData = data?.betas_series.map(d => ({
    date: d.date,
    "βC_d": +d.beta_C_d.toFixed(4),
    "βC_w": +d.beta_C_w.toFixed(4),
    "βC_m": +d.beta_C_m.toFixed(4),
    "βJ_d": +d.beta_J_d.toFixed(4),
    "βJ_w": +d.beta_J_w.toFixed(4),
    "βJ_m": +d.beta_J_m.toFixed(4),
  })) ?? [];

  const cjData = data?.vol_series.map(d => ({
    date: d.date,
    Continuous: +d.log_c.toFixed(4),
    Jump: +d.log_j.toFixed(4),
    Return: +d.return_pct.toFixed(4),
  })) ?? [];

  const cs = data?.current_state;
  const fc = data?.forecast;
  const m = data?.metrics;

  const tooltipStyle = {
    backgroundColor: "#18181b", borderColor: "#3f3f46",
    borderRadius: "8px", fontSize: 11, fontFamily: "monospace",
  };

  const SUB_TABS = [
    { id: "vol" as const, label: "Vol Forecast", icon: "📈" },
    { id: "betas" as const, label: "Dynamic βetas", icon: "🧮" },
    { id: "cj" as const, label: "C+J Decomp", icon: "⚡" },
    { id: "cal" as const, label: "Calibration", icon: "📋" },
  ];

  return (
    <div className="space-y-5">

      {/* ── Control Panel ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-r from-zinc-900 via-violet-950/10 to-zinc-900 px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔬</span>
          <h3 className="text-sm font-mono font-semibold text-violet-300 tracking-wider">
            KALMAN HAR-RV-CJ ENGINE
          </h3>
          <span className="text-[9px] font-mono text-zinc-600 ml-auto">
            Adaptive Time-Varying Betas × State-Space Model
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-8 gap-3 items-end">
          <div className="sm:col-span-5 flex flex-col gap-1">
            <label className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Ticker</label>
            <input
              type="text" value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-violet-500/60 transition-colors"
              placeholder="SPY"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              onClick={handleRun} disabled={loading}
              className={`w-full px-4 py-2 rounded-md text-sm font-mono font-semibold transition-all
                ${loading
                  ? "bg-zinc-800 text-zinc-500 cursor-wait"
                  : "bg-violet-600/20 text-violet-300 border border-violet-500/40 hover:bg-violet-600/30 hover:shadow-lg hover:shadow-violet-500/10"
                }`}
            >
              {loading ? "◌ Computing Kalman..." : "▶ Run Kalman HAR-CJ"}
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

      {data && cs && fc && m && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* ── Hero Metrics ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-xl border border-violet-500/20 bg-violet-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Tomorrow Forecast</p>
              <p className="text-xl font-mono font-bold text-violet-300 mt-1">
                {fc.forecast_vol_pct.toFixed(3)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Kalman Vol</p>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Current Vol</p>
              <p className="text-xl font-mono font-bold text-cyan-300 mt-1">
                {cs.actual_vol_pct.toFixed(3)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Realized</p>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${
              fc.jump_dominant
                ? "border-red-500/20 bg-red-950/10"
                : "border-emerald-500/20 bg-emerald-950/10"
            }`}>
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Regime</p>
              <p className={`text-lg font-mono font-bold mt-1 ${
                fc.jump_dominant ? "text-red-400" : "text-emerald-400"
              }`}>
                {fc.jump_dominant ? "⚠ JUMP" : "✅ SMOOTH"}
              </p>
              <p className="text-[9px] font-mono text-zinc-600">{fc.regime}</p>
            </div>

            <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">R² (log-RV)</p>
              <p className={`text-xl font-mono font-bold mt-1 ${
                m.r2_log_rv > 0.85 ? "text-emerald-400" : m.r2_log_rv > 0.6 ? "text-amber-400" : "text-red-400"
              }`}>
                {(m.r2_log_rv * 100).toFixed(2)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Model Fit</p>
            </div>

            <div className="rounded-xl border border-zinc-700/40 bg-zinc-900/30 px-4 py-3">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">RMSE (vol%)</p>
              <p className="text-xl font-mono font-bold text-zinc-300 mt-1">
                {m.rmse_vol_pct.toFixed(4)}%
              </p>
              <p className="text-[9px] font-mono text-zinc-600">Avg Error</p>
            </div>
          </div>

          {/* ── Beta Coefficients Row ────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
              Latest Kalman Betas — {data.model_spec.date_range}
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
              {Object.entries(fc.betas).map(([key, val]) => (
                <div key={key} className="rounded-lg bg-zinc-800/50 px-3 py-2 text-center">
                  <p className="text-[9px] font-mono text-zinc-500">β{key}</p>
                  <p className={`text-sm font-mono font-bold ${
                    key.startsWith("C") ? "text-sky-400"
                      : key.startsWith("J") ? "text-rose-400"
                      : "text-zinc-300"
                  }`}>
                    {val.toFixed(4)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Sub-Tab Navigation ───────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-1.5 flex gap-1.5">
            {SUB_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono transition-all
                  ${subTab === tab.id
                    ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent"
                  }`}
              >
                <span>{tab.icon}</span>
                <span className="font-semibold">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ── Panel: Vol Forecast ──────────────────────────────────── */}
          {subTab === "vol" && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Kalman HAR-CJ Forecast vs Estimators vs Realized
                </p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={volData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(volData.length / 8)} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a1a1aa" }} />
                    <Area type="monotone" dataKey="Realized" fill="#8b949e" fillOpacity={0.08} stroke="#8b949e" strokeWidth={1} />
                    <Line type="monotone" dataKey="YangZhang" stroke="#d29922" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="GarmanKlass" stroke="#ffa657" strokeWidth={1} dot={false} strokeDasharray="4 2" />
                    <Line type="monotone" dataKey="Kalman" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Panel: Dynamic Betas ─────────────────────────────────── */}
          {subTab === "betas" && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                  Time-Varying Kalman Betas (Adaptive Coefficients)
                </p>
                <p className="text-[9px] font-mono text-zinc-600">Blue = Continuous | Red = Jump</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={betasData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(betasData.length / 8)} />
                    <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a1a1aa" }} />
                    <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="βC_d" stroke="#58a6ff" strokeWidth={1.4} dot={false} />
                    <Line type="monotone" dataKey="βC_w" stroke="#79c0ff" strokeWidth={1.2} dot={false} />
                    <Line type="monotone" dataKey="βC_m" stroke="#cae8ff" strokeWidth={1} dot={false} />
                    <Line type="monotone" dataKey="βJ_d" stroke="#f85149" strokeWidth={1.4} dot={false} />
                    <Line type="monotone" dataKey="βJ_w" stroke="#ff7b72" strokeWidth={1.2} dot={false} />
                    <Line type="monotone" dataKey="βJ_m" stroke="#ffa198" strokeWidth={1} dot={false} />
                    <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Panel: C+J Decomposition ─────────────────────────────── */}
          {subTab === "cj" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                  log Continuous vs log Jump (RV Decomposition)
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={cjData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(cjData.length / 8)} />
                      <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a1a1aa" }} />
                      <Area type="monotone" dataKey="Continuous" fill="#58a6ff" fillOpacity={0.1} stroke="#58a6ff" strokeWidth={1.5} />
                      <Bar dataKey="Jump" fill="#f85149" opacity={0.6} />
                      <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                  Daily Return (%)
                </p>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={cjData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#71717a" }} interval={Math.floor(cjData.length / 8)} />
                      <YAxis tick={{ fontSize: 9, fill: "#71717a" }} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a1a1aa" }} />
                      <ReferenceLine y={0} stroke="#3f3f46" />
                      <Bar dataKey="Return" fill="#bc8cff" opacity={0.7} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ── Panel: Calibration Table ──────────────────────────────── */}
          {subTab === "cal" && (
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4 overflow-x-auto">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                7-Day Calibration Table
              </p>
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800">
                    {["Date", "Open", "Close", "Return%", "YZ 24H%", "GK Intra%", "Kalman%"].map(h => (
                      <th key={h} className="text-left text-zinc-500 py-2 px-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.calibration_table.map(row => (
                    <tr key={row.date} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="py-1.5 px-2 text-zinc-400">{row.date}</td>
                      <td className="py-1.5 px-2 text-zinc-300">{row.open.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-zinc-300">{row.close.toFixed(2)}</td>
                      <td className={`py-1.5 px-2 ${row.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {row.return_pct.toFixed(4)}
                      </td>
                      <td className="py-1.5 px-2 text-amber-400">{row.yz_24h_pct.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-orange-400">{row.gk_intraday_pct.toFixed(4)}</td>
                      <td className="py-1.5 px-2 text-violet-400 font-semibold">{row.kalman_har_cj_pct.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Metrics Summary ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">log-RV Space (Native)</p>
              <div className="space-y-2 text-[11px] font-mono">
                {[
                  ["R²", m.r2_log_rv.toFixed(6)],
                  ["MSE", m.mse_log_rv.toFixed(6)],
                  ["RMSE", m.rmse_log_rv.toFixed(6)],
                  ["MAE", m.mae_log_rv.toFixed(6)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-600">{k}</span>
                    <span className="text-zinc-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">Vol % Space (Interpretable)</p>
              <div className="space-y-2 text-[11px] font-mono">
                {[
                  ["R²", m.r2_vol_pct.toFixed(6)],
                  ["MSE", m.mse_vol_pct.toFixed(6)],
                  ["RMSE", m.rmse_vol_pct.toFixed(6) + "%"],
                  ["MAE", m.mae_vol_pct.toFixed(6) + "%"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-zinc-600">{k}</span>
                    <span className="text-zinc-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Note ──────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-violet-500/15 bg-violet-950/5 px-5 py-4">
            <p className="text-[10px] font-mono text-violet-300/70 leading-relaxed">
              <strong>Kalman HAR-CJ Note:</strong> This engine uses a state-space model where HAR-CJ regression
              coefficients (β) evolve over time via a Kalman Filter, enabling <strong>adaptive</strong> tracking
              of regime shifts between continuous-dominated and jump-dominated volatility.
              When βJ_d &gt; βC_d the market is in a <strong>Jump-Reactive</strong> regime (panic / news-driven).
              The filter automatically adjusts sensitivity to match the current volatility environment.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}

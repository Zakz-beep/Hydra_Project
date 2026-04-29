"use client";

import React, { useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { HMMResult, StateSeriesPoint, STATE_COLORS, STATE_ICONS } from "../../lib/volatility";

interface Props {
  hmm: HMMResult;
}

const fmtDate = (s: string) => s.slice(0, 10).slice(5); // MM-DD

// ── Traffic Light Regime Indicator ────────────────────────────────────────────
function RegimeTrafficLight({ current, posteriors }: { current: number; posteriors: Record<string, number> }) {
  const states = [
    { id: 0, name: "Bearish / High-Vol", icon: "▼" },
    { id: 1, name: "Sideways / Neutral", icon: "◈" },
    { id: 2, name: "Bullish / Low-Vol",  icon: "▲" },
  ];
  const colors = STATE_COLORS;

  return (
    <div className="flex items-center gap-3">
      {states.map(s => {
        const isActive = s.id === current;
        const col = colors[s.id];
        const prob = posteriors[s.name] ?? 0;
        return (
          <div
            key={s.id}
            className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all duration-300
              ${isActive ? `${col.bg} ${col.border} shadow-lg` : "bg-zinc-900/30 border-zinc-800/50 opacity-40"}`}
          >
            <span className={`text-2xl font-bold ${col.text}`}>{s.icon}</span>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${col.text}`}>
              {s.name.split(" / ")[0]}
            </span>
            <div className="w-12 h-1 rounded-full bg-zinc-800">
              <div className={`h-full rounded-full ${col.bg.replace("/40", "")}`} style={{ width: `${(prob * 100).toFixed(0)}%` }} />
            </div>
            <span className="text-[9px] font-mono text-zinc-500">{(prob * 100).toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Transition Matrix Heatmap ─────────────────────────────────────────────────
function TransitionHeatmap({ matrix }: { matrix: HMMResult["transition_matrix"] }) {
  const stateNames = ["Bearish / High-Vol", "Sideways / Neutral", "Bullish / Low-Vol"];
  const short = ["Bearish", "Neutral", "Bullish"];

  return (
    <div className="overflow-auto">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr>
            <th className="text-zinc-600 text-left px-2 py-1.5 text-[10px]">FROM → TO</th>
            {short.map(s => (
              <th key={s} className="px-3 py-1.5 text-zinc-500 text-center font-normal">{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i} className="border-t border-zinc-800/40">
              <td className={`px-2 py-2 font-semibold ${STATE_COLORS[i].text}`}>{short[i]}</td>
              {stateNames.map((toName, j) => {
                const prob = row.to[toName] ?? 0;
                const intensity = Math.round(prob * 100);
                const isHigh = i === j; // diagonal = stay prob
                return (
                  <td key={j} className="px-3 py-2 text-center relative">
                    <div
                      className="absolute inset-1 rounded"
                      style={{
                        background: isHigh
                          ? `rgba(99,102,241,${prob * 0.7})`
                          : `rgba(113,113,122,${prob * 0.4})`,
                      }}
                    />
                    <span className={`relative z-10 font-mono ${prob > 0.5 ? "text-zinc-100 font-bold" : prob > 0.2 ? "text-zinc-300" : "text-zinc-600"}`}>
                      {(prob * 100).toFixed(1)}%
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900/95 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] font-mono shadow-xl space-y-0.5">
      <p className="text-zinc-400 border-b border-zinc-800 pb-1 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? p.fill }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(4) : p.value}
        </p>
      ))}
    </div>
  );
};

// ── State Series Area Chart ───────────────────────────────────────────────────
function RegimeTimeline({ series }: { series: StateSeriesPoint[] }) {
  const data = series.map(p => ({
    date: fmtDate(p.timestamp),
    state: p.state_id,
    return_pct: p.return_pct,
    vol_pct: p.vol_pct,
    avg_corr: p.avg_corr,
    har_rv: p.har_rv,
    // Separate proba per state
    p_bear: p.proba["Bearish / High-Vol"] ?? 0,
    p_neut: p.proba["Sideways / Neutral"] ?? 0,
    p_bull: p.proba["Bullish / Low-Vol"]  ?? 0,
  }));

  return (
    <div className="space-y-4">
      {/* Regime probability stacked area */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Regime Posterior Probabilities (Stacked)
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} stackOffset="expand">
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(data.length / 8)} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} />
            <Area dataKey="p_bear" name="Bearish" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} />
            <Area dataKey="p_neut" name="Neutral" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.4} />
            <Area dataKey="p_bull" name="Bullish" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Return with colored regime background overlay */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Return % with Regime Overlay
        </p>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(data.length / 8)} />
            <YAxis tickFormatter={v => `${v.toFixed(2)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
            <Area dataKey="return_pct" name="Return %" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Vol + Corr dual line */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Rolling Volatility % &amp; Avg Correlation
        </p>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(data.length / 8)} />
            <YAxis yAxisId="vol" tickFormatter={v => `${v.toFixed(2)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={44} />
            <YAxis yAxisId="corr" orientation="right" domain={[-1, 1]} tickFormatter={v => v.toFixed(2)} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={32} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
            <Line yAxisId="vol"  dataKey="vol_pct"  name="Vol %"    stroke="#f97316" strokeWidth={1.5} dot={false} />
            <Line yAxisId="corr" dataKey="avg_corr" name="Avg Corr" stroke="#a78bfa" strokeWidth={1.5} dot={false} />
            {data[0]?.har_rv !== undefined && (
              <Line yAxisId="vol" dataKey="har_rv" name="HAR-RV" stroke="#22d3ee" strokeWidth={1} dot={false} strokeDasharray="3 2" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── State Summary Cards ───────────────────────────────────────────────────────
function StateSummaryCards({ summary }: { summary: HMMResult["state_summary"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {summary.map(s => {
        const col = STATE_COLORS[s.state_id];
        return (
          <div key={s.state_id} className={`rounded-xl border ${col.border} ${col.bg} px-4 py-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-mono font-bold ${col.text}`}>
                {STATE_ICONS[s.state_id]} {s.name}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900/50 px-2 py-0.5 rounded-full">
                {s.pct_history}% of history
              </span>
            </div>

            {/* Bar chart proxy */}
            <div className="space-y-1.5 text-[10px] font-mono">
              {[
                { label: "Avg Return",    val: `${s.mean_return >= 0 ? "+" : ""}${s.mean_return}%`, raw: s.mean_return, maxAbs: 2 },
                { label: "Avg Vol",       val: `${s.mean_vol}%`,       raw: s.mean_vol,   maxAbs: 3 },
                { label: "Avg Corr",      val: s.mean_corr.toFixed(4), raw: s.mean_corr,  maxAbs: 1 },
                { label: "Sharpe Proxy",  val: s.sharpe_proxy.toFixed(3), raw: s.sharpe_proxy, maxAbs: 2 },
              ].map(({ label, val, raw, maxAbs }) => (
                <div key={label}>
                  <div className="flex justify-between text-zinc-400 mb-0.5">
                    <span>{label}</span>
                    <span className={raw >= 0 ? col.text : "text-red-400"}>{val}</span>
                  </div>
                  <div className="h-1 rounded-full bg-zinc-900">
                    <div
                      className={`h-full rounded-full ${col.bg.replace("/40", "")}`}
                      style={{ width: `${Math.min(100, Math.abs(raw) / maxAbs * 100).toFixed(0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800/40 pt-2 grid grid-cols-2 gap-2 text-[10px] font-mono text-zinc-500">
              <div>
                <span className="text-zinc-600">Max Ret</span>
                <span className="ml-1 text-emerald-400">{s.max_return > 0 ? "+" : ""}{s.max_return}%</span>
              </div>
              <div>
                <span className="text-zinc-600">Min Ret</span>
                <span className="ml-1 text-red-400">{s.min_return}%</span>
              </div>
              <div>
                <span className="text-zinc-600">Count</span>
                <span className="ml-1 text-zinc-300">{s.count} bars</span>
              </div>
              <div>
                <span className="text-zinc-600">Exp DD</span>
                <span className="ml-1 text-amber-400">{s.expected_dd_pct.toFixed(2)}%</span>
              </div>
              {s.mean_har_rv !== undefined && (
                <div className="col-span-2">
                  <span className="text-zinc-600">HAR-RV Mean</span>
                  <span className="ml-1 text-cyan-400">{(s.mean_har_rv * 100).toFixed(4)}%</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main HMM Dashboard Component ──────────────────────────────────────────────
export default function HMMRegimeChart({ hmm }: Props) {
  const currentState = hmm.current_regime;
  const col = STATE_COLORS[currentState];

  return (
    <div className="space-y-5">
      {/* ── Current Regime Hero ─────────────────────────────────────── */}
      <div className={`rounded-xl border ${col.border} ${col.bg} px-5 py-4`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Current Market Regime</p>
            <h2 className={`text-2xl font-mono font-bold ${col.text}`}>
              {STATE_ICONS[currentState]} {hmm.current_regime_name}
            </h2>
            <p className="text-[11px] font-mono text-zinc-500 mt-1">
              Stay prob: <span className={`font-semibold ${col.text}`}>{(hmm.stay_probability * 100).toFixed(1)}%</span>
              &nbsp;· Log-likelihood: <span className="text-zinc-300">{hmm.log_likelihood}</span>
              &nbsp;· Features: <span className="text-zinc-300">{hmm.n_features}D</span>
            </p>
          </div>
          <RegimeTrafficLight current={currentState} posteriors={hmm.current_posteriors} />
        </div>
      </div>

      {/* ── Transition Probabilities ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
          <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Next Regime Transition Probabilities
          </p>
          <div className="space-y-2">
            {hmm.transition_probs.map((tp, i) => {
              const stateId = ["Bearish / High-Vol", "Sideways / Neutral", "Bullish / Low-Vol"].indexOf(tp.to_state);
              const c = STATE_COLORS[stateId >= 0 ? stateId : 1];
              return (
                <div key={i}>
                  <div className="flex justify-between text-[11px] font-mono mb-1">
                    <span className={c.text}>{STATE_ICONS[stateId >= 0 ? stateId : 1]} {tp.to_state}</span>
                    <span className="text-zinc-300 font-bold">{(tp.probability * 100).toFixed(2)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div className={`h-full rounded-full ${c.bg.replace("/40", "")} transition-all`}
                      style={{ width: `${(tp.probability * 100).toFixed(1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
          <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
            Transition Matrix (Stay on Diagonal)
          </p>
          <TransitionHeatmap matrix={hmm.transition_matrix} />
        </div>
      </div>

      {/* ── State Summary Cards ───────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Per-State Analytics
        </p>
        <StateSummaryCards summary={hmm.state_summary} />
      </div>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Regime Timeline — Last {hmm.state_series.length} Bars
        </p>
        <RegimeTimeline series={hmm.state_series} />
      </div>
    </div>
  );
}

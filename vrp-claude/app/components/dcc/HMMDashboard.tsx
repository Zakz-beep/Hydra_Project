"use client";

import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Cell,
  BarChart, Bar, Legend, ScatterChart, Scatter
} from "recharts";
import { HMMResult, HMMStatePoint } from "../../lib/dcc";

interface Props {
  hmm: HMMResult;
}

// ── Design tokens per regime ────────────────────────────────────────────────
const REGIME_CONFIG = {
  0: {
    label: "Bearish / High-Vol",
    light: "#ef4444", bg: "bg-red-950/30", border: "border-red-700/50",
    badge: "bg-red-500/20 text-red-300 border-red-500/40",
    dot: "bg-red-500", glow: "shadow-red-500/20",
    trafficColor: "#ef4444", icon: "🔴", signal: "SELL / HEDGE",
  },
  1: {
    label: "Sideways / Neutral",
    light: "#f59e0b", bg: "bg-amber-950/30", border: "border-amber-700/50",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    dot: "bg-amber-500", glow: "shadow-amber-500/20",
    trafficColor: "#f59e0b", icon: "🟡", signal: "REDUCE / WAIT",
  },
  2: {
    label: "Bullish / Low-Vol",
    light: "#22c55e", bg: "bg-emerald-950/30", border: "border-emerald-700/50",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    dot: "bg-emerald-500", glow: "shadow-emerald-500/20",
    trafficColor: "#22c55e", icon: "🟢", signal: "BUY / HOLD",
  },
} as const;

const STATE_COLORS = ["#ef4444", "#f59e0b", "#22c55e"];
const STATE_KEYS = ["Bearish / High-Vol", "Sideways / Neutral", "Bullish / Low-Vol"];

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const fmtDate = (v: string) => {
  try {
    const d = new Date(v);
    const hasTime = d.getHours() > 0 || d.getMinutes() > 0 || v.includes('T') && !v.endsWith('T00:00:00.000Z');
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (hasTime) {
      const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      return `${dateStr} ${timeStr}`;
    }
    return dateStr;
  }
  catch { return v; }
};

// ── 1. TRAFFIC LIGHT PANEL ───────────────────────────────────────────────────
function TrafficLight({ hmm }: { hmm: HMMResult }) {
  const cur = hmm.current_regime as 0 | 1 | 2;
  const cfg = REGIME_CONFIG[cur];
  const posteriors = hmm.current_posteriors;

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5 shadow-lg ${cfg.glow}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">HMM Current Regime</p>
          {/* Traffic Light */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex flex-col gap-2 p-2 bg-zinc-950/60 rounded-xl border border-zinc-800">
              {[0, 1, 2].map((s) => (
                <div
                  key={s}
                  className="w-8 h-8 rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: s === cur ? REGIME_CONFIG[s as 0|1|2].trafficColor : "#27272a",
                    boxShadow: s === cur ? `0 0 16px ${REGIME_CONFIG[s as 0|1|2].trafficColor}88` : "none",
                  }}
                />
              ))}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">{cfg.icon}</span>
                <h2 className="text-xl font-mono font-bold text-zinc-100">{cfg.label}</h2>
              </div>
              <span className={`inline-block text-[10px] font-mono font-bold px-3 py-1 rounded-full border ${cfg.badge} uppercase tracking-widest`}>
                {cfg.signal}
              </span>
            </div>
          </div>

          {/* Posterior Probabilities bar */}
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Posterior Probabilities</p>
          <div className="space-y-1.5">
            {STATE_KEYS.map((name, i) => {
              const prob = posteriors[name] ?? 0;
              const isCur = i === cur;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-zinc-400 w-28 shrink-0 truncate">{name.split(" /")[0]}</span>
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${prob * 100}%`, backgroundColor: STATE_COLORS[i] }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-10 text-right" style={{ color: STATE_COLORS[i] }}>
                    {(prob * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3 shrink-0">
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/40 px-4 py-3 text-center min-w-[100px]">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Stay Prob</p>
            <p className="text-2xl font-mono font-bold text-zinc-100 mt-1">{(hmm.stay_probability * 100).toFixed(1)}%</p>
            <p className="text-[10px] text-zinc-600 font-mono">Regime persistence</p>
          </div>
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-950/40 px-4 py-3 text-center">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Log-Lik</p>
            <p className="text-lg font-mono font-bold text-indigo-400 mt-1">{hmm.log_likelihood.toFixed(1)}</p>
            <p className="text-[10px] text-zinc-600 font-mono">Model fit</p>
          </div>
        </div>
      </div>

      {/* Transition probs footer */}
      <div className="mt-4 pt-4 border-t border-zinc-800/60">
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Next Regime Probabilities</p>
        <div className="flex gap-3 flex-wrap">
          {hmm.transition_probs.map((tp) => {
            const idx = STATE_KEYS.indexOf(tp.to_state);
            return (
              <div key={tp.to_state} className="flex items-center gap-2 text-xs font-mono">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATE_COLORS[idx] ?? "#71717a" }} />
                <span className="text-zinc-400">{tp.to_state.split(" /")[0]}:</span>
                <span className="text-zinc-100 font-bold">{(tp.probability * 100).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 2. REGIME OVERLAY AREA CHART ─────────────────────────────────────────────
function RegimeOverlay({ series }: { series: HMMStatePoint[] }) {
  const [hoveredPoint, setHoveredPoint] = useState<any>(null);

  const data = series.slice(-300).map((pt) => ({
    timestamp: pt.timestamp,
    return_pct: pt.return_pct,
    vol_pct: pt.vol_pct,
    avg_corr: pt.avg_corr,
    state_id: pt.state_id,
    bearish: pt.state_id === 0 ? 1 : 0,
    neutral: pt.state_id === 1 ? 1 : 0,
    bullish: pt.state_id === 2 ? 1 : 0,
    prob_bear: pt.proba["Bearish / High-Vol"] ?? 0,
    prob_neut: pt.proba["Sideways / Neutral"] ?? 0,
    prob_bull: pt.proba["Bullish / Low-Vol"] ?? 0,
  }));

  const displayPoint = hoveredPoint || data[data.length - 1];
  const overlayCfg = REGIME_CONFIG[displayPoint?.state_id as 0|1|2];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const stCfg = REGIME_CONFIG[d?.state_id as 0|1|2];
    return (
      <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-lg text-xs font-mono shadow-xl">
        <p className="text-zinc-400 mb-2 border-b border-zinc-800 pb-1">{label}</p>
        <p className="mb-1" style={{ color: stCfg?.trafficColor }}>{stCfg?.icon} {stCfg?.label}</p>
        <p className="text-zinc-300">Return: <span className={d?.return_pct >= 0 ? "text-emerald-400" : "text-red-400"}>{fmtPct(d?.return_pct ?? 0)}</span></p>
        <p className="text-zinc-300">Vol: <span className="text-amber-400">{(d?.vol_pct ?? 0).toFixed(3)}%</span></p>
        <p className="text-zinc-300">DCC ρ: <span className="text-indigo-400">{(d?.avg_corr ?? 0).toFixed(3)}</span></p>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
      <div>
        <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
          <span className="text-emerald-400">▶</span> The Regime Overlay
          <span className="text-xs font-normal text-zinc-500 ml-1">— Return Series coloured by HMM State</span>
        </h3>
        
        {displayPoint && (
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 shadow-md">
             <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">
                Waktu: <span className="text-zinc-100 font-bold ml-1">{fmtDate(displayPoint.timestamp)}</span>
             </span>
             <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest">
                Return: <span className={displayPoint.return_pct >= 0 ? 'text-emerald-400 font-bold ml-1' : 'text-red-400 font-bold ml-1'}>{fmtPct(displayPoint.return_pct)}</span>
             </span>
             <span className="text-zinc-400 text-xs font-mono uppercase tracking-widest flex items-center gap-1">
                Regime: <span style={{color: overlayCfg?.trafficColor}} className="font-bold ml-1">{overlayCfg?.icon} {overlayCfg?.label}</span>
             </span>
          </div>
        )}
      </div>

      {/* Return coloured by regime */}
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barCategoryGap={1}
            onMouseMove={(state: any) => {
              if (state?.activePayload?.length) setHoveredPoint(state.activePayload[0].payload);
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.2} vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={fmtDate} stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} width={42} tickFormatter={(v) => `${v.toFixed(1)}%`} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
            <Bar dataKey="return_pct" name="Return" radius={[1,1,0,0]}>
              {data.map((pt, i) => (
                <Cell key={i} fill={STATE_COLORS[pt.state_id] ?? "#71717a"} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Probability stacked area */}
      <div className="h-[160px]">
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">State Probability Evolution</p>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} stackOffset="expand"
            onMouseMove={(state: any) => {
              if (state?.activePayload?.length) setHoveredPoint(state.activePayload[0].payload);
            }}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <defs>
              <linearGradient id="gBear" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.7}/>
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.2}/>
              </linearGradient>
              <linearGradient id="gNeut" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.7}/>
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.2}/>
              </linearGradient>
              <linearGradient id="gBull" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.7}/>
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.2}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.2} vertical={false} />
            <XAxis dataKey="timestamp" tickFormatter={fmtDate} stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} width={30} tickFormatter={(v) => `${(v*100).toFixed(0)}%`} domain={[0,1]} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="prob_bear" stackId="1" stroke="#ef4444" fill="url(#gBear)" name="Bearish" strokeWidth={0} />
            <Area type="monotone" dataKey="prob_neut" stackId="1" stroke="#f59e0b" fill="url(#gNeut)" name="Neutral" strokeWidth={0} />
            <Area type="monotone" dataKey="prob_bull" stackId="1" stroke="#22c55e" fill="url(#gBull)" name="Bullish" strokeWidth={0} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap gap-4 justify-center text-[10px] font-mono">
        {[["#ef4444","Bearish / High-Vol"],["#f59e0b","Sideways / Neutral"],["#22c55e","Bullish / Low-Vol"]].map(([c,l])=>(
          <span key={l} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:c}}/>
            <span className="text-zinc-400">{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 3. STATE TRANSITION HEATMAP ──────────────────────────────────────────────
function TransitionHeatmap({ hmm }: { hmm: HMMResult }) {
  const states = STATE_KEYS;

  // Build flat cell array from transition_matrix
  const cells = useMemo(() => {
    const out: {from: string; to: string; prob: number; fromIdx: number; toIdx: number}[] = [];
    hmm.transition_matrix.forEach((row) => {
      const fromIdx = states.indexOf(row.from);
      Object.entries(row.to).forEach(([toState, prob]) => {
        const toIdx = states.indexOf(toState);
        out.push({ from: row.from, to: toState, prob, fromIdx, toIdx });
      });
    });
    return out;
  }, [hmm.transition_matrix]);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
      <div>
        <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
          <span className="text-violet-400">⬡</span> State Transition Heatmap
          <span className="text-xs font-normal text-zinc-500 ml-1">— P(next state | current state)</span>
        </h3>
        <p className="text-xs font-mono text-zinc-500 mt-1">Setiap sel menunjukkan probabilitas transisi antar regime. Diagonal = regime persistence (tetap di state yang sama).</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <thead>
            <tr>
              <th className="text-zinc-600 text-left pb-3 pr-4 font-normal text-[10px] uppercase tracking-widest">FROM ↓ / TO →</th>
              {states.map((s, i) => (
                <th key={s} className="pb-3 px-2 font-normal text-[10px]" style={{ color: STATE_COLORS[i] }}>
                  {s.split(" /")[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {states.map((fromState, fi) => {
              const row = cells.filter(c => c.fromIdx === fi);
              return (
                <tr key={fromState}>
                  <td className="pr-4 py-1.5 text-[10px]" style={{ color: STATE_COLORS[fi] }}>{fromState.split(" /")[0]}</td>
                  {states.map((toState, ti) => {
                    const cell = row.find(c => c.toIdx === ti);
                    const prob = cell?.prob ?? 0;
                    const isDiag = fi === ti;
                    const alpha = prob;
                    return (
                      <td key={toState} className="py-1.5 px-2">
                        <div
                          className="rounded-lg flex items-center justify-center h-14 w-full relative group cursor-default transition-transform hover:scale-105"
                          style={{
                            backgroundColor: `${STATE_COLORS[ti]}${Math.round(alpha * 200).toString(16).padStart(2,"0")}`,
                            border: isDiag ? `1px solid ${STATE_COLORS[ti]}88` : "1px solid transparent",
                            boxShadow: isDiag ? `0 0 12px ${STATE_COLORS[ti]}33` : "none",
                          }}
                        >
                          <span className="text-sm font-bold" style={{ color: prob > 0.3 ? "#fff" : STATE_COLORS[ti] }}>
                            {(prob * 100).toFixed(1)}%
                          </span>
                          {isDiag && (
                            <span className="absolute top-0.5 right-1 text-[8px] opacity-50">persist</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 4. STATE SUMMARY CARDS ────────────────────────────────────────────────────
function StateSummaryCards({ hmm }: { hmm: HMMResult }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {hmm.state_summary.map((s) => {
        const cfg = REGIME_CONFIG[s.state_id as 0|1|2];
        return (
          <div key={s.state_id} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5 space-y-4`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-lg">{cfg.icon}</span>
                <p className="text-xs font-mono font-bold text-zinc-200 mt-1">{s.name}</p>
              </div>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${cfg.badge} uppercase`}>
                {s.pct_history.toFixed(1)}% of hist
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Mean Return", val: `${fmtPct(s.mean_return)}`, color: s.mean_return >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Mean Vol", val: `${s.mean_vol.toFixed(3)}%`, color: "text-amber-400" },
                { label: "Sharpe", val: s.sharpe_proxy.toFixed(3), color: s.sharpe_proxy >= 0 ? "text-cyan-400" : "text-red-400" },
                { label: "Exp. DD", val: `${s.expected_dd_pct.toFixed(1)}%`, color: "text-rose-400" },
                { label: "Max Ret", val: `${fmtPct(s.max_return)}`, color: "text-emerald-300" },
                { label: "Min Ret", val: `${fmtPct(s.min_return)}`, color: "text-red-300" },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-zinc-950/30 rounded p-2">
                  <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">{label}</p>
                  <p className={`text-sm font-mono font-bold ${color} mt-0.5`}>{val}</p>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-zinc-800/40">
              <p className="text-[9px] font-mono text-zinc-600 mb-1">Mean DCC Correlation</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, s.mean_corr * 100)}%`, backgroundColor: cfg.trafficColor }} />
                </div>
                <span className="text-xs font-mono font-bold" style={{ color: cfg.trafficColor }}>{s.mean_corr.toFixed(3)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────
export default function HMMDashboard({ hmm }: Props) {
  if (!hmm || hmm.error) {
    return (
      <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-5 text-sm font-mono text-amber-400">
        ⚠ HMM model tidak tersedia: {hmm?.error ?? "data tidak ditemukan."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <div className="w-1 h-8 rounded-full bg-gradient-to-b from-red-500 via-amber-400 to-emerald-500" />
        <div>
          <h2 className="text-base font-mono font-bold text-zinc-100">Hidden Markov Model — Market Regime Detection</h2>
          <p className="text-xs font-mono text-zinc-500">3-state Gaussian HMM · Features: Log-Return + Rolling-Vol + DCC-Correlation</p>
        </div>
        <div className="ml-auto text-[10px] font-mono bg-zinc-900 border border-zinc-700 px-3 py-1 rounded-full text-zinc-400">
          {hmm.tickers.join(" · ")}
        </div>
      </div>

      {/* 1. Traffic Light */}
      <TrafficLight hmm={hmm} />

      {/* 2. State Summary Cards */}
      <StateSummaryCards hmm={hmm} />

      {/* 3. Regime Overlay */}
      {hmm.state_series?.length > 0 && <RegimeOverlay series={hmm.state_series} />}

      {/* 4. Transition Heatmap */}
      <TransitionHeatmap hmm={hmm} />

      {/* 5. Interpretation Footer */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
        <h4 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest mb-3">Panduan Interpretasi HMM</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          {([
            { icon: "🔴", title: "Bearish / High-Vol", desc: "Volatilitas tinggi, return negatif dominan. Sistem hedge atau keluar posisi.", color: "text-red-400" },
            { icon: "🟡", title: "Sideways / Neutral", desc: "Pasar konsolidasi. Kurangi ukuran posisi, tunggu breakout dengan konfirmasi.", color: "text-amber-400" },
            { icon: "🟢", title: "Bullish / Low-Vol", desc: "Regime positif. Correlasi rendah, diversifikasi efektif. Momentum masuk.", color: "text-emerald-400" },
          ] as const).map(({ icon, title, desc, color }) => (
            <div key={title} className="flex gap-2 items-start">
              <span className="mt-0.5 shrink-0">{icon}</span>
              <div>
                <p className={`font-bold ${color}`}>{title}</p>
                <p className="text-zinc-500 mt-0.5 leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

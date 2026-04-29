"use client";

import React from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceArea, Cell, AreaChart, Area, ReferenceLine
} from "recharts";
import { CopulaDetails, DCCTimeseries } from "../../lib/dcc";
import JointContourPlot from "./JointContourPlot";
import ContourHeatmap from "./ContourHeatmap";

interface Props {
  copula: CopulaDetails;
  timeseries?: DCCTimeseries[];
}

const COPULA_CONFIG = {
  "Clayton": {
    color: "#ef4444",
    glow: "shadow-red-500/30",
    border: "border-red-500/40",
    bg: "bg-red-950/20",
    badge: "bg-red-500/20 text-red-300 border-red-500/40",
    icon: "💥",
    title: "Clayton Copula",
    desc: "Market kompak saat CRASH. Tail dependence bawah sangat tinggi — diversifikasi gagal di krisis.",
    regime: "CRASH RISK",
  },
  "Gumbel": {
    color: "#f59e0b",
    glow: "shadow-amber-500/30",
    border: "border-amber-500/40",
    bg: "bg-amber-950/20",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    icon: "🚀",
    title: "Gumbel Copula",
    desc: "Market kompak saat RALLY. Aset cenderung naik bersama, namun crash tidak terlalu sinkron.",
    regime: "BULLISH SYNC",
  },
  "Student-t": {
    color: "#a78bfa",
    glow: "shadow-violet-500/30",
    border: "border-violet-500/40",
    bg: "bg-violet-950/20",
    badge: "bg-violet-500/20 text-violet-300 border-violet-500/40",
    icon: "⚠️",
    title: "Student-t Copula",
    desc: "Bahaya di KEDUA SISI. Tail dependence atas dan bawah sama tinggi — risiko sistemik ekstrem.",
    regime: "BI-DIRECTIONAL RISK",
  },
  "Gaussian": {
    color: "#22d3ee",
    glow: "shadow-cyan-500/30",
    border: "border-cyan-500/40",
    bg: "bg-cyan-950/20",
    badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
    icon: "✅",
    title: "Gaussian Copula",
    desc: "Kondisi normal. Tidak ada tail dependence signifikan — diversifikasi berjalan efektif.",
    regime: "NORMAL",
  },
};

export default function CopulaDashboard({ copula, timeseries = [] }: Props) {
  if (!copula) return null;

  const cfg = COPULA_CONFIG[copula.best_fit];
  const { pair, lambda_L, lambda_U, u_space_points, percentiles } = copula;

  const CustomDot = (props: any) => {
    const { cx, cy, payload } = props;
    const isLowerTail = payload.u1 <= 0.1 && payload.u2 <= 0.1;
    const isUpperTail = payload.u1 >= 0.9 && payload.u2 >= 0.9;
    const color = isLowerTail ? "#ef4444" : isUpperTail ? "#f59e0b" : "#6b7280";
    const opacity = isLowerTail || isUpperTail ? 0.9 : 0.2;
    return <circle cx={cx} cy={cy} r={isLowerTail || isUpperTail ? 4 : 2} fill={color} fillOpacity={opacity} />;
  };

  const ScatterTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-lg text-xs font-mono shadow-xl">
          <p className="text-zinc-400">{pair[0]}: <span className="text-white">{d.u1.toFixed(3)}</span></p>
          <p className="text-zinc-400">{pair[1]}: <span className="text-white">{d.u2.toFixed(3)}</span></p>
          {d.u1 <= 0.1 && d.u2 <= 0.1 && <p className="text-red-400 mt-1">⚡ Lower Tail Event</p>}
          {d.u1 >= 0.9 && d.u2 >= 0.9 && <p className="text-amber-400 mt-1">🚀 Upper Tail Event</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">

      {/* Best Fit Copula Banner */}
      <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-5 shadow-lg ${cfg.glow}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{cfg.icon}</span>
              <div>
                <h2 className="text-lg font-mono font-bold text-zinc-100">{cfg.title}</h2>
                <span className={`inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${cfg.badge} uppercase tracking-widest mt-1`}>
                  {cfg.regime}
                </span>
              </div>
            </div>
            <p className="text-sm font-mono text-zinc-400 max-w-xl">{cfg.desc}</p>
          </div>
          <div className="flex gap-3 shrink-0">
            {/* λL tile */}
            <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-center min-w-[90px]">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">λ_L (Lower)</p>
              <p className="text-2xl font-mono font-bold text-red-400 mt-1">{(lambda_L * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">Crash Sync</p>
            </div>
            {/* λU tile */}
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-center min-w-[90px]">
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">λ_U (Upper)</p>
              <p className="text-2xl font-mono font-bold text-amber-400 mt-1">{(lambda_U * 100).toFixed(1)}%</p>
              <p className="text-[10px] text-zinc-600 font-mono mt-0.5">Rally Sync</p>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Correlation Pulse + Action Center */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Pulse Chart */}
        <div className="xl:col-span-2 rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
          <div>
            <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
              <span className="text-indigo-400">⚡</span> Real-time Correlation Pulse (Rho)
            </h3>
            <p className="text-xs font-mono text-zinc-500 mt-1">Dinamika korelasi (DCC-GARCH) tersinkronisasi. Mendekati 1 = Risiko terpusat tinggi.</p>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries.slice(-200)} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} syncId="copula-charts">
                <defs>
                  <linearGradient id="colorRho" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.3} vertical={false} />
                <XAxis dataKey="timestamp" tickFormatter={(val) => {
                  try { return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return val; }
                }} stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} minTickGap={30} />
                <YAxis domain={[0, 1]} stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} width={35} />
                <Tooltip content={({ active, payload, label }: any) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-lg text-xs font-mono shadow-xl z-50 relative">
                        <p className="text-zinc-400 mb-1">{label}</p>
                        <p className="text-zinc-300">Rho (Corr): <span className="text-indigo-300 font-bold">{payload[0].value.toFixed(3)}</span></p>
                      </div>
                    );
                  }
                  return null;
                }} cursor={{ strokeDasharray: "3 3", stroke: "#52525b" }} />
                <ReferenceLine y={0.6} stroke="#ef4444" strokeDasharray="3 3" opacity={0.6} />
                <ReferenceLine y={0.3} stroke="#10b981" strokeDasharray="3 3" opacity={0.6} />
                <Area type="monotone" dataKey="avg_corr" stroke="#ef4444" strokeWidth={2} fill="url(#colorRho)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Action Center */}
        <div className="xl:col-span-1 rounded-xl border border-red-900/50 bg-red-950/20 backdrop-blur-sm p-5 shadow-[0_0_20px_rgba(239,68,68,0.05)] relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl pointer-events-none">🛡️</div>
          <div>
            <h3 className="text-base font-mono font-bold text-red-400 flex items-center gap-2 mb-4">
              <span className="animate-pulse">🔴</span> Action Center
            </h3>
            <div className="space-y-4 relative z-10">
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-1">Status Copula</p>
                <p className="text-sm font-mono text-zinc-300">{cfg.desc}</p>
              </div>
              
              <div className="pt-3 border-t border-red-900/30">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">Automated Stop Loss</p>
                <p className="text-[10px] font-mono text-zinc-600 mb-3">
                  Berdasarkan batas ekor ekstrem (P1 Threshold) dari Copula Space.
                </p>
                {percentiles && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-zinc-950/40 rounded px-3 py-2 border border-red-900/30">
                      <span className="text-xs font-mono text-zinc-300">{pair[0]}</span>
                      <span className="text-sm font-mono font-bold text-red-400">{(percentiles.r1_p1 * 100).toFixed(2)}%</span>
                    </div>
                    <div className="flex items-center justify-between bg-zinc-950/40 rounded px-3 py-2 border border-red-900/30">
                      <span className="text-xs font-mono text-zinc-300">{pair[1]}</span>
                      <span className="text-sm font-mono font-bold text-red-400">{(percentiles.r2_p1 * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <button className="w-full mt-4 bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-700/50 py-2.5 rounded-lg text-xs font-mono font-bold transition-colors relative z-10">
            ACTIVATE PROTECTION
          </button>
        </div>
      </div>

      {/* U-Space Scatter Plot */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
        <div>
          <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
            <span className="text-cyan-400">◈</span> U-Space Scatter Plot
            <span className="text-xs font-normal text-zinc-500 ml-1">
              ({pair[0]} vs {pair[1]})
            </span>
          </h3>
          <p className="text-xs font-mono text-zinc-500 mt-1">
            Distribusi titik di pojok (0,0) mendeteksi clustering risiko krisis. Warna merah = Lower Tail Events, Kuning = Upper Tail Events.
          </p>
        </div>

        <div className="h-[380px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.3} />
              <XAxis
                type="number"
                dataKey="u1"
                domain={[0, 1]}
                name={pair[0]}
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: pair[0], position: "insideBottom", offset: -10, fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
              />
              <YAxis
                type="number"
                dataKey="u2"
                domain={[0, 1]}
                name={pair[1]}
                stroke="#71717a"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={50}
                label={{ value: pair[1], angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
              />
              <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#52525b" }} />

              {/* Danger Zone — Lower Left */}
              <ReferenceArea
                x1={0} x2={0.1} y1={0} y2={0.1}
                fill="#ef4444" fillOpacity={0.12}
                stroke="#ef4444" strokeOpacity={0.4} strokeDasharray="3 3"
              />
              {/* Euphoria Zone — Upper Right */}
              <ReferenceArea
                x1={0.9} x2={1} y1={0.9} y2={1}
                fill="#f59e0b" fillOpacity={0.08}
                stroke="#f59e0b" strokeOpacity={0.4} strokeDasharray="3 3"
              />

              <Scatter data={u_space_points} shape={<CustomDot />} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 justify-center text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 opacity-90" />
            <span className="text-zinc-400">Lower Tail Event (Crash Zone)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500 opacity-90" />
            <span className="text-zinc-400">Upper Tail Event (Rally Zone)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-zinc-500 opacity-40" />
            <span className="text-zinc-500">Normal Regime</span>
          </div>
        </div>
      </div>

      {/* Copula Density Contour Heatmap */}
      <ContourHeatmap copula={copula} />

      {/* Joint Contour Plot — Returns Space */}
      <JointContourPlot copula={copula} />

      {/* Interpretation Guide */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">
        <h4 className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest mb-3">Panduan Interpretasi</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          <div className="flex gap-3 items-start">
            <span className="text-red-400 mt-0.5 shrink-0">●</span>
            <div>
              <span className="text-zinc-300 font-bold">Clayton</span>
              <p className="text-zinc-500 mt-0.5">λ_L tinggi, λ_U rendah. Semua aset jatuh barengan saat krisis.</p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-amber-400 mt-0.5 shrink-0">●</span>
            <div>
              <span className="text-zinc-300 font-bold">Gumbel</span>
              <p className="text-zinc-500 mt-0.5">λ_U tinggi, λ_L rendah. Aset naik bersama saat bull market.</p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-violet-400 mt-0.5 shrink-0">●</span>
            <div>
              <span className="text-zinc-300 font-bold">Student-t</span>
              <p className="text-zinc-500 mt-0.5">λ_L ≈ λ_U tinggi. Risiko sistemik di kedua arah — paling berbahaya.</p>
            </div>
          </div>
          <div className="flex gap-3 items-start">
            <span className="text-cyan-400 mt-0.5 shrink-0">●</span>
            <div>
              <span className="text-zinc-300 font-bold">Gaussian</span>
              <p className="text-zinc-500 mt-0.5">λ_L ≈ λ_U ≈ 0. Tidak ada ekor ekstrem. Diversifikasi efektif.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

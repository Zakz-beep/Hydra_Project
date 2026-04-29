"use client";

import React from "react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ReferenceArea, ReferenceLine, ComposedChart, Bar
} from "recharts";
import { DCCTimeseries } from "../../lib/dcc";

interface Props {
  data: DCCTimeseries[];
}

export default function DCCChart({ data }: Props) {
  if (!data || data.length === 0) return null;

  // Format date for tooltip and axis
  const formatDate = (val: string) => {
    try {
      const d = new Date(val);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
    } catch {
      return val;
    }
  };

  const fmtCurrency = (val: number) => `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (val: number) => `${val.toFixed(2)}%`;
  const fmtWeight = (val: number) => `${(val * 100).toFixed(0)}%`;

  const commonProps = {
    data,
    margin: { top: 20, right: 20, left: 0, bottom: 0 },
    syncId: "dcc-charts"
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 p-4 rounded-xl shadow-2xl shadow-black/80 ring-1 ring-white/5 min-w-[200px]">
          <p className="text-zinc-400 text-xs font-mono mb-3 border-b border-zinc-800 pb-2">{formatDate(label)}</p>
          
          <div className="space-y-1.5">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center justify-between gap-4 text-sm font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  <span className="text-zinc-300">{entry.name}</span>
                </div>
                <span className="text-white font-semibold">
                  {entry.name.includes("Equity") ? fmtCurrency(entry.value) : 
                   entry.name.includes("DD") ? fmtPct(entry.value) : 
                   entry.name.includes("Weight") ? fmtWeight(entry.value) : 
                   entry.value.toFixed(3)}
                </span>
              </div>
            ))}
          </div>

          {/* Asset Correlations Details (Only show if available and it's a correlation context) */}
          {dataPoint.asset_corrs && Object.keys(dataPoint.asset_corrs).length > 0 && payload.some((p: any) => p.name === "Market Weight" || p.name === "Correlation" || p.name === "Avg Correlation") && (
            <div className="mt-3 pt-3 border-t border-zinc-800/80">
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest mb-2">Asset Correlations</p>
              <div className="space-y-1">
                {Object.entries(dataPoint.asset_corrs).map(([ticker, corr]: [string, any]) => (
                  <div key={ticker} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400">{ticker}</span>
                    <span className={`${corr > 0.6 ? 'text-red-400' : corr < 0.35 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {corr.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <svg style={{ height: 0, width: 0, position: "absolute" }}>
        <defs>
          <linearGradient id="colorCorr" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorAdaptive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorPassive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#52525b" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#52525b" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorDd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.6}/>
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
      </svg>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 1. Systemic Risk Index (Correlation) */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]"></span>
              Systemic Risk Index
            </h3>
            <div className="flex gap-4 text-[10px] font-mono bg-zinc-950/50 px-3 py-1.5 rounded-full border border-zinc-800">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500/80 shadow-[0_0_4px_rgba(239,68,68,0.8)]"></span> Danger &gt; 0.6</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500/80 shadow-[0_0_4px_rgba(16,185,129,0.8)]"></span> Safe &lt; 0.35</span>
            </div>
          </div>
          <div className="h-64 w-full text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart {...commonProps}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} opacity={0.5} />
                <XAxis dataKey="timestamp" tickFormatter={formatDate} stroke="#52525b" tick={{ fill: "#71717a" }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 1]} stroke="#52525b" tick={{ fill: "#71717a" }} width={40} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceArea y1={0.6} y2={1.0} fill="#ef4444" fillOpacity={0.05} />
                <ReferenceArea y1={-1.0} y2={0.35} fill="#10b981" fillOpacity={0.05} />
                <ReferenceLine y={0.6} stroke="#ef4444" strokeDasharray="3 3" opacity={0.5} />
                <ReferenceLine y={0.35} stroke="#10b981" strokeDasharray="3 3" opacity={0.5} />
                <Area type="monotone" dataKey="avg_corr" stroke="#f59e0b" strokeWidth={2} fill="url(#colorCorr)" name="Avg Correlation" filter="url(#glow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 2. Vergence Tracker */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
              Vergence Tracker
            </h3>
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-950/50 px-3 py-1.5 rounded-full border border-zinc-800">
              Risk vs Exposure
            </span>
          </div>
          <div className="h-64 w-full text-xs font-mono">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart {...commonProps}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} opacity={0.5} />
                <XAxis dataKey="timestamp" tickFormatter={formatDate} stroke="#52525b" tick={{ fill: "#71717a" }} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" domain={[0, 1.2]} stroke="#52525b" tick={{ fill: "#71717a" }} width={45} tickFormatter={fmtWeight} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 1]} stroke="#52525b" tick={{ fill: "#71717a" }} width={40} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" />
                <Bar yAxisId="left" dataKey="weight" fill="url(#colorWeight)" name="Market Weight" radius={[2, 2, 0, 0]} maxBarSize={40} />
                <Line yAxisId="right" type="monotone" dataKey="avg_corr" stroke="#f59e0b" strokeWidth={2} dot={false} name="Correlation" filter="url(#glow)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. Portfolio Growth */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        <h3 className="mb-6 text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></span>
          Portfolio Growth (Equity Curve)
        </h3>
        <div className="h-80 w-full text-xs font-mono">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} opacity={0.5} />
              <XAxis dataKey="timestamp" tickFormatter={formatDate} stroke="#52525b" tick={{ fill: "#71717a" }} minTickGap={40} axisLine={false} tickLine={false} />
              <YAxis stroke="#52525b" tick={{ fill: "#71717a" }} width={65} tickFormatter={(v) => `$${v.toLocaleString()}`} domain={['auto', 'auto']} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} iconType="circle" />
              <Area type="monotone" dataKey="passive_equity" stroke="#71717a" strokeWidth={2} fill="url(#colorPassive)" name="Passive (Hold)" />
              <Area type="monotone" dataKey="adaptive_equity" stroke="#818cf8" strokeWidth={3} fill="url(#colorAdaptive)" name="DCC Adaptive" filter="url(#glow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4. Underwater Chart (Drawdown) */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/50 backdrop-blur-xl p-5 shadow-xl relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        <h3 className="mb-6 text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
          Underwater Chart (Drawdown)
        </h3>
        <div className="h-64 w-full text-xs font-mono">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart {...commonProps}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} opacity={0.5} />
              <XAxis dataKey="timestamp" tickFormatter={formatDate} stroke="#52525b" tick={{ fill: "#71717a" }} minTickGap={40} axisLine={false} tickLine={false} />
              <YAxis stroke="#52525b" tick={{ fill: "#71717a" }} width={45} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} iconType="circle" />
              <Area type="monotone" dataKey="passive_dd" stroke="#71717a" strokeWidth={1.5} fill="url(#colorPassive)" name="Passive DD" />
              <Area type="monotone" dataKey="adaptive_dd" stroke="#ef4444" strokeWidth={2} fill="url(#colorDd)" name="Adaptive DD" filter="url(#glow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

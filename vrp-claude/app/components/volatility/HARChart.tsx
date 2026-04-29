"use client";

import React from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { HARRVResult } from "../../lib/volatility";

interface Props {
  har: HARRVResult;
  ticker: string;
}

const fmtPct = (v: number) => `${(v * 100).toFixed(4)}%`;
const fmtDate = (s: string) => s.slice(5, 10); // MM-DD

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900/95 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {(p.value * 100).toFixed(4)}%
        </p>
      ))}
    </div>
  );
};

export default function HARChart({ har, ticker }: Props) {
  // Build chart data
  const chartData = har.dates.map((d, i) => ({
    date: fmtDate(d),
    fullDate: d,
    actual: har.fitted_rv[i],
    predicted: har.har_predict[i],
    daily: har.rv_daily[i],
    weekly: har.rv_weekly[i],
    monthly: har.rv_monthly[i],
  }));

  // Residuals
  const residualData = har.dates.map((d, i) => ({
    date: fmtDate(d),
    residual: (har.fitted_rv[i] ?? 0) - (har.har_predict[i] ?? 0),
  }));

  const r2Color = har.rsquared >= 0.5 ? "text-emerald-400" : har.rsquared >= 0.3 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-4">
      {/* ── Stats row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Next RV Forecast", value: fmtPct(har.next_forecast), color: "text-cyan-300", sub: "HAR-OLS" },
          { label: "R² Fit", value: har.rsquared.toFixed(4), color: r2Color, sub: "explained variance" },
          { label: "α (Intercept)", value: har.params.const.toFixed(6), color: "text-zinc-300", sub: "base level" },
          { label: "β Daily", value: har.params.RV_Daily.toFixed(4), color: "text-indigo-400", sub: "scalper memory" },
        ].map(({ label, value, color, sub }) => (
          <div key={label} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3">
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</p>
            <p className={`text-lg font-mono font-bold mt-1 ${color}`}>{value}</p>
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── HAR weights ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          HAR-RV Weights — Heterogeneous Memory Decomposition
        </p>
        <div className="flex flex-wrap gap-6">
          {[
            { key: "RV_Daily",   label: "Daily (Scalpers)",      color: "bg-zinc-400",    w: har.params.RV_Daily },
            { key: "RV_Weekly",  label: "Weekly (Swing Traders)", color: "bg-orange-400",  w: har.params.RV_Weekly },
            { key: "RV_Monthly", label: "Monthly (Institutions)", color: "bg-purple-400",  w: har.params.RV_Monthly },
          ].map(({ key, label, color, w }) => {
            const abs = Math.abs(w);
            const total = Math.abs(har.params.RV_Daily) + Math.abs(har.params.RV_Weekly) + Math.abs(har.params.RV_Monthly);
            const pct = total > 0 ? (abs / total * 100).toFixed(1) : "0.0";
            return (
              <div key={key} className="flex-1 min-w-[150px]">
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-zinc-400">{label}</span>
                  <span className={w >= 0 ? "text-emerald-400" : "text-red-400"}>{w.toFixed(4)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800">
                  <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[9px] font-mono text-zinc-600 mt-0.5">{pct}% of total weight</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main chart: Actual vs Predicted ───────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-4">
          Actual RV vs HAR-RV Forecast · {ticker}
        </p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(chartData.length / 8)} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(2)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={52} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="line" wrapperStyle={{ fontSize: 10, fontFamily: "monospace", paddingTop: 8 }} />
            <Line dataKey="actual"    name="Actual RV"  stroke="#ff3366" strokeWidth={1.5} dot={false} />
            <Line dataKey="predicted" name="HAR Predict" stroke="#00ffcc" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            <ReferenceLine y={har.next_forecast} stroke="#ffff00" strokeDasharray="3 3" strokeWidth={1} label={{ value: `Forecast: ${fmtPct(har.next_forecast)}`, fill: "#a3a3a3", fontSize: 9, fontFamily: "monospace" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Memory Components chart ────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-4">
          Market Memory Components — Heterogeneous Layers
        </p>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(chartData.length / 8)} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(2)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={52} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconType="line" wrapperStyle={{ fontSize: 10, fontFamily: "monospace", paddingTop: 8 }} />
            <Line dataKey="daily"   name="Daily (Scalpers)"       stroke="#71717a" strokeWidth={1} dot={false} opacity={0.6} />
            <Line dataKey="weekly"  name="Weekly (Swing)"         stroke="#f97316" strokeWidth={2} dot={false} />
            <Line dataKey="monthly" name="Monthly (Institutions)" stroke="#a855f7" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Residual bar chart ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-4 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-4">
          Model Residuals (Actual − Predicted)
        </p>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={residualData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
            <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(residualData.length / 8)} />
            <YAxis tickFormatter={v => `${(v * 100).toFixed(2)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={52} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
            <Bar dataKey="residual" name="Residual" fill="#6366f1" opacity={0.7} radius={[1, 1, 0, 0]}
              label={false}
              // Dynamic coloring via cell
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

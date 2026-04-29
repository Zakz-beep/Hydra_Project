"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Cell,
  BarChart, Bar, LabelList
} from "recharts";
import { CopulaDetails } from "../../lib/dcc";

interface Props {
  copula: CopulaDetails;
}

const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPctShort = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function JointContourPlot({ copula }: Props) {
  const { pair, lower_tail_returns, percentiles, tail_dep_series_recent, returns_range } = copula;

  if (!lower_tail_returns || !percentiles) return null;

  const { r1_p1, r1_p5, r2_p1, r2_p5 } = percentiles;
  const { r1_min, r1_max, r2_min, r2_max } = returns_range;

  // Domain: a bit wider than the lowest tail event
  const scatter_x_min = Math.min(r1_min, r1_p1 * 1.15);
  const scatter_x_max = Math.min(0, r1_p5 * 0.5); // focus on left side
  const scatter_y_min = Math.min(r2_min, r2_p1 * 1.15);
  const scatter_y_max = Math.min(0, r2_p5 * 0.5);

  // Color by extremeness — deeper red = further from 0
  const pointColor = (r1: number, r2: number): string => {
    const intensity = Math.min(1, (Math.abs(r1) + Math.abs(r2)) / (Math.abs(r1_p1) + Math.abs(r2_p1)));
    const r = Math.round(180 + intensity * 75);
    const g = Math.round(30 - intensity * 15);
    const b = Math.round(30 - intensity * 15);
    return `rgb(${r},${g},${b})`;
  };

  // Annotation label positions
  const annotR1P1 = { value: `p1: ${fmtPctShort(r1_p1)}`, position: "insideTopRight" as const };
  const annotR1P5 = { value: `p5: ${fmtPctShort(r1_p5)}`, position: "insideTopRight" as const };
  const annotR2P1 = { value: `p1: ${fmtPctShort(r2_p1)}`, position: "insideTopRight" as const };
  const annotR2P5 = { value: `p5: ${fmtPctShort(r2_p5)}`, position: "insideTopRight" as const };

  const ScatterTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const belowP1 = d.r1 <= r1_p1 && d.r2 <= r2_p1;
    const belowP5 = d.r1 <= r1_p5 && d.r2 <= r2_p5;
    return (
      <div className="bg-zinc-900/95 border border-red-900/50 p-3 rounded-lg text-xs font-mono shadow-xl">
        <p className="text-red-400 font-bold mb-1 border-b border-zinc-800 pb-1">💥 Lower Tail Event</p>
        <p className="text-zinc-300">{pair[0]}: <span className="text-red-300 font-bold">{fmtPct(d.r1)}</span></p>
        <p className="text-zinc-300">{pair[1]}: <span className="text-red-300 font-bold">{fmtPct(d.r2)}</span></p>
        {belowP1 && <p className="text-red-500 mt-1 font-bold">⚠ Below 1% threshold (Extreme)</p>}
        {!belowP1 && belowP5 && <p className="text-amber-400 mt-1">Below 5% threshold</p>}
      </div>
    );
  };

  const BarTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0].value;
    return (
      <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-lg text-xs font-mono shadow-xl">
        <p className="text-zinc-400 mb-1">{label}</p>
        <p className="text-zinc-300">Tail Risk: <span className={`font-bold ${v > 0.5 ? "text-red-400" : v > 0.25 ? "text-amber-400" : "text-zinc-400"}`}>{(v * 100).toFixed(0)}%</span></p>
        {v > 0.5 && <p className="text-red-400 mt-1">⚠ Systemic Threshold Breached</p>}
      </div>
    );
  };

  const recentCount = tail_dep_series_recent?.length ?? 0;
  // Thin down x-axis labels for readability
  const xTickEvery = Math.max(1, Math.floor(recentCount / 10));

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
          <span className="text-rose-400">◉</span> Lower Tail Cluster Analysis
          <span className="text-xs font-normal text-zinc-500 ml-1">— Extreme joint loss events mapped to Return Space</span>
        </h3>
        <p className="text-xs font-mono text-zinc-500 mt-1">
          Hanya observasi dengan KEDUA aset berada di bawah 10% u-space (ambang batas ekstrem). Sumbu menggunakan % return aktual, bukan uniform.
        </p>
      </div>

      {/* Percentile Info Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: `${pair[0]} — p1%`, val: r1_p1, color: "text-red-400", border: "border-red-900/50", bg: "bg-red-950/20" },
          { label: `${pair[0]} — p5%`, val: r1_p5, color: "text-amber-400", border: "border-amber-900/50", bg: "bg-amber-950/20" },
          { label: `${pair[1]} — p1%`, val: r2_p1, color: "text-red-400", border: "border-red-900/50", bg: "bg-red-950/20" },
          { label: `${pair[1]} — p5%`, val: r2_p5, color: "text-amber-400", border: "border-amber-900/50", bg: "bg-amber-950/20" },
        ].map((item) => (
          <div key={item.label} className={`rounded-lg border ${item.border} ${item.bg} px-3 py-2.5`}>
            <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest truncate">{item.label}</p>
            <p className={`text-lg font-mono font-bold ${item.color} mt-0.5`}>{fmtPctShort(item.val)}</p>
            <p className="text-[10px] text-zinc-600 font-mono">Extreme threshold</p>
          </div>
        ))}
      </div>

      {/* Side-by-side charts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* LEFT: Lower Tail Scatter — Return Space */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
              ① Lower Tail Scatter — Return Space
            </p>
            <span className="text-[10px] font-mono bg-red-950/40 text-red-400 border border-red-900/50 px-2 py-0.5 rounded">
              {lower_tail_returns.length} joint crash events
            </span>
          </div>

          {lower_tail_returns.length === 0 ? (
            <div className="h-[320px] flex items-center justify-center rounded-lg border border-zinc-800/60 bg-zinc-950/30">
              <p className="text-xs font-mono text-zinc-600">No joint lower tail events detected in this period.</p>
            </div>
          ) : (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 15, right: 25, left: 0, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.3} />
                  <XAxis
                    type="number" dataKey="r1"
                    domain={[scatter_x_min, 0]}
                    stroke="#71717a" fontSize={10}
                    tickFormatter={fmtPct} tickLine={false} axisLine={false}
                    label={{ value: pair[0], position: "insideBottom", offset: -14, fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                  />
                  <YAxis
                    type="number" dataKey="r2"
                    domain={[scatter_y_min, 0]}
                    stroke="#71717a" fontSize={10}
                    tickFormatter={fmtPct} tickLine={false} axisLine={false} width={62}
                    label={{ value: pair[1], angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                  />
                  <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#52525b" }} />

                  {/* p1% zone — darkest danger */}
                  <ReferenceArea
                    x1={scatter_x_min} x2={r1_p1} y1={scatter_y_min} y2={r2_p1}
                    fill="#ef4444" fillOpacity={0.15}
                    stroke="#ef4444" strokeOpacity={0.5} strokeDasharray="2 3"
                  />
                  {/* p5% zone — caution */}
                  <ReferenceArea
                    x1={r1_p1} x2={r1_p5} y1={r2_p1} y2={r2_p5}
                    fill="#f59e0b" fillOpacity={0.07}
                    stroke="#f59e0b" strokeOpacity={0.35} strokeDasharray="2 3"
                  />

                  {/* p1 annotation lines */}
                  <ReferenceLine
                    x={r1_p1} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"
                    label={{ value: `p1 ${fmtPctShort(r1_p1)}`, fill: "#ef4444", fontSize: 9, fontFamily: "monospace", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={r2_p1} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"
                    label={{ value: `p1 ${fmtPctShort(r2_p1)}`, fill: "#ef4444", fontSize: 9, fontFamily: "monospace", position: "insideTopRight" }}
                  />
                  {/* p5 annotation lines */}
                  <ReferenceLine
                    x={r1_p5} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3"
                    label={{ value: `p5 ${fmtPctShort(r1_p5)}`, fill: "#f59e0b", fontSize: 9, fontFamily: "monospace", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={r2_p5} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3"
                    label={{ value: `p5 ${fmtPctShort(r2_p5)}`, fill: "#f59e0b", fontSize: 9, fontFamily: "monospace", position: "insideTopRight" }}
                  />

                  <Scatter data={lower_tail_returns}>
                    {lower_tail_returns.map((pt, i) => (
                      <Cell key={i} fill={pointColor(pt.r1, pt.r2)} fillOpacity={0.85} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-[10px] font-mono mt-2 px-1">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-80" /> Below p1% (Extreme)</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 opacity-50" /> p1–p5 Zone (Severe)</span>
          </div>
        </div>

        {/* RIGHT: Tail Dependence Bar Chart over time */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-widest">
              ② Tail Dependence Over Time (λ_L Rolling)
            </p>
            <span className="text-[10px] font-mono text-zinc-600">{recentCount} observasi</span>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tail_dep_series_recent} margin={{ top: 15, right: 10, left: 0, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} opacity={0.3} />
                <XAxis
                  dataKey="timestamp"
                  stroke="#71717a" fontSize={9}
                  tickLine={false} axisLine={false}
                  tickFormatter={(v, i) => (i % xTickEvery === 0 ? v : "")}
                  angle={-30} textAnchor="end" height={40}
                />
                <YAxis
                  stroke="#71717a" fontSize={10}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  domain={[0, 1]}
                  tickLine={false} axisLine={false} width={40}
                />
                <Tooltip content={<BarTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />

                {/* Systemic threshold */}
                <ReferenceLine
                  y={0.5} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"
                  label={{ value: "50% Threshold", fill: "#ef4444", fontSize: 9, fontFamily: "monospace", position: "insideTopRight" }}
                />
                <ReferenceLine
                  y={0.25} stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3"
                  label={{ value: "25%", fill: "#f59e0b", fontSize: 9, fontFamily: "monospace", position: "insideTopRight" }}
                />

                <Bar dataKey="tail_dep" name="Tail Risk" radius={[1, 1, 0, 0]} maxBarSize={14}>
                  {tail_dep_series_recent?.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.tail_dep > 0.5 ? "#ef4444" : entry.tail_dep > 0.25 ? "#f59e0b" : "#3f3f46"}
                      fillOpacity={entry.tail_dep > 0.5 ? 0.9 : entry.tail_dep > 0.25 ? 0.7 : 0.5}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-4 text-[10px] font-mono mt-2 px-1">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-red-500 opacity-90" /> &gt;50% Systemic Risk</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-amber-400 opacity-70" /> 25–50% Elevated</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-zinc-600 opacity-50" /> &lt;25% Normal</span>
          </div>
        </div>
      </div>
    </div>
  );
}

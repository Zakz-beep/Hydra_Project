"use client";

import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine
} from "recharts";
import { DCCTimeseries } from "../../lib/dcc";

interface Props {
  data: DCCTimeseries[];
}

export default function CopulaChart({ data }: Props) {
  if (!data || data.length === 0) return null;

  const formatDate = (val: string) => {
    try {
      const d = new Date(val);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
    } catch {
      return val;
    }
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 p-4 rounded-xl shadow-2xl shadow-black/80 ring-1 ring-white/5 min-w-[200px]">
          <p className="text-zinc-400 text-xs font-mono mb-3 border-b border-zinc-800 pb-2">{formatDate(label)}</p>
          <div className="flex items-center justify-between gap-4 text-sm font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: payload[0].color }} />
              <span className="text-zinc-300">Tail Risk (Copula)</span>
            </div>
            <span className="text-white font-semibold">
              {(payload[0].value * 100).toFixed(1)}%
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 font-mono">
            {payload[0].value > 0.5 
              ? "⚠ HIGH SYSTEMIC THREAT: >50% assets are in extreme lower tail."
              : "Normal market conditions."}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-mono font-semibold text-zinc-100 flex items-center gap-2">
            <span className="text-rose-500">⚡</span> Copula Tail Risk Scanner
          </h2>
          <p className="text-xs font-mono text-zinc-500 mt-1">
            Detects probability of simultaneous multi-asset crashes (Black Swan events).
          </p>
        </div>
      </div>

      <div className="h-[250px] w-full mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 20, left: 0, bottom: 0 }} syncId="dcc-charts">
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} opacity={0.3} />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={formatDate}
              stroke="#71717a" 
              fontSize={11}
              tickMargin={10}
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              stroke="#71717a" 
              fontSize={11}
              tickFormatter={(val) => `${(val * 100).toFixed(0)}%`}
              domain={[0, 1]}
              tickLine={false}
              axisLine={false}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
            
            <ReferenceLine y={0.5} stroke="#ef4444" strokeDasharray="3 3" opacity={0.6} />
            
            <Bar dataKey="tail_dep" name="Tail Risk" radius={[2, 2, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.tail_dep > 0.5 ? '#ef4444' : '#3f3f46'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

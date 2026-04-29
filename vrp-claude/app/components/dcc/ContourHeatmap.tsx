"use client";

import React from "react";
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine
} from "recharts";
import { CopulaDetails } from "../../lib/dcc";

interface Props {
  copula: CopulaDetails;
}

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function ContourHeatmap({ copula }: Props) {
  const { pair, density_grid, returns_range } = copula;
  
  if (!density_grid || density_grid.length === 0) return null;

  const maxCount = Math.max(...density_grid.map(d => d.count));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-zinc-900/95 border border-zinc-700/50 p-3 rounded-lg text-xs font-mono shadow-xl">
          <p className="text-zinc-400 mb-2 font-bold border-b border-zinc-800 pb-1">Density Cluster</p>
          <p className="text-zinc-300">{pair[0]}: <span className="text-cyan-300">{fmtPct(d.x)}</span></p>
          <p className="text-zinc-300">{pair[1]}: <span className="text-cyan-300">{fmtPct(d.y)}</span></p>
          <p className="text-zinc-300 mt-2">Observations: <span className="text-white font-bold">{d.count}</span></p>
        </div>
      );
    }
    return null;
  };

  const getColor = (count: number) => {
    const intensity = count / maxCount;
    if (intensity < 0.15) return "#1e3a8a"; // blue-900
    if (intensity < 0.3) return "#3b82f6";  // blue-500
    if (intensity < 0.5) return "#06b6d4";  // cyan-500
    if (intensity < 0.7) return "#eab308";  // yellow-500
    if (intensity < 0.9) return "#f97316";  // orange-500
    return "#ef4444"; // red-500
  };

  // Create a custom shape for the scatter dot to create a contour-like bubble
  const BubbleDot = (props: any) => {
    const { cx, cy, payload } = props;
    const intensity = payload.count / maxCount;
    // Radius ranges from 4 to 18 depending on count
    const r = 4 + (intensity * 14);
    
    return (
      <circle 
        cx={cx} 
        cy={cy} 
        r={r} 
        fill={getColor(payload.count)} 
        fillOpacity={0.8}
        stroke="rgba(255,255,255,0.1)"
        strokeWidth={1}
        className="transition-all duration-300"
      />
    );
  };

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 space-y-4">
      <div>
        <h3 className="text-base font-mono font-semibold text-zinc-100 flex items-center gap-2">
          <span className="text-fuchsia-400">🌌</span> Copula Density Contour Plot
          <span className="text-xs font-normal text-zinc-500 ml-1">— Bubble Heatmap in Return Space</span>
        </h3>
        <p className="text-xs font-mono text-zinc-500 mt-1">
          Visualisasi konsentrasi probabilitas gabungan. Area merah/kuning menunjukkan pusat massa distribusi (normal regimes), 
          sementara titik-titik kecil di ekstrem kiri-bawah memetakan risiko krisis (tail risk).
        </p>
      </div>

      <div className="h-[450px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.2} />
            <XAxis 
              type="number" 
              dataKey="x" 
              domain={[returns_range.r1_min * 1.1, returns_range.r1_max * 1.1]} 
              name={pair[0]}
              tickFormatter={fmtPct}
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: pair[0], position: "insideBottom", offset: -10, fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
            />
            <YAxis 
              type="number" 
              dataKey="y" 
              domain={[returns_range.r2_min * 1.1, returns_range.r2_max * 1.1]} 
              name={pair[1]}
              tickFormatter={fmtPct}
              stroke="#71717a"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={60}
              label={{ value: pair[1], angle: -90, position: "insideLeft", fill: "#71717a", fontSize: 11, fontFamily: "monospace" }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: "3 3", stroke: "#52525b" }} />
            
            {/* 0-lines to center the return space visually */}
            <ReferenceLine x={0} stroke="#52525b" strokeWidth={1} />
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />

            <Scatter data={density_grid} shape={<BubbleDot />} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-col items-center justify-center mt-2">
        <div className="flex items-center justify-between w-full max-w-sm text-[10px] font-mono text-zinc-400 mb-1">
          <span>Tail Events (Low Freq)</span>
          <span>Core (High Freq)</span>
        </div>
        <div className="w-full max-w-sm h-2 rounded-full bg-gradient-to-r from-[#1e3a8a] via-[#06b6d4] to-[#ef4444]" />
      </div>
    </div>
  );
}

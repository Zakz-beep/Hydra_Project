// app/components/greeks/GreeksChart.tsx
"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { GreeksSnapshot } from "../../lib/greeks";

interface GreeksChartProps {
  history: GreeksSnapshot[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-4 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-zinc-200">{p.value?.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
};

export default function GreeksChart({ history }: GreeksChartProps) {
  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-zinc-600 font-mono text-xs">
        Belum ada history data
      </div>
    );
  }

  // The history from API may be newest first or oldest first. 
  // LineChart typically expects chronological order (oldest first). 
  // Check if reversed or sort it.
  const chartData = [...history].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Map to format time strings if needed
  const formattedData = chartData.map(d => ({
     ...d,
     timeLabel: d.time || d.timestamp.substring(11, 19)
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Chart 1: Net & Absolute GEX */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Net & Absolute GEX</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={formattedData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="timeLabel" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={{ stroke: "#3f3f46" }} />
            <YAxis yAxisId="left" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }} />
            <ReferenceLine yAxisId="left" y={0} stroke="#3f3f46" strokeDasharray="4 4" />
            <Line yAxisId="left" type="monotone" dataKey="total_net_gex" name="Net GEX" stroke="#34d399" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#34d399" }} />
            <Line yAxisId="right" type="monotone" dataKey="total_gross_gex" name="Absolute GEX" stroke="#fcd34d" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#fcd34d" }} strokeDasharray="5 5" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Net Vanna & Charm */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Net Vanna & Charm</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={formattedData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="timeLabel" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={{ stroke: "#3f3f46" }} />
            <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }} />
            <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="total_net_vanna" name="Vanna" stroke="#818cf8" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#818cf8" }} />
            <Line type="monotone" dataKey="total_net_charm" name="Charm" stroke="#fb923c" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#fb923c" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: Net VEX */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-2">Net VEX (Vega Exposure)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={formattedData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="timeLabel" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={{ stroke: "#3f3f46" }} />
            <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="total_net_vex" name="Net VEX" stroke="#f472b6" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: "#f472b6" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

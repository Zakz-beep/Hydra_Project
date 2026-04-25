// app/components/VRPChart.tsx
"use client";

import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { VRPSnapshot } from "../lib/vrp";

interface VRPChartProps {
  history: VRPSnapshot[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-3 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-zinc-200">{p.value?.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
};

export default function VRPChart({ history }: VRPChartProps) {
  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-zinc-600 font-mono text-xs">
        Belum ada history data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={history} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={{ stroke: "#3f3f46" }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v.toFixed(1)}%`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }}
        />
        <ReferenceLine y={0} stroke="#3f3f46" strokeDasharray="4 4" />

        <Line
          type="monotone"
          dataKey="iv"
          name="IV"
          stroke="#818cf8"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "#818cf8" }}
        />
        <Line
          type="monotone"
          dataKey="rv"
          name="RV"
          stroke="#fb923c"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "#fb923c" }}
        />
        <Line
          type="monotone"
          dataKey="vrp"
          name="VRP"
          stroke="#34d399"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, fill: "#34d399" }}
          strokeDasharray="5 2"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

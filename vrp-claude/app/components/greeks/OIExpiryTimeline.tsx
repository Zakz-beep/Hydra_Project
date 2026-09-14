"use client";

import React, { useMemo } from "react";
import { GreeksSnapshot, StrikeGreeks } from "../../lib/greeks";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface OIExpiryTimelineProps {
  data: GreeksSnapshot;
}

export default function OIExpiryTimeline({ data }: OIExpiryTimelineProps) {
  // Extract all strikes and group them by DTE
  const timelineData = useMemo(() => {
    if (!data.by_expiry) return [];

    const grouped: Record<number, { dte: number; call_oi: number; put_oi: number }> = {};

    for (const bucketKey in data.by_expiry) {
      const bucket = data.by_expiry[bucketKey];
      if (!bucket.strikes) continue;

      for (const strike of bucket.strikes) {
        if (!grouped[strike.dte]) {
          grouped[strike.dte] = {
            dte: strike.dte,
            call_oi: 0,
            put_oi: 0,
          };
        }
        if (strike.option_type === "call") {
          grouped[strike.dte].call_oi += strike.oi;
        } else {
          grouped[strike.dte].put_oi += strike.oi;
        }
      }
    }

    const arr = Object.values(grouped).sort((a, b) => a.dte - b.dte);
    return arr;
  }, [data]);

  const formatOI = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toString();
  };

  if (!data.by_expiry || timelineData.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 text-center text-zinc-500 font-mono text-xs">
        No strike data available in current snapshot.
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-sm font-mono text-zinc-300 font-bold">OI Expiry Timeline</h2>
          <p className="text-[10px] text-zinc-500 font-mono">When is the Open Interest expiring?</p>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timelineData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="dte"
              stroke="#52525b"
              tick={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={(val) => `DTE ${val}`}
            />
            <YAxis
              stroke="#52525b"
              tick={{ fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={formatOI}
              width={40}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#18181b",
                border: "1px solid #27272a",
                borderRadius: "4px",
                fontFamily: "monospace",
                fontSize: "12px",
              }}
              itemStyle={{ color: "#e4e4e7" }}
              formatter={(value: number, name: string) => [
                value.toLocaleString(),
                name === "call_oi" ? "Call OI" : "Put OI",
              ]}
              labelFormatter={(label) => `DTE ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
            <Bar dataKey="put_oi" name="Put OI" stackId="a" fill="#ef4444" />
            <Bar dataKey="call_oi" name="Call OI" stackId="a" fill="#22c55e" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

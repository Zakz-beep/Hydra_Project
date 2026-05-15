"use client";

import {
  ComposedChart, Scatter, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { SVIResponse, SVIParams } from "../../lib/dispersion";

interface SVIChartProps {
  data: SVIResponse;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">Strike: ${d?.strike?.toFixed(2) ?? "--"}</p>
      {d?.svi_iv !== undefined && (
        <div className="text-indigo-300">SVI IV: {d.svi_iv.toFixed(2)}%</div>
      )}
      {d?.market_iv !== undefined && (
        <div className="text-amber-400">
          Market IV: {d.market_iv.toFixed(2)}%
          <span className="ml-2 text-zinc-500">({d.type}, OI: {d.oi?.toLocaleString()})</span>
        </div>
      )}
    </div>
  );
};

function ParamBadge({ label, value, desc }: { label: string; value: string; desc?: string }) {
  return (
    <div className="flex flex-col items-center bg-zinc-800/50 rounded-lg px-3 py-2 border border-zinc-700/30">
      <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-mono font-bold text-indigo-300">{value}</span>
      {desc && <span className="text-[9px] font-mono text-zinc-600 text-center">{desc}</span>}
    </div>
  );
}

export default function SVIChart({ data }: SVIChartProps) {
  const p = data.params;

  // Gabungkan curve + market points untuk chart
  // Curve sebagai line, market sebagai scatter
  const qualityColor = ({
    EXCELLENT: "text-emerald-400",
    GOOD:      "text-lime-400",
    FAIR:      "text-yellow-400",
    POOR:      "text-red-400",
    INSUFFICIENT_DATA: "text-zinc-500",
  } as Record<string, string>)[data.fit_quality] ?? "text-zinc-400";

  const atm = data.spot;

  return (
    <div className="space-y-4">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
            SVI Volatility Smile — {data.ticker} ({data.dte}DTE / {data.expiry})
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            Spot: <span className="text-zinc-300">${data.spot.toFixed(2)}</span>
            <span className="mx-2">·</span>
            {data.n_market_points} market points
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-bold ${qualityColor}`}>
            {data.fit_quality}
          </span>
          <span className="text-[10px] font-mono text-zinc-600">
            RMSE: {(data.rmse * 100).toFixed(3)}%
          </span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            data.is_arbitrage_free
              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
              : "text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
          }`}>
            {data.is_arbitrage_free ? "✓ ARB-FREE" : "⚠ CHECK ARB"}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="strike"
              type="number"
              domain={["auto", "auto"]}
              tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={(v) => `$${v}`}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
              tickFormatter={(v) => `${v?.toFixed ? v.toFixed(0) : v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }}
            />

            {/* Reference line: ATM / Spot */}
            <ReferenceLine
              x={atm}
              stroke="#e4e4e7"
              strokeDasharray="4 4"
              strokeWidth={1}
              label={{ value: "ATM", position: "top", fill: "#e4e4e7", fontSize: 9 }}
            />

            {/* SVI Fitted Curve */}
            <Line
              data={data.curve_points}
              dataKey="svi_iv"
              name="SVI Fitted"
              stroke="#818cf8"
              strokeWidth={2.5}
              dot={false}
              type="monotone"
              connectNulls
            />

            {/* Market IV Scatter — Calls */}
            <Scatter
              data={data.market_points.filter((p: any) => p.type === "call")}
              dataKey="market_iv"
              name="Call IV (Market)"
              fill="#34d399"
              opacity={0.7}
              r={3}
            />

            {/* Market IV Scatter — Puts */}
            <Scatter
              data={data.market_points.filter((p: any) => p.type === "put")}
              dataKey="market_iv"
              name="Put IV (Market)"
              fill="#f87171"
              opacity={0.7}
              r={3}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* SVI Parameter Display */}
      <div>
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-2">
          SVI Parameters (a, b, ρ, m, σ)
        </p>
        <div className="grid grid-cols-5 gap-2">
          <ParamBadge label="a" value={p.a.toFixed(4)} desc="Variance Level" />
          <ParamBadge label="b" value={p.b.toFixed(4)} desc="Wing Slope" />
          <ParamBadge label="ρ (rho)" value={p.rho.toFixed(3)} desc="Skewness" />
          <ParamBadge label="m" value={p.m.toFixed(4)} desc="Center" />
          <ParamBadge label="σ (sigma)" value={p.sigma.toFixed(4)} desc="Smoothness" />
        </div>
        <p className="text-[9px] font-mono text-zinc-600 mt-2">
          w(k) = a + b·[ρ(k−m) + √((k−m)² + σ²)] — Raw SVI Formula (Gatheral 2004)
        </p>
      </div>
    </div>
  );
}

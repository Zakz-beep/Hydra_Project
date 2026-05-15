"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend, Area, AreaChart, ComposedChart,
} from "recharts";
import { CorrelationResponse, fmtCorr, fmtSpread } from "../../lib/dispersion";

interface CorrelationSpreadChartProps {
  data: CorrelationResponse;
  history?: CorrelationResponse[]; // data historis untuk chart time-series (opsional)
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-4 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-zinc-200">{typeof p.value === "number" ? (p.value * 100).toFixed(1) + "%" : p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function CorrelationSpreadChart({ data }: CorrelationSpreadChartProps) {
  const implied  = data.implied_correlation ?? 0;
  const realized = data.realized_correlation ?? 0;
  const spread   = data.spread ?? 0;

  // Untuk chart snapshot (satu titik): buat chart batang konstituen
  const constData = data.constituents.map((c: any) => ({
    ticker: c.ticker,
    atm_iv: c.atm_iv ?? 0,
    weight: c.weight,
    contribution: c.contribution,
  }));

  const spreadColor = spread > 0.15 ? "#34d399" : spread < -0.10 ? "#f87171" : "#71717a";
  const spreadLabel = spread > 0.15 ? "OVERPRICED (Short Disp)" : spread < -0.10 ? "UNDERPRICED (Long Disp)" : "WITHIN RANGE";

  return (
    <div className="space-y-5">
      {/* Correlation Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 text-center">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
            ρ Implied
          </p>
          <p className="text-2xl font-mono font-black text-blue-400">
            {fmtCorr(data.implied_correlation)}
          </p>
          <p className="text-[9px] font-mono text-zinc-600 mt-1">dari harga opsi {data.dte}DTE</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/50 rounded-xl p-4 text-center">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
            ρ Realized
          </p>
          <p className="text-2xl font-mono font-black text-orange-400">
            {fmtCorr(data.realized_correlation)}
          </p>
          <p className="text-[9px] font-mono text-zinc-600 mt-1">{data.window_days}d return historis</p>
        </div>
        <div className={`rounded-xl p-4 text-center border ${
          spread > 0.15 ? "bg-emerald-500/10 border-emerald-500/30"
          : spread < -0.10 ? "bg-red-500/10 border-red-500/30"
          : "bg-zinc-900/60 border-zinc-800/50"
        }`}>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">
            Spread (ρ_impl − ρ_real)
          </p>
          <p className={`text-2xl font-mono font-black`} style={{ color: spreadColor }}>
            {fmtSpread(data.spread)}
          </p>
          <p className="text-[9px] font-mono text-zinc-600 mt-1">{spreadLabel}</p>
        </div>
      </div>

      {/* Correlation Bar Chart (visual gap) */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <h4 className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-3">
          Implied vs Realized Correlation Gap
        </h4>
        <div className="space-y-3">
          {/* Implied Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-blue-400">ρ Implied (Options Market)</span>
              <span className="text-zinc-300">{fmtCorr(data.implied_correlation)}</span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-700"
                style={{ width: `${(implied * 100).toFixed(1)}%` }}
              />
            </div>
          </div>

          {/* Realized Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-orange-400">ρ Realized (Historical Returns)</span>
              <span className="text-zinc-300">{fmtCorr(data.realized_correlation)}</span>
            </div>
            <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full transition-all duration-700"
                style={{ width: `${(realized * 100).toFixed(1)}%` }}
              />
            </div>
          </div>

          {/* Spread indicator */}
          <div className="pt-1 border-t border-zinc-800/60">
            <div className="flex justify-between text-[10px] font-mono">
              <span className="text-zinc-500">Spread = ρ_impl − ρ_real</span>
              <span style={{ color: spreadColor }} className="font-bold">
                {fmtSpread(data.spread)} → {spreadLabel}
              </span>
            </div>
            {/* Threshold guide */}
            <div className="flex gap-4 mt-1">
              <span className="text-[9px] font-mono text-emerald-500/70">▶ &gt;+15% = Short Disp Zone</span>
              <span className="text-[9px] font-mono text-zinc-500">◀ 0 ▶</span>
              <span className="text-[9px] font-mono text-red-500/70">◀ &lt;-10% = Long Disp Zone</span>
            </div>
          </div>
        </div>
      </div>

      {/* Constituent IV Breakdown Chart */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
        <h4 className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider mb-3">
          ATM IV per Konstituen
        </h4>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={constData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="ticker" tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }} />
            <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => `${v?.toFixed ? v.toFixed(0) : v}%`} />
            <Tooltip
              formatter={(v: number, name: string) => [`${v.toFixed(1)}%`, name]}
              contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 10, fontFamily: "monospace" }}
            />
            {/* Index IV reference line */}
            {data.index_atm_iv && (
              <ReferenceLine
                y={data.index_atm_iv}
                stroke="#818cf8"
                strokeDasharray="4 3"
                label={{ value: `${data.index} IV: ${data.index_atm_iv}%`, position: "right", fill: "#818cf8", fontSize: 9 }}
              />
            )}
            <Area
              type="monotone"
              dataKey="atm_iv"
              name="ATM IV"
              stroke="#fb923c"
              fill="#fb923c"
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{ fill: "#fb923c", r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Constituent Detail Table */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800/60">
                <th className="text-left py-1.5 pr-4">Ticker</th>
                <th className="text-right py-1.5 pr-4">Weight</th>
                <th className="text-right py-1.5 pr-4">ATM IV</th>
                <th className="text-right py-1.5">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {data.constituents.map((c: any) => (
                <tr key={c.ticker} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                  <td className="py-1.5 pr-4 font-bold text-zinc-200">{c.ticker}</td>
                  <td className="text-right py-1.5 pr-4 text-zinc-400">{(c.weight * 100).toFixed(1)}%</td>
                  <td className="text-right py-1.5 pr-4 text-orange-400">
                    {c.atm_iv !== null ? `${c.atm_iv.toFixed(1)}%` : "--"}
                  </td>
                  <td className="text-right py-1.5 text-zinc-400">
                    {c.contribution.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

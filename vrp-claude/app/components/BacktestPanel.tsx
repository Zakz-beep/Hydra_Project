// app/components/BacktestPanel.tsx
// Menampilkan hasil backtesting signal accuracy dari SQLite
"use client";

import { BacktestResult, SIGNAL_META, SignalType } from "../lib/vrp";

interface BacktestPanelProps {
  data:    BacktestResult;
  loading: boolean;
}

// ── Win rate ring ──────────────────────────────────────────────
function WinRateRing({ rate, size = 80 }: { rate: number | null; size?: number }) {
  if (rate === null) {
    return (
      <div
        className="flex items-center justify-center rounded-full border-2 border-zinc-700 border-dashed"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] font-mono text-zinc-600">N/A</span>
      </div>
    );
  }

  const r         = size / 2 - 6;
  const circ      = 2 * Math.PI * r;
  const filled    = circ * rate;
  const color     = rate >= 0.6 ? "#34d399" : rate >= 0.45 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Track */}
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#27272a" strokeWidth="5" />
        {/* Progress */}
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${filled} ${circ - filled}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      {/* Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold text-zinc-100" style={{ fontSize: size * 0.18 }}>
          {(rate * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

// ── Horizon card ───────────────────────────────────────────────
function HorizonCard({
  days,
  summary,
}: {
  days: number;
  summary: BacktestResult["by_horizon"][1];
}) {
  const label = days === 1 ? "1 Day" : days === 5 ? "1 Week" : "1 Month";

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4">
      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">{label}</span>
      <WinRateRing rate={summary.win_rate} size={72} />
      <div className="text-center space-y-0.5">
        <div className="text-[11px] font-mono text-zinc-500">
          {summary.correct}/{summary.total} signals
        </div>
        <div className={`text-[11px] font-mono ${summary.avg_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          avg {summary.avg_pnl >= 0 ? "+" : ""}{summary.avg_pnl.toFixed(2)}% pnl
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function BacktestPanel({ data, loading }: BacktestPanelProps) {
  const horizons = [
    { days: 1  as const, summary: data.by_horizon[1]  },
    { days: 5  as const, summary: data.by_horizon[5]  },
    { days: 20 as const, summary: data.by_horizon[20] },
  ];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            Signal Accuracy
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            {data.total_signals} total signal changes · {data.newly_evaluated} newly evaluated
          </p>
        </div>
        {loading && (
          <span className="text-[10px] font-mono text-zinc-600 animate-pulse">evaluating...</span>
        )}
      </div>

      {/* Horizon rings */}
      <div className="grid grid-cols-3 gap-3">
        {horizons.map(({ days, summary }) => (
          <HorizonCard key={days} days={days} summary={summary} />
        ))}
      </div>

      {/* By signal type table */}
      {Object.keys(data.by_signal_type).length > 0 && (
        <div className="rounded-xl border border-zinc-800/60 overflow-hidden">
          <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/80">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
              Breakdown by Signal Type
            </span>
          </div>
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="border-b border-zinc-800/50">
                {["Signal", "Total", "Correct", "Win Rate"].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-zinc-600 font-normal uppercase tracking-wider text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.by_signal_type).map(([sig, stat]) => {
                const meta = SIGNAL_META[sig as SignalType];
                const wr   = stat.win_rate;
                const wrColor = wr === null ? "text-zinc-600"
                  : wr >= 0.6 ? "text-emerald-400"
                  : wr >= 0.45 ? "text-amber-400"
                  : "text-red-400";

                return (
                  <tr key={sig} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-2">
                      <span className={`${meta?.color ?? "text-zinc-400"}`}>
                        {meta?.icon} {meta?.label ?? sig}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{stat.total}</td>
                    <td className="px-4 py-2 text-zinc-400">{stat.correct}</td>
                    <td className={`px-4 py-2 font-semibold ${wrColor}`}>
                      {wr !== null ? `${(wr * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {data.total_signals === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center">
          <p className="text-zinc-500 font-mono text-sm">Belum ada signal yang terekam</p>
          <p className="text-zinc-600 font-mono text-xs mt-1">
            Data akan muncul setelah beberapa signal change terjadi + horizon tercapai
          </p>
        </div>
      )}
    </div>
  );
}

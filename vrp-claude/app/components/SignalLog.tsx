// app/components/SignalLog.tsx
// Tabel signal change events dari SQLite + outcome badges
"use client";

import { SignalLogEntry, SIGNAL_META, SignalType } from "../lib/vrp";

interface SignalLogProps {
  signals: SignalLogEntry[];
}

// ── Outcome badge ──────────────────────────────────────────────
function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return <span className="text-zinc-700 font-mono text-[10px]">—</span>;

  const styles = {
    correct:   "text-emerald-400 bg-emerald-950/40 border-emerald-800",
    incorrect: "text-red-400 bg-red-950/40 border-red-800",
    neutral:   "text-zinc-500 bg-zinc-800/40 border-zinc-700",
  }[outcome] ?? "text-zinc-600";

  const icons = { correct: "✓", incorrect: "✗", neutral: "→" } as Record<string, string>;

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-mono ${styles}`}>
      {icons[outcome]} {outcome}
    </span>
  );
}

// ── Signal arrow ───────────────────────────────────────────────
function SignalTransition({ from, to }: { from: SignalType | null; to: SignalType }) {
  const toMeta   = SIGNAL_META[to];
  const fromMeta = from ? SIGNAL_META[from] : null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {fromMeta && (
        <>
          <span className={`text-[10px] font-mono ${fromMeta.color} opacity-60`}>
            {fromMeta.icon} {fromMeta.label}
          </span>
          <span className="text-zinc-700 text-[10px]">→</span>
        </>
      )}
      <span className={`text-[10px] font-mono font-semibold ${toMeta.color}`}>
        {toMeta.icon} {toMeta.label}
      </span>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function SignalLog({ signals }: SignalLogProps) {
  if (!signals || signals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-8 text-center">
        <p className="text-zinc-500 font-mono text-sm">Belum ada signal change</p>
        <p className="text-zinc-600 font-mono text-xs mt-1">
          Signal dicatat tiap kali state berubah (bukan tiap poll)
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 overflow-hidden">

      {/* Summary bar */}
      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
          Signal Change Log
        </span>
        <span className="text-[10px] font-mono text-zinc-600">
          {signals.length} events
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-800/50 bg-zinc-900/60">
              {["Time", "Transition", "VRP Z", "Spot", "IV", "RV", "1D", "5D", "20D"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-zinc-600 font-normal uppercase tracking-wider text-[9px] whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {signals.map((entry) => {
              // Format timestamp
              let timeStr = entry.timestamp;
              try {
                const dt = new Date(entry.timestamp);
                timeStr = dt.toLocaleDateString("id-ID", {
                  month: "short", day: "numeric",
                }) + " " + dt.toLocaleTimeString("id-ID", {
                  hour: "2-digit", minute: "2-digit",
                });
              } catch {}

              const zColor = entry.vrp_z > 1 ? "text-emerald-400"
                : entry.vrp_z < -1 ? "text-red-400"
                : "text-zinc-400";

              return (
                <tr key={entry.id}
                  className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                >
                  {/* Time */}
                  <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{timeStr}</td>

                  {/* Transition */}
                  <td className="px-3 py-2">
                    <SignalTransition from={entry.prev_signal} to={entry.signal} />
                  </td>

                  {/* VRP Z */}
                  <td className={`px-3 py-2 ${zColor}`}>
                    {entry.vrp_z >= 0 ? "+" : ""}{entry.vrp_z.toFixed(2)}σ
                  </td>

                  {/* Spot */}
                  <td className="px-3 py-2 text-zinc-300">
                    ${entry.spot_at_signal.toLocaleString()}
                  </td>

                  {/* IV */}
                  <td className="px-3 py-2 text-indigo-400">
                    {(entry.iv_at_signal * 100).toFixed(1)}%
                  </td>

                  {/* RV */}
                  <td className="px-3 py-2 text-orange-400">
                    {(entry.rv_at_signal * 100).toFixed(1)}%
                  </td>

                  {/* Outcomes */}
                  <td className="px-3 py-2"><OutcomeBadge outcome={entry.outcome_1d} /></td>
                  <td className="px-3 py-2"><OutcomeBadge outcome={entry.outcome_5d} /></td>
                  <td className="px-3 py-2"><OutcomeBadge outcome={entry.outcome_20d} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-zinc-800/50 flex gap-4 text-[9px] font-mono text-zinc-600">
        <span><span className="text-emerald-400">✓ correct</span> — signal direction terbukti</span>
        <span><span className="text-red-400">✗ incorrect</span> — direction salah</span>
        <span>— belum ada data / horizon belum tercapai</span>
      </div>
    </div>
  );
}

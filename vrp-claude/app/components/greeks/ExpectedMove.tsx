"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ExpectedMoveResponse, EMPeriod,
  fetchExpectedMove, fmtGex,
} from "../../lib/greeks";
import { RefreshCw, Target, ArrowUpDown, Activity, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

interface Props {
  ticker: string;
}

const OVEREXT_CONFIG = {
  EXTREME:      { color: "text-rose-400",    bg: "bg-rose-500/15",    border: "border-rose-500/40",    label: "EXTREME",     emoji: "🔥", desc: "Harga sudah >2σ di luar EM — mean reversion sangat likely" },
  EXTENDED:     { color: "text-orange-400",  bg: "bg-orange-500/15",  border: "border-orange-500/40",  label: "EXTENDED",    emoji: "⚠️",  desc: "Harga di antara 1.5-2σ — stretched, perhatikan reversal" },
  AT_BOUNDARY:  { color: "text-yellow-400",  bg: "bg-yellow-500/15",  border: "border-yellow-500/40",  label: "AT BOUNDARY", emoji: "📍", desc: "Harga mendekati batas 1σ — potensi rejection atau breakout" },
  WITHIN_RANGE: { color: "text-emerald-400", bg: "bg-emerald-500/15", border: "border-emerald-500/40", label: "WITHIN EM",   emoji: "✅", desc: "Harga masih di dalam expected range — normal" },
};

/** Visual ruler showing spot price position relative to EM bands */
function EMRuler({ data }: { data: ExpectedMoveResponse }) {
  if (!data.standard_periods.length) return null;
  const p = data.standard_periods[0]; // 1D EM

  // Total visual range = ±2.5σ from prev_close
  const center = data.prev_close;
  const halfRange = p.em_1sigma * 2.5;
  const rangeMin = center - halfRange;
  const rangeMax = center + halfRange;
  const total = rangeMax - rangeMin;

  // Convert price to percentage position on ruler
  const toPct = (price: number) => Math.max(0, Math.min(100, ((price - rangeMin) / total) * 100));

  const centerPct = toPct(center);
  const spotPct = toPct(data.spot);
  const lower2s = toPct(p.lower_2s);
  const lower1s = toPct(p.lower_1s);
  const upper1s = toPct(p.upper_1s);
  const upper2s = toPct(p.upper_2s);
  const highPct = toPct(data.day_high);
  const lowPct = toPct(data.day_low);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[9px] font-mono text-zinc-600">
        <span>${p.lower_2s.toFixed(0)}</span>
        <span>${p.lower_1s.toFixed(0)}</span>
        <span className="text-zinc-400">Prev ${center.toFixed(0)}</span>
        <span>${p.upper_1s.toFixed(0)}</span>
        <span>${p.upper_2s.toFixed(0)}</span>
      </div>

      {/* Main ruler */}
      <div className="relative h-10 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800/60">
        {/* 2σ band (outer) */}
        <div
          className="absolute top-0 h-full bg-red-500/8"
          style={{ left: `${lower2s}%`, width: `${upper2s - lower2s}%` }}
        />
        {/* 1σ band (inner) */}
        <div
          className="absolute top-0 h-full bg-emerald-500/12"
          style={{ left: `${lower1s}%`, width: `${upper1s - lower1s}%` }}
        />

        {/* 1σ boundary lines */}
        <div className="absolute top-0 h-full w-px bg-emerald-500/40" style={{ left: `${lower1s}%` }} />
        <div className="absolute top-0 h-full w-px bg-emerald-500/40" style={{ left: `${upper1s}%` }} />

        {/* 2σ boundary lines */}
        <div className="absolute top-0 h-full w-px bg-red-500/40" style={{ left: `${lower2s}%` }} />
        <div className="absolute top-0 h-full w-px bg-red-500/40" style={{ left: `${upper2s}%` }} />

        {/* Day range bar (high-low) */}
        <div
          className="absolute top-3 h-4 bg-indigo-500/20 border-y border-indigo-500/30 rounded-sm"
          style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 0.5)}%` }}
        />

        {/* Center line (prev close) */}
        <div
          className="absolute top-0 h-full w-px bg-zinc-500/60"
          style={{ left: `${centerPct}%` }}
        />

        {/* Spot price dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-indigo-400 shadow-lg shadow-indigo-500/30 z-10"
          style={{ left: `${spotPct}%`, transform: `translateX(-50%) translateY(-50%)` }}
        />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 text-[9px] font-mono text-zinc-600">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/40" /> 1σ (68%)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/30" /> 2σ (95%)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500/40" /> Day Range</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-white border border-indigo-400" style={{ width: 8, height: 8 }} /> Spot</span>
      </div>
    </div>
  );
}

export default function ExpectedMove({ ticker }: Props) {
  const [data, setData] = useState<ExpectedMoveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showExpiry, setShowExpiry] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchExpectedMove(ticker, force);
      setData(res);
    } catch (e: any) {
      setError(e.message || "EM fetch failed");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  // Ticker change: immediately clear stale data, then fetch
  useEffect(() => {
    setData(null);
    setError(null);
    load();
  }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic refresh (don't clear data)
  useEffect(() => {
    const iv = setInterval(() => load(), 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const regime = data?.overextension_regime ?? "WITHIN_RANGE";
  const cfg = OVEREXT_CONFIG[regime];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <Target size={15} className="text-cyan-400" />
          <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-wider font-bold">
            Expected Move
          </h3>
          {data && (
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${cfg.border} ${cfg.bg} ${cfg.color}`}>
              {cfg.emoji} {cfg.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[9px] font-mono text-zinc-500">
              IV {data.annualized_iv.toFixed(1)}%
            </span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-1.5 rounded-md text-zinc-500 hover:text-cyan-400 hover:bg-zinc-800 transition-all"
          >
            <RefreshCw size={13} className={loading ? "animate-spin text-cyan-400" : ""} />
          </button>
        </div>
      </div>

      {error && <div className="px-4 py-3 text-xs font-mono text-red-400">{error}</div>}

      {loading && !data && (
        <div className="px-4 py-8 text-center text-zinc-500 text-xs font-mono">
          Menghitung Expected Move...
        </div>
      )}

      {data && (
        <div className="p-4 space-y-4">

          {/* ── Visual Ruler ───────────────────────── */}
          <EMRuler data={data} />

          {/* ── Key Metrics Row ────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {/* Actual Move */}
            <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-2.5 text-center">
              <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">Actual Move</div>
              <div className={`text-sm font-mono font-bold ${data.actual_move >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {data.actual_move >= 0 ? "+" : ""}{data.actual_move.toFixed(2)}
              </div>
              <div className="text-[9px] font-mono text-zinc-600">
                {data.actual_move_pct >= 0 ? "+" : ""}{data.actual_move_pct.toFixed(3)}%
              </div>
            </div>

            {/* 1D Expected Move */}
            <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-2.5 text-center">
              <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">1D EM (1σ)</div>
              <div className="text-sm font-mono font-bold text-cyan-400">
                ±{data.em_1d.toFixed(2)}
              </div>
              <div className="text-[9px] font-mono text-zinc-600">
                ±{data.standard_periods[0]?.em_1sigma_pct.toFixed(3) ?? "—"}%
              </div>
            </div>

            {/* Overextension */}
            <div className={`rounded-lg border p-2.5 text-center ${cfg.border} ${cfg.bg}`}>
              <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">Overextension</div>
              <div className={`text-sm font-mono font-bold ${cfg.color}`}>
                {data.overextension.toFixed(2)}σ
              </div>
              <div className="text-[9px] font-mono text-zinc-600">
                {regime === "WITHIN_RANGE" ? "dalam batas" : "di luar EM"}
              </div>
            </div>

            {/* Range Utilization */}
            <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-2.5 text-center">
              <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">Range Used</div>
              <div className="text-sm font-mono font-bold text-zinc-200">
                {(data.range_utilization * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] font-mono text-zinc-600">
                {data.actual_range.toFixed(2)} / {(data.em_1d * 2).toFixed(2)}
              </div>
            </div>
          </div>

          {/* ── Interpretation ─────────────────────── */}
          <div className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              {regime === "EXTREME" || regime === "EXTENDED"
                ? <AlertTriangle size={13} className={cfg.color} />
                : <Activity size={13} className={cfg.color} />
              }
              <p className={`text-xs font-mono font-bold ${cfg.color}`}>
                {cfg.emoji} {cfg.label}
              </p>
            </div>
            <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">{cfg.desc}</p>
          </div>

          {/* ── Standard Periods Table ─────────────── */}
          <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="bg-zinc-900/80 border-b border-zinc-800">
                  <th className="px-3 py-2 text-left text-zinc-500 font-normal uppercase">Period</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">1σ Move</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">1σ %</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase hidden sm:table-cell">Range</th>
                  <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">2σ Move</th>
                </tr>
              </thead>
              <tbody>
                {data.standard_periods.map((p, i) => (
                  <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-3 py-1.5 text-zinc-300 font-bold">{p.label}</td>
                    <td className="px-3 py-1.5 text-right text-cyan-400">±${p.em_1sigma.toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right text-cyan-400/70">±{p.em_1sigma_pct.toFixed(2)}%</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400 hidden sm:table-cell">
                      ${p.lower_1s.toFixed(0)} — ${p.upper_1s.toFixed(0)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-orange-400/80">±${p.em_2sigma.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Per-Expiry Toggle ──────────────────── */}
          {data.by_expiry.length > 0 && (
            <div>
              <button
                onClick={() => setShowExpiry(!showExpiry)}
                className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <ArrowUpDown size={10} />
                {showExpiry ? "Hide" : "Show"} Per-Expiry EM ({data.by_expiry.length} buckets)
              </button>

              {showExpiry && (
                <div className="mt-2 rounded-lg border border-zinc-800/50 overflow-hidden">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="bg-zinc-900/80 border-b border-zinc-800">
                        <th className="px-3 py-2 text-left text-zinc-500 font-normal uppercase">Expiry</th>
                        <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">DTE</th>
                        <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">ATM IV</th>
                        <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">1σ Move</th>
                        <th className="px-3 py-2 text-right text-zinc-500 font-normal uppercase">Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_expiry.map((e, i) => (
                        <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20">
                          <td className="px-3 py-1.5 text-zinc-300 font-bold">{e.label}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-400">{e.dte}d</td>
                          <td className="px-3 py-1.5 text-right text-indigo-400">{e.atm_iv.toFixed(1)}%</td>
                          <td className="px-3 py-1.5 text-right text-cyan-400">±${e.em_1sigma.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right text-zinc-400">
                            ${e.lower_1s.toFixed(0)} — ${e.upper_1s.toFixed(0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Price Reference ────────────────────── */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-zinc-600">
            <span>Prev Close: <span className="text-zinc-400">${data.prev_close.toFixed(2)}</span></span>
            <span>Spot: <span className="text-zinc-300">${data.spot.toFixed(2)}</span></span>
            <span>High: <span className="text-emerald-400/60">${data.day_high.toFixed(2)}</span></span>
            <span>Low: <span className="text-red-400/60">${data.day_low.toFixed(2)}</span></span>
            <span>Range: <span className="text-zinc-400">${data.actual_range.toFixed(2)} ({data.actual_range_pct.toFixed(2)}%)</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

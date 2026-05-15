"use client";

import { TrendingDown, TrendingUp, Minus, Info } from "lucide-react";
import {
  DispersionSignalResponse, TradeBlueprint, TradeLeg,
  getSignalColor, getSignalBg, getSignalLabel, getMethodBadge, fmtCorr, fmtSpread,
} from "../../lib/dispersion";

interface DispersionSignalPanelProps {
  data: DispersionSignalResponse;
}

function StrengthGauge({ strength, signal }: { strength: number; signal: string }) {
  const circumference = 2 * Math.PI * 40;
  const offset = circumference * (1 - strength / 100);
  const color =
    signal === "SHORT_DISPERSION" ? "#34d399" :
    signal === "LONG_DISPERSION"  ? "#f87171" : "#71717a";

  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#27272a" strokeWidth="8" />
        <circle
          cx="50" cy="50" r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-mono font-black" style={{ color }}>{strength}</span>
        <span className="text-[9px] font-mono text-zinc-500">/ 100</span>
      </div>
    </div>
  );
}

function LegCard({ leg, isIndex = false }: { leg: TradeLeg; isIndex?: boolean }) {
  const isBuy = leg.action === "BUY";
  return (
    <div className={`rounded-lg border p-3 space-y-1 ${
      isIndex
        ? "border-indigo-500/40 bg-indigo-500/5"
        : "border-zinc-800/50 bg-zinc-900/30"
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isBuy
            ? <TrendingUp size={11} className="text-emerald-400" />
            : <TrendingDown size={11} className="text-red-400" />
          }
          <span className="text-sm font-mono font-bold text-zinc-100">{leg.ticker}</span>
          {isIndex && (
            <span className="text-[9px] font-mono bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-1.5 py-0.5 rounded">
              INDEX
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
            isBuy
              ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
              : "bg-red-500/15 border-red-500/40 text-red-400"
          }`}>
            {leg.action}
          </span>
          <span className="text-[9px] font-mono text-zinc-500">{leg.instrument}</span>
        </div>
      </div>
      <div className="flex justify-between text-[9px] font-mono">
        <span className="text-zinc-500">ATM IV:</span>
        <span className="text-orange-400">{leg.atm_iv.toFixed(1)}%</span>
      </div>
      {leg.weight !== undefined && (
        <div className="flex justify-between text-[9px] font-mono">
          <span className="text-zinc-500">Weight:</span>
          <span className="text-zinc-400">{(leg.weight * 100).toFixed(1)}%</span>
        </div>
      )}
      <p className="text-[9px] font-mono text-zinc-600 leading-relaxed">{leg.rationale}</p>
    </div>
  );
}

export default function DispersionSignalPanel({ data }: DispersionSignalPanelProps) {
  const signalColor = getSignalColor(data.signal);
  const signalBg    = getSignalBg(data.signal);
  const signalLabel = getSignalLabel(data.signal);
  const bp = data.trade_blueprint;

  const SignalIcon =
    data.signal === "SHORT_DISPERSION" ? TrendingDown :
    data.signal === "LONG_DISPERSION"  ? TrendingUp   : Minus;

  return (
    <div className="space-y-5">

      {/* Main Signal Card */}
      <div className={`rounded-xl border p-5 ${signalBg}`}>
        <div className="flex flex-col sm:flex-row gap-5 items-center">

          {/* Strength Gauge */}
          <StrengthGauge strength={data.signal_strength} signal={data.signal} />

          {/* Signal Info */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <SignalIcon size={18} className={signalColor} />
              <span className={`text-xl font-mono font-black tracking-widest ${signalColor}`}>
                {signalLabel}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800/60 px-2 py-1 rounded">
                {data.index} · {data.dte}DTE · {data.window_days}d Realized
              </span>
              {data.weights_method && (() => {
                const badge = getMethodBadge(data.weights_method);
                return (
                  <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${badge.color}`}>
                    {badge.label}{data.coverage ? ` · ${data.coverage}` : ""}
                  </span>
                );
              })()}
            </div>

            {/* Correlation Stats */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-mono">
              <div>
                <span className="text-zinc-500">ρ Implied: </span>
                <span className="text-blue-400 font-bold">{fmtCorr(data.implied_corr)}</span>
              </div>
              <div>
                <span className="text-zinc-500">ρ Realized: </span>
                <span className="text-orange-400 font-bold">{fmtCorr(data.realized_corr)}</span>
              </div>
              <div>
                <span className="text-zinc-500">Spread: </span>
                <span className={`font-bold ${signalColor}`}>{fmtSpread(data.spread)}</span>
              </div>
              {data.index_atm_iv && (
                <div>
                  <span className="text-zinc-500">{data.index} ATM IV: </span>
                  <span className="text-zinc-300 font-bold">{data.index_atm_iv.toFixed(1)}%</span>
                </div>
              )}
            </div>

            {/* Description */}
            <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
              {data.description}
            </p>
          </div>
        </div>
      </div>

      {/* Trade Blueprint */}
      {bp ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
              Trade Blueprint — {bp.strategy}
            </h4>
            <span className="text-[9px] font-mono text-zinc-600 bg-zinc-800/40 px-2 py-0.5 rounded">
              Edge: {bp.spread_edge}
            </span>
          </div>

          {/* Index Leg */}
          <LegCard leg={bp.index_leg} isIndex />

          {/* Constituent Legs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {bp.constituent_legs.map((leg: any, i: number) => (
              <LegCard key={i} leg={leg} />
            ))}
          </div>

          {/* Profit / Risk */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <p className="text-[9px] font-mono text-emerald-400 uppercase tracking-wider mb-1">
                ✓ Profit Condition
              </p>
              <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                {bp.profit_condition}
              </p>
            </div>
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-[9px] font-mono text-red-400 uppercase tracking-wider mb-1">
                ⚠ Risk Scenario
              </p>
              <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                {bp.risk}
              </p>
            </div>
          </div>
        </div>
      ) : (
        data.signal === "NEUTRAL" && (
          <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-500 bg-zinc-800/30 rounded-lg p-4 border border-zinc-700/30">
            <Info size={14} />
            <span>Spread dalam batas normal. Tidak ada trade blueprint — tunggu hingga spread melebar ke zona sinyal (&gt;+15% atau &lt;-10%).</span>
          </div>
        )
      )}
    </div>
  );
}

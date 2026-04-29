"use client";

import React from "react";
import { DCCSummary } from "../../lib/dcc";
import MetricCard from "../MetricCard";

interface Props {
  summary: DCCSummary;
  tickers: string[];
}

export default function DCCMetrics({ summary, tickers }: Props) {
  // Define formatting helpers
  const fmtCurrency = (val: number) => `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (val: number) => `${val.toFixed(2)}%`;

  const passiveBalance = summary.final_passive_equity;
  const adaptiveBalance = summary.final_adaptive_equity;
  const diffBalance = adaptiveBalance - passiveBalance;
  const isAdaptiveBetter = diffBalance > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="Assets"
          value={tickers.length.toString()}
          sub={tickers.join(", ")}
          highlight="neutral"
        />
        <MetricCard
          label="Strategy Edge"
          value={`${isAdaptiveBetter ? "+" : ""}${fmtCurrency(diffBalance)}`}
          sub="Adaptive vs Passive"
          highlight={isAdaptiveBetter ? "green" : "red"}
        />
        <MetricCard
          label="Max DD (Passive)"
          value={fmtPct(summary.max_passive_dd)}
          sub="Buy & Hold Risk"
          highlight="red"
        />
        <MetricCard
          label="Max DD (Adaptive)"
          value={fmtPct(summary.max_adaptive_dd)}
          sub="Smart Hedging Risk"
          highlight={summary.max_adaptive_dd > summary.max_passive_dd ? "red" : "green"}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 flex items-center justify-between">
           <div>
             <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Passive Strategy</h3>
             <p className="text-2xl font-mono text-zinc-300 mt-1">{fmtCurrency(summary.final_passive_equity)}</p>
           </div>
           <div className="text-right">
             <span className="text-[10px] font-mono text-zinc-600 block">Buy & Hold</span>
             <span className="text-xs font-mono text-zinc-400">100% Exposure</span>
           </div>
        </div>

        <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-5 flex items-center justify-between">
           <div>
             <h3 className="text-xs font-mono text-indigo-400 uppercase tracking-wider">DCC Adaptive</h3>
             <p className="text-2xl font-mono text-indigo-200 mt-1">{fmtCurrency(summary.final_adaptive_equity)}</p>
           </div>
           <div className="text-right">
             <span className="text-[10px] font-mono text-indigo-500/70 block">Dynamic Hedging</span>
             <span className="text-xs font-mono text-indigo-300">20% - 100% Exp.</span>
           </div>
        </div>
      </div>
    </div>
  );
}

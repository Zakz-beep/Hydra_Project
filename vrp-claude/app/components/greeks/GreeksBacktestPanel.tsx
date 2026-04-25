import { GreeksBacktestResponse } from "../../lib/greeks";

export default function GreeksBacktestPanel({ data, loading }: { data: GreeksBacktestResponse | null, loading: boolean }) {
  if (loading) {
     return <div className="h-40 rounded-xl bg-zinc-800/30 animate-pulse" />;
  }

  if (!data) {
     return <div className="text-center font-mono text-zinc-500 py-6 border border-zinc-800 rounded-xl">Data backtest tidak tersedia</div>;
  }

  return (
    <div className="space-y-4">
      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
         <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4 text-center">
            <div className="text-xl font-bold font-mono text-zinc-200">{data.total_signals}</div>
            <div className="text-[10px] uppercase font-mono text-zinc-500 mt-1">Total Signals Evaluated</div>
         </div>
         <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl p-4 text-center">
            <div className="text-xl font-bold font-mono text-indigo-400">{data.newly_evaluated}</div>
            <div className="text-[10px] uppercase font-mono text-zinc-500 mt-1">New Evaluations</div>
         </div>
      </div>

      {/* Accuracy By Horizon */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
         <h3 className="text-xs uppercase font-mono text-zinc-400 mb-4 tracking-wider">Predictive Accuracy (Win Rate)</h3>
         <div className="grid grid-cols-3 gap-3">
           {([1, 5, 20] as const).map(horizon => {
              const hData = data.by_horizon[horizon];
              if (!hData) return null;
              
              const wrPct = hData.win_rate !== null ? (hData.win_rate * 100).toFixed(1) + "%" : "N/A";
              return (
                 <div key={horizon} className="border border-zinc-800/80 rounded-lg p-3 text-center bg-zinc-950">
                    <div className="text-[10px] uppercase font-mono text-zinc-500 mb-1">{horizon} Day Horizon</div>
                    <div className={`text-lg font-bold font-mono ${hData.win_rate !== null && hData.win_rate > 0.5 ? "text-emerald-400" : "text-amber-400"}`}>
                       {wrPct}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-600 mt-1">
                       {hData.correct} / {hData.total}
                    </div>
                 </div>
              );
           })}
         </div>
      </div>
      
      {/* Accuracy by Signal Value (e.g. POSITIVE_GAMMA) */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
          <h3 className="text-xs uppercase font-mono text-zinc-400 mb-4 tracking-wider">Win Rate by Signal Value</h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
             {Object.entries(data.by_signal_value || {}).map(([val, d]) => {
                const wrPct = d.win_rate !== null ? (d.win_rate * 100).toFixed(1) + "%" : "N/A";
                return (
                 <div key={val} className="border border-zinc-800/80 rounded-lg p-3 text-center bg-zinc-950">
                    <div className="text-[10px] uppercase font-mono text-zinc-500 mb-1">{val.replace(/_/g, " ")}</div>
                    <div className={`text-lg font-bold font-mono ${d.win_rate !== null && d.win_rate > 0.5 ? "text-emerald-400" : "text-zinc-300"}`}>
                       {wrPct}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-600 mt-1">
                       {d.correct} / {d.total}
                    </div>
                 </div>
                )
             })}
          </div>
      </div>
    </div>
  );
}

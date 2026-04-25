import { GreeksSnapshot, fmtGex } from "../../lib/greeks";

export default function GreeksHistoryTable({ history }: { history: GreeksSnapshot[] }) {
  if (!history || history.length === 0) {
    return <div className="text-zinc-500 text-sm font-mono p-4 text-center border border-zinc-800 rounded-xl">No history available</div>;
  }

  // Expecting history array to be oldest first or newest first. We map newest first.
  const displayHistory = [...history].reverse();

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono text-left">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-950/50">
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Time</th>
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Spot</th>
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Net GEX</th>
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Regime</th>
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Gamma Flip</th>
              <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Flip Dist</th>
            </tr>
          </thead>
          <tbody>
            {displayHistory.map((snap, i) => {
              // Hitung jarak ke gamma flip 
              let distMsg = "-";
              if (snap.gamma_flip) {
                const dist = ((snap.gamma_flip - snap.spot) / snap.spot) * 100;
                distMsg = `${dist > 0 ? "+" : ""}${dist.toFixed(2)}%`;
              }
              const regimeColor = 
                  snap.gex_regime === "POSITIVE_GAMMA" ? "text-emerald-400" : 
                  snap.gex_regime === "NEGATIVE_GAMMA" ? "text-red-400" : "text-zinc-400";

              return (
                <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-3 py-1.5 text-zinc-400">{snap.time || snap.timestamp.substring(11, 19)}</td>
                  <td className="px-3 py-1.5 text-zinc-300">{snap.spot.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 ${snap.total_net_gex >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {fmtGex(snap.total_net_gex)}
                  </td>
                  <td className={`px-3 py-1.5 ${regimeColor}`}>{snap.gex_regime}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{snap.gamma_flip?.toFixed(2) ?? "-"}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{distMsg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

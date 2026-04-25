import { GreeksSignalLogEntry } from "../../lib/greeks";

export default function GreeksSignalLog({ signals }: { signals: GreeksSignalLogEntry[] }) {
    if (!signals || signals.length === 0) {
      return <div className="text-center font-mono text-zinc-500 py-6 border border-zinc-800 rounded-xl">Belum ada sinyal berubah</div>;
    }

    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/50">
                <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Waktu</th>
                <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Type</th>
                <th className="px-3 py-2 text-zinc-500 uppercase font-normal">New Signal</th>
                <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Prev Signal</th>
                <th className="px-3 py-2 text-zinc-500 uppercase font-normal">Spot</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((sig) => {
                const isGex = sig.signal_type === "gex_regime";
                return (
                  <tr key={sig.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-3 py-1.5 text-zinc-400 whitespace-nowrap">
                       {sig.timestamp.replace("T", " ").substring(0, 16)}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-300">{sig.signal_type}</td>
                    <td className={`px-3 py-1.5 font-bold ${isGex && sig.signal_value.includes("POSITIVE") ? "text-emerald-400" : isGex && sig.signal_value.includes("NEGATIVE") ? "text-red-400" : "text-amber-400"}`}>
                      {sig.signal_value}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500">{sig.prev_value ?? "-"}</td>
                    <td className="px-3 py-1.5 text-zinc-400">{sig.spot_at_signal.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
}


import { GreeksSnapshot, fmtGex } from "../../lib/greeks";
import MetricCard from "../MetricCard";
import GreeksSurfaces from "./GreeksSurfaces";


export default function GreeksOverview({ data }: { data: GreeksSnapshot }) {
  const formatSignal = (sig: string) => {
    if (!sig) return "";
    return sig.replace(/_/g, " ");
  };

  return (
    <div className="space-y-4">
      {/* Greeks ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Net GEX"
          value={`$${fmtGex(data.total_net_gex)}`}
          sub="Billion per 1% move"
          highlight={data.total_net_gex > 0 ? "green" : "red"}
          tooltip="Gamma Exposure Total, positive suppresses volatility, negative amplifies."
        />
        <MetricCard
          label="Net Vanna"
          value={`$${fmtGex(data.total_net_vanna)}`}
          sub="Delta change per 1% IV"
          highlight={data.total_net_vanna > 0 ? "green" : "red"}
          tooltip="Vanna Total. Bullish jika positive (IV turun -> Delta naik -> dealer buy)."
        />
        <MetricCard
          label="Net Charm"
          value={`$${fmtGex(data.total_net_charm)}`}
          sub="Delta change per day"
          highlight={data.total_net_charm > 0 ? "green" : "red"}
          tooltip="Charm Total. Bullish jika positive (Waktu lewat -> Delta naik -> dealer buy)."
        />
        <MetricCard
          label="Net VEX"
          value={`$${fmtGex(data.total_net_vex)}`}
          sub="Vega Exposure"
          highlight="neutral"
          tooltip="Vega Exposure Total."
        />
      </div>

      {/* Signals ── */}
      {data.signals && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4 space-y-4">
          <h3 className="text-sm font-mono text-zinc-400 uppercase tracking-wider">Market Structure Signals</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              { title: "GEX Regime", text: formatSignal(data.signals.gex_regime), desc: data.signals.gex_desc },
              { title: "Vanna Signal", text: formatSignal(data.signals.vanna_signal), desc: data.signals.vanna_desc },
              { title: "Charm Signal", text: formatSignal(data.signals.charm_signal), desc: data.signals.charm_desc },
              { title: "DAI Bias", text: formatSignal(data.signals.dai_bias), desc: data.signals.dai_desc },
            ].map(({ title, text, desc }) => (
              <div key={title} className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-3">
                <div className="text-[10px] uppercase font-mono text-zinc-500 mb-1">{title}</div>
                <div className="text-sm font-semibold text-zinc-200">{text}</div>
                <div className="text-[11px] font-mono text-zinc-500 mt-1">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Surface & Profiles (Vol Skew & GEX strike levels) */}
      <GreeksSurfaces data={data} />

      {/* Expiry Breakdown */}
      {data.by_expiry && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
             <h3 className="text-sm font-mono text-zinc-400 uppercase tracking-wider">Expiry Buckets</h3>
          </div>
          <table className="w-full text-left font-mono text-[11px]">
             <thead>
                <tr className="bg-zinc-950/30 text-zinc-500 border-b border-zinc-800/60">
                   <th className="px-4 py-2">DTE</th>
                   <th className="px-4 py-2">Strikes</th>
                   <th className="px-4 py-2">Net GEX</th>
                   <th className="px-4 py-2">Gamma Flip</th>
                   <th className="px-4 py-2">Max Pain</th>
                </tr>
             </thead>
             <tbody>
                {Object.values(data.by_expiry).sort((a,b) => a.dte_bucket - b.dte_bucket).map(b => (
                  <tr key={b.dte_bucket} className="border-b border-zinc-800/20 hover:bg-zinc-800/10">
                     <td className="px-4 py-2 text-zinc-300">{b.dte_bucket}DTE</td>
                     <td className="px-4 py-2 text-zinc-400">{b.n_strikes}</td>
                     <td className={`px-4 py-2 ${b.net_gex_spotgamma >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtGex(b.net_gex_spotgamma)}</td>
                     <td className="px-4 py-2 text-zinc-400">{b.gamma_flip ?? "-"}</td>
                     <td className="px-4 py-2 text-zinc-400">{b.max_pain ?? "-"}</td>
                  </tr>
                ))}
             </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

import { GreeksSnapshot, fmtGex } from "../../lib/greeks";
import MetricCard from "../MetricCard";
import GreeksSurfaces from "./GreeksSurfaces";
import GammaBounceScore from "./GammaBounceScore";
import ExpectedMove from "./ExpectedMove";


export default function GreeksOverview({ data, ticker }: { data: GreeksSnapshot; ticker: string }) {
  const formatSignal = (sig: string) => {
    if (!sig) return "";
    return sig.replace(/_/g, " ");
  };

  return (
    <div className="space-y-4">
      {/* Greeks ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard
          label="Net GEX"
          value={`${fmtGex(data.total_net_gex)}`}
          sub="Billion per 1% move"
          highlight={data.total_net_gex > 0 ? "green" : "red"}
          tooltip="Gamma Exposure Total, positive suppresses volatility, negative amplifies."
        />
        <MetricCard
          label="Absolute GEX"
          value={`${fmtGex(data.total_gross_gex)}`}
          sub="Total gross gamma"
          highlight="neutral"
          tooltip="Absolute (Gross) GEX Total. Mengukur total dealer gamma activity terlepas dari arah (put+call absolute)."
        />
        <MetricCard
          label="Net Vanna"
          value={`${fmtGex(data.total_net_vanna)}`}
          sub="Delta change per 1% IV"
          highlight={data.total_net_vanna > 0 ? "green" : "red"}
          tooltip="Vanna Total. Bullish jika positive (IV turun -> Delta naik -> dealer buy)."
        />
        <MetricCard
          label="Net Charm"
          value={`${fmtGex(data.total_net_charm)}`}
          sub="Delta change per day"
          highlight={data.total_net_charm > 0 ? "green" : "red"}
          tooltip="Charm Total. Bullish jika positive (Waktu lewat -> Delta naik -> dealer buy)."
        />
        <MetricCard
          label="Net VEX"
          value={`${fmtGex(data.total_net_vex)}`}
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

      {/* DGCI (Dealer Gamma Condition Index) Oscillator */}
      {data.signals?.dgci !== undefined && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
              Dealer Gamma Condition Index (DGCI)
            </h3>
            <div className={`text-lg font-bold font-mono ${
              data.signals.dgci > 0 ? "text-emerald-400" : data.signals.dgci < 0 ? "text-red-400" : "text-zinc-300"
            }`}>
              {data.signals.dgci > 0 ? "+" : ""}{data.signals.dgci}
            </div>
          </div>
          
          <div className="text-xs font-mono text-zinc-500">{data.signals.dgci_desc}</div>
          
          {/* Custom Oscillator Bar (-100 to +100) */}
          <div className="relative h-6 bg-zinc-950 rounded-full border border-zinc-800 overflow-hidden flex items-center">
            {/* Center line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-zinc-700 z-10" />
            
            {/* Markers */}
            <div className="absolute left-1/4 top-0 bottom-0 w-px bg-zinc-800/50 z-0" />
            <div className="absolute left-3/4 top-0 bottom-0 w-px bg-zinc-800/50 z-0" />

            {/* Fill Bar */}
            <div className="absolute h-full transition-all duration-1000 ease-in-out z-0" 
                 style={{
                   left: data.signals.dgci >= 0 ? "50%" : `${50 + (data.signals.dgci / 100 * 50)}%`,
                   right: data.signals.dgci < 0 ? "50%" : `${50 - (data.signals.dgci / 100 * 50)}%`,
                   backgroundColor: data.signals.dgci >= 0 ? "#10b981" : "#ef4444",
                   opacity: Math.max(0.3, Math.abs(data.signals.dgci) / 100)
                 }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono text-zinc-600 px-1">
            <span>-100 (Dealer Capitulation)</span>
            <span>0 (Neutral)</span>
            <span>+100 (Strong Dealer Buffer)</span>
          </div>
        </div>
      )}

      {/* Surface & Profiles (Vol Skew & GEX strike levels) */}
      <GreeksSurfaces data={data} />

      {/* Gamma Bounce Score */}
      <GammaBounceScore ticker={ticker} />

      {/* Expected Move Visualizer */}
      <ExpectedMove ticker={ticker} />

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
                   <th className="px-4 py-2">Total OI</th>
                   <th className="px-4 py-2">PCR</th>
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
                     <td className="px-4 py-2 text-zinc-300">{(b.total_oi_calls + b.total_oi_puts).toLocaleString()}</td>
                     <td className="px-4 py-2 text-zinc-400">{b.pcr_oi?.toFixed(2) || '-'}</td>
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

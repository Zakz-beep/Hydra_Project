import { GreeksSnapshot, fmtGex, fmtGammaExposure } from "../../lib/greeks";
import GreeksExposureMap from "./GreeksExposureMap";

function MetricCard({ label, value, sub, highlight, tooltip }: { label: string; value: string; sub: string; highlight: string; tooltip?: string }) {
  return <div title={tooltip} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
    <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">{label}</p>
    <p className={`mt-2 break-words font-mono text-xl font-semibold sm:text-2xl ${highlight === "green" ? "text-emerald-400" : highlight === "red" ? "text-rose-400" : "text-zinc-100"}`}>{value}</p>
    <p className="mt-1 text-xs leading-relaxed text-zinc-400">{sub}</p>
  </div>;
}

export default function GreeksOverview({ data }: { data: GreeksSnapshot; ticker: string }) {
  const buckets = Object.values(data.by_expiry || {}).sort((a, b) => a.dte_bucket - b.dte_bucket);
  const calls = buckets.reduce((sum, b) => sum + b.total_oi_calls, 0);
  const puts = buckets.reduce((sum, b) => sum + b.total_oi_puts, 0);
  const dgci = data.signals?.dgci;
  const distance = data.gamma_flip && data.spot > 0 ? (data.gamma_flip / data.spot - 1) * 100 : null;
  const signalCards = [
    { title: "Gamma regime", value: data.signals.gex_regime, detail: data.signals.gex_desc },
    { title: "Vanna", value: data.signals.vanna_signal, detail: data.signals.vanna_desc },
    { title: "Charm", value: data.signals.charm_signal, detail: data.signals.charm_desc },
    { title: "Dealer delta", value: data.signals.dai_bias, detail: data.signals.dai_desc },
  ];
  return <div className="min-w-0 space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <MetricCard label="Net GEX" value={fmtGammaExposure(data.total_net_gex)} sub="Exposure per 1% spot move" highlight={data.total_net_gex > 0 ? "green" : data.total_net_gex < 0 ? "red" : "neutral"} tooltip="Signed gamma exposure under the model's call-positive / put-negative positioning assumption." />
      <MetricCard label="Gross GEX" value={fmtGammaExposure(data.total_gross_gex)} sub="Absolute exposure per 1% spot move" highlight="neutral" />
      <MetricCard label="Gamma flip" value={data.gamma_flip ? "$" + data.gamma_flip.toLocaleString() : "N/A"} sub={distance === null ? "No crossing in model range" : (distance >= 0 ? "+" : "") + distance.toFixed(2) + "% from spot"} highlight="neutral" />
      <MetricCard label="Net vanna" value={fmtGex(data.total_net_vanna)} sub="Exposure to IV changes" highlight="neutral" />
      <MetricCard label="Net charm" value={fmtGex(data.total_net_charm)} sub="Exposure to time decay" highlight="neutral" />
      <MetricCard label="Net VEX" value={fmtGex(data.total_net_vex)} sub="Aggregate vega exposure" highlight="neutral" />
    </div>
    <GreeksExposureMap data={data} />
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold">Market structure</h3>
        <p className="mt-1 text-xs text-zinc-400">Model-derived exposure signals; gamma sign describes hedging sensitivity, not price direction.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{signalCards.map(s => <div key={s.title} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">{s.title}</p>
          <p className="mt-1 text-sm font-mono text-zinc-100">{s.value?.replaceAll("_", " ") || "Unavailable"}</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400">{s.detail || "Belum ada deskripsi untuk snapshot ini."}</p>
        </div>)}</div>
      </section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <h3 className="text-sm font-semibold">Chain coverage</h3>
        <dl className="mt-4 space-y-3 text-xs font-mono">
          {[["Contracts", buckets.reduce((s, b) => s + b.n_strikes, 0).toLocaleString()], ["Expiry buckets", buckets.length], ["Call OI", calls.toLocaleString()], ["Put OI", puts.toLocaleString()], ["Put / call OI", calls > 0 ? (puts / calls).toFixed(2) : "N/A"]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-zinc-400">{label}</dt><dd className="text-zinc-100">{value}</dd></div>)}
        </dl>
        <p className="mt-4 border-t border-zinc-800 pt-3 text-xs leading-relaxed text-zinc-400">OI reflects provider reporting cycles. Refreshing a snapshot does not imply new open interest.</p>
        {typeof dgci === "number" && Number.isFinite(dgci) && <div className="mt-4 border-t border-zinc-800 pt-3">
          <div className="flex justify-between text-xs font-mono"><span className="text-zinc-400">Dealer gamma index</span><span>{dgci > 0 ? "+" : ""}{dgci.toFixed(1)}</span></div>
          <meter aria-label="Dealer Gamma Condition Index" min={-100} max={100} value={Math.max(-100, Math.min(100, dgci))} className="mt-2 h-3 w-full" />
          <p className="mt-2 text-xs text-zinc-400">{data.signals.dgci_desc}</p>
        </div>}
      </section>
    </div>
    <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <div className="border-b border-zinc-800 p-4"><h3 className="text-sm font-semibold">Expiry breakdown</h3><p className="mt-1 text-xs text-zinc-400">DTE labels represent grouped buckets. Actual expiry dates are shown below.</p></div>
      <div className="overflow-x-auto" tabIndex={0} aria-label="Expiry breakdown, scroll horizontally">
        <table className="w-full whitespace-nowrap text-right text-xs font-mono">
          <thead className="bg-zinc-950/50 text-zinc-400"><tr>{["Bucket", "Expiries", "Contracts", "Total OI", "P/C OI", "GEX / 1% move", "Gamma flip", "Max pain"].map(h => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
          <tbody>{buckets.map(b => <tr key={b.dte_bucket} className="border-t border-zinc-800 text-zinc-300 hover:bg-zinc-800/30">
            <td className="px-4 py-3 text-zinc-100">{b.dte_bucket}DTE</td><td className="max-w-56 truncate px-4 py-3" title={b.expiry_dates.join(", ")}>{b.expiry_dates.join(", ")}</td>
            <td className="px-4 py-3">{b.n_strikes}</td><td className="px-4 py-3">{(b.total_oi_calls + b.total_oi_puts).toLocaleString()}</td><td className="px-4 py-3">{b.total_oi_calls > 0 ? (b.total_oi_puts / b.total_oi_calls).toFixed(2) : "N/A"}</td>
            <td className={"px-4 py-3 " + (b.net_gex_spotgamma >= 0 ? "text-emerald-400" : "text-red-400")}>{fmtGammaExposure(b.net_gex_spotgamma)}</td><td className="px-4 py-3">{b.gamma_flip ?? "—"}</td><td className="px-4 py-3">{b.max_pain ?? "—"}</td>
          </tr>)}
          {!buckets.length && <tr><td colSpan={8} className="p-8 text-center text-zinc-400">Tidak ada expiry atau strike pada snapshot ini.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

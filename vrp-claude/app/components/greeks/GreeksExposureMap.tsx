"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Crosshair, SlidersHorizontal } from "lucide-react";
import { GreeksSnapshot, fmtGex } from "../../lib/greeks";
import { ExposureMetric, exposureByStrike, strongestOIStrike } from "../../lib/greeksExposure";

const control = "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200 focus-visible:outline focus-visible:outline-cyan-400";
const price = (value: number | null) => value === null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export default function GreeksExposureMap({ data }: { data: GreeksSnapshot }) {
  const [metric, setMetric] = useState<ExposureMetric>("gex");
  const [bucket, setBucket] = useState("all");
  const [range, setRange] = useState("10");
  const selectedBucket = bucket === "all" || data.by_expiry?.[bucket] ? bucket : "all";
  const allRows = useMemo(() => exposureByStrike(data, selectedBucket, metric), [data, selectedBucket, metric]);
  const rows = allRows.filter(row => range === "all" || Math.abs(row.strike / data.spot - 1) <= Number(range) / 100);
  const selected = selectedBucket === "all" ? null : data.by_expiry?.[selectedBucket];
  const flip = selected ? selected.gamma_flip : data.gamma_flip;
  const levels = [
    { label: "Largest call OI", value: strongestOIStrike(allRows, "callOI"), color: "text-emerald-400" },
    { label: "Largest put OI", value: strongestOIStrike(allRows, "putOI"), color: "text-rose-400" },
    { label: "Gamma flip", value: flip ?? null, color: "text-amber-300" },
    ...(selected ? [{ label: "Bucket max pain", value: selected.max_pain, color: "text-cyan-300" }] : []),
  ];
  const net = rows.reduce((sum, row) => sum + row.net, 0);
  const unit = metric === "gex" ? "USD / 1% spot move" : "Model exposure (USD)";

  return <section aria-label="Exposure map" className="grid min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 lg:grid-cols-[minmax(0,1fr)_240px]">
    <div className="min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} className="text-cyan-400" />Exposure by strike</h3><p className="mt-1 text-xs text-zinc-400">See where the options inventory is concentrated.</p></div>
        <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1" aria-label="Exposure metric">
          {(["gex", "vanna", "charm"] as const).map(name => <button key={name} aria-pressed={metric === name} onClick={() => setMetric(name)} className={`rounded px-3 py-1.5 text-xs font-mono focus-visible:outline focus-visible:outline-cyan-400 ${metric === name ? "bg-zinc-800 text-cyan-300" : "text-zinc-400 hover:text-zinc-100"}`}>{name === "gex" ? "GEX" : name[0].toUpperCase() + name.slice(1)}</button>)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 font-mono">
        <label className="flex items-center gap-2 text-xs text-zinc-400">Expiry<select aria-label="Exposure expiry bucket" value={selectedBucket} onChange={e => setBucket(e.target.value)} className={control}><option value="all">All buckets</option>{Object.keys(data.by_expiry || {}).sort((a, b) => +a - +b).map(key => <option key={key} value={key}>{key} DTE</option>)}</select></label>
        <label className="flex items-center gap-2 text-xs text-zinc-400">Range<select aria-label="Exposure strike range" value={range} onChange={e => setRange(e.target.value)} className={control}><option value="5">±5% spot</option><option value="10">±10% spot</option><option value="20">±20% spot</option><option value="all">All strikes</option></select></label>
        <span className="ml-auto text-xs text-zinc-400">Net in view <span className={net >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtGex(net)}</span></span>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-zinc-400"><span className="text-emerald-400">● Calls</span><span className="text-rose-400">● Puts</span><span className="text-zinc-200">― Net</span><span className="ml-auto">{unit}</span></div>
      <div className="mt-3 h-72 min-w-0" role="img" aria-label={`${metric.toUpperCase()} exposure across ${rows.length} strikes; net ${fmtGex(net)}. Spot ${price(data.spot)}. Exact values available in the table below.`}>
        {rows.length ? <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 22, right: 16, bottom: 5, left: 0 }} stackOffset="sign">
            <CartesianGrid vertical={false} stroke="#27272a" strokeDasharray="3 5" />
            <XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: "#a1a1aa", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={compact} />
            <YAxis width={55} tick={{ fill: "#a1a1aa", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={compact} />
            <Tooltip contentStyle={{ background: "#09090b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelFormatter={value => `Strike ${price(Number(value))}`} formatter={(value: number) => fmtGex(value)} />
            <ReferenceLine y={0} stroke="#52525b" />
            <ReferenceLine x={data.spot} ifOverflow="extendDomain" stroke="#22d3ee" strokeDasharray="4 4" label={{ value: "Spot", position: "top", fill: "#22d3ee", fontSize: 10 }} />
            <Bar dataKey="call" name="Calls" stackId="exposure" fill="#34d399" maxBarSize={12} isAnimationActive={false} />
            <Bar dataKey="put" name="Puts" stackId="exposure" fill="#fb7185" maxBarSize={12} isAnimationActive={false} />
            <Line dataKey="net" name="Net" stroke="#e4e4e7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer> : <p role="status" className="flex h-full items-center justify-center text-center text-sm text-zinc-400">No strikes in this range. Select a wider range or another expiry.</p>}
      </div>
      <details className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400"><summary className="cursor-pointer py-1 focus-visible:outline focus-visible:outline-cyan-400">View chart data · {rows.length} strikes</summary><div className="mt-3 max-h-64 overflow-auto" tabIndex={0} aria-label="Exposure values"><table className="w-full text-right font-mono"><thead><tr>{["Strike", "Calls", "Puts", "Net"].map(label => <th scope="col" className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.strike} className="border-t border-zinc-800"><td className="p-2">{price(row.strike)}</td><td className="p-2">{fmtGex(row.call)}</td><td className="p-2">{fmtGex(row.put)}</td><td className="p-2">{fmtGex(row.net)}</td></tr>)}</tbody></table></div></details>
    </div>
    <aside className="border-t border-zinc-800 bg-zinc-950/40 p-5 lg:border-l lg:border-t-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Crosshair size={15} className="text-cyan-400" />Key levels</h3><p className="mt-1 text-xs text-zinc-400">{selectedBucket === "all" ? "Across all expiry buckets" : `${selectedBucket} DTE bucket`} · full strike range</p>
      <dl className="mt-5 space-y-5">{levels.map(level => <div key={level.label}><dt className="text-xs text-zinc-400">{level.label}</dt><dd className="mt-1 flex flex-wrap items-baseline justify-between gap-2 font-mono"><span className={`text-xl font-medium ${level.color}`}>{price(level.value)}</span><span className="text-xs text-zinc-400">{level.value !== null ? `${level.value >= data.spot ? "+" : ""}${((level.value / data.spot - 1) * 100).toFixed(2)}%` : "Unavailable"}</span></dd></div>)}</dl>
      <p className="mt-6 border-t border-zinc-800 pt-4 text-xs leading-relaxed text-zinc-400">Distances are relative to spot. OI concentrations describe inventory; they do not guarantee support or resistance.</p>
    </aside>
  </section>;
}

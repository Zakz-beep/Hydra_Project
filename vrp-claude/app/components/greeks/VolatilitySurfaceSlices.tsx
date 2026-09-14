"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { SurfaceGrid, interpolateSmile, smileIV } from "../../lib/volatilitySurface";

const fmt = (value: number | null, suffix = "%") => value === null ? "Unavailable" : `${value.toFixed(2)}${suffix}`;
const axis = { fill: "#a1a1aa", fontSize: 10, fontFamily: "monospace" };
const tip = { background: "#09090b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 };

export default function VolatilitySurfaceSlices({ grid, spot }: { grid: SurfaceGrid; spot: number }) {
  const [expiry, setExpiry] = useState("");
  const selected = grid.smiles.find(s => s.expiry === expiry) ?? grid.smiles[0];
  const term = useMemo(() => grid.smiles.map(s => ({ expiry: s.expiry, dte: s.dte, iv: smileIV(s, spot) })), [grid.smiles, spot]);
  const slice = useMemo(() => {
    if (!selected) return [];
    const sample = interpolateSmile(selected.points.map(p => p.strike), selected.points.map(p => p.iv));
    const low = grid.x[0] ?? selected.points[0].strike, high = grid.x.at(-1) ?? selected.points.at(-1)!.strike;
    const observed = selected.points.filter(p => p.strike >= low && p.strike <= high).map(p => ({ strike: p.strike, observed: p.iv, curve: p.iv }));
    const smooth = Array.from({ length: 96 }, (_, i) => { const strike = low + (high - low) * i / 95; return { strike, curve: sample(strike), observed: null }; });
    return [...observed, ...smooth].sort((a, b) => a.strike - b.strike);
  }, [selected, grid.x]);
  if (!selected) return null;
  const atm = smileIV(selected, spot), putWing = smileIV(selected, spot * .95), callWing = smileIV(selected, spot * 1.05);
  const skew = putWing !== null && callWing !== null ? putWing - callWing : null;
  const front = term[0].iv, back = term[term.length - 1].iv;
  const spread = term.length > 1 && front !== null && back !== null ? back - front : null;
  const metrics = [
    { title: "Selected expiry ATM", value: fmt(atm), detail: selected.expiry },
    { title: "95% − 105% strike skew", value: fmt(skew, " pp"), detail: "Put-wing IV minus call-wing IV" },
    { title: "Back − front ATM", value: fmt(spread, " pp"), detail: term.length > 1 ? `${term[0].dte}D → ${term[term.length - 1].dte}D` : "Requires two expiries" },
  ];
  return <div className="space-y-4 border-t border-zinc-800 pt-5">
    <div className="grid gap-3 sm:grid-cols-3">{metrics.map(m => <div key={m.title} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3"><p className="text-[10px] font-mono uppercase tracking-wide text-zinc-400">{m.title}</p><p className="mt-2 font-mono text-xl text-cyan-300">{m.value}</p><p className="mt-1 text-xs text-zinc-400">{m.detail}</p></div>)}</div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-2">
      <section className="min-w-0"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">Expiry smile</h4><select aria-label="Smile expiry" value={selected.expiry} onChange={e => setExpiry(e.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs font-mono text-zinc-200 focus-visible:outline focus-visible:outline-cyan-400">{grid.smiles.map(s => <option key={s.expiry} value={s.expiry}>{s.expiry} · {s.dte}D</option>)}</select></div>
        <div className="h-56"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={slice} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="#27272a" vertical={false} strokeDasharray="3 4" /><XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} tick={axis} tickFormatter={v => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} /><YAxis width={42} tick={axis} domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(0)}%`} /><Tooltip contentStyle={tip} labelFormatter={v => `Strike $${Number(v).toFixed(2)}`} formatter={(v: number) => fmt(v)} /><ReferenceLine x={spot} stroke="#71717a" strokeDasharray="3 3" /><Line name="Interpolated IV" dataKey="curve" stroke="#22d3ee" dot={false} isAnimationActive={false} /><Scatter name="Observed IV (OI weighted)" dataKey="observed" fill="#fbbf24" isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div>
        <p className="mt-2 text-xs text-zinc-400"><span className="text-amber-300">● Observed IV</span> · <span className="text-cyan-300">― Interpolated curve</span> · Dashed line: spot</p>
      </section>
      <section className="min-w-0"><h4 className="mb-3 py-2 text-sm font-medium">ATM term structure</h4><div className="h-56"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={term} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="#27272a" vertical={false} strokeDasharray="3 4" /><XAxis dataKey="dte" type="number" domain={["dataMin", "dataMax"]} tick={axis} tickFormatter={v => `${v}D`} /><YAxis width={42} tick={axis} domain={["auto", "auto"]} tickFormatter={v => `${Number(v).toFixed(0)}%`} /><Tooltip contentStyle={tip} labelFormatter={v => `${v} days to expiry`} formatter={(v: number) => fmt(v)} /><Line name="ATM IV at spot" dataKey="iv" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} /></ComposedChart></ResponsiveContainer></div><p className="mt-2 text-xs text-zinc-400">ATM IV sampled at spot for each actual expiry. Missing coverage stays unavailable.</p></section>
    </div>
    <details className="text-xs text-zinc-400"><summary className="cursor-pointer py-2 focus-visible:outline focus-visible:outline-cyan-400">Read expiry values as a table</summary><div className="max-h-56 overflow-auto" tabIndex={0} aria-label="Expiry IV values"><table className="w-full text-right font-mono"><thead><tr>{["Expiry", "DTE", "ATM IV", "95% strike IV", "105% strike IV"].map(t => <th scope="col" className="p-2" key={t}>{t}</th>)}</tr></thead><tbody>{grid.smiles.map(s => <tr key={s.expiry} className="border-t border-zinc-800"><td className="p-2">{s.expiry}</td><td className="p-2">{s.dte}</td><td className="p-2">{fmt(smileIV(s, spot))}</td><td className="p-2">{fmt(smileIV(s, spot * .95))}</td><td className="p-2">{fmt(smileIV(s, spot * 1.05))}</td></tr>)}</tbody></table></div></details>
  </div>;
}

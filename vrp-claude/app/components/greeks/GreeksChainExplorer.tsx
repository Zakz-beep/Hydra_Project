"use client";

import { useMemo, useState } from "react";
import { GreeksSnapshot, fmtGex, fmtGammaExposure } from "../../lib/greeks";
import { ChainFilters, contractsCSV, filterContracts } from "../../lib/greeksExplorer";
import { actualExpiries, expiryLabel, expiryWeekday } from '../../lib/optionExpiries';

const defaults: ChainFilters = { bucket: "all", side: "all", search: "", minOI: 0, nearSpot: false, sort: "gex" };
const field = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:outline focus:outline-cyan-400";
const number = (n: number | null, digits = 2) => n != null && Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";

export default function GreeksChainExplorer({ data, onOpenContract }: { data: GreeksSnapshot; onOpenContract?: (symbol: string) => void }) {
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(0);
  const rows = useMemo(() => filterContracts(data, filters), [data, filters]);
  const pages = Math.max(1, Math.ceil(rows.length / 30));
  const currentPage = Math.min(page, pages - 1);
  const update = (patch: Partial<ChainFilters>) => { setFilters({ ...filters, ...patch }); setPage(0); };
  const exportCSV = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF", contractsCSV(data, rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${data.ticker.replace(/[^a-z0-9.-]/gi, "_")}-greeks.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="min-w-0 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Strike explorer</h3><p className="mt-1 text-xs text-zinc-400">Filter kontrak, bandingkan exposure, dan ekspor seluruh hasil filter.</p></div><button onClick={exportCSV} disabled={!rows.length} className="rounded-lg border border-cyan-800 px-3 py-2 text-xs font-mono text-cyan-300 disabled:opacity-40">Export filtered CSV</button></div>
    <div className="grid grid-cols-2 gap-3 text-xs text-zinc-400 sm:grid-cols-3 lg:grid-cols-5">
      <label>Expiry weekday<select aria-label="Chain expiry weekday" className={field} value={filters.weekday||'all'} onChange={e=>update({weekday:e.target.value,expiry:'all'})}><option value="all">All weekdays</option>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=><option key={d}>{d}</option>)}</select></label>
      <label>Actual expiry<select aria-label="Chain actual expiry" className={field} value={filters.expiry||'all'} onChange={e=>update({expiry:e.target.value})}><option value="all">All matching dates</option>{actualExpiries(data).filter(e=>!filters.weekday||filters.weekday==='all'||expiryWeekday(e)===filters.weekday).map(e=><option key={e} value={e}>{expiryLabel(e)}</option>)}</select></label>
      <label>Strike / expiry<input aria-label="Search strike or expiry" className={field} placeholder="700 / 2026-09" value={filters.search} onChange={e => update({ search: e.target.value })} /></label>
      <label>DTE bucket<select className={field} value={filters.bucket} onChange={e => update({ bucket: e.target.value })}><option value="all">All buckets</option>{Object.keys(data.by_expiry || {}).sort((a, b) => +a - +b).map(b => <option key={b} value={b}>{b} DTE bucket</option>)}</select></label>
      <label>Option type<select className={field} value={filters.side} onChange={e => update({ side: e.target.value })}><option value="all">Calls & puts</option><option value="call">Calls</option><option value="put">Puts</option></select></label>
      <label>Minimum OI<input className={field} type="number" min="0" value={filters.minOI} onChange={e => update({ minOI: Math.max(0, Number(e.target.value) || 0) })} /></label>
      <label>Sort by<select className={field} value={filters.sort} onChange={e => update({ sort: e.target.value as ChainFilters["sort"] })}><option value="gex">Largest absolute GEX</option><option value="oi">Highest OI</option><option value="strike">Strike ascending</option></select></label>
    </div>
    <div className="flex flex-wrap justify-between gap-3 text-xs text-zinc-300"><label className="flex items-center gap-2"><input type="checkbox" checked={filters.nearSpot} onChange={e => update({ nearSpot: e.target.checked })} />Within ±10% of spot</label><button className="text-zinc-400 underline" onClick={() => { setFilters(defaults); setPage(0); }}>Reset filters</button></div>
    <div className="overflow-x-auto rounded-lg border border-zinc-800" tabIndex={0} aria-label="Options contract table, scroll horizontally for all Greeks">
      <table className="w-full whitespace-nowrap text-right text-xs font-mono"><caption className="sr-only">Options contracts for {data.ticker}. IV is percentage; GEX is dollars per 1% spot move.</caption><thead className="bg-zinc-950 text-zinc-400"><tr>{["Workspace", "Expiry", "Type", "Strike", "OI", "Volume", "IV %", "Delta", "Gamma", "GEX / 1% move", "Vanna exp.", "Charm exp."].map(c => <th key={c} scope="col" className="px-3 py-3 font-medium">{c}</th>)}</tr></thead><tbody>
        {rows.slice(currentPage * 30, (currentPage + 1) * 30).map(s => <tr key={`${s.expiry}-${s.option_type}-${s.strike}`} className="border-t border-zinc-800 text-zinc-300 hover:bg-zinc-800/50"><td className="px-3 py-3"><button disabled={!s.contract_symbol || !onOpenContract} onClick={() => s.contract_symbol && onOpenContract?.(s.contract_symbol)} aria-label={`Open contract ${s.contract_symbol || s.strike}`} className="rounded border border-cyan-800 px-2 py-1 text-cyan-300 hover:bg-cyan-950 disabled:opacity-30">Open ↗</button></td><td className="px-3 py-3">{s.expiry}</td><td className={`px-3 py-3 ${s.option_type === "call" ? "text-emerald-400" : "text-red-400"}`}>{s.option_type}</td><td className="px-3 py-3 text-zinc-100">{number(s.strike)}</td><td className="px-3 py-3">{number(s.oi, 0)}</td><td className="px-3 py-3">{number(s.volume, 0)}</td><td className="px-3 py-3">{number(s.iv * 100)}</td><td className="px-3 py-3">{number(s.delta, 4)}</td><td className="px-3 py-3">{number(s.gamma, 6)}</td><td className="px-3 py-3">{fmtGammaExposure(s.gex_spotgamma)}</td><td className="px-3 py-3">{fmtGex(s.vanna_exp)}</td><td className="px-3 py-3">{fmtGex(s.charm_exp)}</td></tr>)}
        {!rows.length && <tr><td colSpan={12} className="p-8 text-center text-zinc-400">Tidak ada kontrak yang cocok. Kurangi filter atau pilih expiry lain.</td></tr>}
      </tbody></table>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-zinc-400"><span aria-live="polite">{rows.length.toLocaleString()} contracts · Page {currentPage + 1}/{pages}</span><div className="flex gap-2"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="rounded border border-zinc-700 px-3 py-2 disabled:opacity-40">Previous</button><button disabled={currentPage >= pages - 1} onClick={() => setPage(currentPage + 1)} className="rounded border border-zinc-700 px-3 py-2 disabled:opacity-40">Next</button></div></div>
  </section>;
}


'use client';

import { useEffect, useState } from 'react';
import { OptionsProvenance } from '../../lib/greeks';

interface Activity { contract_symbol: string; strike: number; expiry: string; option_type: string; volume: number; oi: number; oi_date: string; ratio: number; mid_price: number; premium: number }
interface Result { ticker: string; count: number; activities: Activity[]; provenance: OptionsProvenance; flow_basis: string; premium_basis: string }
const field = 'rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus-visible:outline focus-visible:outline-cyan-400';
export default function UnusualOptions({ ticker }: { ticker: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [minVolume, setMinVolume] = useState(100);
  const [minRatio, setMinRatio] = useState(1.5);
  const [side, setSide] = useState('ALL');
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState({ volume: 100, ratio: 1.5 });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    setLoading(true); setError(''); setResult(null);
    const query = new URLSearchParams({ ticker, min_volume: String(request.volume), vol_oi_ratio: String(request.ratio) });
    fetch(`/api/greeks/unusual-activity?${query}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Options activity unavailable.');
      return body;
    }).then(data => { if (active) setResult(data); }).catch(err => { if (active) setError(controller.signal.aborted ? 'Request melewati 90 detik. Coba Apply filters lagi.' : err.message); })
      .finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [ticker, request, attempt]);
  const rows = result?.activities.filter(a => side === 'ALL' || a.option_type === side) || [];
  return <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-6">
    <div><p className="text-[10px] tracking-widest text-cyan-400">ALPACA / VOLUME–OI RESEARCH</p><h3 className="mt-2 text-lg text-zinc-100">Unusual activity, with evidence</h3><p className="mt-2 text-xs leading-relaxed text-zinc-400">Volume tinggi dibanding OI menunjukkan aktivitas relatif besar. Data agregat tidak membuktikan buy/sell, pembukaan posisi, institutional sweep, atau arah bull/bear.</p></div>
    <form className="flex flex-wrap items-end gap-3 text-xs text-zinc-400" onSubmit={e => { e.preventDefault(); setRequest({ volume: minVolume, ratio: minRatio }); setAttempt(a => a + 1); }}>
      <label className="grid gap-2">Minimum volume<input className={field} aria-label="Minimum option volume" type="number" min={0} value={minVolume} onChange={e => setMinVolume(Number(e.target.value))} required /></label>
      <label className="grid gap-2">Minimum volume / OI<input className={field} aria-label="Minimum volume OI ratio" type="number" min={0} step={0.1} value={minRatio} onChange={e => setMinRatio(Number(e.target.value))} required /></label>
      <label className="grid gap-2">Contract side<select className={field} value={side} onChange={e => setSide(e.target.value)}><option value="ALL">Calls + puts</option><option value="CALL">Calls</option><option value="PUT">Puts</option></select></label>
      <button className={`${field} border-cyan-800 text-cyan-300 disabled:opacity-50`} disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
    </form>
    {loading && <p role="status" className="text-sm text-zinc-400">Loading captured option volume and dated OI…</p>}
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    {result && <><div className="rounded-lg border border-amber-900/70 bg-amber-950/10 p-3 text-xs leading-relaxed text-amber-200"><p>{result.provenance?.feed} · Volume date {result.provenance?.volume_date || 'unavailable'} · Coverage {result.provenance?.volume_covered ?? 0} / {result.provenance?.eligible_contracts ?? '—'} eligible contracts.</p><p className="mt-1">{result.premium_basis}</p></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-right text-xs"><thead className="text-zinc-400"><tr>{['Expiry', 'Side', 'Strike', 'Volume', 'OI', 'OI date', 'Vol/OI', 'Notional proxy'].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(a => <tr key={a.contract_symbol || `${a.expiry}-${a.option_type}-${a.strike}`} className="border-t border-zinc-800 text-zinc-200"><td className="p-3">{a.expiry}</td><td className="p-3">{a.option_type}</td><td className="p-3">{a.strike}</td><td className="p-3">{a.volume.toLocaleString()}</td><td className="p-3">{a.oi.toLocaleString()}</td><td className="p-3">{a.oi_date || '—'}</td><td className="p-3 text-cyan-300">{a.ratio.toFixed(2)}×</td><td className="p-3">${a.premium.toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="p-6 text-center text-sm text-zinc-400">Tidak ada kontrak yang lolos filter pada volume yang tersedia. Coverage yang hilang bukan volume nol.</p>}
      <p className="text-xs text-zinc-500">Showing {rows.length} of {result.count} matches (maximum 100), ranked by Volume/OI. OI and volume may refer to different dates.</p></>}
  </section>;
}

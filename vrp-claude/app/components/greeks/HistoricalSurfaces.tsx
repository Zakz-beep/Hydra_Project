"use client";

import { useEffect, useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Layers3 } from 'lucide-react';
import { downloadResearch, HistoricalDay, HistoricalSurfaceLevels, HistoryParameters, marketdata } from '../../lib/marketdataHistory';
import { historicalDTE, historicalExpiries, historicalSurface } from '../../lib/historicalSurface';
import VolatilityTermStructure from './VolatilityTermStructure';

const field = 'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-200 focus-visible:outline focus-visible:outline-cyan-400';
const panel = 'min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3';
const number = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('en-US', {maximumFractionDigits: 2});
const compact = (v: number) => new Intl.NumberFormat('en-US', {notation: 'compact', maximumFractionDigits: 2}).format(v);
const colors = {call_wall: '#4ade80', put_wall: '#fb7185', gamma_flip: '#22d3ee', max_pain: '#c084fc'};
const names = {call_wall: 'Call wall', put_wall: 'Put wall', gamma_flip: 'Gamma flip', max_pain: 'Max pain'};

export default function HistoricalSurfaces({day, parameters}: {day: HistoricalDay; parameters: HistoryParameters}) {
  const [horizon, setHorizon] = useState<number | null>(null);
  const [weekday, setWeekday] = useState('');
  const [expiry, setExpiry] = useState('');
  const [range, setRange] = useState(15);
  const [response, setResponse] = useState<{key: string; data: HistoricalSurfaceLevels} | null>(null);
  const [failure, setFailure] = useState<{key: string; message: string} | null>(null);
  const available = useMemo(() => historicalExpiries(day, horizon, weekday), [day, horizon, weekday]);
  const selected = useMemo(() => expiry && available.includes(expiry) ? [expiry] : available, [expiry, available]);
  const request = useMemo(() => ({...parameters, start: day.date, end: day.date,
    captured_at: day.captured_at, expiries: selected}), [parameters, day.date, day.captured_at, selected]);
  const key = JSON.stringify(request);
  const data = response?.key === key ? response.data : null;
  const error = failure?.key === key ? failure.message : '';
  const surface = useMemo(() => historicalSurface(day, parameters.ticker, selected), [day, parameters.ticker, selected]);
  useEffect(() => {
    if (!selected.length || !surface) return;
    const controller = new AbortController();
    marketdata<HistoricalSurfaceLevels>('surface-levels', request, 'POST', controller.signal)
      .then(value => {if (!controller.signal.aborted) setResponse({key, data: value});})
      .catch(e => {if (!controller.signal.aborted) setFailure({key, message: e.message});});
    return () => controller.abort();
  }, [key, request, selected.length, surface]);

  const spot = day.spot;
  const profile = (data?.profile || []).filter(p => !range || spot == null || Math.abs(p.strike / spot - 1) <= range / 100);
  const chartLevels = data ? (Object.keys(colors) as (keyof typeof colors)[]).flatMap(k =>
    data.levels[k] == null ? [] : [{key: k, value: data.levels[k]!, color: colors[k], label: names[k]}]) : [];
  const xs = [...profile.map(p => p.strike), ...chartLevels.map(l => l.value), ...(spot == null ? [] : [spot])];
  const min = Math.min(...xs), max = Math.max(...xs), padding = Math.max((max - min) * .035, (spot || 1) * .005);
  const empty = !selected.length || !surface;

  return <div className="min-w-0 space-y-4" data-testid="historical-surfaces">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><Layers3 size={16} className="text-cyan-400"/>Historical Surfaces <span className="font-mono text-cyan-300">{day.date}</span></h3>
        <p className="mt-1 text-xs text-zinc-400">{parameters.ticker} · EOD spot <span className="font-mono text-zinc-200">${number(spot)}</span> · {selected.length} actual expiries · {data ? data.contracts_used.toLocaleString() : '—'} contracts</p>
        <p className="mt-1 text-[11px] text-zinc-500">Archived MarketData quotes · IV & Greeks reconstructed with BSM</p></div>
      <button disabled={!data} className={`${field} inline-flex items-center gap-2 disabled:opacity-40`} onClick={() => data && downloadResearch(data, `${parameters.ticker}-${day.date}-surface-levels.json`)}><Download size={12}/>Export selected levels</button>
    </div>

    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
      <span className="px-1 text-[10px] uppercase tracking-wider text-zinc-500">Expiry scope</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Historical surface DTE">
        {[null, 0, 7, 14, 30, 60, 90].map(n => <button key={n ?? 'all'} aria-pressed={horizon === n} onClick={() => {setHorizon(n); setExpiry('');}}
          className={`rounded px-2.5 py-2 font-mono text-[11px] focus-visible:outline focus-visible:outline-cyan-400 ${horizon === n ? 'bg-cyan-950 text-cyan-200 ring-1 ring-cyan-800' : 'text-zinc-400 hover:bg-zinc-800'}`}>{n === null ? 'All DTE' : n === 0 ? '0 DTE' : `≤${n} DTE`}</button>)}
      </div>
      <select aria-label="Surface historical weekday" className={field} value={weekday} onChange={e => {setWeekday(e.target.value); setExpiry('');}}><option value="">All weekdays</option>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map((d,i) => <option key={d} value={i+1}>{d}</option>)}</select>
      <select aria-label="Surface historical expiry" className={field} value={available.includes(expiry) ? expiry : ''} onChange={e => setExpiry(e.target.value)}><option value="">All matching expiries</option>{available.map(e => <option key={e} value={e}>{e} · {historicalDTE(day.date,e)} DTE</option>)}</select>
    </div>
    <p className="text-[11px] leading-relaxed text-zinc-500">DTE dihitung dari {day.date}, dalam universe Run analysis ({parameters.min_dte}–{parameters.max_dte} DTE). Filter tanggal berlaku untuk seluruh panel di bawah. IV side/OI di panel 3D hanya mengubah visualisasi IV.</p>
    {empty ? <div role="status" className={`${panel} py-8 text-center text-sm text-amber-200`}>Tidak ada kontrak historis yang lolos untuk pilihan ini. 0DTE yang sudah expired saat EOD tidak direkonstruksi. Pilih All DTE atau expiry lain.</div> : <>
      {error && <p role="alert" className="rounded-lg border border-red-900 p-3 text-xs text-red-300">{error}</p>}
      {!data && !error && <p role="status" className="text-xs text-cyan-300">Menghitung level dari kontrak historis terpilih…</p>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5" aria-label="Historical surface levels">
        <div className={panel}><p className="text-[10px] uppercase tracking-wide text-zinc-500">Net GEX · USD / 1%</p><p className={`mt-2 font-mono text-xl ${data?.levels.gex == null ? 'text-zinc-300' : data.levels.gex >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{data?.levels.gex == null ? '—' : compact(data.levels.gex)}</p><p className="mt-1 text-[10px] text-zinc-500">Call-positive / put-negative</p></div>
        {(Object.keys(colors) as (keyof typeof colors)[]).map(k => <div className={panel} key={k}><p className="text-[10px] uppercase tracking-wide text-zinc-500">{names[k]}</p><p className="mt-2 font-mono text-xl" style={{color: colors[k]}}>{number(data?.levels[k])}</p><p className="mt-1 text-[10px] text-zinc-500">{k === 'gamma_flip' ? data && data.levels.gamma_flip == null ? 'No crossing in 50–150% spot' : 'Nearest frozen-IV crossing' : k === 'max_pain' ? selected.length > 1 ? 'Select one settlement date' : 'Fixed-OI payout minimum' : 'Maximum side GEX strike'}</p></div>)}
      </div>
      <section className={panel}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-medium text-zinc-200">GEX by strike · historical walls & flip</h4><select aria-label="Historical GEX strike range" className={field} value={range} onChange={e => setRange(Number(e.target.value))}>{[5,15,30,0].map(n => <option key={n} value={n}>{n ? `±${n}% of spot` : 'All strikes'}</option>)}</select></div>
        {data && profile.length ? <div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={profile} barGap={0} margin={{top: 60, right: 12, bottom: 4, left: 0}}>
          <CartesianGrid stroke="#27272a" vertical={false}/><XAxis type="number" dataKey="strike" domain={[min-padding,max+padding]} tick={{fill:'#a1a1aa',fontSize:10}} tickFormatter={number}/><YAxis width={65} tick={{fill:'#a1a1aa',fontSize:10}} tickFormatter={compact}/>
          <Tooltip contentStyle={{background:'#09090b',border:'1px solid #3f3f46',fontSize:11}} formatter={(v: number) => `$${number(v)} / 1%`} labelFormatter={v => `Strike $${number(Number(v))}`}/><Legend wrapperStyle={{fontSize:10}}/>
          <ReferenceLine y={0} stroke="#52525b"/>
          <Bar dataKey="call" name="Call GEX" fill="#4ade80" barSize={2} isAnimationActive={false}/><Bar dataKey="put" name="Put GEX" fill="#fb7185" barSize={2} isAnimationActive={false}/><Line dataKey="net" name="Net GEX" stroke="#facc15" strokeWidth={1.7} dot={false} isAnimationActive={false}/>
          {spot != null && <ReferenceLine x={spot} stroke="#e4e4e7" strokeDasharray="4 4" label={{value:`Spot ${number(spot)}`,fill:'#e4e4e7',fontSize:9,position:'insideBottomRight'}}/>}
          {chartLevels.map((l,i) => <ReferenceLine key={l.key} x={l.value} stroke={l.color} strokeDasharray="3 3" label={{value:`${l.label} ${number(l.value)}`,fill:l.color,fontSize:9,position:'insideTopRight',dy:-53+i*13}}/>)}
        </ComposedChart></ResponsiveContainer></div> : <p className="py-12 text-center text-xs text-zinc-500">{data ? 'No strikes in display range. Select All strikes.' : 'Historical GEX profile unavailable while levels load.'}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">Walls dan gamma flip dihitung pada seluruh expiry terpilih sebelum strike chart dipotong. GEX adalah exposure model; bukan posisi dealer yang terobservasi.</p>
      </section>
      {surface && <VolatilityTermStructure data={surface} scopeKey={key}/>}
      {data && <details className={panel}><summary className="cursor-pointer text-xs text-zinc-300">Levels per actual expiry · {data.expiries.length} dates</summary><div className="mt-3 overflow-x-auto"><table className="w-full whitespace-nowrap text-left font-mono text-xs"><thead className="text-zinc-500"><tr>{['Expiry','DTE','Net GEX $/1%','Call wall','Put wall','Max pain','OI-weighted IV'].map(s => <th key={s} className="p-2 font-normal">{s}</th>)}</tr></thead><tbody>{data.expiries.map(e => <tr key={e.expiry} className="border-t border-zinc-800 text-zinc-300"><td className="p-2"><button className="text-cyan-300 underline decoration-cyan-900 underline-offset-4" onClick={() => setExpiry(e.expiry)}>{e.expiry}</button></td><td className="p-2">{historicalDTE(day.date,e.expiry)}</td><td className="p-2">{e.gex == null ? '—' : compact(e.gex)}</td><td className="p-2">{number(e.call_wall)}</td><td className="p-2">{number(e.put_wall)}</td><td className="p-2">{number(e.max_pain)}</td><td className="p-2">{e.mean_iv == null ? '—' : `${(e.mean_iv*100).toFixed(2)}%`}</td></tr>)}</tbody></table></div></details>}
    </>}
    <details className={`${panel} text-[11px] leading-relaxed text-zinc-500`}><summary className="cursor-pointer text-zinc-400">Historical data & model provenance</summary><p className="mt-2 break-words">Reference session {day.date} · captured {day.captured_at}. IV points are BSM reconstructions of archived EOD bid/ask midpoints, not native historical Greeks. r {(parameters.rate*100).toFixed(2)}%, q {(parameters.dividend_yield*100).toFixed(2)}%; same common spot and model inputs as chain replay. EOD 0DTE is excluded. OI reflects preceding settlement; exact OI capture time is unavailable. Missing roots remain empty and max pain requires one expiry. Shared-strike interpolation does not create additional observed data.</p></details>
  </div>;
}

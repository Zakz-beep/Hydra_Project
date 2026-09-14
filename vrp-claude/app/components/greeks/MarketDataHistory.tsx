"use client";

import { useEffect, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, History, Play, RefreshCw, Square } from 'lucide-react';
import { downloadResearch, HistoricalDay, HistoryAnalysis, HistoryParameters, HistoryStatus, ImportJob, marketdata } from '../../lib/marketdataHistory';
import HistoricalSurfaces from './HistoricalSurfaces';

const field = 'mt-1 w-full min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none';
const button = 'inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40';
const panel = 'min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4';
const fmt = (v: number | null | undefined, digits = 2) => v == null ? '—' : v.toLocaleString('en-US', {maximumFractionDigits: digits});
const pct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(2)}%`;
const compact = (v: number) => new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:1}).format(v);
const running = (j: ImportJob | null) => !!j && ['queued','running'].includes(j.state);
function initial(ticker: string): HistoryParameters {
  const day = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const end = new Date(`${day}T12:00:00Z`); end.setUTCDate(end.getUTCDate()-1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate()-7);
  return {ticker,start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),min_dte:1,max_dte:45,
    weekday:null,rate:.04,dividend_yield:0,min_oi:10,max_spread_pct:50,min_coverage:.5,min_contracts:20,rule:'positive_gex',cost_bps:5};
}

export default function MarketDataHistory({ticker, view}: {ticker:string;view:'History'|'Backtest'}) {
  const [params, setParams] = useState(() => initial(ticker));
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [result, setResult] = useState<HistoryAnalysis | null>(null);
  const [replay, setReplay] = useState<HistoricalDay | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [replayBusy, setReplayBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const analysisAbort = useRef<AbortController | null>(null);
  const [metric, setMetric] = useState('gex');
  const [replayView, setReplayView] = useState<'surfaces'|'contracts'>('surfaces');
  useEffect(() => { mounted.current=true; return () => {mounted.current=false; analysisAbort.current?.abort();}; }, []);
  useEffect(() => {
    const controller = new AbortController();
    marketdata<HistoryStatus>(`status?ticker=${encodeURIComponent(ticker)}`, undefined, 'GET', controller.signal)
      .then(s => {setStatus(s); setJob(s.jobs.find(running) || s.jobs.at(-1) || null);})
      .catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [ticker]);
  useEffect(() => {
    if (!job || !running(job)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => marketdata<ImportJob>(`imports/${job.id}`,undefined,'GET',controller.signal)
      .then(j => {setJob(j); if (!running(j)) return marketdata<HistoryStatus>(`status?ticker=${encodeURIComponent(ticker)}`,undefined,'GET',controller.signal).then(setStatus);})
      .catch(e => {if (!controller.signal.aborted) {setError(`${e.message} Refresh konfigurasi untuk memeriksa import; arsip tersimpan tetap tersedia.`);setJob(null);}}),1500);
    return () => {clearTimeout(timer);controller.abort();};
  }, [job,ticker]);
  useEffect(() => {
    setReplay(null);
    if (!selected || !result) return;
    const controller = new AbortController(); setReplayBusy(true);
    marketdata<HistoricalDay>('replay', {...result.parameters,start:selected,end:selected}, 'POST', controller.signal)
      .then(setReplay).catch(e => {if (!controller.signal.aborted) setError(e.message);})
      .finally(() => {if (!controller.signal.aborted) setReplayBusy(false);});
    return () => controller.abort();
  }, [selected,result]);
  async function action(kind: 'import'|'analyze'|'status'|'cancel') {
    setError('');setBusy(true);
    const controller=new AbortController(); analysisAbort.current=controller;
    try {
      if (kind==='import') {
        const j=await marketdata<ImportJob>('imports',{ticker,start:params.start,end:params.end,max_dte:params.max_dte},'POST',controller.signal);
        if (mounted.current) setJob(j);
      } else if (kind==='analyze') {
        const r=await marketdata<HistoryAnalysis>('analysis',params,'POST',controller.signal);
        if (mounted.current) {setResult(r);setSelected(r.days.at(-1)?.date || '');}
      } else if (kind==='status') {
        const s=await marketdata<HistoryStatus>(`status?ticker=${encodeURIComponent(ticker)}`,undefined,'GET',controller.signal);
        if (mounted.current) {setStatus(s);setJob(s.jobs.find(running) || s.jobs.at(-1) || null);}
      } else if (job) {
        const j=await marketdata<ImportJob>(`imports/${job.id}`,undefined,'DELETE',controller.signal);
        if (mounted.current) setJob(j);
      }
    } catch(e) {if (mounted.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Request failed');}
    finally {if (mounted.current) setBusy(false);}
  }
  const dirty = !!result && Object.entries(params).some(([key,value]) => result.parameters[key as keyof HistoryParameters] !== value);
  const numeric = (key: keyof HistoryParameters, label:string, min:number, max:number, scale=1, step=1) => <label className="text-xs text-zinc-400">{label}<input aria-label={label} type="number" min={min} max={max} step={step} className={field} value={Number(params[key])*scale} onChange={e => setParams({...params,[key]:Number(e.target.value)/scale})}/></label>;
  const chartDays = result ? [...result.days, ...result.gaps.map(g => ({date:g.date}))].sort((a,b)=>a.date.localeCompare(b.date)) : [];
  return <div className="min-w-0 space-y-4">
    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><History size={16} className="text-cyan-400"/>Historical Greeks Lab <span className="rounded border border-cyan-900 px-2 py-0.5 text-[10px] font-normal text-cyan-400">MARKETDATA · EOD</span></div><p className="mt-1 text-xs text-zinc-400">Replay exposure historis, lalu uji respons sesi berikutnya.</p></div>
        <button className={button} disabled={busy} onClick={()=>action('status')}><RefreshCw size={12}/>{status ? status.configured ? 'Token configured' : 'Token belum diisi' : 'Memeriksa konfigurasi…'}</button>
      </div>
      {status && !status.configured && <p className="mb-4 rounded-md border border-amber-900/60 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">Isi <code>MARKETDATA_API_TOKEN</code> di <code className="break-all">python/.env.marketdata</code>, lalu refresh konfigurasi. Token tetap di server. Arsip lokal tetap bisa dianalisis tanpa token.</p>}
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4 xl:grid-cols-6">
        <label className="text-xs text-zinc-400">Dari<input aria-label="History start date" className={field} type="date" value={params.start} onChange={e=>setParams({...params,start:e.target.value})}/></label>
        <label className="text-xs text-zinc-400">Sampai<input aria-label="History end date" className={field} type="date" value={params.end} onChange={e=>setParams({...params,end:e.target.value})}/></label>
        {numeric('max_dte','Expiry hingga DTE',1,90)}
        <button className={button} disabled={busy||running(job)||!status?.configured} onClick={()=>action('import')}><Download size={13}/>Import / resume</button>
        <button className={`${button} border-cyan-700 bg-cyan-950/40 text-cyan-200`} disabled={busy||running(job)} onClick={()=>action('analyze')}><Play size={13}/>{busy ? 'Memproses…' : 'Run analysis'}</button>
        <span className="text-xs text-zinc-500">{status ? new Set(status.dates.map(d=>d.day)).size : '—'} tanggal tersimpan</span>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">Maksimum 90 hari kalender per impor. Import memakai kredit API: satu request candle + chain per sesi yang belum tersimpan; biaya kredit tergantung jumlah kontrak dan paket. Run analysis hanya membaca arsip lokal.</p>
      {!!status?.dates.length && <details className="mt-3"><summary className="cursor-pointer text-xs text-cyan-300">Arsip tersedia · pilih tanggal & scope tersimpan</summary><div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">{status.dates.map(d=><button key={`${d.day}-${d.scope}`} className={button} onClick={()=>setParams(p=>({...p,start:d.day,end:d.day,max_dte:d.scope,min_dte:Math.min(p.min_dte,d.scope)}))}>{d.day} · ≤{d.scope} DTE</button>)}</div></details>}
      {job && <div role="status" className="mt-3 rounded-md bg-zinc-900 p-3 text-xs text-zinc-300"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono">{job.state.toUpperCase()} · {job.completed}/{job.total} sesi · {job.requests} requests {job.current_date && `· ${job.current_date}`}</span>{running(job) && <button className={button} disabled={busy||job.cancel_requested} onClick={()=>action('cancel')}><Square size={10}/>{job.cancel_requested?'Menghentikan…':'Stop import'}</button>}</div><progress aria-label="Import progress" className="mt-2 h-1 w-full accent-cyan-500" max={Math.max(job.total,1)} value={job.completed}/>{job.error && <p className="mt-2 text-amber-300">{job.error}</p>}</div>}
      {job?.latest_available && <button className={`${button} mt-3 border-amber-800 text-amber-200`} onClick={()=>{const end=job.latest_available!;setParams(p=>({...p,end,start:p.start>end?end:p.start}));}}>Gunakan tanggal tersedia · {job.latest_available}</button>}
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">Akses historical-only: options sesi terakhir baru tersedia setelah pembukaan sesi bursa berikutnya. Data Jumat bisa belum dapat diimpor saat akhir pekan; ini berbeda dari jadwal candle saham.</p>
      <details className="mt-4 border-t border-zinc-800 pt-3"><summary className="cursor-pointer text-xs text-zinc-300">Parameter model & kualitas · r {pct(params.rate)} · q {pct(params.dividend_yield)} · {params.min_dte}–{params.max_dte} DTE</summary>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {numeric('rate','Assumed rate (%)',-5,50,100,.1)}{numeric('dividend_yield','Dividend yield (%)',0,50,100,.1)}{numeric('min_dte','Minimum DTE',0,90)}
          <label className="text-xs text-zinc-400">Expiry weekday<select aria-label="Historical expiry weekday" className={field} value={params.weekday??''} onChange={e=>setParams({...params,weekday:e.target.value===''?null:Number(e.target.value)})}><option value="">All weekdays</option>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label>
          {numeric('min_oi','Minimum OI',1,1000000)}{numeric('max_spread_pct','Maximum spread / mid (%)',.1,200,1,.1)}{numeric('min_coverage','Minimum OI coverage (%)',0,100,100,1)}{numeric('min_contracts','Minimum modeled contracts',1,50000)}
        </div><p className="mt-3 text-xs leading-relaxed text-zinc-500">IV & Greeks direkonstruksi dari midpoint bid/ask. r dan q adalah asumsi konstan, bukan data bunga historis. OI coverage dihitung dalam universe yang lolos filter identitas/expiry/minimum OI. Kontrak 0DTE yang sudah kedaluwarsa saat EOD dikeluarkan.</p>
      </details>
      {view==='Backtest' && <div className="mt-4 grid grid-cols-1 gap-3 border-t border-zinc-800 pt-3 sm:grid-cols-2"><label className="text-xs text-zinc-400">Aturan long / cash<select aria-label="Backtest rule" className={field} value={params.rule} onChange={e=>setParams({...params,rule:e.target.value as HistoryParameters['rule']})}><option value="positive_gex">Long saat GEX positif</option><option value="negative_gex">Long saat GEX negatif</option><option value="above_flip">Long saat spot di atas gamma flip</option></select></label>{numeric('cost_bps','Round-trip cost (bps)',0,100,1,.5)}</div>}
    </section>
    {error && <div role="alert" className="rounded-lg border border-red-900 p-3 text-sm text-red-300">{error}</div>}
    {dirty && <p role="status" className="text-xs text-amber-300">Parameter berubah. Hasil di bawah masih memakai parameter Run analysis terakhir.</p>}
    {!result && <div className={`${panel} py-12 text-center`}><History className="mx-auto mb-3 text-zinc-600" size={28}/><p className="text-sm text-zinc-300">Mulai dari arsip historis {ticker}</p><p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-zinc-500">Pilih rentang tanggal, import data, kemudian Run analysis. History menampilkan chain EOD dan level per expiry. Backtest memakai sinyal penutupan untuk entry di pembukaan sesi berikutnya.</p></div>}
    {result && <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"><span>{result.days.length}/{result.requested_sessions} sesi tersimpan · {result.gaps.length} gap · {result.parameters.start} → {result.parameters.end}</span><button className={button} onClick={()=>downloadResearch(result,`${ticker}-marketdata-research.json`)}><Download size={12}/>Export research JSON</button></div>
      {!result.days.length ? <div className={`${panel} py-8 text-center text-sm text-zinc-400`}>Belum ada chain tersimpan untuk rentang dan scope expiry ini. Import data terlebih dahulu; {result.gaps.length} sesi yang kosong tidak dihitung sebagai exposure nol.</div> : view==='History' ? <>
        <section className={panel}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm text-zinc-200">Exposure timeline</h3><select aria-label="Historical exposure metric" className="rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-300" value={metric} onChange={e=>setMetric(e.target.value)}><option value="gex">GEX · USD / 1% move</option><option value="vanna_exposure">Vanna · delta units / unit IV</option><option value="charm_exposure">Charm · delta units / day</option></select></div><ResearchChart data={chartDays} lines={[{key:metric,color:'#22d3ee',name:metric==='gex'?'Net GEX':metric,bar:true}]}/></section>
        <section className={panel}><h3 className="mb-3 text-sm text-zinc-200">Spot & historical levels</h3><ResearchChart data={chartDays} lines={[{key:'spot',name:'Spot',color:'#fafafa'},{key:'gamma_flip',name:'Gamma flip',color:'#22d3ee'},{key:'call_wall',name:'Call wall',color:'#4ade80'},{key:'put_wall',name:'Put wall',color:'#fb7185'}]}/></section>
        <section className={panel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Historical replay view">{(['surfaces','contracts'] as const).map(v=><button key={v} aria-pressed={replayView===v} className={`${button} ${replayView===v?'border-cyan-800 bg-cyan-950/40 text-cyan-200':''}`} onClick={()=>setReplayView(v)}>{v==='surfaces'?'Historical Surfaces':'Contracts & data'}</button>)}</div>
            <div className="flex items-center gap-1">
              <button aria-label="Previous historical session" className={button} disabled={result.days.findIndex(d=>d.date===selected)<=0} onClick={()=>setSelected(result.days[result.days.findIndex(d=>d.date===selected)-1].date)}>←</button>
              <select aria-label="Replay date" className="min-w-0 rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-100" value={selected} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Pilih tanggal</option>{result.days.map(d=><option key={d.date}>{d.date}</option>)}</select>
              <button aria-label="Next historical session" className={button} disabled={result.days.findIndex(d=>d.date===selected)>=result.days.length-1} onClick={()=>setSelected(result.days[result.days.findIndex(d=>d.date===selected)+1].date)}>→</button>
            </div>
          </div>
          {replayBusy?<p role="status" className="text-xs text-zinc-400">Rekonstruksi chain…</p>:replay?(replayView==='surfaces'?<HistoricalSurfaces day={replay} parameters={result.parameters}/>:<Replay day={replay}/>):<p className="text-xs text-zinc-500">Belum ada tanggal yang dapat direplay.</p>}
        </section>
      </> : <BacktestResult result={result}/>}
      <details className={panel}><summary className="cursor-pointer text-xs text-zinc-300">Metodologi, gaps & reproducibility</summary><ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-zinc-400">{result.methodology.map(m=><li key={m}>{m}</li>)}</ul><p className="mt-3 break-all font-mono text-[11px] text-zinc-500">Model: {result.model_version} · Missing sessions: {result.gaps.map(g=>g.date).join(', ')||'none'}</p></details>
    </>}
  </div>;
}

function ResearchChart({data,lines}:{data:object[];lines:{key:string;name:string;color:string;bar?:boolean}[]}) {
  const bars=lines.some(l=>l.bar);
  const equity=lines.some(l=>l.key==='equity');
  return <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{left:0,right:8,top:8,bottom:0}}><CartesianGrid stroke="#27272a" vertical={false}/><XAxis dataKey="date" tick={{fill:'#a1a1aa',fontSize:10}} minTickGap={35}/><YAxis tickFormatter={equity ? (v:number)=>v.toFixed(3) : compact} tick={{fill:'#a1a1aa',fontSize:10}} width={60} domain={bars ? [(v:number)=>Math.min(0,v),(v:number)=>Math.max(0,v)] : ['auto','auto']}/><Tooltip contentStyle={{background:'#09090b',border:'1px solid #3f3f46',fontSize:11}} formatter={(v:number)=>fmt(v,4)}/><Legend wrapperStyle={{fontSize:11}}/>{bars && <ReferenceLine y={0} stroke="#52525b"/>}{lines.map(l=>l.bar?<Bar key={l.key} dataKey={l.key} name={l.name} fill={l.color} isAnimationActive={false}/>:<Line key={l.key} dataKey={l.key} name={l.name} stroke={l.color} type="linear" strokeWidth={1.7} dot={data.length<3} connectNulls={false} isAnimationActive={false}/>)}</ComposedChart></ResponsiveContainer></div>;
}

function Stat({label,value}:{label:string;value:string}) {return <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p><p className="mt-1 font-mono text-lg text-zinc-100">{value}</p></div>;}
function Replay({day}:{day:HistoricalDay}) {
  const [expiry,setExpiry]=useState('');
  useEffect(()=>setExpiry(''),[day.date]);
  const contracts=(day.contracts||[]).filter(c=>!expiry||c.expiry===expiry);
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Stat label="Net GEX · USD / 1%" value={day.gex==null?'—':compact(day.gex)}/><Stat label="Gamma flip" value={fmt(day.gamma_flip)}/><Stat label="Modeled contracts" value={`${day.contracts_used} / ${day.raw_contracts}`}/><Stat label="OI coverage" value={pct(day.oi_coverage)}/></div><p className="text-xs text-zinc-500">Captured {day.captured_at} · Multi-expiry max pain: {fmt(day.max_pain)} · {Object.entries(day.exclusions).map(([k,v])=>`${k}: ${v}`).join(' · ')||'No exclusions'}</p>
    <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left font-mono text-xs"><thead className="text-zinc-500"><tr>{['Actual expiry','Net GEX $/1%','Call wall','Put wall','Max pain','OI-weighted IV'].map(x=><th className="p-2 font-normal" key={x}>{x}</th>)}</tr></thead><tbody>{day.expiries.map(e=><tr key={e.expiry} className="border-t border-zinc-800 text-zinc-300"><td className="p-2">{e.expiry}</td><td className="p-2">{fmt(e.gex)}</td><td className="p-2">{fmt(e.call_wall)}</td><td className="p-2">{fmt(e.put_wall)}</td><td className="p-2">{fmt(e.max_pain)}</td><td className="p-2">{pct(e.mean_iv)}</td></tr>)}</tbody></table></div>
    <div className="flex flex-wrap justify-between gap-2"><select aria-label="Replay contract expiry" className="rounded border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-300" value={expiry} onChange={e=>setExpiry(e.target.value)}><option value="">All actual expiries</option>{day.expiries.map(e=><option key={e.expiry}>{e.expiry}</option>)}</select><button className={button} onClick={()=>downloadResearch(day,`chain-${day.date}.json`)}>Export full chain JSON</button></div>
    <div className="max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left font-mono text-[11px]"><thead className="sticky top-0 bg-zinc-950 text-zinc-500"><tr>{['Contract','OI','Bid / ask','IV','Delta','Gamma','Theta / d','Vega / pp','GEX $/1%'].map(x=><th className="p-2 font-normal" key={x}>{x}</th>)}</tr></thead><tbody>{contracts.slice(0,250).map(c=><tr key={c.symbol} className="border-t border-zinc-800/70 text-zinc-300"><td className="p-2">{c.symbol}</td><td className="p-2">{fmt(c.oi,0)}</td><td className="p-2">{fmt(c.bid)} / {fmt(c.ask)}</td><td className="p-2">{pct(c.iv)}</td><td className="p-2">{fmt(c.delta,4)}</td><td className="p-2">{fmt(c.gamma,5)}</td><td className="p-2">{fmt(c.theta,4)}</td><td className="p-2">{fmt(c.vega,4)}</td><td className="p-2">{fmt(c.gex)}</td></tr>)}</tbody></table></div><p className="text-[11px] text-zinc-500">Showing {Math.min(250,contracts.length)} / {contracts.length} filtered contracts. Full chain tersedia di export.</p>
  </div>;
}

function BacktestResult({result}:{result:HistoryAnalysis}) {
  const b=result.backtest;
  const equity=b.ledger.length ? [{date:'Initial',equity:1,benchmark:1},...b.ledger] : [];
  return <div className="space-y-4"><p className="rounded-lg border border-amber-900/50 p-3 text-xs leading-relaxed text-amber-200">Sinyal EOD → long/cash pada open sesi berikutnya → exit di close sesi tersebut. Ini backtest return underlying, bukan P&amp;L options. GEX positif/negatif tidak otomatis berarti bullish/bearish.</p><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label={`Net return · ${b.trades} trades`} value={pct(b.total_return)}/><Stat label="Intraday benchmark" value={pct(b.benchmark_return)}/><Stat label="Max drawdown" value={pct(b.max_drawdown)}/><Stat label="Net trade win rate" value={pct(b.win_rate)}/></div><section className={panel}><h3 className="mb-3 text-sm text-zinc-200">Equity · initial capital = 1</h3><ResearchChart data={equity} lines={[{key:'equity',name:'GEX rule',color:'#22d3ee'},{key:'benchmark',name:'Every eligible session long',color:'#a1a1aa'}]}/><p className="mt-2 text-xs text-zinc-500">{b.sessions} eligible sessions · Excluded: {Object.entries(b.skipped).map(([k,v])=>`${k}: ${v}`).join(' · ')||'none'} · Missing imported sessions: {result.gaps.length}</p></section>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{b.regimes.map(r=><section className={panel} key={r.regime}><h3 className="text-sm text-zinc-200">{r.regime==='positive'?'Positive':'Negative'} GEX · {r.n} observations</h3><div className="mt-4 grid grid-cols-2 gap-3"><Stat label="Mean next-session return" value={pct(r.mean_return)}/><Stat label="Mean absolute return" value={pct(r.mean_absolute_return)}/></div><p className="mt-3 text-xs leading-relaxed text-zinc-400">P(up) posterior: {pct(r.posterior_up)} · 95% interval {pct(r.credible_interval[0])}–{pct(r.credible_interval[1])}. Prior {r.prior}; {r.ties} ties excluded. Descriptive IID approximation; not a calibrated forecast.</p></section>)}</div>
    <details className={panel}><summary className="cursor-pointer text-xs text-zinc-300">Session ledger · {b.ledger.length} rows</summary><div className="mt-3 max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left font-mono text-xs"><thead className="text-zinc-500"><tr>{['Signal EOD','Trade session','Position','Open','Close','Net return'].map(x=><th className="p-2 font-normal" key={x}>{x}</th>)}</tr></thead><tbody>{b.ledger.map(x=><tr key={x.date} className="border-t border-zinc-800 text-zinc-300"><td className="p-2">{x.signal_date}</td><td className="p-2">{x.date}</td><td className="p-2">{x.active?'LONG':'CASH'}</td><td className="p-2">{fmt(x.open)}</td><td className="p-2">{fmt(x.close)}</td><td className="p-2">{pct(x.net_return)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

"use client";
import { useEffect, useMemo, useState } from 'react';
import { Radio, Square, RefreshCw, ArrowDownUp, Download, ExternalLink } from 'lucide-react';
import { GreeksSnapshot, StrikeGreeks } from '../../lib/greeks';
import { ContractHistory, loadContract, newerObservation, spread } from '../../lib/contractWorkspace';
import ContractChart from './ContractChart';
import { useContractStream } from './useContractStream';
import { expiryLabel, expiryWeekday } from '../../lib/optionExpiries';

const field='mt-1 w-full rounded-lg border border-slate-700 bg-[#0b1017] px-3 py-2.5 text-xs text-slate-100 focus-visible:outline focus-visible:outline-cyan-300';
const button='flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500 focus-visible:outline focus-visible:outline-cyan-300 disabled:opacity-40';
const fmt=(n:number|null|undefined,digits=3)=>n!=null&&Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:digits}):'—';
const stamp=(value:string|null|undefined)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString().replace('T',' ').replace('Z',' UTC'):'Unavailable';
function age(value:string|null|undefined, now:number) {
  if (!value) return 'No observation';
  const seconds=Math.max(0,(now-Date.parse(value))/1000);
  return !Number.isFinite(seconds)?'Unknown age':seconds<60?`${Math.floor(seconds)}s old`:seconds<3600?`${Math.floor(seconds/60)}m old`:`${(seconds/3600).toFixed(1)}h old`;
}

export default function ContractWorkspace({data,initialSymbol}:{data:GreeksSnapshot;initialSymbol?:string|null}) {
  const rows=useMemo(()=>{
    const unique=new Map<string,StrikeGreeks>();
    Object.values(data.by_expiry||{}).forEach(b=>b.strikes?.forEach(s=>{if(s.contract_symbol) unique.set(s.contract_symbol,s);}));
    return Array.from(unique.values()).sort((a,b)=>a.expiry.localeCompare(b.expiry)||Math.abs(a.strike-data.spot)-Math.abs(b.strike-data.spot)||a.option_type.localeCompare(b.option_type));
  },[data]);
  const initial=rows.find(r=>r.contract_symbol===initialSymbol)||rows[0];
  const [expiry,setExpiry]=useState(initial?.expiry||'');
  const [side,setSide]=useState(initial?.option_type||'call');
  const [symbol,setSymbol]=useState(initial?.contract_symbol||'');
  const [weekday,setWeekday]=useState('all');
  const allExpiries=Array.from(new Set(rows.map(r=>r.expiry)));
  const expiries=allExpiries.filter(e=>weekday==='all'||expiryWeekday(e)===weekday);
  const choices=rows.filter(r=>r.expiry===expiry&&r.option_type===side).sort((a,b)=>a.strike-b.strike);
  const selected=choices.find(r=>r.contract_symbol===symbol)||[...choices].sort((a,b)=>Math.abs(a.strike-data.spot)-Math.abs(b.strike-data.spot))[0];
  if (!rows.length) return <p className="rounded-xl border border-slate-800 p-8 text-slate-400">No eligible Alpaca contract symbols. Refresh the chain first.</p>;
  return <section aria-label="Contract workspace" className="min-w-0 space-y-4">
    <div className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900 to-[#0b121b] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.2em] text-cyan-300">Single contract / market data</p><h3 className="mt-2 text-xl font-semibold">Contract desk<span className="text-cyan-300">.</span></h3><p className="mt-2 text-xs text-slate-400">Choose an expiry and strike. Inspect the history, then listen to the selected contract.</p></div><span className="rounded-full border border-amber-800 bg-amber-950/20 px-3 py-1 text-[10px] uppercase text-amber-200">{data.provenance?.feed || 'Unknown feed'} · read only</span></div>
      <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-[1fr_.65fr_1.4fr]">
        <label>Weekday<select aria-label="Contract expiry weekday" className={field} value={weekday} onChange={e=>{const day=e.target.value;setWeekday(day);setExpiry(allExpiries.find(x=>day==='all'||expiryWeekday(x)===day)||'');setSymbol('');}}><option value="all">All weekdays</option>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=><option key={d}>{d}</option>)}</select></label>
        <label>Expiration<select aria-label="Contract expiration" className={field} value={expiry} onChange={e=>{setExpiry(e.target.value);setSymbol('');}}>{!expiries.length&&<option value="">No eligible expiries</option>}{expiries.map(e=><option key={e} value={e}>{expiryLabel(e)}</option>)}</select></label>
        <label>Side<select aria-label="Contract side" className={field} value={side} onChange={e=>{setSide(e.target.value);setSymbol('');}}><option value="call">Call</option><option value="put">Put</option></select></label>
        <label>Strike · open interest<select aria-label="Selected option contract" className={field} value={selected?.contract_symbol||''} onChange={e=>setSymbol(e.target.value)}>{choices.map(r=><option key={r.contract_symbol} value={r.contract_symbol}>${fmt(r.strike)} · OI {fmt(r.oi,0)} · {r.contract_symbol}</option>)}</select></label>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">Selector uses the filtered inventory, not every listed option. Missing IV/OI contracts and unsupported 0DTE can be absent. Changing contracts stops the previous stream.</p>
    </div>
    {selected?<ContractSession key={selected.contract_symbol} row={selected} snapshot={data}/>:<p className="p-6 text-slate-400">No eligible {side} contracts for this expiry.</p>}
  </section>;
}

function ContractSession({row,snapshot}:{row:StrikeGreeks;snapshot:GreeksSnapshot}) {
  const symbol=row.contract_symbol!;
  const [interval,setIntervalValue]=useState('5Min'),[days,setDays]=useState(5),[attempt,setAttempt]=useState(0);
  const [history,setHistory]=useState<ContractHistory|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const [running,setRunning]=useState(false),[now,setNow]=useState(Date.now());
  const live=useContractStream(symbol,running);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const abort=new AbortController();let active=true;
    const timeout=setTimeout(()=>abort.abort(),60_000);
    setHistory(null);setError(null);setLoading(true);
    loadContract(symbol,interval,days,abort.signal).then(value=>{if(active)setHistory(value);}).catch(e=>{if(active)setError(abort.signal.aborted?'History request timed out. Retry.':e.message);}).finally(()=>{clearTimeout(timeout);if(active)setLoading(false);});
    return()=>{active=false;clearTimeout(timeout);abort.abort();};
  },[symbol,interval,days,attempt]);
  const quote=live.quote?newerObservation(history?.quote||null,live.quote):history?.quote||null;
  const trade=live.trade?newerObservation(history?.trade||null,live.trade):history?.trade||null;
  const quoteSpread=spread(quote);
  const exportData=()=>{
    const blob=new Blob([JSON.stringify({symbol,history,chain_observation:{timestamp:snapshot.timestamp,oi:row.oi,oi_date:row.oi_date,model_greeks:row},stream:{...live,tape_basis:'Last 100 observed events this session; not a complete tape or daily volume.'}},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=`${symbol}-workspace.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="min-w-0"><p className="break-all text-sm font-semibold text-slate-100">{symbol}</p><p className="mt-1 text-xs text-slate-400">{row.expiry} · ${fmt(row.strike)} {row.option_type.toUpperCase()} · underlying ${fmt(snapshot.spot,2)} at chain capture</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={exportData}><Download size={13}/>Export JSON</button><button className={`${button} ${running?'border-amber-800 text-amber-200':'border-cyan-700 bg-cyan-950/40 text-cyan-200'}`} onClick={()=>setRunning(!running)}>{running?<Square size={13}/>:<Radio size={13}/>} {running?'Stop stream':'Start stream'}</button></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400" role="status"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${live.status.state==='subscribed'?'bg-emerald-400':live.status.state==='error'?'bg-red-400':'bg-amber-400'}`}/><strong className="uppercase text-slate-200">{live.status.state}</strong> · {live.status.message}</span><span>Link: {age(live.received,now)} · data ages below</span></div>
    {live.gaps&&<p className="rounded-lg border border-amber-900 bg-amber-950/20 p-3 text-xs text-amber-200">This session has a data gap. The visible tape is incomplete; missing events are not replayed.</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[{label:'Bid / size',value:`$${fmt(quote?.bid)} / ${fmt(quote?.bid_size,0)}`,note:age(quote?.timestamp,now)}, {label:'Ask / size',value:`$${fmt(quote?.ask)} / ${fmt(quote?.ask_size,0)}`,note:quote?.crossed?'Crossed quote · midpoint unavailable':age(quote?.timestamp,now)}, {label:'Quoted spread',value:quoteSpread?`$${fmt(quoteSpread.absolute)} · ${fmt(quoteSpread.percent,2)}%`:'—',note:'Indicative spread is not an execution estimate'}, {label:'Last reported trade',value:trade?`$${fmt(trade.price)} × ${fmt(trade.size,0)}`:'—',note:age(trade?.timestamp,now)}].map(c=><div className="rounded-xl border border-slate-800 bg-[#0c131d] p-4" key={c.label}><p className="text-[10px] uppercase tracking-wider text-slate-500">{c.label}</p><p className="mt-3 break-words text-base text-slate-100 sm:text-lg">{c.value}</p><p className="mt-2 text-[10px] leading-4 text-slate-400">{c.note}</p></div>)}
    </div>
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-500"><span>Quote: {stamp(quote?.timestamp)}</span><span>Trade: {stamp(trade?.timestamp)}</span><span>OI: {fmt(row.oi,0)} · observed {row.oi_date||'unknown'} · snapshot {stamp(snapshot.timestamp)}</span></div>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
      <section className="min-w-0 space-y-3" aria-label="Contract historical chart">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="text-sm font-semibold">Contract price & volume</h4><p className="mt-1 text-[11px] text-slate-500">Historical aggregates · UTC · gaps retained</p></div><div className="flex flex-wrap items-end gap-2 text-[10px] text-slate-400"><label>Interval<select aria-label="Contract chart interval" className={field} value={interval} onChange={e=>setIntervalValue(e.target.value)}>{['1Min','5Min','15Min','1Day'].map(v=><option key={v}>{v}</option>)}</select></label><label>Lookback<select aria-label="Contract chart lookback" className={field} value={days} onChange={e=>setDays(+e.target.value)}>{[1,5,20].map(v=><option key={v} value={v}>{v} calendar days</option>)}</select></label><button className={button} disabled={loading} onClick={()=>setAttempt(v=>v+1)} aria-label="Refresh contract history and Greeks"><RefreshCw size={14}/></button></div></div>
        {loading?<div role="status" className="flex h-[465px] items-center justify-center rounded-xl border border-slate-800 bg-[#0b1017] text-sm text-slate-500">Loading contract bars…</div>:error?<div role="alert" className="rounded-xl border border-red-900 p-6 text-sm text-red-200">{error}<button className={`${button} mt-4`} onClick={()=>setAttempt(v=>v+1)}>Retry history</button></div>:history&&<ContractChart bars={history.bars}/>}
        <p className="text-[11px] leading-5 text-slate-500">{history?.bars_basis} {history&&`Requested through ${stamp(history.requested_end)}.`} Streaming prints stay in the tape; they are not merged into historical volume.</p>
        {history?.warnings.map(w=><p role="alert" key={w} className="text-xs text-amber-300">{w}</p>)}
      </section>
      <aside className="rounded-xl border border-slate-800 bg-[#0c131d] p-4" aria-label="Contract Greeks comparison">
        <div className="flex items-center gap-2 text-sm font-semibold"><ArrowDownUp size={15} className="text-cyan-300"/>Greeks snapshot</div><p className="mt-2 text-[11px] leading-5 text-slate-500">Provider estimates vs inventory model. Different capture times/inputs can explain differences.</p>
        <table className="mt-4 w-full text-right text-xs"><thead><tr className="text-[10px] text-slate-500"><th className="py-2 text-left">Metric</th><th>Alpaca</th><th>Model</th></tr></thead><tbody>{['IV %','delta','gamma','theta','vega','rho'].map(k=><tr key={k} className="border-t border-slate-800"><th className="py-3 text-left font-normal text-slate-400">{k}</th><td className="text-cyan-200">{fmt(k==='IV %'?history?.iv==null?null:history.iv*100:history?.greeks[k],4)}</td><td className="text-slate-300">{fmt(k==='IV %'?row.iv*100:row[k as keyof StrikeGreeks] as number,4)}</td></tr>)}</tbody></table>
        <p className="mt-4 break-words text-[10px] leading-5 text-slate-500">Alpaca capture: {stamp(history?.captured_at)}<br/>Model capture: {stamp(snapshot.timestamp)}<br/>Greeks refresh with the history button, not with each stream tick. Model units: per underlying share; theta/day, vega and rho per percentage point. Verify provider conventions before interpreting differences.</p>
      </aside>
    </div>
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-[#0c131d]" aria-label="Contract trade tape"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-4"><div><h4 className="text-sm font-semibold">Observed trade tape</h4><p className="mt-1 text-[11px] text-slate-500">Last 100 stream events · arrival order · size in contracts · no buy/sell classification</p></div><span className="text-xs text-slate-400">{live.tape.length} visible</span></div><div className="max-h-72 overflow-auto"><table className="w-full whitespace-nowrap text-right text-xs"><thead className="text-[10px] uppercase text-slate-500"><tr>{['Event time (UTC)','Price','Size','Exchange','Condition'].map(k=><th key={k} className="px-4 py-3">{k}</th>)}</tr></thead><tbody>{live.tape.map((t,i)=><tr className="border-t border-slate-800/70 text-slate-300" key={`${t.sequence}-${i}`}><td className="px-4 py-2">{stamp(t.timestamp)}</td><td className="px-4 py-2">${fmt(t.price)}</td><td className="px-4 py-2">{fmt(t.size,0)}</td><td className="px-4 py-2">{t.exchange||'—'}</td><td className="px-4 py-2">{t.condition||'—'}</td></tr>)}{!live.tape.length&&<tr><td colSpan={5} className="p-8 text-center text-slate-500">{running?'Waiting for trades. A confirmed subscription does not guarantee activity, especially outside market hours.':'Start the stream to capture incoming trades.'}</td></tr>}</tbody></table></div></section>
    <p className="flex items-start gap-2 rounded-lg border border-amber-900/50 p-3 text-[11px] leading-5 text-amber-200/80"><ExternalLink size={14} className="mt-0.5 shrink-0"/>{snapshot.provenance?.feed==='indicative'?'Indicative feed: modified quotes and delayed derivative trades. This is not executable OPRA pricing.':'Inspect event timestamps even when OPRA is selected.'} No orders are sent. A heartbeat confirms the connection, not fresh market data.</p>
  </div>;
}

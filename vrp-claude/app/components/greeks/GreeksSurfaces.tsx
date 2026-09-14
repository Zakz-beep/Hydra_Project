"use client";
import { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';
import type { GreeksSnapshot } from '../../lib/greeks';
import { bucketExpiries, expiryLabel, expiryWeekday, surfaceScope } from '../../lib/optionExpiries';
import { collectExpirySmiles } from '../../lib/volatilitySurface';
import VolatilityTermStructure from './VolatilityTermStructure';

type LevelData={ticker:string;timestamp:string;expiries:string[];contracts:number;call_wall:number|null;put_wall:number|null;gamma_flip:number|null;max_pain:number|null;basis:string;profile:{strike:number;call:number;put:number;net:number;vanna:number;charm:number}[];by_actual_expiry:{expiry:string;contracts:number;max_pain:number|null}[]};
const field='rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-200 focus-visible:outline focus-visible:outline-cyan-400';
const panel='min-w-0 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4';
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(n);
const price=(n:number|null|undefined)=>n!=null&&Number.isFinite(n)?`$${n.toFixed(2)}`:'—';
const axis={fill:'#71717a',fontSize:10,fontFamily:'monospace'};
const tip={background:'#09090b',border:'1px solid #3f3f46',fontSize:11,borderRadius:8};
const colors=['#818cf8','#fb923c','#f472b6','#34d399','#38bdf8','#facc15','#a78bfa','#f87171','#2dd4bf','#e879f9'];

function LevelLabel({viewBox,value,fill,lane=0}:{viewBox?:{x:number;y:number};value:string;fill:string;lane?:number}) {
  if(!viewBox)return null;
  return <g><rect x={viewBox.x-43} y={viewBox.y+lane*21+2} width={86} height={17} rx={3} fill={fill}/><text x={viewBox.x} y={viewBox.y+lane*21+14} textAnchor="middle" fill="#09090b" fontSize={9} fontFamily="monospace" fontWeight="bold">{value}</text></g>;
}

export default function GreeksSurfaces({data}:{data:GreeksSnapshot}) {
  const [bucket,setBucket]=useState('all'),[weekday,setWeekday]=useState('all'),[expiry,setExpiry]=useState('all'),[near,setNear]=useState(true);
  const [levels,setLevels]=useState<LevelData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const dates=useMemo(()=>bucketExpiries(data,bucket),[data,bucket]);
  const choices=dates.filter(e=>weekday==='all'||expiryWeekday(e)===weekday);
  const selected=choices.filter(e=>expiry==='all'||e===expiry);
  const scopeKey=selected.join(',');
  const scoped=useMemo(()=>surfaceScope(data,scopeKey?scopeKey.split(','):[]),[data,scopeKey]);
  useEffect(()=>{
    setLevels(null);setError('');
    if(!scopeKey)return;
    const abort=new AbortController();let active=true;
    const timer=setTimeout(()=>abort.abort(),95_000);
    const query=new URLSearchParams({ticker:data.ticker,expiries:scopeKey,snapshot:data.timestamp});
    fetch(`/api/greeks/levels?${query}`,{signal:abort.signal,cache:'no-store'}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(typeof body.detail==='string'?body.detail:body.error||'Unable to calculate levels');return body as LevelData;}).then(v=>{if(active)setLevels(v);}).catch(e=>{if(active)setError(abort.signal.aborted?'Levels request timed out. Retry.':e.message);}).finally(()=>clearTimeout(timer));
    return()=>{active=false;clearTimeout(timer);abort.abort();};
  },[data.ticker,data.timestamp,scopeKey,retry]);
  const current=levels?.timestamp===data.timestamp&&levels.ticker===data.ticker&&levels.expiries.join(',')===scopeKey?levels:null;
  // A matching unfiltered scope already has a flip in the same captured snapshot.
  const hasSnapshotFlip=weekday==='all'&&expiry==='all'&&selected.length>0;
  const gammaFlip=current?current.gamma_flip:hasSnapshotFlip?(bucket==='all'?data.gamma_flip:data.by_expiry?.[bucket]?.gamma_flip):undefined;
  const flipLabel=gammaFlip!=null?price(gammaFlip):current||hasSnapshotFlip?'No crossing':error?'Unavailable':'Calculating…';
  const profile=current?.profile.filter(r=>!near||Math.abs(r.strike/data.spot-1)<=.15).map(r=>({...r,absolute:r.call-r.put}))||[];
  const totals=current?.profile.reduce((a,r)=>({call:a.call+r.call,put:a.put+r.put,net:a.net+r.net}),{call:0,put:0,net:0});
  const smiles=useMemo(()=>collectExpirySmiles(scoped,'all',10),[scoped]);
  const skew=useMemo(()=>{
    const map=new Map<number,Record<string,number|null>>();
    for(const smile of smiles)for(const p of smile.points){
      if(near&&Math.abs(p.strike/data.spot-1)>.15)continue;
      const row=map.get(p.strike)||Object.fromEntries([['strike',p.strike],...smiles.map(s=>[s.expiry,null])]);
      row[smile.expiry]=p.iv;map.set(p.strike,row);
    }
    return Array.from(map.values()).sort((a,b)=>Number(a.strike)-Number(b.strike));
  },[smiles,data.spot,near]);
  const scopeText=`${bucket==='all'?'All DTE':`${bucket} DTE bucket`} · ${weekday==='all'?'All weekdays':weekday} · ${selected.length} expiries`;
  const levelsInChart=[{name:'Gamma flip',value:gammaFlip,color:'#22d3ee'}, {name:'Call wall',value:current?.call_wall,color:'#34d399'}, {name:'Put wall',value:current?.put_wall,color:'#fb7185'}, {name:'Max pain',value:current?.max_pain,color:'#fbbf24'}];
  const domainValues=[...profile.map(r=>r.strike),data.spot,...levelsInChart.flatMap(l=>l.value!=null?[l.value]:[])];
  const min=Math.min(...domainValues),max=Math.max(...domainValues),pad=Math.max((max-min)*.07,data.spot*.005);
  const buckets=Array.from(new Set(['0','1','7','14','30',...Object.keys(data.by_expiry||{})])).sort((a,b)=>+a-+b);
  return <section className="min-w-0 space-y-4 font-mono" aria-label="Surface and expiry analysis">
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Surface DTE filter"><span className="mr-1 text-[11px] text-zinc-500">DTE Filter:</span>{['all',...buckets].map(b=><button key={b} aria-pressed={bucket===b} onClick={()=>{setBucket(b);setExpiry('all');}} title={b==='all'?'All available buckets':`${b} DTE bucket · ${bucketExpiries(data,b).length} eligible expiries`} className={`rounded border px-2.5 py-1.5 text-[11px] transition-colors focus-visible:outline focus-visible:outline-cyan-400 ${bucket===b?'border-indigo-700/60 bg-indigo-900/60 text-indigo-200':'border-transparent bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800'}`}>{b==='all'?'All Expiries':`${b} DTE`}</button>)}</div>
        <div className="flex flex-wrap gap-4 text-[11px]">{[{name:'Call / Pos GEX',value:totals?.call,color:'text-emerald-400'},{name:'Put / Neg GEX',value:totals?.put,color:'text-red-400'},{name:'Total Net GEX',value:totals?.net,color:'text-zinc-100'}].map(c=><div className="text-right" key={c.name}><p className="text-zinc-500">{c.name}</p><p className={`mt-1 font-semibold ${c.color}`}>{c.value!=null?money(c.value):'—'}</p></div>)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500"><label className="flex items-center gap-2">Expiry day<select aria-label="Surface expiry weekday" className={field} value={weekday} onChange={e=>{setWeekday(e.target.value);setExpiry('all');}}><option value="all">All weekdays</option>{['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=><option key={d} value={d}>{d} ({dates.filter(e=>expiryWeekday(e)===d).length})</option>)}</select></label><label className="flex items-center gap-2">Date<select aria-label="Surface actual expiry" className={`${field} max-w-[240px]`} value={expiry} onChange={e=>setExpiry(e.target.value)}><option value="all">All matching dates ({choices.length})</option>{choices.map(e=><option key={e} value={e}>{expiryLabel(e)}</option>)}</select></label><button className="text-zinc-400 underline" onClick={()=>{setBucket('all');setWeekday('all');setExpiry('all');}}>Reset</button></div>
        <span className="text-[10px] text-zinc-500" role="status">{scopeText} · {current?`${current.contracts} contracts`:selected.length?'Loading levels…':'No eligible contracts'}</span>
      </div>
    </div>
    {!selected.length?<div className={`${panel} space-y-2 text-xs text-amber-200`}><p>No eligible contracts for {scopeText}.</p><p className="text-zinc-400">DTE and weekday filters are combined. Try All Expiries or another weekday. 0DTE remains unavailable when the feed has no eligible same-day IV/OI.</p></div>:<>
      {error&&<div role="alert" className="rounded border border-amber-900 px-4 py-3 text-xs text-amber-200">{error}<button className="ml-3 underline" onClick={()=>setRetry(n=>n+1)}>Retry levels</button></div>}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs" aria-label="Selected expiry key levels">
        <span className="font-semibold text-cyan-300">Gamma Flip: {flipLabel}</span><span className="text-emerald-400">Call Wall: {price(current?.call_wall)}</span><span className="text-red-400">Put Wall: {price(current?.put_wall)}</span><span className="text-amber-400">Max Pain: {selected.length>1?'Select one expiry':price(current?.max_pain)}</span><span className="ml-auto text-zinc-500">Spot: {price(data.spot)}</span>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <section className={panel} aria-label="Scoped GEX profile">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs uppercase tracking-wider text-zinc-400">GEX Profile (Call vs Put Wall)</h3><label className="text-[10px] text-zinc-500"><input type="checkbox" checked={near} onChange={e=>setNear(e.target.checked)}/> Strikes ±15%</label></div>
          <p className="mb-2 text-[10px] text-zinc-500">USD / 1% spot move · axis includes gamma flip and selected levels</p>
          <div className="h-[320px] min-w-0">{current&&profile.length?<ResponsiveContainer width="100%" height="100%"><ComposedChart data={profile} margin={{top:8,right:12,bottom:0,left:0}} stackOffset="sign" barGap={0}><CartesianGrid stroke="#27272a" vertical={false} strokeDasharray="3 3"/><XAxis dataKey="strike" type="number" domain={[min-pad,max+pad]} tick={axis}/><YAxis tickFormatter={money} width={70} tick={axis}/><Tooltip formatter={(v:number)=>money(v)} labelFormatter={v=>`Strike $${v}`} contentStyle={tip}/><Legend wrapperStyle={{fontSize:10}}/><ReferenceLine y={0} stroke="#3f3f46"/><ReferenceLine x={data.spot} stroke="#a1a1aa" strokeDasharray="4 4"/><Bar dataKey="call" name="Call GEX" fill="#10b981" stackId="gex" isAnimationActive={false}/><Bar dataKey="put" name="Put GEX" fill="#ef4444" stackId="gex" isAnimationActive={false}/><Line dataKey="absolute" name="Absolute GEX" stroke="#eab308" type="linear" dot={false} strokeWidth={1.5} isAnimationActive={false}/>{levelsInChart.map((l,i)=>l.value!=null?<ReferenceLine key={l.name} x={l.value} stroke={l.color} strokeWidth={l.name==='Gamma flip'?2:1} strokeDasharray="4 4" isFront label={<LevelLabel value={`${l.name} ${l.value.toFixed(2)}`} fill={l.color} lane={i}/>}/>:null)}</ComposedChart></ResponsiveContainer>:<p className="pt-24 text-center text-xs text-zinc-500">{error?'Levels unavailable.':current?'No strikes in this display range.':'Calculating scoped GEX…'}</p>}</div>
          <p className="mt-2 text-[10px] text-cyan-300">Gamma Flip: {flipLabel}{gammaFlip!=null?` · ${((gammaFlip/data.spot-1)*100).toFixed(2)}% from spot`:' · no boundary estimate is substituted'}</p>
        </section>
        <section className={panel}><h3 className="mb-3 text-xs uppercase tracking-wider text-zinc-400">Volatility Skew (IV by Strike & Expiry)</h3><p className="mb-2 text-[10px] text-zinc-500">Calls + puts · OI weighted at each actual expiry · gaps preserved</p><div className="h-[320px] min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={skew} margin={{top:8,right:12,left:0,bottom:0}}><CartesianGrid stroke="#27272a" vertical={false} strokeDasharray="3 3"/><XAxis dataKey="strike" type="number" domain={['dataMin','dataMax']} tick={axis}/><YAxis width={45} tick={axis} tickFormatter={v=>`${v}%`} domain={['auto','auto']}/><Tooltip contentStyle={tip} formatter={(v:number)=>`${v.toFixed(2)}%`} labelFormatter={v=>`Strike $${v}`}/><Legend wrapperStyle={{fontSize:9}}/><ReferenceLine x={data.spot} stroke="#71717a" strokeDasharray="3 3"/>{smiles.map((s,i)=><Line key={s.expiry} dataKey={s.expiry} name={`${s.dte}D · ${s.expiry.slice(5)} ${expiryWeekday(s.expiry).slice(0,3)}`} stroke={colors[i%colors.length]} strokeWidth={1.5} dot={{r:1.5}} type="linear" connectNulls={false} isAnimationActive={false}/>)}</ComposedChart></ResponsiveContainer></div></section>
      </div>
      <VolatilityTermStructure data={scoped} scopeKey={scopeKey}/>
      <details className={panel}><summary className="cursor-pointer text-xs text-zinc-400">Vanna / Charm & max pain per expiry</summary><div className="mt-4 h-56 min-w-0"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={profile}><CartesianGrid stroke="#27272a" strokeDasharray="3 3"/><XAxis dataKey="strike" type="number" domain={['dataMin','dataMax']} tick={axis}/><YAxis tickFormatter={money} width={70} tick={axis}/><Tooltip contentStyle={tip}/><Legend wrapperStyle={{fontSize:10}}/><Line dataKey="vanna" name="Vanna exposure" stroke="#a78bfa" type="linear" dot={false} isAnimationActive={false}/><Line dataKey="charm" name="Charm exposure" stroke="#fbbf24" type="linear" dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div><div className="mt-3 overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="text-zinc-500"><tr><th className="p-2">Expiration</th><th className="p-2">Contracts</th><th className="p-2">Max pain</th></tr></thead><tbody>{current?.by_actual_expiry.map(r=><tr key={r.expiry} className="border-t border-zinc-800 text-zinc-300"><td className="p-2"><button className="text-cyan-300 underline" aria-label={`Analyze expiry ${r.expiry}`} onClick={()=>setExpiry(r.expiry)}>{expiryLabel(r.expiry)}</button></td><td className="p-2">{r.contracts}</td><td className="p-2">{price(r.max_pain)}</td></tr>)}</tbody></table></div></details>
    </>}
    <details className="text-[10px] leading-5 text-zinc-500"><summary className="cursor-pointer">Scope, source & calculation notes</summary><p>{scopeText}. DTE buttons use the existing grouped buckets, not exact-day horizons. Weekday and date selections narrow that bucket. Only provider-listed eligible contracts are used.</p><p>{current?.basis} Gamma flip is a modeled crossing, not observed dealer positioning. No crossing within the search range stays unavailable. Mixed-expiry max pain is not combined.</p><p>Capture: {data.timestamp} · {data.provenance?.feed||'Legacy'} feed. IV controls inside the 3D panel apply only to the IV visualization.</p></details>
  </section>;
}

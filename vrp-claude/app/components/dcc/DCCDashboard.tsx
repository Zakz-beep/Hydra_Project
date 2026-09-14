"use client";
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { DCCRunResponse, runDCCModel } from '../../lib/dcc';
import PairExplorer from './PairExplorer';
import TailResearch from './TailResearch';
import ExposureLab from './ExposureLab';
import { number } from './ResearchCharts';
import s from './CorrelationWorkspace.module.css';
const HMMDashboard=dynamic(()=>import('./HMMDashboard'), {loading:()=> <p>Loading regime charts…</p>});
const tabs=[['pairs','Correlation & pairs'],['tails','Joint extremes'],['simulation','Exposure lab'],['hmm','HMM regimes'],['method','Data & methodology']] as const;
type Tab=typeof tabs[number][0];
const presets: Record<string,string>={'US multi-asset':'SPY, QQQ, TLT, GLD','US sectors':'XLK, XLF, XLE, XLV, XLI','Indonesia':'BBCA.JK, BBRI.JK, BMRI.JK','Crypto':'BTC-USD, ETH-USD, SOL-USD'};

function download(data:DCCRunResponse, format:'json'|'csv') {
  const csv=['pair,dcc,change,rolling,historical,sample_size,as_of,window_bars',...data.research.pairs.map(p=>[p.key,p.dcc,p.change,p.rolling,p.historical,p.sample_size,data.research.last_bar,data.research.window].map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(','))].join('\n');
  const blob=new Blob([format==='json'?JSON.stringify(data,null,2):csv],{type:format==='json'?'application/json':'text/csv'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`dcc-${data.run_id}.${format}`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function DCCDashboard() {
  const [tickers,setTickers]=useState('SPY, QQQ, TLT, GLD');const [mode,setMode]=useState('4');
  const [window,setWindow]=useState(20);const [threshold,setThreshold]=useState(.65);const [defensive,setDefensive]=useState(.1);const [cost,setCost]=useState(5);
  const [tab,setTab]=useState<Tab>('pairs');const [selected,setSelected]=useState('');
  const [data,setData]=useState<DCCRunResponse|null>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const request=useRef<AbortController|null>(null);const mounted=useRef(true);const [submitted,setSubmitted]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
  const signature=JSON.stringify({tickers,mode,window,threshold,defensive,cost});
  const dirty=!!data&&signature!==submitted;
  async function run() {
    if(request.current)return;
    const names=tickers.split(',').map(t=>t.trim().toUpperCase()).filter(Boolean);
    if(names.length<2||names.length>12){setError('Masukkan 2–12 ticker Yahoo Finance.');return;}
    if(new Set(names).size!==names.length){setError('Hapus ticker yang duplikat.');return;}
    if(!Number.isInteger(window)||window<10||window>120||threshold < -1||threshold>1||defensive<0||defensive>1||cost<0||cost>100){setError('Check research controls: window 10–120 bars, correlation −1 to 1, exposure 0–1, costs 0–100 bps.');return;}
    const controller=new AbortController();request.current=controller;setLoading(true);setError('');
    const timer=setTimeout(()=>controller.abort(),180000);
    try {
      const result=await runDCCModel({tickers:names,mode,window,threshold,defensive,cost_bps:cost},controller.signal);
      if(!result.research?.pairs?.length)throw new Error('Backend DCC belum memuat research v2. Restart service correlation dengan launcher.');
      if(mounted.current){setData(result);setSubmitted(signature);setSelected(result.research.pairs[0].key);}
    }catch(e){if(mounted.current)setError(e instanceof Error&&e.name==='AbortError'?'Request timed out. Backend may still be fitting; wait before retrying.':e instanceof Error?e.message:'Request failed.');}
    finally{clearTimeout(timer);request.current=null;if(mounted.current)setLoading(false);}
  }
  const r=data?.research;const last=data?.timeseries.at(-1);
  return <div className={s.root}>
    <header className={s.header}><div><div className={s.eyebrow}>DCC / CROSS-ASSET RESEARCH</div><h1>Correlation workspace</h1><p>Temukan hubungan yang menguat, berubah, dan bergerak ekstrem bersama.</p></div><div className={s.actions}><button disabled={!data} onClick={()=>data&&download(data,'csv')}>Export pairs CSV</button><button disabled={!data} onClick={()=>data&&download(data,'json')}>Research JSON</button></div></header>
    <div className={s.controls}>
      <form className={s.form} onSubmit={e=>{e.preventDefault();void run();}}>
        <label>Basket · 2–12 tickers<input aria-label="Correlation basket" value={tickers} onChange={e=>setTickers(e.target.value)} disabled={loading} placeholder="SPY, QQQ, TLT, GLD"/></label>
        <label>Sampling<select value={mode} onChange={e=>setMode(e.target.value)} disabled={loading}><option value="4">Daily · 3 years</option><option value="3">Hourly · 30 days</option><option value="2">15 minutes · 14 days</option><option value="1">5 minutes · 7 days</option></select></label>
        <button className={s.primary} disabled={loading} type="submit">{loading?'Fitting models…':'Run analysis'}</button>
      </form>
      <div className={s.presets}><small>Basket presets</small>{Object.entries(presets).map(([label,value])=><button disabled={loading} key={label} onClick={()=>setTickers(value)}>{label}</button>)}</div>
      <details><summary>Research controls · window, exposure & costs</summary><div className={s.advanced}>
        <label>Comparison window (bars)<input type="number" min={10} max={120} value={window} disabled={loading} onChange={e=>setWindow(Number(e.target.value))}/></label>
        <label>Correlation trigger<input type="number" min={-1} max={1} step={.05} value={threshold} disabled={loading} onChange={e=>setThreshold(Number(e.target.value))}/></label>
        <label>Defensive exposure (0–1)<input type="number" min={0} max={1} step={.05} value={defensive} disabled={loading} onChange={e=>setDefensive(Number(e.target.value))}/></label>
        <label>One-way turnover cost (bps)<input type="number" min={0} max={100} step={1} value={cost} disabled={loading} onChange={e=>setCost(Number(e.target.value))}/></label>
      </div><p>Exposure rule also reduces exposure after more than half the basket falls below its past residual 10th percentile. Click Run analysis to apply changes.</p></details>
    </div>
    <main className={s.body}>
      {error&&<div className={`${s.notice} ${s.error}`} role="alert">{error} {data&&'Previous successful result remains displayed.'}</div>}
      {dirty&&<div className={s.notice} role="status">Controls changed. Results below still belong to {data?.tickers.join(', ')} · {data?.timeframe}. Run analysis to apply.</div>}
      {loading&&<div className={s.skeleton} role="status" aria-live="polite">Downloading aligned prices and fitting GARCH → DCC → HMM. This can take a minute; changing tabs does not trigger another fit.</div>}
      {!data&&!loading&&<div className={s.empty}><h2>Start with a basket</h2><p>Pilih preset atau masukkan ticker, lalu Run analysis. Model hanya dijalankan saat diminta.</p><p>Minimum 100 aligned returns. Untuk pasar dengan jam berbeda, mulai dari sampling daily.</p></div>}
      {data&&r&&<>
        <div className={s.meta}>RESULT #{data.run_id} · {data.tickers.join(' / ')} · {data.timeframe} · Last price bar {r.last_bar} · Retrieved {new Date(r.fetched_at).toLocaleString()}</div>
        <div className={s.stats}>
          <div><small>Mean pair correlation</small><strong>{number(last?.avg_corr)}</strong><small>Model estimate · not a crash probability</small></div>
          <div><small>Relationships</small><strong>{r.pairs.length}</strong><small>{data.tickers.length} assets · click any matrix pair</small></div>
          <div><small>Aligned returns</small><strong>{r.observations}</strong><small>{r.dropped_rows} unmatched price rows excluded</small></div>
          <div><small>DCC persistence · a + b</small><strong>{number(r.fit.persistence)}</strong><small>Optimizer converged · full-sample fit</small></div>
        </div>
        <nav className={s.tabs} aria-label="Correlation research sections">{tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
        {tab==='pairs'&&<PairExplorer data={data} selected={selected} onSelect={setSelected}/>}
        {tab==='tails'&&<TailResearch data={data} selected={selected} onSelect={setSelected}/>}
        {tab==='simulation'&&<ExposureLab data={data}/>}
        {tab==='hmm'&&<><div className={s.notice}>Descriptive full-sample HMM. Historical probabilities are smoothed using later observations. Regime labels rank sample mean returns; they do not guarantee direction or volatility ordering.</div>{data.hmm&&!data.hmm.error?<HMMDashboard hmm={data.hmm}/>:<div className={s.empty}>HMM unavailable: {data.hmm?.error??'No result returned.'}</div>}</>}
        {tab==='method'&&<section className={s.panel}><h2>Data provenance & model assumptions</h2><p>{r.source} · {r.first_bar} → {r.last_bar}</p><p>{r.aligned_prices} aligned prices / {r.price_rows} downloaded rows. No forward fill. Pair history in this response contains the latest {data.timeseries.length} bars; summary statistics use all {r.observations} returns.</p><p>GARCH(1,1), normal innovations; DCC a={number(r.fit.a,5)}, b={number(r.fit.b,5)}. Conditional recursion uses the preceding residual.</p><ul className={s.list}>{r.warnings.map(w=><li key={w}>{w}</li>)}</ul><p><a href="https://doi.org/10.1198/073500102288618487" target="_blank" rel="noreferrer">Engle (2002) · DCC methodology ↗</a></p><p>Research JSON includes settings, diagnostics, pair estimates and chart data for reproducible review by humans or agents.</p></section>}
      </>}
    </main>
  </div>;
}

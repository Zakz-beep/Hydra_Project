"use client";
import { useState } from 'react';
import { DCCRunResponse } from '../../lib/dcc';
import { number, Trend } from './ResearchCharts';
import s from './CorrelationWorkspace.module.css';

export default function PairExplorer({data, selected, onSelect}: {data:DCCRunResponse; selected:string; onSelect:(key:string)=>void}) {
  const [sort,setSort]=useState('change');
  const [search,setSearch]=useState('');
  const r=data.research;
  const pair=r.pairs.find(p=>p.key===selected) ?? r.pairs[0];
  const rows=r.pairs.filter(p=>p.key.includes(search.toUpperCase())).sort((a,b)=>sort==='change'?Math.abs(b.change??0)-Math.abs(a.change??0):sort==='low'?a.dcc-b.dcc:b.dcc-a.dcc);
  const chart=data.timeseries.map(t=>({timestamp:t.timestamp,dcc:t.pair_corrs?.[pair.key],rolling:t.rolling_corrs?.[pair.key]}));
  return <>
    <div className={s.split}>
      <section className={s.panel}>
        <h2>Correlation matrix</h2><p>Klik pasangan untuk menelusuri riwayatnya. Negatif bukan jaminan hedge.</p>
        <div className={`${s.tableWrap} ${s.matrix}`}><table aria-label="Latest DCC correlation matrix"><thead><tr><th scope="col">DCC</th>{data.tickers.map(t=><th scope="col" key={t}>{t}</th>)}</tr></thead>
          <tbody>{data.tickers.map((a,i)=><tr key={a}><th scope="row">{a}</th>{data.tickers.map((b,j)=>{
            const value=r.matrix[i][j]; const key=i<j?`${a}|${b}`:`${b}|${a}`;
            return <td key={b}>{i===j?<span>1.00</span>:<button aria-label={`Inspect ${a} / ${b}`} aria-pressed={key===pair.key} style={{background:value<0?`rgba(52,175,164,${.12+Math.abs(value)*.4})`:`rgba(210,143,51,${.1+Math.abs(value)*.4})`}} onClick={()=>onSelect(key)}>{number(value,2)}</button>}</td>;
          })}</tr>)}</tbody></table></div>
        <p><span className={s.negative}>−1 inverse</span> · 0 no linear correlation · <span className={s.positive}>+1 together</span></p>
      </section>
      <section className={s.panel}>
        <div className={s.heading}><h2>{pair.left} / {pair.right}</h2><label>Pair<select aria-label="Selected correlation pair" value={pair.key} onChange={e=>onSelect(e.target.value)}>{r.pairs.map(p=><option key={p.key} value={p.key}>{p.left} / {p.right}</option>)}</select></label></div>
        <p>DCC {number(pair.dcc)} · Rolling {number(pair.rolling)} · Δ {r.window} bars {number(pair.change)}</p>
        <Trend data={chart} domain={[-1,1]} series={[{key:'dcc',name:'DCC (full-sample fit)',color:'#f0b75e'},{key:'rolling',name:`Rolling Pearson · ${r.window} bars`,color:'#73d9cf'}]}/>
        <p>Drag the range handles to zoom. Rolling correlation includes each displayed bar; DCC recursion uses the previous residual.</p>
      </section>
    </div>
    <section className={s.panel}>
      <div className={s.heading}><h2>Pair radar · {r.pairs.length} relationships</h2><div className={s.actions}><label>Filter ticker<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="SPY"/></label><label>Rank by<select value={sort} onChange={e=>setSort(e.target.value)}><option value="change">Largest absolute change</option><option value="high">Highest correlation</option><option value="low">Lowest correlation</option></select></label></div></div>
      <div className={s.tableWrap}><table><thead><tr><th>Pair</th><th>DCC</th><th>Δ {r.window} bars</th><th>Rolling {r.window}</th><th>Full-sample Pearson</th><th>Matched returns</th></tr></thead><tbody>{rows.map(p=><tr key={p.key} data-selected={p.key===pair.key}><td><button onClick={()=>onSelect(p.key)} aria-pressed={p.key===pair.key}>{p.left} / {p.right}</button></td><td>{number(p.dcc)}</td><td>{number(p.change)}</td><td>{number(p.rolling)}</td><td>{number(p.historical)}</td><td>{p.sample_size}</td></tr>)}</tbody></table></div>
      {!rows.length&&<p role="status">Tidak ada pasangan yang cocok dengan filter.</p>}
    </section>
  </>;
}

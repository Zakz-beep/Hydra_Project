"use client";
import { DCCRunResponse } from '../../lib/dcc';
import { number, Trend } from './ResearchCharts';
import s from './CorrelationWorkspace.module.css';
export default function ExposureLab({data}:{data:DCCRunResponse}) {
  const r=data.research;const rows=data.timeseries.map(t=>({...t}));
  const metrics:[string,number][]=[['Always invested',data.summary.final_passive_equity],['Adaptive exposure',data.summary.final_adaptive_equity],['Always invested max DD',data.summary.max_passive_dd],['Adaptive max DD',data.summary.max_adaptive_dd]];
  return <>
    <div className={s.notice}>In-sample illustration. Signals lag one bar, but model parameters are estimated on the full sample. This is not a validated strategy edge.</div>
    <div className={s.stats}>{metrics.map(([label,value],i)=><div key={label}><small>{label}</small><strong>{number(value,2)}{i>1?'%':''}</strong><small>{i<2?'Model units · starts at 10,000':'Includes initial capital in the peak'}</small></div>)}</div>
    <section className={s.panel}><h2>Exposure comparison</h2><p>Equal-weight basket, rebalanced each bar. Trigger &gt; {r.settings.threshold} or past-tail breadth &gt; 50%; defensive exposure {r.settings.defensive*100}%; turnover cost {r.settings.cost_bps} bps. Cash yield zero. Costs exclude internal rebalancing and slippage.</p><Trend data={rows} series={[{key:'passive_equity',name:'Always invested',color:'#a6b5c4'},{key:'adaptive_equity',name:'Adaptive exposure',color:'#f0b75e'}]}/></section>
    <div className={s.split}><section className={s.panel}><h2>Drawdown from peak</h2><Trend percent data={rows} series={[{key:'passive_dd',name:'Always invested DD %',color:'#a6b5c4'},{key:'adaptive_dd',name:'Adaptive DD %',color:'#ef9a9a'}]}/></section><section className={s.panel}><h2>Applied basket exposure</h2><Trend percent domain={[0,100]} data={data.timeseries.map(t=>({timestamp:t.timestamp,exposure:t.weight*100}))} series={[{key:'exposure',name:'Exposure % · lagged signal',color:'#73d9cf',step:true}]}/></section></div>
  </>;
}

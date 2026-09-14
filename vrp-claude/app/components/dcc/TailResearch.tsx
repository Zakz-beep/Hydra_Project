"use client";
import { DCCRunResponse } from '../../lib/dcc';
import { number } from './ResearchCharts';
import s from './CorrelationWorkspace.module.css';
const pct=(v:number|null|undefined)=>v==null?'—':`${number(v*100,1)}%`;
export default function TailResearch({data,selected,onSelect}:{data:DCCRunResponse;selected:string;onSelect:(v:string)=>void}) {
  const pairs=data.research.pairs;const p=pairs.find(p=>p.key===selected)??pairs[0];
  return <>
    <section className={s.panel}>
      <div className={s.heading}><h2>Joint extremes · empirical evidence</h2><label>Conditional pair<select value={p.key} onChange={e=>onSelect(e.target.value)}>{pairs.map(p=><option key={p.key} value={p.key}>{p.left} given {p.right}</option>)}</select></label></div>
      <p>Seberapa sering residual {p.left} berada di 10% terbawah ketika residual {p.right} juga berada di 10% terbawah?</p>
      <div className={s.stats}><div><small>Observed lower co-exceedance</small><strong>{pct(p.lower)}</strong><small>{p.lower_count} joint events / {p.lower_total} conditioning events</small></div><div><small>Observed upper co-exceedance</small><strong>{pct(p.upper)}</strong><small>Both residuals in upper 10%</small></div><div><small>Posterior mean</small><strong>{pct(p.posterior_mean)}</strong><small>Beta(1,1) prior + event counts</small></div><div><small>80% credible interval</small><strong>{pct(p.posterior_interval[0])}–{pct(p.posterior_interval[1])}</strong><small>Under an independent-event binomial model</small></div></div>
      <div className={s.notice}>{p.lower_total<30?'Small tail sample: interpret estimates cautiously. ':''}These are finite-threshold residual co-exceedances, not fitted copula families, asymptotic tail dependence, or probabilities of a market crash. Events may cluster; the interval does not adjust for serial dependence or parameter estimation.</div>
      <p>Prior: Beta(1,1). Evidence: {p.lower_count} successes and {p.lower_total-p.lower_count} other conditioning events. Posterior: Beta({p.lower_count+1}, {p.lower_total-p.lower_count+1}). Under independence of the two residual series, conditional lower-tail frequency is approximately 10%, not zero.</p>
    </section>
    <section className={s.panel}><h2>Lower-tail concentration across the basket</h2><p>Sorted by observed conditional frequency; inspect event counts before comparing pairs.</p><div className={s.tableWrap}><table><thead><tr><th>Pair · left given right</th><th>Observed lower</th><th>Events</th><th>Posterior mean</th><th>80% interval</th></tr></thead><tbody>{[...pairs].sort((a,b)=>(b.lower??-1)-(a.lower??-1)).map(p=><tr key={p.key}><td><button onClick={()=>onSelect(p.key)} aria-pressed={selected===p.key}>{p.left} | {p.right}</button></td><td>{pct(p.lower)}</td><td>{p.lower_count} / {p.lower_total}</td><td>{pct(p.posterior_mean)}</td><td>{pct(p.posterior_interval[0])}–{pct(p.posterior_interval[1])}</td></tr>)}</tbody></table></div></section>
  </>;
}

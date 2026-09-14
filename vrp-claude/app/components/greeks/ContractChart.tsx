"use client";
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, IChartApi, UTCTimestamp } from 'lightweight-charts';
import { ContractBar } from '../../lib/contractWorkspace';

export default function ContractChart({bars}:{bars:ContractBar[]}) {
  const container=useRef<HTMLDivElement>(null), api=useRef<IChartApi|null>(null);
  const [hover,setHover]=useState<ContractBar|null>(null);
  useEffect(()=>{
    if (!container.current) return;
    const chart=createChart(container.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#0b1017'},textColor:'#93a4b8',fontFamily:'monospace',fontSize:11},grid:{vertLines:{color:'#17212f'},horzLines:{color:'#17212f'}},timeScale:{timeVisible:true,secondsVisible:false},localization:{locale:'en-US'},rightPriceScale:{borderColor:'#263143'}});
    api.current=chart;
    const candles=chart.addSeries(CandlestickSeries,{upColor:'#4dd4bb',downColor:'#ef8187',borderVisible:false,wickUpColor:'#4dd4bb',wickDownColor:'#ef8187',priceFormat:{type:'price',precision:3,minMove:.001}});
    candles.setData(bars.map(b=>({...b,time:b.time as UTCTimestamp})));
    const volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''},1);
    volume.setData(bars.map(b=>({time:b.time as UTCTimestamp,value:b.volume,color:b.close>=b.open?'#287c72':'#823f4b'})));
    chart.panes()[0].setHeight(305); chart.panes()[1].setHeight(90);
    const byTime=new Map(bars.map(b=>[b.time,b]));
    chart.subscribeCrosshairMove(p=>setHover(byTime.get(Number(p.time)) ?? null));
    chart.timeScale().fitContent();
    return ()=>{api.current=null;chart.remove();};
  },[bars]);
  const shown=hover ?? bars[bars.length-1];
  return <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1017]">
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-[11px] text-slate-400">
      <span>{shown ? `${new Date(shown.time*1000).toISOString().slice(0,16).replace('T',' ')} UTC · O ${shown.open.toFixed(3)} H ${shown.high.toFixed(3)} L ${shown.low.toFixed(3)} C ${shown.close.toFixed(3)} · Vol ${shown.volume.toLocaleString()}` : 'No historical bars in this period'}</span>
      <button className="rounded border border-slate-700 px-2 py-1 hover:text-white" onClick={()=>api.current?.timeScale().fitContent()}>Fit chart</button>
    </div>
    <div ref={container} className="h-[420px] w-full" role="img" aria-label={`Historical contract candles and volume, ${bars.length} bars. Exact values in the data table below.`}/>
    <details className="border-t border-slate-800 p-3 text-xs text-slate-400"><summary className="cursor-pointer">Chart data · latest 100 bars · UTC</summary><div className="max-h-64 overflow-auto"><table className="w-full whitespace-nowrap text-right"><thead><tr>{['Time','Open','High','Low','Close','Volume'].map(k=><th className="p-2" key={k}>{k}</th>)}</tr></thead><tbody>{bars.slice(-100).reverse().map(b=><tr key={b.time}><td className="p-2">{new Date(b.time*1000).toISOString().slice(0,16)}</td>{[b.open,b.high,b.low,b.close,b.volume].map((v,i)=><td className="p-2" key={i}>{v.toLocaleString()}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}

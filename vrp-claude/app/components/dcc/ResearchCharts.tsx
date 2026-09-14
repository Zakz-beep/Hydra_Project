"use client";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, Brush } from 'recharts';
import styles from './CorrelationWorkspace.module.css';

export const number = (v: number | null | undefined, digits=3) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
export function Trend({data, series, domain, percent=false}: {
  data: Record<string, unknown>[]; series: {key:string; name:string; color:string; step?:boolean}[];
  domain?: [number,number]; percent?:boolean;
}) {
  return <div className={styles.chart}><ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{top:12,right:16,bottom:0,left:0}}>
      <CartesianGrid stroke="#2b3b4a" strokeDasharray="3 3" vertical={false}/>
      <XAxis dataKey="timestamp" minTickGap={55} tick={{fontSize:10,fill:'#a6b5c4'}} tickFormatter={v=>String(v).slice(0,10)}/>
      <YAxis domain={domain ?? ['auto','auto']} allowDataOverflow={!!domain} width={55} tick={{fontSize:10,fill:'#a6b5c4'}} tickFormatter={v=>percent ? `${number(v,0)}%` : number(v,domain?1:0)}/>
      <Tooltip labelFormatter={v=>String(v)} contentStyle={{background:'#101c29',borderColor:'#425568',fontSize:12,color:'#edf3f7'}} formatter={(v:number)=>number(v,3)}/>
      <Legend wrapperStyle={{fontSize:11}}/>
      <ReferenceLine y={0} stroke="#627588"/>
      {series.map(s=><Line key={s.key} type={s.step?'stepAfter':'linear'} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false}/>)}
      <Brush ariaLabel="Chart time range handle. Use left and right arrow keys to adjust." dataKey="timestamp" height={20} stroke="#627588" fill="#101c29" tickFormatter={v=>String(v).slice(0,10)} travellerWidth={8}/>
    </LineChart>
  </ResponsiveContainer></div>;
}

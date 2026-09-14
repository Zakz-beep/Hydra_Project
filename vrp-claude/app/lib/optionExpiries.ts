import type { GreeksSnapshot } from './greeks';
export const expiryDays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function expiryWeekday(expiry:string):string {
  return /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiryDays[new Date(`${expiry}T12:00:00Z`).getUTCDay()] || '' : '';
}
export const expiryLabel=(expiry:string)=>`${expiryWeekday(expiry)} · ${expiry}`;
export function actualExpiries(data:GreeksSnapshot):string[] {
  return Array.from(new Set(Object.values(data.by_expiry||{}).flatMap(b=>(b.strikes||[]).map(r=>r.expiry)))).sort();
}
export function bucketExpiries(data:GreeksSnapshot,bucket:string):string[] {
  if(bucket==='all')return actualExpiries(data);
  return Array.from(new Set((data.by_expiry?.[bucket]?.strikes||[]).map(r=>r.expiry))).sort();
}
// Chart-only projection. Aggregate fields are not recomputed; levels come from the scoped API.
export function surfaceScope(data:GreeksSnapshot,expiries:string[]):GreeksSnapshot {
  const selected=new Set(expiries);
  return {...data,by_expiry:Object.fromEntries(Object.entries(data.by_expiry||{}).map(([k,b])=>[k,{...b,expiry_dates:b.expiry_dates.filter(e=>selected.has(e)),strikes:(b.strikes||[]).filter(r=>selected.has(r.expiry))}]))};
}

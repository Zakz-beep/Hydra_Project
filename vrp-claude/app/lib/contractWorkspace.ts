export type ContractBar = {time:number;open:number;high:number;low:number;close:number;volume:number};
export type QuoteEvent = {type:'quote';symbol:string;timestamp:string;received_at:string;bid:number;ask:number;bid_size:number|null;ask_size:number|null;crossed:boolean};
export type TradeEvent = {type:'trade';symbol:string;timestamp:string;received_at:string;price:number;size:number;exchange:string;condition:string;sequence?:number};
export type StreamEvent = QuoteEvent | TradeEvent | {type:'status';state:string;message:string;feed?:string} | {type:'heartbeat';received_at:string};
export type ContractHistory = {symbol:string;feed:string;interval:string;bars:ContractBar[];quote:QuoteEvent|null;trade:TradeEvent|null;iv:number|null;greeks:Record<string,number|null>;captured_at:string;requested_start:string;requested_end:string;warnings:string[];bars_basis:string;greeks_basis:string};

export function newerObservation<T extends {timestamp:string}>(current:T|null, next:T):T|null {
  const time = Date.parse(next.timestamp);
  if (!Number.isFinite(time)) return current;
  if (!current) return next;
  const prior=Date.parse(current.timestamp);
  // Date.parse truncates to milliseconds; preserve ordering within a millisecond
  // for provider RFC3339 micro/nanosecond timestamps.
  const remainder=(value:string)=>Number((value.match(/\.(\d+)/)?.[1]||'').padEnd(9,'0').slice(3,9));
  return time>prior || time===prior && remainder(next.timestamp)>=remainder(current.timestamp) ? next : current;
}

export function spread(quote:QuoteEvent|null) {
  if (!quote || quote.bid <= 0 || quote.ask < quote.bid) return null;
  const mid=(quote.bid+quote.ask)/2;
  return {mid,absolute:quote.ask-quote.bid,percent:(quote.ask-quote.bid)/mid*100};
}

export async function loadContract(symbol:string, interval:string, days:number, signal:AbortSignal):Promise<ContractHistory> {
  const response=await fetch(`/api/greeks/contracts/${encodeURIComponent(symbol)}/history?interval=${encodeURIComponent(interval)}&days=${days}`,{signal,cache:'no-store'});
  const body=await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || 'Contract history unavailable');
  if (body.symbol !== symbol || !Array.isArray(body.bars)) throw new Error('Unexpected contract response');
  return body;
}

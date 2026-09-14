"use client";
import { useEffect, useState } from 'react';
import { newerObservation, QuoteEvent, StreamEvent, TradeEvent } from '../../lib/contractWorkspace';

export function useContractStream(symbol:string, running:boolean) {
  const [quote,setQuote]=useState<QuoteEvent|null>(null);
  const [trade,setTrade]=useState<TradeEvent|null>(null);
  const [tape,setTape]=useState<TradeEvent[]>([]);
  const [status,setStatus]=useState({state:'stopped',message:'Start streaming to receive quotes and trades for this contract.'});
  const [received,setReceived]=useState<string|null>(null);
  const [gaps,setGaps]=useState(false);
  useEffect(()=>{
    if (!running) { setStatus(s=>s.state==='error'?s:{state:'stopped',message:'Stream stopped. Last observations retained with their timestamps.'}); return; }
    setQuote(null);setTrade(null);setTape([]);setReceived(null);setGaps(false);
    setStatus({state:'connecting',message:'Opening contract stream…'});
    let pendingQuote:QuoteEvent|null=null, pendingTrades:TradeEvent[]=[], pendingReceived:string|null=null;
    const source=new EventSource(`/api/greeks/contracts/${encodeURIComponent(symbol)}/stream`);
    source.onmessage=event=>{
      let item:StreamEvent;
      try { item=JSON.parse(event.data); } catch { setGaps(true); return; }
      pendingReceived=new Date().toISOString();
      if (item.type==='status') {
        setStatus({state:item.state,message:item.message});
        if (item.state==='gap'||item.state==='reconnecting') setGaps(true);
        if (item.state==='error') source.close();
      } else if (item.type==='quote' && item.symbol===symbol) pendingQuote=newerObservation(pendingQuote,item);
      else if (item.type==='trade' && item.symbol===symbol) {
        pendingTrades.push(item);
        if (pendingTrades.length>500) { pendingTrades=pendingTrades.slice(-500);setGaps(true); }
      }
    };
    source.onerror=()=>{
      // The backend reconnects its upstream. A broken HTTP/SSE link requires an
      // explicit restart rather than an unbounded browser reconnect loop.
      source.close();setGaps(true);setStatus({state:'error',message:'Stream link unavailable. Stop / Start to retry; check credentials, feed and connection limits.'});
    };
    const paint=setInterval(()=>{
      if (pendingReceived) { setReceived(pendingReceived);pendingReceived=null; }
      if (pendingQuote) { const next=pendingQuote;setQuote(old=>newerObservation(old,next));pendingQuote=null; }
      if (pendingTrades.length) {
        const batch=pendingTrades;pendingTrades=[];
        setTrade(old=>batch.reduce<TradeEvent|null>((latest,next)=>newerObservation(latest,next),old));
        setTape(old=>[...batch.reverse(),...old].slice(0,100));
      }
    },250);
    return ()=>{source.close();clearInterval(paint);};
  },[symbol,running]);
  return {quote,trade,tape,status,received,gaps};
}

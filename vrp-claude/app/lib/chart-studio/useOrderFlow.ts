'use client';
import { useEffect, useState } from 'react';
import { FlowBook, FlowTrade, mergeTrades } from './orderflow';

const empty = { key: '', trades: [] as FlowTrade[], book: null as FlowBook | null, status: 'Connecting', gap: false, capped: false };
export function useOrderFlow(symbol: string, enabled: boolean, reset: number) {
  const [state, setState] = useState(empty); const [now, setNow] = useState(Date.now());
  const key = `${symbol}:${reset}:${enabled}`;
  useEffect(() => {
    setState({ ...empty, key }); if (!enabled) return;
    const events = new EventSource(`/api/chart-studio/orderflow?${new URLSearchParams({ provider: 'hyperliquid', symbol })}`);
    let trades: FlowTrade[] = [], book: FlowBook | null = null, status = 'Connecting', gap = false, capped = false, dirty = false;
    const cutoff = reset || 0;
    events.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'status') { status = data.status; if (status.includes('Reconnecting')) gap = true; }
        if (data.type === 'flow') {
          if (data.trades?.length) {
            const next = mergeTrades(trades, data.trades, Math.max(cutoff, Date.now() - 3600000));
            capped ||= next.length >= 20000; trades = next;
          }
          if (data.book === null) book = null; else if (data.book && (!book || data.book.time >= book.time)) book = data.book;
          gap ||= Boolean(data.gap); if (data.status) status = data.status;
        }
        dirty = true;
      } catch { /* Ignore incomplete frames during reconnect. */ }
    };
    events.onerror = () => { status = 'Reconnecting · possible trade gap'; gap = true; book = null; dirty = true; };
    const publish = setInterval(() => {
      setNow(Date.now());
      if (dirty) { setState({ key, trades, book, status, gap, capped }); dirty = false; }
    }, 500);
    return () => { events.close(); clearInterval(publish); };
  }, [key, symbol, enabled, reset]);
  return { ...(state.key === key ? state : empty), now };
}

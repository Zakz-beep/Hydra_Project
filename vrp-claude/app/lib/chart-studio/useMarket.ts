'use client';
import { useEffect, useState } from 'react';
import { Bar, Dataset, Instrument, Interval, MarketContext, mergeBar } from './types';
export function useMarket(instrument: Instrument, interval: Interval, refresh: number) {
  const [data, setData] = useState<(Dataset & { _key: string }) | null>(null);
  const requestKey = `${instrument.provider}:${instrument.symbol}:${interval}`;
  const [status, setStatus] = useState('Loading');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; let loaded = false; let buffer: Bar[] = []; let controller = new AbortController(); let poll: ReturnType<typeof setInterval>; let market: MarketContext | undefined;
    const query = new URLSearchParams({ provider: instrument.provider, symbol: instrument.symbol, interval });
    setData(null); setStatus('Loading'); setError('');
    async function load() {
      controller.abort(); controller = new AbortController(); const own = controller;
      loaded = false;
      try {
        const response = await fetch(`/api/chart-studio/bars?${query}`, { signal: own.signal });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'History unavailable');
        if (!active || own.signal.aborted) return;
        for (const bar of buffer) result.bars = mergeBar(result.bars, bar);
        buffer = []; loaded = true; setData({ ...result, market, _key: `${instrument.provider}:${instrument.symbol}:${interval}` }); setError('');
        setStatus(instrument.provider === 'yahoo' ? 'Snapshot · 20s' : 'Connected');
      } catch (e) { if (active && !own.signal.aborted) { setError(e instanceof Error ? e.message : 'Data unavailable'); setStatus('Stale / unavailable'); loaded = true; } }
    }
    void load();
    let source: EventSource | undefined;
    if (instrument.provider === 'hyperliquid') {
      source = new EventSource(`/api/chart-studio/stream?${query}`);
      source.onmessage = event => {
        if (!active) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'bar') {
            if (!loaded) { buffer.push(msg.bar); buffer = buffer.slice(-5000); }
            else setData(previous => previous ? { ...previous, bars: mergeBar(previous.bars, msg.bar), asOf: Date.now() } : previous);
            setStatus('Live');
          } else if (msg.type === 'context') { market = msg.market; setData(previous => previous ? { ...previous, market } : previous); }
          else if (msg.type === 'status') { setStatus(msg.status); if (msg.status === 'Connected') void load(); }
        } catch { setError('Invalid market update'); }
      };
      source.onerror = () => { if (active) setStatus('Reconnecting'); };
      poll = setInterval(() => { if (active) void load(); }, 60000);
    } else poll = setInterval(() => { if (active) void load(); }, 20000);
    return () => { active = false; controller.abort(); source?.close(); clearInterval(poll); };
  }, [instrument.provider, instrument.symbol, interval, refresh]);
  return { data: data?._key === requestKey ? data : null, status, error };
}

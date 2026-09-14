'use client';
import { useEffect, useState } from 'react';
import { Instrument } from '../../lib/chart-studio/types';
import LightweightChartDashboard from '../lwc/core/LightweightChartDashboard';
export default function TerminalChartPage({ ticker, onTickerChange }: { ticker: string; onTickerChange: (ticker: string) => void }) {
  const [resolved, setResolved] = useState<{ ticker: string; instrument: Instrument } | null>(null);
  const [error, setError] = useState(''); const [matches, setMatches] = useState<Instrument[]>([]); const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setMatches([]);
    if (!ticker.includes(':') && !ticker.endsWith('.P')) { setResolved({ ticker, instrument: { provider: 'yahoo', symbol: ticker, name: ticker } }); return; }
    (async () => {
      try {
        const r = await fetch(`/api/chart-studio/search?${new URLSearchParams({ provider: 'hyperliquid', q: ticker, limit: '500' })}`, { signal: controller.signal });
        const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Market discovery failed');
        if (controller.signal.aborted) return;
        const exact = (data as Instrument[]).filter(i => i.symbol.toLowerCase() === ticker.toLowerCase());
        const candidates = exact.length ? exact : data as Instrument[];
        if (candidates.length === 1) setResolved({ ticker, instrument: candidates[0] });
        else if (candidates.length > 1) setMatches(candidates);
        else throw new Error(`No active Hyperliquid market found for ${ticker}.`);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Market discovery failed'); }
    })();
    return () => controller.abort();
  }, [ticker, retry]);
  const pending = resolved?.ticker !== ticker || Boolean(error);
  return <>
  {pending && <section className="rounded-xl border border-slate-700 bg-[#121923] p-6 text-sm text-slate-300" aria-live="polite">
    {error ? <><p>{error}</p><button className="mt-4 rounded border border-slate-600 px-4 py-2" onClick={() => setRetry(n => n + 1)}>Retry market discovery</button></> : matches.length ? <><h2>Choose the Hyperliquid venue for {ticker}</h2><div className="mt-4 flex flex-wrap gap-2">{matches.map(i => <button className="rounded border border-slate-600 p-3" key={i.symbol} onClick={() => onTickerChange(i.symbol)}>{i.symbol} · {i.collateral || 'Collateral not reported'}</button>)}</div></> : `Opening ${ticker}…`}
  </section>}
  {resolved && <div hidden={pending}><LightweightChartDashboard initialInstrument={resolved.instrument} onInstrumentChange={i => onTickerChange(i.provider === 'hyperliquid' ? i.symbol.includes(':') ? i.symbol : `${i.symbol}USDT.P` : i.symbol)} /></div>}
  </>;
}

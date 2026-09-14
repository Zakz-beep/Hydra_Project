'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Instrument, Provider, WATCHLIST } from '../../../lib/chart-studio/types';
export default function SymbolPicker({ current, onSelect, onClose }: { current: Instrument; onSelect: (i: Instrument) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null);
  const [provider, setProvider] = useState<Provider>(current.provider); const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]); const [status, setStatus] = useState('');
  const [scope, setScope] = useState('all'); const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0); const [catalogCount, setCatalogCount] = useState(0); const [loading, setLoading] = useState(false);
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setTotal(0);
    if (limit === 50) setResults(WATCHLIST.filter(i => i.provider === provider && scope !== 'hip3' && i.symbol.includes(query.toUpperCase())));
    const timer = setTimeout(async () => {
      setStatus('Searching…');
      try {
        const r = await fetch(`/api/chart-studio/search?${new URLSearchParams({ provider, q: query || (provider === 'yahoo' ? 'SPY' : ''), scope, limit: String(limit) })}`, { signal: controller.signal });
        const data = await r.json(); if (!r.ok) throw new Error(data.error);
        if (!controller.signal.aborted) { setResults(data); setTotal(Number(r.headers.get('X-Total-Count') || data.length)); setCatalogCount(Number(r.headers.get('X-Catalog-Count') || 0)); setStatus(data.length ? '' : 'No instruments found'); }
      } catch (e) { if (!controller.signal.aborted) setStatus(e instanceof Error ? e.message : 'Search failed'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [provider, query, scope, limit]);
  return <dialog className="cs-dialog" ref={dialog} onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }}>
    <div className="cs-dialog-head"><div><span className="cs-eyebrow">MARKET EXPLORER</span><h2>Find your next chart</h2></div><button aria-label="Close symbol search" onClick={onClose}><X size={18} /></button></div>
    <div className="cs-segments">{(['hyperliquid', 'yahoo'] as Provider[]).map(v => <button key={v} className={provider === v ? 'active' : ''} onClick={() => { setProvider(v); setLimit(50); }}>{v === 'hyperliquid' ? 'Hyperliquid · Perpetuals' : 'Yahoo · Global markets'}</button>)}</div>
    <label className="cs-search-field"><Search size={17} /><input ref={input} placeholder={provider === 'hyperliquid' ? 'BTC, TSLAUSDT.P, xyz:NVDA…' : 'Search symbol or company…'} aria-label="Search instruments" value={query} onChange={e => { setQuery(e.target.value); setLimit(50); }} /></label>
    {provider === 'hyperliquid' && <div className="cs-market-filters">{[['all', 'All markets'], ['native', 'Native'], ['hip3', 'HIP-3 / Builders']].map(([value, label]) => <button key={value} className={scope === value ? 'active' : ''} aria-pressed={scope === value} onClick={() => { setScope(value); setLimit(50); }}>{label}</button>)}<span>{catalogCount > 0 ? `${catalogCount} active` : 'Live catalog'}</span></div>}
    <div className="cs-search-results" aria-busy={loading}>{results.map(i => <button key={`${i.provider}:${i.symbol}`} onClick={() => { onSelect(i); onClose(); }}><strong>{i.symbol}</strong><span>{i.name}</span><small>{provider === 'hyperliquid' ? i.venue && i.venue !== 'native' ? 'HIP-3' : 'PERP' : 'YAHOO'}</small></button>)}</div>
    {results.length < total && <button className="cs-load-markets" disabled={loading} onClick={() => setLimit(n => n + 50)}>Show more markets ({results.length} / {total})</button>}
    <p className="cs-muted cs-dialog-note" role="status">{status || (provider === 'hyperliquid' ? `${results.length} of ${total} matches · USDT.P is a search alias. Select the actual venue and collateral shown above.` : 'Each provider keeps its own prices, sessions and volume units.')}</p>
  </dialog>;
}

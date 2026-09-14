'use client';
import { useEffect, useState } from 'react';
import { researchFetch } from '../../lib/greeksResearch';

export function useResearch<T>(path: string) {
  const [data, setData] = useState<T>(); const [error, setError] = useState('');
  const [busy, setBusy] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController(); setBusy(true); setError(''); setData(undefined);
    researchFetch<T>(path, request.signal).then(value => { if (!request.signal.aborted) setData(value); })
      .catch(e => { if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Request failed'); })
      .finally(() => { if (!request.signal.aborted) setBusy(false); });
    return () => request.abort();
  }, [path, revision]);
  return { data, error, busy, retry: () => setRevision(v => v + 1) };
}
export function ResearchState({ busy, error, retry }: { busy: boolean; error: string; retry: () => void }) {
  if (busy) return <div role="status" className="space-y-3 rounded-xl border border-zinc-800 p-6"><p className="text-sm text-zinc-400">Loading dated market observations…</p><div className="h-36 animate-pulse rounded bg-zinc-900" /></div>;
  if (error) return <div role="alert" className="rounded-xl border border-amber-800 bg-amber-950/20 p-6 text-sm text-amber-200"><p>{error}</p><button className="mt-3 rounded border border-amber-700 px-3 py-2" onClick={retry}>Retry data</button></div>;
  return null;
}
export function ResearchMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-w-0 border-l border-zinc-800 px-4 py-3 first:border-l-0"><p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p><p className="mt-2 break-words text-2xl font-medium text-zinc-100">{value}</p><p className="mt-1 text-[11px] text-zinc-400">{detail}</p></div>;
}

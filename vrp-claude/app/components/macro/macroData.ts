'use client';
import { useEffect, useState } from 'react';
export interface Source { name?: string; url: string; fetched_at: string | null; stale: boolean; error: string | null; count?: number }
export interface MacroEvent { id: string; title: string; date: string; precision: 'time' | 'date'; source: string; url: string | null; category: string; impact: string; impact_basis: string; actual: string | null; forecast: string | null; previous: string | null; unit: string | null; first_seen: string; last_seen: string }
export interface News { id: string; title: string; date: string; source: string; url: string; category: string }
export interface DashboardData { events: MacroEvent[]; news: News[]; sources: Source[]; generated_at: string }
export interface ModelResult {
  key: string; series: string; label: string; unit: string; frequency: string; window: number; strength: number;
  model_version: string; vintage: string; source: Source; generated_at: string; source_url: string; input_hash: string;
  latest: number; latest_period: string; target_period: string; threshold: number; probability_above: number;
  prediction: { mean: number; lower: number; upper: number; training_pairs: number };
  metrics: null | { n: number; mae: number; rmse: number; naive_mae: number; skill: number | null; coverage: number };
  evaluation: { period: string; actual: number; model: number; naive: number; lower: number; upper: number; surprise?:number; predictive_sd?:number; model_z?:number }[];
  history: { period: string; value: number | null }[];
}
export const MODELS = [{ key: 'core_cpi', label: 'Core CPI' }, { key: 'cpi', label: 'Headline CPI' }, { key: 'payrolls', label: 'Nonfarm payrolls' }, { key: 'unemployment', label: 'Unemployment rate' }, { key: 'core_pce', label: 'Core PCE' }, { key: 'pce', label: 'Headline PCE' }, { key: 'retail', label: 'Retail sales' }, { key: 'gdp', label: 'Real GDP' }, { key: 'claims', label: 'Jobless claims' }];
export function useMacro<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setData(null); setError('');
    if (!path) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/macro/${path}`, { signal: abort.signal }).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Request failed'); return body as T;
    }).then(d => { if (!abort.signal.aborted) setData(d); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [path, revision]);
  return { data, error, loading, refresh: () => setRevision(r => r + 1) };
}
export function num(n: number | null | undefined, digits = 2) { return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }); }
export function day(date: string, tz: string) { return date.length === 10 ? date : new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date)); }
export function timeLabel(event: Pick<MacroEvent, 'precision' | 'date'>, tz: string) { return event.precision === 'date' ? 'Time unavailable' : new Date(event.date).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); }
export function csv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+@\t\r]/.test(s) || /^-[^\d.]/.test(s)) s = "'" + s; return `"${s.replaceAll('"', '""')}"`; };
  const blob = new Blob([[keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

'use client';

import { useEffect, useState } from 'react';
import { OptionsProvenance } from '../../lib/greeks';

interface Status { provider: string; feed: string; credentials_configured: boolean; account_environment: string }
export default function OptionsDataSource({ provenance }: { provenance?: OptionsProvenance }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/greeks/provider', { signal: controller.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(setStatus).catch(() => {});
    return () => controller.abort();
  }, []);
  const feed = provenance?.feed || status?.feed || 'indicative';
  return <section aria-label="Options data provenance" className="rounded-xl border border-cyan-900/70 bg-cyan-950/10 p-4 text-xs leading-relaxed">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-cyan-200">ALPACA / {feed.toUpperCase()}</h3><span className="rounded border border-amber-800/60 px-2 py-1 text-amber-300">{feed === 'indicative' ? 'Delayed trades · modified quotes' : 'OPRA · inspect quote timestamps'}</span></div>
    <p className="mt-2 text-zinc-300">{feed === 'indicative' ? 'Untuk riset indikatif. Quote bukan harga OPRA executable; angka exposure tetap merupakan hasil model.' : 'Feed OPRA dipilih secara eksplisit. OI bertanggal dan model exposure tetap berbeda dari posisi dealer yang teramati.'}</p>
    {!provenance && <p className="mt-2 text-zinc-400">{status?.credentials_configured ? 'Konfigurasi key ditemukan; menunggu snapshot yang berhasil.' : 'Isi API key di file lokal python/.env.alpaca menggunakan python/.env.alpaca.example. Jangan taruh secret di browser atau chat.'}</p>}
    {provenance && <>
      <div className="mt-3 grid gap-3 text-zinc-400 sm:grid-cols-2 xl:grid-cols-4">
        <div>Model / eligible / contracts<strong className="mt-1 block text-zinc-200">{provenance.modeled_contracts ?? '—'} / {provenance.eligible_contracts ?? '—'} / {provenance.contract_count ?? '—'}</strong></div>
        <div>OI observation dates<strong className="mt-1 block break-words text-zinc-200">{provenance.oi_dates?.join(', ') || 'Unavailable'}</strong></div>
        <div>Volume coverage<strong className="mt-1 block text-zinc-200">{provenance.volume_covered ?? 0} contracts · {provenance.volume_date || '—'}</strong></div>
        <div>Underlying<strong className="mt-1 block text-zinc-200">{provenance.stock_feed?.toUpperCase()} · {provenance.spot_basis}</strong></div>
      </div>
      <details className="mt-3 border-t border-cyan-900/50 pt-3"><summary className="cursor-pointer text-cyan-300 focus-visible:outline focus-visible:outline-cyan-400">Source timestamps, coverage & model assumptions</summary>
        <div className="mt-3 space-y-2 break-words text-zinc-400"><p>Retrieved: {provenance.retrieved_at}</p><p>Spot: {provenance.spot_timestamp}</p><p>Quote range: {provenance.quote_oldest} → {provenance.quote_newest}</p><p>Contracts captured: {provenance.contracts_retrieved_at}</p><p>Volume request cutoff: {provenance.volume_requested_end}</p><p>Risk-free model input: {provenance.risk_free_rate == null ? '—' : `${(provenance.risk_free_rate * 100).toFixed(2)}%`} · {provenance.greeks_basis}</p><p>Excluded: {Object.entries(provenance.excluded || {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'None'}</p><ul className="list-disc space-y-2 pl-4">{provenance.warnings?.map(w => <li key={w}>{w}</li>)}</ul></div>
      </details>
    </>}
    <p className="mt-3 text-zinc-500">Arsip Alpaca dipisahkan per feed. History menyediakan pilihan arsip Yahoo lama. RV/VIX dan holdings tetap memakai sumber riset terpisah.</p>
  </section>;
}

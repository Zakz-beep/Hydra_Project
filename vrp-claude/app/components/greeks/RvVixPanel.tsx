'use client';
import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { numberLabel as n, researchCsv, VolatilityResearch } from '../../lib/greeksResearch';
import { ResearchMetric, ResearchState, useResearch } from './ResearchPanelShell';

export default function RvVixPanel() {
  const { data, busy, error, retry } = useResearch<VolatilityResearch>('rv-vix');
  const [view, setView] = useState<'trailing' | 'forward'>('trailing');
  const [unit, setUnit] = useState<'annual' | '30d'>('30d'); const [days, setDays] = useState(365);
  const scale = unit === 'annual' ? 1 : Math.sqrt(30 / 365);
  const matured = data?.rows.filter(row => row.rv_forward != null) || [];
  const observation = view === 'forward' ? matured.at(-1) : data?.latest;
  const rv = observation ? view === 'forward' ? observation.rv_forward : observation.rv_trailing : null;
  const plot = useMemo(() => {
    if (!data?.rows.length) return [];
    const last = Date.parse(data.rows.at(-1)!.date); const cutoff = last - days * 86400000;
    return data.rows.filter(row => Date.parse(row.date) >= cutoff).map(row => {
      const value = view === 'trailing' ? row.rv_trailing : row.rv_forward;
      return { ...row, implied: row.vix * scale, realized: value == null ? null : value * scale };
    });
  }, [data, days, view, scale]);
  const diff = observation && rv != null ? (observation.vix - rv) * scale : null;
  return <section aria-label="RV versus VIX research" className="space-y-4">
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] tracking-widest text-cyan-400">S&P 500 · 30 CALENDAR DAYS</p><h4 className="mt-1 text-lg font-semibold text-zinc-100">Realized vs implied volatility</h4><p className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-400">Underlying tetap S&P 500 (^GSPC), meskipun ticker utama berbeda. VIX berasal dari opsi SPX; bukan IV saham individual atau harga VIX futures.</p></div><button onClick={retry} disabled={busy} className="flex items-center gap-2 rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-300 disabled:opacity-50"><RefreshCw size={13} />Reload daily data</button></div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex flex-wrap gap-1 rounded border border-zinc-700 p-1" role="group" aria-label="Volatility comparison mode">
          <button aria-pressed={view === 'trailing'} onClick={() => setView('trailing')} className={`rounded px-3 py-2 ${view === 'trailing' ? 'bg-cyan-300 text-zinc-950' : 'text-zinc-300'}`}>Historical context</button>
          <button aria-pressed={view === 'forward'} onClick={() => setView('forward')} className={`rounded px-3 py-2 ${view === 'forward' ? 'bg-cyan-300 text-zinc-950' : 'text-zinc-300'}`}>Forward evaluation</button>
        </div>
        <label className="flex items-center gap-2 text-zinc-400">Units<select aria-label="Volatility units" value={unit} onChange={e => setUnit(e.target.value as 'annual' | '30d')} className="rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"><option value="30d">30-day volatility (%)</option><option value="annual">Annualized volatility (%)</option></select></label>
        <label className="flex items-center gap-2 text-zinc-400">History<select aria-label="Volatility history range" value={days} onChange={e => setDays(Number(e.target.value))} className="rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-200"><option value={90}>3 months</option><option value={180}>6 months</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
      </div>
    </div>
    <ResearchState busy={busy} error={error} retry={retry} />
    {data && <>
      <p className="rounded border border-cyan-900 bg-cyan-950/20 p-3 text-xs leading-relaxed text-cyan-100">{view === 'trailing' ? 'Historical context: VIX(t) melihat 30 hari ke depan; RV trailing(t) mengukur 30 hari sebelumnya. Selisih ini bukan evaluasi forecast atau profit trading.' : 'Forward evaluation: pada tanggal t, bandingkan VIX(t) dengan RV dari return setelah t hingga t+30 hari kalender. Bagian yang belum matang atau datanya tidak lengkap dibiarkan kosong.'}</p>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30 lg:grid-cols-4">
        <ResearchMetric label="VIX implied" value={observation ? `${n(observation.vix * scale)}%` : '—'} detail={`${unit === '30d' ? '30-day scale' : 'Annualized'} · VIX index ${n(observation?.vix)} · origin ${observation?.date || 'unavailable'}`} />
        <ResearchMetric label={view === 'trailing' ? 'RV trailing 30d' : 'RV subsequent 30d'} value={rv == null ? '—' : `${n(rv * scale)}%`} detail={`${view === 'forward' ? 'Latest matured origin' : 'Daily-close proxy'} · ${observation ? view === 'forward' ? observation.forward_returns : observation.trailing_returns : 0} returns`} />
        <ResearchMetric label="Implied − realized" value={diff == null ? '—' : `${diff >= 0 ? '+' : ''}${n(diff)} pp`} detail="Volatility-point difference; not P&L" />
        <ResearchMetric label="Evaluation origins" value={data.evaluation.samples.toLocaleString()} detail="Matured overlapping windows · full dataset" />
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 p-3 sm:p-5">
        <div className="mb-4 flex flex-wrap justify-between gap-2 text-xs text-zinc-400"><span>{view === 'trailing' ? 'Backward RV vs forward VIX' : 'VIX vs subsequent realized outcome'} · {unit === '30d' ? '30-day' : 'annualized'} %</span><button className="flex items-center gap-2 text-cyan-300" onClick={() => researchCsv('spx-vix-30d-research.csv', data.rows.map(row => ({ ...row, units: 'annualized percent', horizon_calendar_days: 30 })))}><Download size={13} />Export CSV</button></div>
        <div className="h-80 min-w-0" role="img" aria-label="VIX and S&P 500 realized volatility time series"><ResponsiveContainer width="100%" height="100%"><LineChart data={plot} margin={{ top: 12, right: 8, left: -15, bottom: 8 }}><CartesianGrid stroke="#27272a" strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={65} tick={{ fill: '#a1a1aa', fontSize: 10 }} tickFormatter={v => String(v).slice(5)} /><YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} domain={[0, 'auto']} /><Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 11 }} formatter={(v: number) => `${n(v)}%`} /><Legend wrapperStyle={{ fontSize: 11 }} /><Line dataKey="implied" name="VIX implied" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} /><Line dataKey="realized" name={view === 'trailing' ? 'RV trailing 30d' : 'RV subsequent 30d'} stroke="#22d3ee" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} /></LineChart></ResponsiveContainer></div>
      </div>
      <details className="rounded-xl border border-zinc-800 p-4 text-xs leading-relaxed text-zinc-400"><summary className="cursor-pointer text-zinc-200">Methodology, horizon alignment & data quality</summary><div className="mt-4 space-y-3"><p><b>30-day RV:</b> 100 × √Σ log(Pᵢ/Pᵢ₋₁)². <b>Annualized RV:</b> 30-day RV × √(365/30). Return close timestamps lie inside the selected 30-calendar-day window.</p><p><b>30-day implied:</b> VIX × √(30/365). This is a scale conversion of VIX’s 30-day implied variance, not a new daily forecast. We do not compare a single day’s realized move with annualized VIX.</p><p>{data.method}</p><ul className="list-disc space-y-2 pl-5">{data.limitations.map(note => <li key={note}>{note}</li>)}</ul><p>Source: {data.source}. SPX through {data.spx_last_date}; VIX through {data.vix_last_date}. Retrieved {data.retrieved_at}. Cache up to 15 minutes.</p><p>Annualized implied² − subsequent RV² mean: {n(data.evaluation.mean_forward_variance_gap)} vol-point². VIX above subsequent RV: {n(data.evaluation.vix_above_forward_pct)}% of matured origins. These descriptive figures use the full fetched history, not a calibrated forecast probability.</p><a className="text-cyan-300 underline" href="https://cdn.cboe.com/resources/vix/VIX_Methodology.pdf" target="_blank" rel="noreferrer">Cboe VIX methodology</a></div></details>
    </>}
  </section>;
}

'use client';
import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { MODELS, ModelResult, csv, num, useMacro } from './macroData';
import s from './MacroDashboard.module.css';
import ModelSurpriseHistory from './ModelSurpriseHistory';

export default function ForecastLab() {
  const [series, setSeries] = useState('core_cpi'), [window, setWindow] = useState(120), [strength, setStrength] = useState(4), [boundary, setBoundary] = useState(''), [threshold, setThreshold] = useState('');
  const [forceRefresh,setForceRefresh]=useState(false);
  const result = useMacro<ModelResult>(`forecast?series=${series}&window=${window}&strength=${strength}&refresh=${forceRefresh}${threshold ? `&threshold=${encodeURIComponent(threshold)}` : ''}`);
  const [chartMode, setChartMode] = useState<'evaluation' | 'history'>('evaluation');
  const d = result.data;
  function refreshFred(){if(forceRefresh)result.refresh();else setForceRefresh(true);}
  return <section className={s.lab}>
    <div className={s.sectionHead}><div><span className={s.eyebrow}>INTERNAL MODEL / BAYESIAN AR</span><h2>Forecast Lab</h2><p>Prior persistence → observed economic data → posterior predictive distribution.</p></div><button onClick={() => csv(`${series}-walk-forward.csv`, d?.evaluation || [])} disabled={!d}>Export evaluation</button></div>
    <div className={s.controls}>
      <label>Economic series<select value={series} onChange={e => { setSeries(e.target.value); setForceRefresh(false); setBoundary(''); setThreshold(''); }}>{MODELS.map(m => <option value={m.key} key={m.key}>{m.label}</option>)}</select></label>
      <label>Training window<select value={window} onChange={e => setWindow(+e.target.value)}>{[60,120,240].map(n => <option key={n} value={n}>{n} observations</option>)}</select></label>
      <label>Prior strength<select value={strength} onChange={e => setStrength(+e.target.value)}><option value={.5}>0.5 · flexible</option><option value={4}>4 · balanced</option><option value={16}>16 · persistent</option></select></label>
      <form className={s.scenario} onSubmit={e => { e.preventDefault(); if (!boundary || Number.isFinite(Number(boundary))) setThreshold(boundary); }}><label>Scenario threshold<input type="number" step="any" placeholder="Default: latest value" value={boundary} onChange={e => setBoundary(e.target.value)} /></label><button type="submit">Evaluate</button></form>
    </div>
    <p className={s.notice}><strong>Histori rekonstruksi · data FRED sudah direvisi.</strong> Forecast menaksir periode ekonomi berikutnya. Ini bukan konsensus pasar atau rekaman prediksi real-time saat rilis.</p>
    <div className={s.sectionHead}><p>Refresh sumber dibatasi sekali per 30 detik. Cache tetap tersedia jika koneksi gagal.</p><button onClick={refreshFred} disabled={result.loading}>Refresh data FRED</button></div>
    {result.loading && <div className={s.skeleton} role="status">Loading economic history and fitting the model…</div>}
    {result.error && <div className={s.error} role="alert">{result.error}<button onClick={result.refresh}>Retry forecast</button></div>}
    {d && <>
      {d.source.stale && <div className={s.error} role="status"><div><strong>FRED belum berhasil diperbarui.</strong><p>Menggunakan cache dari {d.source.fetched_at ? new Date(d.source.fetched_at).toLocaleString() : 'waktu tidak diketahui'}. Label histori ikut memakai snapshot ini.</p><details><summary>Detail koneksi</summary>{d.source.error || 'Sumber tidak merespons'}</details></div><button onClick={refreshFred}>Coba FRED lagi</button></div>}
      <ModelSurpriseHistory key={d.key} data={d} />
      <div className={s.forecastHero}>
        <div><span className={s.eyebrow}>{d.label} / {d.target_period}</span><div className={s.forecastValue}>{num(d.prediction.mean)} <small>{d.unit}</small></div><span className={s.muted}>Next reference period · {d.prediction.training_pairs} training pairs</span></div>
        <div><span className={s.eyebrow}>80% PREDICTIVE INTERVAL</span><strong className={s.interval}>{num(d.prediction.lower)} <span>to</span> {num(d.prediction.upper)}</strong><span className={s.muted}>Student-t posterior · model assumptions apply</span></div>
        <div><span className={s.eyebrow}>P(NEXT VALUE &gt; {num(d.threshold)})</span><strong className={s.interval}>{num(d.probability_above * 100, 1)}%</strong><span className={s.muted}>Economic outcome probability; not USD direction</span></div>
      </div>
      <div className={s.stats}>
        <div><span>Latest observation · {d.latest_period}</span><strong>{num(d.latest)}</strong><small>{d.unit}</small></div>
        <div><span>Model MAE / naïve MAE</span><strong>{num(d.metrics?.mae)} <i>/ {num(d.metrics?.naive_mae)}</i></strong><small>Same held-out periods · lower is better</small></div>
        <div><span>MAE improvement over naïve</span><strong className={d.metrics?.skill != null && d.metrics.skill < 0 ? s.negative : s.accent}>{num(d.metrics?.skill == null ? null : d.metrics.skill * 100, 1)}%</strong><small>Negative = persistence baseline performed better</small></div>
        <div><span>Observed 80% interval coverage</span><strong>{num(d.metrics ? d.metrics.coverage * 100 : null, 1)}%</strong><small>{d.metrics?.n || 0} sequential holdouts · RMSE {num(d.metrics?.rmse)}</small></div>
      </div>
      <div className={s.chartBox}>
        <div className={s.sectionHead}><div><h3>{chartMode === 'evaluation' ? 'Walk-forward evaluation' : 'Economic observation history'}</h3><p>{chartMode === 'evaluation' ? 'Every prediction uses only the preceding observation prefix. Revisions remain a limitation.' : 'Reference periods, not publication dates. Gaps remain visible.'}</p></div><div className={s.segment}><button aria-pressed={chartMode === 'evaluation'} onClick={() => setChartMode('evaluation')}>Evaluation</button><button aria-pressed={chartMode === 'history'} onClick={() => setChartMode('history')}>History</button></div></div>
        <div className={s.chart}><ResponsiveContainer width="100%" height="100%"><LineChart data={chartMode === 'evaluation' ? d.evaluation : d.history} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="#25303c" vertical={false} /><XAxis dataKey="period" tick={{ fill: '#aab7c6', fontSize: 11 }} minTickGap={50} /><YAxis tick={{ fill: '#aab7c6', fontSize: 11 }} width={60} domain={['auto','auto']} tickFormatter={v => num(v, 1)} />
          <Tooltip contentStyle={{ background: '#111b27', borderColor: '#354353', color: '#edf2f7' }} formatter={(v: number) => num(v, 3)} /><Legend />
          {chartMode === 'evaluation' ? <><Line dataKey="actual" name="Realized (latest vintage)" stroke="#54d5cb" dot={false} isAnimationActive={false} /><Line dataKey="model" name="Internal forecast" stroke="#efb353" dot={false} isAnimationActive={false} /><Line dataKey="lower" name="80% lower" stroke="#748397" strokeDasharray="3 4" dot={false} isAnimationActive={false} /><Line dataKey="upper" name="80% upper" stroke="#748397" strokeDasharray="3 4" dot={false} isAnimationActive={false} /></> : <Line dataKey="value" name={`${d.label} (${d.unit})`} stroke="#54d5cb" dot={false} connectNulls={false} isAnimationActive={false} />}
        </LineChart></ResponsiveContainer></div>
      </div>
      <details className={s.method}><summary>Model specification, provenance & interpretation</summary><p>AR(2) plus the mean of the last three observations, with a normal/inverse-gamma prior centered on persistence. Each training window standardizes its own inputs. Missing periods are not filled; incomplete training pairs are excluded. The predictive interval includes parameter and residual uncertainty under the model, not every possible regime change.</p><p>Initial claims are weekly; GDP is quarterly; other series are monthly. CPI/PCE/retail use monthly percentage change; payrolls use monthly change in thousands; GDP uses annualized quarterly growth. Seasonal adjustment follows the FRED series.</p><p>These are next-period statistical forecasts, not first-release nowcasts. Revisions can inflate historical performance. Use MAE and coverage to assess the model; its probabilities are not independently calibrated trading signals. Economic histories are distinct from release-date archives.</p><p><a href={d.source_url} target="_blank" rel="noreferrer">FRED · {d.series}</a> · fetched {d.source.fetched_at} · model {d.model_version} · input {d.input_hash}. Forecast snapshots persist in SQLite.</p></details>
    </>}
  </section>;
}

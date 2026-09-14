'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Download, Play, SlidersHorizontal } from 'lucide-react';
import { BetaConfig, BetaResponse, downloadBeta, fetchBeta, interval, number, pct } from '../../lib/beta';
import { ReturnScatter, RollingSensitivity } from './BetaCharts';
import BetaScenario from './BetaScenario';
import s from './BetaWorkspace.module.css';

const initial: BetaConfig = { ticker: 'TSLA', benchmarks: 'SPY, QQQ, IWM', period: '1y', window: 60, annualization: 252 };
const tabs = ['Overview', 'Stability & tails', 'Scenario lab', 'Residual events', 'Methodology'] as const;
type Tab = typeof tabs[number];
const presets = [
  { label: 'US equity', ticker: 'TSLA', benchmarks: 'SPY, QQQ, IWM', annualization: 252 },
  { label: 'Indonesia', ticker: 'BBCA.JK', benchmarks: '^JKSE', annualization: 252 },
  { label: 'Crypto', ticker: 'ETH-USD', benchmarks: 'BTC-USD', annualization: 365 },
];

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default function BetaDashboard() {
  const [config, setConfig] = useState<BetaConfig>(initial);
  const [submitted, setSubmitted] = useState('');
  const [data, setData] = useState<BetaResponse | null>(null);
  const [benchmark, setBenchmark] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const analysis = data?.analyses.find(a => a.benchmark === benchmark) ?? data?.analyses[0];
  const changed = !!data && JSON.stringify(config) !== submitted;
  async function run(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    const timer = setTimeout(() => request.abort(), 120000);
    try {
      const result = await fetchBeta(config, request.signal);
      setData(result); setBenchmark(result.benchmark); setSubmitted(JSON.stringify(config));
    } catch (err) {
      if (controller.current === request) setError(request.signal.aborted ? 'Request berhenti atau melebihi 120 detik. Periksa backend BETA lalu coba lagi.' : err instanceof Error ? err.message : 'Analisis gagal.');
    } finally {
      clearTimeout(timer);
      if (controller.current === request) setLoading(false);
    }
  }
  const stats = analysis?.stats;
  return <div className={s.root}>
    <header className={s.header}>
      <div><div className={s.eyebrow}>BETA / MARKET SENSITIVITY WORKSPACE</div><h1>Understand the exposure<span>.</span></h1><p>Seberapa kuat aset mengikuti benchmark — dan kapan hubungan itu berubah?</p></div>
      <div className={s.headerMark}><Activity size={22} /><span>RETURN<br /><b>RESEARCH</b></span></div>
    </header>
    <section className={s.controls} aria-label="Analysis configuration">
      <form onSubmit={run}>
        <div className={s.form}>
          <label>Aset<input aria-label="Asset ticker" value={config.ticker} maxLength={20} required disabled={loading} onChange={e => setConfig({ ...config, ticker: e.target.value.toUpperCase() })} placeholder="TSLA" /></label>
          <label>Benchmark · pisahkan koma<input aria-label="Benchmark tickers" value={config.benchmarks} required disabled={loading} onChange={e => setConfig({ ...config, benchmarks: e.target.value.toUpperCase() })} placeholder="SPY, QQQ, IWM" /></label>
          <label>History<select aria-label="History period" value={config.period} disabled={loading} onChange={e => setConfig({ ...config, period: e.target.value })}><option value="6mo">6 months</option><option value="1y">1 year</option><option value="2y">2 years</option><option value="5y">5 years</option></select></label>
          <button className={s.primary} disabled={loading} type="submit"><Play size={14} />{loading ? 'Analyzing…' : 'Run analysis'}</button>
        </div>
        <div className={s.controlFooter}>
          <div className={s.presets}><span>Quick setup</span>{presets.map(p => <button type="button" disabled={loading} key={p.label} onClick={() => setConfig({ ...config, ticker: p.ticker, benchmarks: p.benchmarks, annualization: p.annualization })}>{p.label}</button>)}</div>
          <details><summary><SlidersHorizontal size={13} /> Model settings</summary><div className={s.settings}>
            <label>Rolling window · observations<input aria-label="Rolling window" type="number" min={20} max={252} required value={config.window} disabled={loading} onChange={e => setConfig({ ...config, window: Number(e.target.value) })} /></label>
            <label>Annualization · sessions/year<select aria-label="Annualization" value={config.annualization} disabled={loading} onChange={e => setConfig({ ...config, annualization: Number(e.target.value) })}><option value={252}>252 · exchange sessions</option><option value={365}>365 · calendar sessions</option></select></label>
          </div><p>Annualization hanya mengubah skala volatilitas dan intercept. Beta tetap sama. Gunakan konvensi yang sesuai dengan sampel.</p></details>
        </div>
      </form>
    </section>
    <main className={s.body}>
      {error && <div className={`${s.notice} ${s.error}`} role="alert">{error}{data && ' Hasil sebelumnya tetap ditampilkan.'}</div>}
      {loading && <div className={s.notice} role="status">Mengambil adjusted close Yahoo dan menghitung regresi, interval, serta rolling windows…{data && ' Panel di bawah masih hasil sebelumnya.'}</div>}
      {changed && !loading && <div className={s.notice}>Pengaturan berubah. Klik <b>Run analysis</b> untuk memperbarui; hasil di bawah masih menggunakan konfigurasi sebelumnya.</div>}
      {!data && !loading && <div className={s.welcome}>
        <div className={s.eyebrow}>START WITH A QUESTION</div><h2>Kalau benchmark turun 1%, aset ini biasanya merespons seberapa besar?</h2>
        <p>Pilih aset dan hingga empat benchmark. Jalankan satu analisis untuk membandingkan sensitivitas, kestabilan, dan risiko residual pada sampel yang sama.</p>
        <div className={s.welcomeSteps}><div><b>01</b><h3>Compare</h3><p>Beta, interval 95%, R² dan residual volatility.</p></div><div><b>02</b><h3>Inspect</h3><p>Rolling beta serta perbedaan saat benchmark naik dan turun.</p></div><div><b>03</b><h3>Explore</h3><p>Uji skenario gerakan benchmark dengan konteks historis.</p></div></div>
        <small>Daily adjusted prices · explicit run · no forward fill</small>
      </div>}
      {data && analysis && stats && <>
        <div className={s.resultHeader}>
          <div><div className={s.eyebrow}>ANALYSIS SNAPSHOT</div><h2>{data.ticker} <ArrowRight size={17} /> {analysis.benchmark}<span className={s.badge}>{data.period} / {data.metadata.observations} observations</span></h2></div>
          <div className={s.actions}><button onClick={() => downloadBeta(data, 'csv')}><Download size={13} /> CSV</button><button onClick={() => downloadBeta(data, 'json')}><Download size={13} /> JSON</button></div>
        </div>
        <div className={s.meta}>Returns {data.metadata.first_return} → {data.metadata.last_return} · {data.metadata.source} · Retrieved {new Date(data.metadata.retrieved_at).toLocaleString()} · {data.metadata.excluded_rows} unmatched price rows excluded</div>
        <div className={s.metrics}>
          <Metric label={`Beta vs ${analysis.benchmark}`} value={number(stats.beta)} detail={`95% HAC CI ${interval(stats.beta_ci)}`} />
          <Metric label="In-sample R²" value={pct(stats.r_squared)} detail="Linear fit strength; not forecast accuracy" />
          <Metric label="Residual volatility" value={pct(stats.idiosyncratic_vol_annual)} detail={`Annualized · ${data.annualization} sessions/year`} />
          <Metric label={`Latest rolling β · ${data.rolling_window} obs`} value={number(analysis.stability.latest)} detail={`Change over ${data.rolling_window} obs: ${number(analysis.stability.change)}`} />
        </div>
        <div className={s.tabs} aria-label="BETA analysis sections">{tabs.map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</div>
        <div className={s.benchmarkPicker}><span>Inspect benchmark</span>{data.analyses.map(a => <button key={a.benchmark} aria-pressed={analysis.benchmark === a.benchmark} onClick={() => setBenchmark(a.benchmark)}>{a.benchmark}</button>)}<small>Switch instantly · same sample</small></div>
        {tab === 'Overview' && <>
          <section className={s.insight}><div className={s.eyebrow}>READ THE RELATIONSHIP</div><h2>+1% {analysis.benchmark} ≈ {number(stats.beta)}% komponen respons {data.ticker}</h2><p>Angka ini adalah kemiringan regresi, sebelum intercept dan residual. {stats.beta_ci[0] <= 0 && stats.beta_ci[1] >= 0 ? 'Interval 95% melintasi nol: arah sensitivitas belum terpisah jelas dari nol pada sampel ini.' : `Interval 95% berada ${stats.beta_ci[0] > 0 ? 'di atas' : 'di bawah'} nol, dengan estimasi beta ${interval(stats.beta_ci)}.`} {stats.r_squared == null ? 'R² tidak terdefinisi karena variasi return aset terlalu kecil.' : `${pct(stats.r_squared)} variasi return sampel cocok dengan hubungan linear ini; sisanya berada dalam residual.`}</p></section>
          <section className={s.panel}><div className={s.heading}><div><h2>Benchmark comparison</h2><p>Pilih baris untuk memeriksa benchmark. R² tertinggi di sampel bukan bukti benchmark terbaik ke depan.</p></div><span className={s.badge}>COMMON SAMPLE</span></div>
            <div className={s.tableWrap}><table><caption className={s.srOnly}>Comparison of benchmark sensitivities on common return dates</caption><thead><tr><th>Benchmark</th><th>Beta</th><th>95% CI</th><th>R²</th><th>Residual vol / yr</th><th>Up β</th><th>Down β</th><th>N</th></tr></thead><tbody>{data.analyses.map(a => <tr key={a.benchmark} data-selected={a.benchmark === analysis.benchmark}><td><button aria-pressed={a.benchmark === analysis.benchmark} onClick={() => setBenchmark(a.benchmark)}>{a.benchmark}</button></td><td>{number(a.stats.beta)}</td><td>{interval(a.stats.beta_ci)}</td><td>{pct(a.stats.r_squared)}</td><td>{pct(a.stats.idiosyncratic_vol_annual)}</td><td>{number(a.asymmetric_beta.beta_upside)}</td><td>{number(a.asymmetric_beta.beta_downside)}</td><td>{a.stats.n_observations}</td></tr>)}</tbody></table></div>
          </section>
          <div className={s.split}>
            <section className={s.panel}><h2>Return relationship</h2><p>Setiap titik = satu return antar harga bersama. Garis amber = OLS characteristic line.</p><ReturnScatter analysis={analysis} ticker={data.ticker} /><small>Y: {data.ticker} return (%) · X: {analysis.benchmark} return (%)</small></section>
            <section className={s.panel}><div className={s.eyebrow}>ESTIMATE & UNCERTAINTY</div><h2>Jangan berhenti di satu angka beta</h2><div className={s.readouts}><div><span>OLS beta</span><b>{number(stats.beta)} <small>[{interval(stats.beta_ci)}]</small></b></div><div><span>Approx. Bayesian beta</span><b>{number(stats.bayesian.mean)}</b></div><div><span>Approx. 95% posterior interval</span><b>{interval(stats.bayesian.interval)}</b></div><div><span>Correlation</span><b>{number(stats.correlation)}</b></div><div><span>Intercept per observation</span><b>{pct(stats.alpha_daily)}</b></div><div><span>Total volatility / year</span><b>{pct(stats.total_vol_annual)}</b></div></div><p>Prior β ~ Normal(1, 1²), diperbarui memakai estimasi beta dan HAC standard error. Pendekatan shrinkage ini menganggap standard error tetap; bukan model Bayesian time series penuh.</p><p>Intercept tidak dikurangi risk-free rate, sehingga bukan Jensen alpha.</p></section>
          </div>
        </>}
        {tab === 'Stability & tails' && <>
          <section className={s.panel}><div className={s.heading}><div><h2>Does the sensitivity hold?</h2><p>Rolling {data.rolling_window} observasi · cyan: beta · area: 95% HAC CI · garis putus: β = 1.</p></div><span className={s.badge}>Range {number(analysis.stability.min)} → {number(analysis.stability.max)}</span></div><RollingSensitivity analysis={analysis} window={data.rolling_window} /><p>Geser handles di bawah chart untuk mempersempit tampilan. β = 1 berarti sensitivitas unit terhadap benchmark. Window saling overlap; perubahan bukan sinyal trading tervalidasi.</p></section>
          <div className={s.split}>{(['up', 'down'] as const).map(side => {
            const a = analysis.asymmetric_beta; const up = side === 'up'; const estimate = up ? a.beta_upside : a.beta_downside;
            return <section className={s.panel} key={side}><div className={s.eyebrow}>{up ? 'BENCHMARK > 0' : 'BENCHMARK < 0'} · {up ? a.n_up : a.n_down} OBSERVATIONS</div><h2>{up ? 'Upside sensitivity' : 'Downside sensitivity'}</h2><div className={s.scenarioValue}>{number(estimate)}<small> β</small></div><p>95% HC3 CI: {interval(up ? a.up_ci : a.down_ci)}</p><div className={s.readouts}><div><span>Rata-rata return {data.ticker} pada subset</span><b>{pct(up ? a.mean_asset_up : a.mean_asset_down)}</b></div></div>{estimate == null ? <p>Butuh minimal 20 observasi dan variasi benchmark yang cukup. Estimasi tidak tersedia.</p> : <p>Regresi terpisah dengan intercept sendiri. Beta turun yang lebih rendah tidak menjamin perlindungan kerugian.</p>}</section>;
          })}</div><p className={s.meta}>{analysis.asymmetric_beta.n_flat} observasi benchmark nol tidak masuk subset naik/turun. Ini analisis berdasarkan tanda return, bukan estimasi tail dependence.</p>
        </>}
        {tab === 'Scenario lab' && <BetaScenario analysis={analysis} ticker={data.ticker} />}
        {tab === 'Residual events' && <section className={s.panel}><div className={s.eyebrow}>LARGEST MODEL DEVIATIONS</div><h2>What the benchmark didn’t explain</h2><p>12 observasi dengan residual absolut terbesar. Residual = return aktual − fitted return; belum tentu disebabkan berita perusahaan. Semua nilai return dalam persen, selisih dalam percentage points (pp).</p><div className={s.tableWrap}><table><thead><tr><th>Date</th><th>{data.ticker}</th><th>{analysis.benchmark}</th><th>Fitted return</th><th>Residual (pp)</th></tr></thead><tbody>{analysis.events.map(p => <tr key={p.date}><td>{p.date}</td><td>{number(p.asset_return)}%</td><td>{number(p.market_return)}%</td><td>{number(p.fitted)}%</td><td className={p.residual >= 0 ? s.cyan : s.amber}>{number(p.residual)}</td></tr>)}</tbody></table></div><p>Regresi menggunakan seluruh sampel yang dipilih. Daftar ini bersifat retrospektif, bukan detektor kejadian yang diuji secara real-time.</p></section>}
        {tab === 'Methodology' && <>
          <section className={s.panel}><div className={s.eyebrow}>DATA CONTRACT</div><h2>Know exactly what you’re measuring</h2><div className={s.readouts}><div><span>Model</span><b>r(asset) = intercept + β × r(benchmark) + residual</b></div><div><span>Price dates</span><b>{analysis.price_info.data_start} → {analysis.price_info.data_end}</b></div><div><span>Common prices / downloaded rows</span><b>{data.metadata.aligned_prices} / {data.metadata.downloaded_rows}</b></div><div><span>Last adjusted price · {data.ticker}</span><b>{number(analysis.price_info.asset_last_price)} · local quote units</b></div><div><span>Last adjusted price · {analysis.benchmark}</span><b>{number(analysis.price_info.bench_last_price)} · local quote units</b></div><div><span>Daily intercept 95% CI</span><b>{pct(stats.alpha_ci_daily[0])} to {pct(stats.alpha_ci_daily[1])}</b></div></div><p>Harga tanggal UTC berjalan dikeluarkan untuk menghindari bar parsial. Ini filter konservatif, bukan validasi kalender bursa atau jaminan freshness provider.</p></section>
          <section className={s.panel}><h2>Assumptions & limits</h2><ol className={s.methodList}>{data.metadata.warnings.map(w => <li key={w}>{w}</li>)}</ol><p>Referensi: <a href="https://www.statsmodels.org/dev/generated/statsmodels.stats.sandwich_covariance.cov_hac.html" target="_blank" rel="noreferrer">statsmodels HAC covariance</a> · <a href="https://www.federalreserve.gov/econres/ifdp/nonparametric-hac-estimation-for-time-series-data-with-missing-observations.htm" target="_blank" rel="noreferrer">Federal Reserve: HAC and missing observations</a></p></section>
        </>}
        <footer className={s.footer}><span>BETA · DESCRIPTIVE RESEARCH</span><span>Adjusted historical data · confidence ≠ certainty</span></footer>
      </>}
    </main>
  </div>;
}

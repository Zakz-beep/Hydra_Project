'use client';

import { useState } from 'react';
import { BetaAnalysis, number } from '../../lib/beta';
import s from './BetaWorkspace.module.css';

export default function BetaScenario({ analysis, ticker }: { analysis: BetaAnalysis; ticker: string }) {
  const [move, setMove] = useState(-2);
  const stats = analysis.stats;
  const contribution = stats.beta * move;
  const response = stats.alpha_daily * 100 + contribution;
  const outside = move < stats.market_range[0] * 100 || move > stats.market_range[1] * 100;
  return <div className={s.split}>
    <section className={s.panel}>
      <div className={s.eyebrow}>WHAT IF · ONE OBSERVATION</div>
      <h2>Kalau {analysis.benchmark} bergerak…</h2>
      <p>Ubah return benchmark untuk melihat respons linear historis {ticker}.</p>
      <label className={s.scenarioLabel} htmlFor="beta-move">Return {analysis.benchmark}<strong>{number(move)}%</strong></label>
      <input id="beta-move" aria-label="Benchmark scenario move" type="range" min={-10} max={10} step={0.1} value={move} onChange={e => setMove(Number(e.target.value))} />
      <div className={s.rangeEnds}><span>−10%</span><span>0%</span><span>+10%</span></div>
      <div className={s.actions}>{[-5, -2, -1, 1, 2, 5].map(n => <button key={n} aria-pressed={move === n} onClick={() => setMove(n)}>{n > 0 ? '+' : ''}{n}%</button>)}</div>
      <p>Rentang benchmark di sampel: {number(stats.market_range[0] * 100)}% hingga {number(stats.market_range[1] * 100)}%.</p>
      {outside && <div className={s.notice} role="status">Di luar rentang historis: skenario ini mengekstrapolasi hubungan yang teramati.</div>}
    </section>
    <section className={s.panel} aria-live="polite">
      <div className={s.eyebrow}>LINEAR RESPONSE · {ticker}</div>
      <div className={s.scenarioValue}>{number(response)}%</div>
      <p>Respons model untuk satu observasi, bukan target harga.</p>
      <div className={s.equation}><span>Intercept <b>{number(stats.alpha_daily * 100)}%</b></span><span>+</span><span>β × benchmark <b>{number(contribution)}%</b></span><span>=</span><span>Respons <b>{number(response)}%</b></span></div>
      <div className={s.divider} />
      <h3>Dengan dispersi residual historis</h3>
      <div className={s.dispersion}><span>P10 offset<strong>{number(response + stats.residual_quantiles[0] * 100)}%</strong></span><span>P90 offset<strong>{number(response + stats.residual_quantiles[2] * 100)}%</strong></span></div>
      <p>Respons + persentil 10/90 residual seluruh sampel. Ini bukan interval prediksi terkalibrasi atau VaR; ketidakpastian parameter dan perubahan regime belum tercakup.</p>
    </section>
  </div>;
}

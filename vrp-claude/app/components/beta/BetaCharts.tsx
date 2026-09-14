'use client';

import { useMemo } from 'react';
import { Area, Brush, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import { BetaAnalysis, number } from '../../lib/beta';
import s from './BetaWorkspace.module.css';

const axis = { stroke: '#90a2b5', fontSize: 10, tickLine: false, axisLine: false };
const tooltip = { backgroundColor: '#152331', border: '1px solid #405467', borderRadius: 6, color: '#edf3f7', fontSize: 12 };

export function ReturnScatter({ analysis, ticker }: { analysis: BetaAnalysis; ticker: string }) {
  const line = analysis.regression_line;
  return <div className={s.chart} role="img" aria-label={`Scatter of ${ticker} and ${analysis.benchmark} returns. Beta ${number(analysis.stats.beta)}.`}>
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 12, right: 20, bottom: 24, left: 4 }}>
        <CartesianGrid stroke="#293b4b" strokeDasharray="3 5" />
        <XAxis {...axis} type="number" dataKey="market_return" name={analysis.benchmark} unit="%" label={{ value: `${analysis.benchmark} return (%)`, position: 'bottom', fill: '#a5b5c5', fontSize: 11 }} />
        <YAxis {...axis} type="number" dataKey="asset_return" name={ticker} unit="%" width={56} />
        <ReferenceLine x={0} stroke="#536475" /><ReferenceLine y={0} stroke="#536475" />
        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
          const p = payload?.[0]?.payload;
          return active && p ? <div style={tooltip} className={s.tip}><strong>{p.date || 'OLS characteristic line'}</strong><div>{analysis.benchmark}: {number(p.market_return)}%</div><div>{ticker}: {number(p.asset_return)}%</div>{p.residual != null && <div>Residual: {number(p.residual)} pp</div>}</div> : null;
        }} />
        <Scatter name="Observed returns" data={analysis.scatter_data} fill="#65d4d0" fillOpacity={0.5} isAnimationActive={false} />
        <Scatter name="OLS characteristic line" data={[{ market_return: line.x_min, asset_return: line.y_min }, { market_return: line.x_max, asset_return: line.y_max }]} line={{ stroke: '#f2bb65', strokeWidth: 2 }} shape={() => <g />} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  </div>;
}

export function RollingSensitivity({ analysis, window }: { analysis: BetaAnalysis; window: number }) {
  const rows = useMemo(() => analysis.rolling_beta.map(p => ({ ...p, band: p.low == null || p.high == null ? null : [p.low, p.high] })), [analysis]);
  if (!rows.length) return <div className={s.empty}>Rolling window {window} observasi melebihi sampel. Pilih periode lebih panjang atau window lebih pendek, lalu Run analysis.</div>;
  return <div className={s.chart} role="group" aria-label={`${window}-observation rolling beta with 95 percent HAC confidence interval. Latest ${number(analysis.stability.latest)}.`}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 15, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid stroke="#293b4b" strokeDasharray="3 5" />
        <XAxis {...axis} dataKey="date" minTickGap={50} tickFormatter={v => String(v).slice(2)} />
        <YAxis {...axis} width={50} domain={['auto', 'auto']} tickFormatter={v => number(v, 1)} />
        <Tooltip content={({ active, payload }) => {
          const p = payload?.[0]?.payload;
          return active && p ? <div style={tooltip} className={s.tip}><strong>{p.start} → {p.date}</strong><div>Beta: {number(p.beta)}</div><div>95% CI: {number(p.low)} to {number(p.high)}</div></div> : null;
        }} />
        <ReferenceLine y={1} stroke="#b2a188" strokeDasharray="5 5" />
        <ReferenceLine y={0} stroke="#536475" />
        <Area type="linear" dataKey="band" stroke="none" fill="#65d4d0" fillOpacity={0.13} connectNulls={false} isAnimationActive={false} />
        <Line type="linear" dataKey="beta" stroke="#65d4d0" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        <Brush dataKey="date" ariaLabel="Rolling date range handle. Use left and right arrow keys to adjust." height={24} stroke="#506477" fill="#101c28" travellerWidth={8} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}

'use client';

import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart, ComposedChart
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryPoint {
  date: string;
  predicted: number;
  actual: number;
  residual: number;
}

interface PropFirmResult {
  ticker: string;
  market: {
    close: number;
    vix: number;
    pred_vol: number;
    regime: string;
    confidence: number;
  };
  prop_firm: {
    equity: number;
    daily_loss: number;
    total_loss: number;
    tp_target: number;
  };
  risk: {
    budget_factor_pct: number;
    rec_daily_budget: number;
    risk_per_trade: number;
    max_trades_today: number;
    hard_stop: number;
    max_safe_exposure: number;
    z_score: number;
  };
  execution: {
    needed_r: number;
    net_wins: number;
    win_pnl: number;
    loss_pnl: number;
  };
  capital: {
    eval_fee: number;
    attempts: number;
    capital_budget: number;
    ruin_prob_pct: number;
  };
  history: HistoryPoint[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number, d = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const REGIME_CONFIG: Record<string, { color: string; glow: string; bg: string; border: string; label: string }> = {
  CALM:     { color: '#10b981', glow: 'rgba(16,185,129,0.3)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', label: 'Low volatility — favourable conditions' },
  NORMAL:   { color: '#f59e0b', glow: 'rgba(245,158,11,0.3)',  bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',  label: 'Moderate volatility — trade cautiously' },
  ELEVATED: { color: '#f97316', glow: 'rgba(249,115,22,0.3)',  bg: 'rgba(249,115,22,0.08)',  border: 'rgba(249,115,22,0.3)',  label: 'Elevated volatility — reduce size' },
  CRISIS:   { color: '#ef4444', glow: 'rgba(239,68,68,0.3)',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.3)',   label: 'Crisis mode — minimal or no exposure' },
};

// ── Custom Tooltip ─────────────────────────────────────────────────────────────

const VolTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono shadow-2xl">
      <p className="text-zinc-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{fmt(p.value, 4)}%</span>
        </p>
      ))}
    </div>
  );
};

const ResidualTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-xs font-mono shadow-2xl">
      <p className="text-zinc-400 mb-1">{label}</p>
      <p style={{ color: val >= 0 ? '#10b981' : '#ef4444' }}>
        Residual: <span className="font-bold">{val >= 0 ? '+' : ''}{fmt(val, 4)}%</span>
      </p>
    </div>
  );
};

// ── Stat Card ─────────────────────────────────────────────────────────────────

const StatCard = ({ label, value, sub, color = '#a1a1aa' }: { label: string; value: string; sub?: string; color?: string }) => (
  <div className="bg-zinc-950/60 rounded-xl border border-zinc-800/60 p-4 flex flex-col gap-1">
    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{label}</span>
    <span className="text-lg font-mono font-bold" style={{ color }}>{value}</span>
    {sub && <span className="text-[10px] font-mono text-zinc-600">{sub}</span>}
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

export default function PropFirmDashboard() {
  const [ticker, setTicker] = useState('SPY');
  const [tickerInput, setTickerInput] = useState('SPY');
  const [equity, setEquity] = useState('50000');
  const [dailyLoss, setDailyLoss] = useState('2500');
  const [totalLoss, setTotalLoss] = useState('5000');
  const [tpTarget, setTpTarget] = useState('3000');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PropFirmResult | null>(null);

  const regime = result ? (REGIME_CONFIG[result.market.regime] ?? REGIME_CONFIG.NORMAL) : null;

  // Chart data
  const chartData = useMemo(() => result?.history ?? [], [result]);
  const residualMax = useMemo(() => Math.max(...chartData.map(d => Math.abs(d.residual)), 0.01), [chartData]);
  const shortDates = useMemo(() =>
    chartData.map(d => ({ ...d, dateShort: d.date.slice(5) })), // MM-DD
    [chartData]
  );

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    const t = tickerInput.trim().toUpperCase() || 'SPY';
    setTicker(t);
    try {
      const res = await fetch('/api/vol/propfirm-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: t,
          equity: parseFloat(equity) || 50000,
          daily_loss_usd: parseFloat(dailyLoss) || 2500,
          total_loss_usd: parseFloat(totalLoss) || 5000,
          tp_target_usd: parseFloat(tpTarget) || 3000,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Engine error');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-16">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900/70 to-zinc-950 p-8">
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-violet-600/8 blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-9 w-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <h1 className="text-xl md:text-2xl font-bold font-mono text-white tracking-tight">
                  Prop-Firm Risk Engine
                </h1>
                {result && (
                  <span className="text-sm font-mono text-zinc-400 bg-zinc-800/80 px-3 py-1 rounded-full border border-zinc-700">
                    {result.ticker}
                  </span>
                )}
              </div>
              <p className="text-sm font-mono text-zinc-400 max-w-lg">
                ElasticNet + Mincer-Zarnowitz calibration · Dynamic regime-conditional daily risk budget
              </p>
            </div>
            <div className="flex gap-2 flex-wrap text-[10px] font-mono text-zinc-500">
              <span className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded">ENet-CV</span>
              <span className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded">MZ-Reg</span>
              <span className="px-2 py-1 bg-zinc-900 border border-zinc-800 rounded">GK-Vol</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

        {/* ── Left: Inputs ─────────────────── */}
        <div className="xl:col-span-3 space-y-4">
          <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm p-5 shadow-xl space-y-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-3">
              Configure Engine
            </h3>

            {/* Ticker */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Ticker</label>
              <input
                type="text"
                value={tickerInput}
                onChange={e => setTickerInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleRun()}
                placeholder="SPY, QQQ, NQ=F ..."
                className="w-full bg-zinc-950 border border-zinc-700 text-white font-mono text-sm rounded-xl py-2.5 px-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
            </div>

            <div className="border-t border-zinc-800/60 pt-3 space-y-3">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Prop Firm Rules (USD)</label>

              {[
                { label: 'Total Equity', val: equity, set: setEquity, color: 'focus:border-indigo-500', textColor: 'text-white' },
                { label: 'Max Daily Loss', val: dailyLoss, set: setDailyLoss, color: 'focus:border-red-500', textColor: 'text-red-400' },
                { label: 'Max Total Drawdown', val: totalLoss, set: setTotalLoss, color: 'focus:border-red-500', textColor: 'text-red-400' },
                { label: 'Profit Target', val: tpTarget, set: setTpTarget, color: 'focus:border-emerald-500', textColor: 'text-emerald-400' },
              ].map(({ label, val, set, color, textColor }) => (
                <div key={label} className="space-y-1">
                  <label className="text-[10px] font-mono text-zinc-500">{label}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 font-mono text-sm">$</span>
                    <input
                      type="number"
                      value={val}
                      onChange={e => set(e.target.value)}
                      className={`w-full bg-zinc-950 border border-zinc-800 ${textColor} font-mono text-sm rounded-xl py-2.5 pl-7 pr-3 focus:outline-none ${color} focus:ring-1 focus:ring-current/30 transition-all`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={handleRun}
              disabled={loading}
              className="w-full relative overflow-hidden rounded-xl bg-indigo-600 py-3 font-mono text-sm font-bold text-white shadow-lg shadow-indigo-900/30 transition-all hover:bg-indigo-500 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  COMPUTING...
                </span>
              ) : 'INITIALIZE ENGINE'}
            </button>

            {error && (
              <div className="rounded-xl bg-red-950/40 border border-red-900/50 p-3 text-xs font-mono text-red-400">
                <span className="font-bold">ERROR:</span> {error}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Results ─────────────────── */}
        <div className="xl:col-span-9 space-y-6">
          {result ? (
            <>
              {/* ── Row 1: Regime Banner + Market State ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Regime card (spans 2 cols on md) */}
                <div
                  className="md:col-span-2 relative overflow-hidden rounded-2xl p-6 flex flex-col justify-between"
                  style={{ background: regime!.bg, border: `1px solid ${regime!.border}` }}
                >
                  <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full blur-3xl opacity-40" style={{ background: regime!.glow }} />
                  <div className="relative z-10">
                    <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: regime!.color, opacity: 0.7 }}>
                      Volatility Regime · {result.ticker}
                    </span>
                    <div className="mt-2 flex items-baseline gap-4 flex-wrap">
                      <h2 className="text-5xl font-black font-mono tracking-tighter" style={{ color: regime!.color, textShadow: `0 0 30px ${regime!.glow}` }}>
                        {result.market.regime}
                      </h2>
                      <div className="flex flex-col">
                        <span className="text-xs font-mono text-zinc-400">Pred Vol (next day)</span>
                        <span className="text-2xl font-bold font-mono" style={{ color: regime!.color }}>
                          {result.market.pred_vol.toFixed(4)}%
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-mono text-zinc-400">{regime!.label}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <span className="text-[10px] font-mono bg-zinc-900/60 border border-zinc-700/60 px-2 py-1 rounded text-zinc-400">
                        VaR Confidence: {result.market.confidence}%
                      </span>
                      <span className="text-[10px] font-mono bg-zinc-900/60 border border-zinc-700/60 px-2 py-1 rounded text-zinc-400">
                        Z-Score: {result.risk.z_score}
                      </span>
                      <span className="text-[10px] font-mono bg-zinc-900/60 border border-zinc-700/60 px-2 py-1 rounded text-zinc-400">
                        {result.ticker} Close: ${fmt(result.market.close)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* VIX + stats */}
                <div className="space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">VIX (Implied Vol)</span>
                    <span className="text-3xl font-black font-mono text-white">{result.market.vix.toFixed(2)}</span>
                    <span className="text-[10px] font-mono text-zinc-600">Market fear gauge</span>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col gap-2">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Max Safe Nominal</span>
                    <span className="text-xl font-bold font-mono text-indigo-400">${fmt(result.risk.max_safe_exposure)}</span>
                    <span className="text-[10px] font-mono text-zinc-600">VaR-based exposure limit</span>
                  </div>
                </div>
              </div>

              {/* ── Row 2: Daily Risk Budget (hero number) ── */}
              <div className="relative overflow-hidden rounded-2xl border border-indigo-800/40 bg-gradient-to-br from-indigo-950/40 to-zinc-950/80 p-6">
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/5 to-transparent" />
                <div className="relative z-10 flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
                  <div>
                    <h3 className="text-xs font-mono text-indigo-300/70 uppercase tracking-widest mb-2">
                      Recommended Daily Risk Budget — Based on {result.market.regime} Regime
                    </h3>
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="text-6xl font-black font-mono text-white drop-shadow-[0_0_20px_rgba(99,102,241,0.4)]">
                        ${fmt(result.risk.rec_daily_budget)}
                      </span>
                      <span className="text-lg font-mono text-indigo-300/70">
                        / {result.risk.budget_factor_pct}% of daily limit
                      </span>
                    </div>
                    <p className="text-xs font-mono text-zinc-500 mt-2">
                      This is the maximum dollar amount you should expose to risk today, given current vol predictions.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 shrink-0">
                    <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 min-w-[180px]">
                      <span className="text-[10px] font-mono text-amber-400/70 uppercase tracking-wider block mb-1">Risk Per Trade</span>
                      <span className="text-2xl font-bold font-mono text-amber-400">${fmt(result.risk.risk_per_trade)}</span>
                    </div>
                    <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4 min-w-[180px]">
                      <span className="text-[10px] font-mono text-zinc-400/70 uppercase tracking-wider block mb-1">Max Trades Today</span>
                      <span className="text-2xl font-bold font-mono text-white">{result.risk.max_trades_today}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Row 3: Charts ── */}
              {chartData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* Predicted vs Actual */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
                    <div className="mb-4">
                      <h4 className="text-sm font-mono text-zinc-200 font-semibold">Predicted vs Actual Volatility</h4>
                      <p className="text-[10px] font-mono text-zinc-500 mt-0.5">30-day rolling 1-step-ahead forecast · {result.ticker} daily vol (%)</p>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={shortDates}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis
                          dataKey="dateShort"
                          tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#71717a' }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#71717a' }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => `${v.toFixed(2)}%`}
                        />
                        <Tooltip content={<VolTooltip />} />
                        <Legend
                          iconType="circle"
                          iconSize={7}
                          wrapperStyle={{ fontSize: '10px', fontFamily: 'monospace' }}
                        />
                        <Area
                          type="monotone"
                          dataKey="actual"
                          fill="rgba(99,102,241,0.08)"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={false}
                          name="Actual"
                        />
                        <Line
                          type="monotone"
                          dataKey="predicted"
                          stroke="#10b981"
                          strokeWidth={2}
                          strokeDasharray="5 3"
                          dot={false}
                          name="Predicted"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Residuals */}
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 shadow-xl">
                    <div className="mb-4">
                      <h4 className="text-sm font-mono text-zinc-200 font-semibold">Prediction Residuals (Actual − Predicted)</h4>
                      <p className="text-[10px] font-mono text-zinc-500 mt-0.5">Positive = model under-predicted · Negative = over-predicted</p>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={shortDates} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis
                          dataKey="dateShort"
                          tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#71717a' }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 9, fontFamily: 'monospace', fill: '#71717a' }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => `${v.toFixed(2)}`}
                          domain={[-residualMax * 1.3, residualMax * 1.3]}
                        />
                        <Tooltip content={<ResidualTooltip />} />
                        <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 2" />
                        <Bar
                          dataKey="residual"
                          name="Residual"
                          radius={[3, 3, 0, 0]}
                          isAnimationActive={false}
                        >
                          {shortDates.map((entry, index) => (
                            <Cell key={index} fill={entry.residual >= 0 ? '#10b981' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── Row 4: Stat Grid ── */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard
                  label="Hard Stop"
                  value={`$${fmt(result.risk.hard_stop)}`}
                  sub="80% of daily loss"
                  color="#ef4444"
                />
                <StatCard
                  label="Win PnL (1:2)"
                  value={`+$${fmt(result.execution.win_pnl)}`}
                  sub="per winning trade"
                  color="#10b981"
                />
                <StatCard
                  label="Loss PnL"
                  value={`-$${fmt(result.execution.loss_pnl)}`}
                  sub="per losing trade"
                  color="#ef4444"
                />
                <StatCard
                  label="R-Units Needed"
                  value={`${result.execution.needed_r} R`}
                  sub="to hit profit target"
                  color="#a78bfa"
                />
                <StatCard
                  label="Clean Wins"
                  value={`${result.execution.net_wins}`}
                  sub="at 1:2 to pass"
                  color="#10b981"
                />
                <StatCard
                  label="Eval Fee Est."
                  value={`$${fmt(result.capital.eval_fee)}`}
                  sub={`${result.capital.attempts} attempts budget`}
                  color="#f59e0b"
                />
              </div>

              {/* ── Row 5: Ruin Probability Bar ── */}
              <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5 flex flex-col md:flex-row items-start md:items-center gap-4">
                <div className="flex-1">
                  <h4 className="text-xs font-mono text-zinc-400 uppercase tracking-widest mb-2">Probability of Ruin (3 Attempts)</h4>
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-red-500 transition-all duration-700"
                      style={{ width: `${Math.min(result.capital.ruin_prob_pct, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-zinc-600 mt-1">
                    <span>0% (survive)</span>
                    <span>100% (always blow)</span>
                  </div>
                </div>
                <div className="text-center md:text-right shrink-0">
                  <span className="text-3xl font-black font-mono text-white">{result.capital.ruin_prob_pct.toFixed(1)}%</span>
                  <span className="block text-[10px] font-mono text-zinc-500 mt-0.5">Ruin probability</span>
                </div>
                <div className="rounded-xl bg-red-950/40 border border-red-900/50 px-4 py-3 text-xs font-mono text-red-400 max-w-xs">
                  🚨 Hard Stop at <strong>${fmt(result.risk.hard_stop)}</strong> — exit all positions immediately when hit.
                </div>
              </div>

            </>
          ) : (
            /* ── Empty State ── */
            <div className="h-[500px] rounded-2xl border-2 border-dashed border-zinc-800/50 bg-zinc-950/30 flex flex-col items-center justify-center gap-4">
              <div className="h-20 w-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-2xl">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="text-center">
                <h3 className="text-base font-mono font-bold text-zinc-400">Engine Ready</h3>
                <p className="text-sm font-mono text-zinc-600 mt-2 max-w-sm">
                  Configure your prop firm parameters and ticker, then click <span className="text-indigo-400">Initialize Engine</span> to run the volatility model.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

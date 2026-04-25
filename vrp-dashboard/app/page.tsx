'use client'
// app/page.tsx — VRP Dashboard Main Page

import { useState, useEffect, useCallback, useRef } from 'react'
import { RefreshCw, Activity, Database, AlertCircle, Clock } from 'lucide-react'
import MetricCard    from './components/MetricCard'
import SignalBadge   from './components/SignalBadge'
import VRPGauge      from './components/VRPGauge'
import VRPChart      from './components/VRPChart'
import Pipeline      from './components/Pipeline'
import TickerInput   from './components/TickerInput'
import { VRPResult, SIGNAL_META } from './lib/vrp'

const UPDATE_INTERVAL = 15_000  // 15 detik

function fmt(v: number, pct = true, sign = false): string {
  const s = (v * (pct ? 100 : 1)).toFixed(2)
  return (sign && v > 0 ? '+' : '') + s + (pct ? '%' : '')
}

export default function VRPDashboard() {
  const [data,      setData]      = useState<VRPResult | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [ticker,    setTicker]    = useState('^GSPC')
  const [step,      setStep]      = useState(0)
  const [countdown, setCountdown] = useState(UPDATE_INTERVAL / 1000)
  const [updateN,   setUpdateN]   = useState(0)
  const timerRef  = useRef<NodeJS.Timeout | null>(null)
  const countRef  = useRef<NodeJS.Timeout | null>(null)

  const fetchVRP = useCallback(async (t: string) => {
    setLoading(true)
    setError(null)

    // Animate pipeline steps
    for (let s = 0; s <= 4; s++) {
      setStep(s)
      await new Promise(r => setTimeout(r, 220))
    }

    try {
      const res = await fetch(`/api/vrp?ticker=${encodeURIComponent(t)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: VRPResult = await res.json()
      setData(json)
      setUpdateN(n => n + 1)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
      setStep(4)
    }
  }, [])

  // Auto-refresh
  const startAutoRefresh = useCallback((t: string) => {
    if (timerRef.current)  clearInterval(timerRef.current)
    if (countRef.current)  clearInterval(countRef.current)

    setCountdown(UPDATE_INTERVAL / 1000)
    timerRef.current = setInterval(() => {
      fetchVRP(t)
      setCountdown(UPDATE_INTERVAL / 1000)
    }, UPDATE_INTERVAL)

    countRef.current = setInterval(() => {
      setCountdown(c => Math.max(0, c - 1))
    }, 1000)
  }, [fetchVRP])

  const handleTicker = (t: string) => {
    setTicker(t)
    fetchVRP(t)
    startAutoRefresh(t)
  }

  useEffect(() => {
    fetchVRP(ticker)
    startAutoRefresh(ticker)
    return () => {
      if (timerRef.current)  clearInterval(timerRef.current)
      if (countRef.current)  clearInterval(countRef.current)
    }
  }, []) // eslint-disable-line

  const signalColor = data ? SIGNAL_META[data.signal].color : '#4A5E75'

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Scanline overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.025]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)',
        }}
      />

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

        {/* ── Header ─────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-accent" />
              <span className="text-xs font-mono text-dim tracking-[0.3em] uppercase">
                Volatility Intelligence System
              </span>
            </div>
            <h1 className="text-3xl font-display font-bold text-bright tracking-tight">
              VRP<span className="text-accent">.</span>Dashboard
            </h1>
            <p className="text-xs font-mono text-dim mt-1">
              Volatility Risk Premium · Real-Time Signal Engine
            </p>
          </div>

          <div className="text-right shrink-0">
            <div className="flex items-center gap-2 justify-end mb-1">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: loading ? '#FFD700' : '#00FF9C',
                  boxShadow:       `0 0 6px ${loading ? '#FFD700' : '#00FF9C'}`,
                  animation:       'pulse 2s infinite',
                }}
              />
              <span className="text-xs font-mono text-dim">
                {loading ? 'UPDATING...' : 'LIVE'}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs font-mono text-dim justify-end">
              <Clock className="w-3 h-3" />
              <span>Next update: {countdown}s</span>
            </div>
            {data && (
              <div className="text-[10px] font-mono text-dim mt-1">
                Update #{updateN} · {data.timestamp}
              </div>
            )}
          </div>
        </div>

        {/* ── Ticker Input ────────────────────────────── */}
        <div className="border border-border rounded p-4 bg-surface">
          <TickerInput
            value={ticker}
            onSubmit={handleTicker}
            loading={loading}
          />
        </div>

        {/* ── Pipeline Status ─────────────────────────── */}
        <div className="border border-border rounded p-4 bg-surface">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-mono text-dim tracking-widest uppercase">Pipeline</span>
            {data && (
              <>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                  style={{ color: '#4A5E75', backgroundColor: '#1A2230', border: '1px solid #2A3545' }}
                >
                  {(data as any).dataSource === 'synthetic' ? '⚠ SYNTHETIC' : '✓ LIVE DATA'}
                </span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                  style={{ color: '#00D4FF', backgroundColor: '#00D4FF10', border: '1px solid #00D4FF25' }}
                >
                  via: {(data as any)._via ?? 'unknown'}
                </span>
              </>
            )}
          </div>
          <Pipeline activeStep={step} loading={loading} />
        </div>

        {/* ── Error ────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2 p-4 rounded border border-red/30 bg-red/5 text-red text-sm font-mono">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Main Signal ──────────────────────────────── */}
        {data && (
          <div
            className="relative border rounded p-6 overflow-hidden"
            style={{
              borderColor:     signalColor + '44',
              backgroundColor: signalColor + '08',
              boxShadow:       `0 0 40px ${signalColor}12`,
            }}
          >
            {/* Corner accents */}
            <div className="absolute top-0 left-0 w-16 h-px" style={{ backgroundColor: signalColor }} />
            <div className="absolute top-0 left-0 w-px h-16" style={{ backgroundColor: signalColor }} />
            <div className="absolute bottom-0 right-0 w-16 h-px" style={{ backgroundColor: signalColor }} />
            <div className="absolute bottom-0 right-0 w-px h-16" style={{ backgroundColor: signalColor }} />

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2">
                <div className="text-xs font-mono text-dim tracking-widest uppercase">Current Signal</div>
                <SignalBadge signal={data.signal} size="lg" animate />
                <p className="text-xs font-mono text-dim max-w-xs">{data.signalDesc}</p>
              </div>

              <div className="text-right">
                <div className="text-xs font-mono text-dim mb-1">{data.ticker}</div>
                <div className="text-4xl font-mono font-bold text-bright tabular-nums">
                  {data.spot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs font-mono text-dim mt-1">{data.nCandles} × 15m candles</div>
              </div>
            </div>

            {/* VRP Gauge */}
            <div className="mt-6">
              <VRPGauge zScore={data.vrpZ} />
            </div>
          </div>
        )}

        {/* ── Metric Grid ──────────────────────────────── */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="IV (VIX Proxy)"
              value={fmt(data.iv)}
              sub="Implied Volatility"
              accent="#00D4FF"
              glow
              animateIn
            />
            <MetricCard
              label="RV (GK Blended)"
              value={fmt(data.rv)}
              sub="Garman-Klass + HV20"
              accent="#FF8C00"
              animateIn
            />
            <MetricCard
              label="RV HAR Forecast"
              value={fmt(data.rvHar)}
              sub="Corsi (2009) model"
              accent="#FF8C00"
              animateIn
            />
            <MetricCard
              label="HV20 Baseline"
              value={fmt(data.hv20)}
              sub="20-day historical vol"
              accent="#4A5E75"
              animateIn
            />
            <MetricCard
              label="VRP Raw"
              value={fmt(data.vrpRaw, true, true)}
              sub="IV − RV intraday"
              accent={data.vrpRaw > 0 ? '#FF3B5C' : '#00FF9C'}
              glow
              animateIn
            />
            <MetricCard
  label="VRP Z-Score"
  // Check if it's a number before doing math/formatting on it
  value={
    typeof data?.vrpZ === 'number' 
      ? `${data.vrpZ >= 0 ? '+' : ''}${data.vrpZ.toFixed(2)}σ` 
      : 'Loading...' // Or 'N/A', '-', etc.
  }
  sub="Rolling 60-day norm."
  // Safely default to the neutral color if undefined
  accent={
    data?.vrpZ > 1.5 ? '#FF3B5C' : 
    data?.vrpZ < -1.5 ? '#00FF9C' : 
    '#4A5E75'
  }
  glow
/>
            <MetricCard
              label="VRP vs HAR"
              value={fmt(data.vrpVsHar, true, true)}
              sub="IV − HAR-RV forecast"
              accent={data.vrpVsHar > 0 ? '#FF8C00' : '#FFD700'}
              animateIn
            />
            <MetricCard
              label="Update #"
              value={`#${updateN}`}
              sub={`Every ${UPDATE_INTERVAL / 1000}s`}
              accent="#2A3545"
              animateIn
            />
          </div>
        )}

        {/* ── History Chart ─────────────────────────────── */}
        {data && (
          <div className="border border-border rounded p-4 bg-surface">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-mono text-dim tracking-widest uppercase mb-1">
                  IV / RV / VRP History
                </div>
                <div className="text-[10px] font-mono text-dim">
                  Last {data.history.length} snapshots · 15-30s interval
                </div>
              </div>
              <button
                onClick={() => fetchVRP(ticker)}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-dim
                           border border-border rounded hover:text-accent hover:border-accent/40
                           disabled:opacity-40 transition-all"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                REFRESH
              </button>
            </div>
            <VRPChart data={data.history} />
          </div>
        )}

        {/* ── Signal Z-Score Table ─────────────────────── */}
        <div className="border border-border rounded p-4 bg-surface">
          <div className="text-xs font-mono text-dim tracking-widest uppercase mb-3">Signal Z-Score Reference</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-dim py-2 pr-4 font-normal">Z-Score</th>
                  <th className="text-left text-dim py-2 pr-4 font-normal">Kondisi</th>
                  <th className="text-left text-dim py-2 font-normal">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {[
                  ['>  +1.5', 'IV sangat mahal',    'STRONG_SHORT_VOL'],
                  ['+0.5 → +1.5', 'IV sedikit elevated', 'MILD_SHORT_VOL'],
                  ['−0.5 → +0.5', 'Fairly priced',       'NEUTRAL'],
                  ['−1.5 → −0.5', 'IV sedikit murah',    'MILD_LONG_VOL'],
                  ['<  −1.5', 'IV sangat murah',   'STRONG_LONG_VOL'],
                ].map(([z, cond, sig]) => {
                  const meta  = SIGNAL_META[sig as keyof typeof SIGNAL_META]
                  const isNow = data?.signal === sig
                  return (
                    <tr
                      key={sig}
                      className="transition-colors"
                      style={{ backgroundColor: isNow ? meta.color + '10' : undefined }}
                    >
                      <td className="py-2 pr-4 tabular-nums" style={{ color: meta.color }}>{z}</td>
                      <td className="py-2 pr-4 text-dim">{cond}</td>
                      <td className="py-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-bold tracking-wider"
                          style={{
                            color:           meta.color,
                            backgroundColor: meta.color + '15',
                            border:          `1px solid ${meta.color}30`,
                          }}
                        >
                          {meta.emoji} {meta.label.toUpperCase()}
                          {isNow && ' ◀ NOW'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2 pb-4 text-[10px] font-mono text-dim border-t border-border">
          <div className="flex items-center gap-1">
            <Database className="w-3 h-3" />
            <span>Yahoo Finance · VIX proxy IV · GK + HAR-RV estimator · BSM Newton-Raphson</span>
          </div>
          <span>VRP Engine v1.0</span>
        </div>
      </div>
    </div>
  )
}

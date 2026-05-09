'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineSeries, HistogramSeries } from 'lightweight-charts';

// ── TYPES ────────────────────────────────────────────────────────────
interface RegimeData {
    label: 'RISK_OFF' | 'INFLATION_SHOCK' | 'REFLATION' | 'NEUTRAL';
    bond_equity_corr: number;
    roc_20d: number;
    roc_60d: number;
    momentum_signal: 'accelerating' | 'fading' | 'reversing';
    hedge_active: boolean;
}

interface PerformanceData {
    effective_duration: number;
    annual_return_pct: number;
    annual_vol_pct: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
    tracking_error_pct: number;
    corr_vs_benchmark: number;
}

interface Snapshot {
    timestamp: string;
    index_value: number;
    daily_return_pct: number;
    regime: RegimeData;
    performance: PerformanceData;
}

interface HistoryRow {
    date: string;
    index_value: number;
    daily_return: number;
    corr: number;
    roc_20d: number;
    roc_60d: number;
    regime: string;
}

// ── HELPERS ──────────────────────────────────────────────────────────
const REGIME_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    RISK_OFF:        { label: 'RISK OFF',        color: 'text-emerald-300', bg: 'bg-emerald-950/60', border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
    INFLATION_SHOCK: { label: 'INFLATION SHOCK', color: 'text-red-300',     bg: 'bg-red-950/60',     border: 'border-red-500/40',     dot: 'bg-red-400' },
    REFLATION:       { label: 'REFLATION',       color: 'text-amber-300',   bg: 'bg-amber-950/60',   border: 'border-amber-500/40',   dot: 'bg-amber-400' },
    NEUTRAL:         { label: 'NEUTRAL',         color: 'text-zinc-300',    bg: 'bg-zinc-900/60',    border: 'border-zinc-600/40',    dot: 'bg-zinc-400' },
};

const MOMENTUM_CONFIG: Record<string, { label: string; arrow: string; color: string }> = {
    accelerating: { label: 'Accelerating', arrow: '▲', color: 'text-emerald-400' },
    fading:       { label: 'Fading',       arrow: '▶', color: 'text-amber-400' },
    reversing:    { label: 'Reversing',    arrow: '▼', color: 'text-red-400' },
};

const COMPONENTS_META: Record<string, { label: string; weight: number; color: string }> = {
    SHY:  { label: '1-3Y Treasury',    weight: 0.10, color: '#93c5fd' },
    IEF:  { label: '7-10Y Treasury',   weight: 0.20, color: '#60a5fa' },
    TLT:  { label: '20Y+ Treasury',    weight: 0.12, color: '#3b82f6' },
    LQD:  { label: 'IG Corporate',     weight: 0.18, color: '#a78bfa' },
    MBB:  { label: 'MBS',              weight: 0.13, color: '#f472b6' },
    IGOV: { label: 'Intl Government',  weight: 0.15, color: '#34d399' },
    BWX:  { label: 'Intl Treasury',    weight: 0.07, color: '#fbbf24' },
    AGG:  { label: 'US Aggregate',     weight: 0.05, color: '#f97316' },
};

function fmt(val: number | undefined, suffix = '%', dec = 2): string {
    if (val === undefined || val === null) return '--';
    const str = Math.abs(val).toFixed(dec);
    const sign = val >= 0 ? '+' : '-';
    return `${sign}${str}${suffix}`;
}
function fmtPlain(val: number | undefined, suffix = '', dec = 2): string {
    if (val === undefined || val === null) return '--';
    return `${val.toFixed(dec)}${suffix}`;
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────
export default function LegatruuDashboard() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const corrContainerRef  = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const corrChartRef = useRef<IChartApi | null>(null);
    const indexSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const corrSeriesRef  = useRef<ISeriesApi<'Line'> | null>(null);
    const histSeriesRef  = useRef<ISeriesApi<'Histogram'> | null>(null);

    const [snapshot, setSnapshot]   = useState<Snapshot | null>(null);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);
    const [tail, setTail]           = useState<252 | 504 | 756 | 1260>(504);

    // ── Fetch ────────────────────────────────────────────────────────
    const fetchAll = useCallback(async (histTail: number) => {
        setLoading(true);
        setError(null);
        try {
            const [snapRes, histRes] = await Promise.all([
                fetch('/api/legatruu/snapshot'),
                fetch(`/api/legatruu/history?tail=${histTail}`),
            ]);

            if (!snapRes.ok) throw new Error(`Snapshot: ${snapRes.statusText}`);
            if (!histRes.ok) throw new Error(`History: ${histRes.statusText}`);

            const snap: Snapshot        = await snapRes.json();
            const histJson: { data: HistoryRow[] } = await histRes.json();

            setSnapshot(snap);

            // Populate charts
            const rows = histJson.data;
            if (rows.length > 0 && indexSeriesRef.current && corrSeriesRef.current && histSeriesRef.current) {
                const indexData = rows.map(r => ({ time: r.date as any, value: r.index_value }));
                const corrData  = rows.map(r => ({ time: r.date as any, value: r.corr }));
                const rtnData   = rows.map(r => ({
                    time:  r.date as any,
                    value: r.daily_return,
                    color: r.daily_return >= 0 ? '#10b981' : '#ef4444',
                }));

                indexSeriesRef.current.setData(indexData);
                corrSeriesRef.current.setData(corrData);
                histSeriesRef.current.setData(rtnData);

                chartRef.current?.timeScale().fitContent();
                corrChartRef.current?.timeScale().fitContent();
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Init charts ──────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current || !corrContainerRef.current) return;

        const commonOptions = {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af',
            },
            grid: {
                vertLines: { color: '#27272a' },
                horzLines: { color: '#27272a' },
            },
            rightPriceScale: { borderColor: '#27272a', autoScale: true },
            timeScale: { borderColor: '#27272a', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
            crosshair: {
                vertLine: { color: '#52525b', width: 1 as any, style: 3 },
                horzLine: { color: '#52525b', width: 1 as any, style: 3 },
            },
        };

        // Main chart: proxy index + daily return histogram
        const chart = createChart(chartContainerRef.current, commonOptions);
        chartRef.current = chart;

        const indexSeries = chart.addSeries(LineSeries, {
            color: '#818cf8',
            lineWidth: 2,
            title: 'Bond Proxy Index',
            crosshairMarkerRadius: 4,
        });
        indexSeriesRef.current = indexSeries;

        const histSeries = chart.addSeries(HistogramSeries, {
            color: '#10b981',
            priceFormat: { type: 'percent' },
            priceScaleId: 'returns',
        } as any);
        chart.priceScale('returns').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });
        histSeriesRef.current = histSeries;

        // Correlation chart
        const corrChart = createChart(corrContainerRef.current, {
            ...commonOptions,
            height: 160,
        });
        corrChartRef.current = corrChart;

        const zeroSeries = corrChart.addSeries(LineSeries, {
            color: '#ef4444', lineWidth: 1, lineStyle: 2,
            crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
        });

        const corrSeries = corrChart.addSeries(LineSeries, {
            color: '#f59e0b',
            lineWidth: 2,
            title: 'Bond-Equity Corr (60d)',
            crosshairMarkerRadius: 4,
        });
        corrSeriesRef.current = corrSeries;

        const handleResize = () => {
            if (chartContainerRef.current)
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            if (corrContainerRef.current)
                corrChart.applyOptions({ width: corrContainerRef.current.clientWidth });
        };
        window.addEventListener('resize', handleResize);

        // Fetch initial data — after series are set up, populate zero line after history loads
        fetchAll(tail).then(() => {
            // add zero line once we have history data via corrSeries data
        });

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
            corrChart.remove();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!indexSeriesRef.current) return;
        fetchAll(tail);
    }, [tail, fetchAll]);

    // ── Derived UI ───────────────────────────────────────────────────
    const regime = snapshot?.regime;
    const perf   = snapshot?.performance;
    const rc     = regime ? (REGIME_CONFIG[regime.label] ?? REGIME_CONFIG.NEUTRAL) : REGIME_CONFIG.NEUTRAL;
    const mc     = regime ? (MOMENTUM_CONFIG[regime.momentum_signal] ?? MOMENTUM_CONFIG.fading) : MOMENTUM_CONFIG.fading;

    return (
        <div className="flex flex-col gap-4 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden relative p-5">
            {/* ── Gradient accent ── */}
            <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 opacity-80" />

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-mono font-bold text-zinc-100 tracking-tight flex items-center gap-2">
                        <span className="text-violet-400">LEGA·TRUU</span>
                        <span className="text-[10px] bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded uppercase tracking-wider">
                            Bond Proxy
                        </span>
                    </h2>
                    <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        Global Bond Market Composite — 8-ETF Weighted Proxy (AGG benchmark)
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Time range selector */}
                    {([252, 504, 756, 1260] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTail(t)}
                            className={`px-2.5 py-1 text-[10px] font-mono rounded border transition-colors ${
                                tail === t
                                    ? 'bg-violet-600 border-violet-500 text-white'
                                    : 'bg-zinc-900 border-zinc-700 text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {t === 252 ? '1Y' : t === 504 ? '2Y' : t === 756 ? '3Y' : '5Y'}
                        </button>
                    ))}
                    <button
                        onClick={() => fetchAll(tail)}
                        disabled={loading}
                        className="px-2.5 py-1 text-[10px] font-mono rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 disabled:opacity-40 transition-colors"
                    >
                        {loading ? '...' : '↺'}
                    </button>
                </div>
            </div>

            {/* ── Error ── */}
            {error && (
                <div className="bg-red-950/30 border border-red-500/30 rounded-lg px-4 py-3 text-sm font-mono text-red-400">
                    ⚠ {error}
                </div>
            )}

            {/* ── Top Snapshot Row ── */}
            {snapshot && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Index Value */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 col-span-1">
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Proxy Index</p>
                        <p className="text-2xl font-mono font-bold text-zinc-100 mt-0.5">
                            {fmtPlain(snapshot.index_value, '', 2)}
                        </p>
                        <p className={`text-xs font-mono mt-0.5 ${snapshot.daily_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {fmt(snapshot.daily_return_pct)} today
                        </p>
                    </div>

                    {/* Regime Badge */}
                    <div className={`${rc.bg} border ${rc.border} rounded-xl p-3 col-span-1`}>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Regime</p>
                        <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${rc.dot} shrink-0 animate-pulse`} />
                            <span className={`text-sm font-mono font-bold ${rc.color}`}>{rc.label}</span>
                        </div>
                        <p className={`text-xs font-mono mt-1 ${mc.color}`}>
                            {mc.arrow} {mc.label}
                        </p>
                    </div>

                    {/* Hedge Status */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 col-span-1">
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Hedge Status</p>
                        <p className={`text-sm font-mono font-bold mt-1 ${regime?.hedge_active ? 'text-emerald-400' : 'text-red-400'}`}>
                            {regime?.hedge_active ? '🛡 ACTIVE' : '⚠ INACTIVE'}
                        </p>
                        <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                            Bond-Equity Corr: {fmtPlain(regime?.bond_equity_corr, '', 3)}
                        </p>
                    </div>

                    {/* Duration */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 col-span-1">
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Eff. Duration</p>
                        <p className="text-2xl font-mono font-bold text-violet-300 mt-0.5">
                            {fmtPlain(perf?.effective_duration, 'yr')}
                        </p>
                        <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                            TE: {fmtPlain(perf?.tracking_error_pct)}% vs AGG
                        </p>
                    </div>
                </div>
            )}

            {/* ── Main Chart: Proxy Index ── */}
            <div className="relative bg-zinc-900/30 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="absolute top-3 left-4 z-10 pointer-events-none">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                        Bond Proxy Index · Daily Return Histogram
                    </span>
                </div>
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center z-20 bg-zinc-950/60 backdrop-blur-sm">
                        <div className="text-violet-400 font-mono text-sm animate-pulse">Loading Bond Data…</div>
                    </div>
                )}
                <div ref={chartContainerRef} style={{ width: '100%', height: 300 }} />
            </div>

            {/* ── Correlation Chart ── */}
            <div className="relative bg-zinc-900/30 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="absolute top-3 left-4 z-10 pointer-events-none">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                        Bond–Equity Rolling 60d Correlation · <span className="text-red-400">0 = Decoupling</span>
                    </span>
                </div>
                <div ref={corrContainerRef} style={{ width: '100%', height: 160 }} />
            </div>

            {/* ── Performance Metrics ── */}
            {perf && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                        { label: 'Annual Return',    value: fmt(perf.annual_return_pct),   color: perf.annual_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400' },
                        { label: 'Annual Vol',       value: fmtPlain(perf.annual_vol_pct) + '%', color: 'text-amber-400' },
                        { label: 'Sharpe Ratio',     value: fmtPlain(perf.sharpe_ratio, '', 3),  color: perf.sharpe_ratio >= 1 ? 'text-emerald-400' : perf.sharpe_ratio >= 0 ? 'text-amber-400' : 'text-red-400' },
                        { label: 'Max Drawdown',     value: fmt(perf.max_drawdown_pct),    color: 'text-red-400' },
                        { label: 'Tracking Error',   value: fmtPlain(perf.tracking_error_pct) + '%', color: 'text-zinc-300' },
                        { label: 'Corr vs AGG',      value: fmtPlain(perf.corr_vs_benchmark, '', 3), color: 'text-violet-400' },
                    ].map(({ label, value, color }) => (
                        <div key={label} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-center">
                            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{label}</p>
                            <p className={`text-sm font-mono font-bold mt-1 ${color}`}>{value}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Momentum / ROC ── */}
            {regime && (
                <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">Rate of Change</p>
                    <div className="flex gap-6">
                        <div>
                            <p className="text-[10px] font-mono text-zinc-600">20-Day ROC</p>
                            <p className={`text-base font-mono font-bold ${regime.roc_20d >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmt(regime.roc_20d)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-mono text-zinc-600">60-Day ROC</p>
                            <p className={`text-base font-mono font-bold ${regime.roc_60d >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmt(regime.roc_60d)}
                            </p>
                        </div>
                        <div className="ml-auto flex items-center gap-2 text-[10px] font-mono text-zinc-600">
                            Updated: {snapshot ? new Date(snapshot.timestamp).toLocaleTimeString() : '--'}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Portfolio Composition ── */}
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4">
                <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                    Composite Allocation
                </p>
                <div className="space-y-2">
                    {Object.entries(COMPONENTS_META).map(([ticker, meta]) => (
                        <div key={ticker} className="flex items-center gap-3">
                            <span className="text-[10px] font-mono text-zinc-400 w-10 shrink-0">{ticker}</span>
                            <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${meta.weight * 100}%`, backgroundColor: meta.color }}
                                />
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500 w-24 shrink-0">{meta.label}</span>
                            <span className="text-[10px] font-mono text-zinc-400 w-8 text-right shrink-0">
                                {(meta.weight * 100).toFixed(0)}%
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

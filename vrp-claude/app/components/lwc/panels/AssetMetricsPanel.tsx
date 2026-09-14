import React, { useEffect, useState, useMemo } from 'react';
import { Play, TrendingUp, TrendingDown, RefreshCw, BarChart2, Activity, ShieldAlert, ArrowUpRight, Search, ChevronLeft, ChevronRight } from 'lucide-react';

interface AssetMetricsPanelProps {
    ticker: string;
    interval: string;
    currentPrice: number | null;
}

interface HistoricalBar {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface CalculatedBar {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    logReturn: number | null;
    yzVol: number | null;
    yzVolAnn: number | null;
    gapDirection: 'Gap Up' | 'Gap Down' | 'No Gap';
    gapStatus: 'Gap Fill' | 'Runaway Gap' | 'N/A';
    gapSize: number | null; // Gap Pembukaan (%)
    gapClosedPct: number;  // % Gap Ditutup
    runExtensionPct: number; // % Run Extension
}

export default function AssetMetricsPanel({ ticker, interval, currentPrice }: AssetMetricsPanelProps) {
    const [rawBars, setRawBars] = useState<HistoricalBar[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Pagination & Search States
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const itemsPerPage = 15;
    const [lookbackWindow, setLookbackWindow] = useState(20);

    // 1. Fetch historical data on ticker/interval change
    useEffect(() => {
        let isMounted = true;
        
        async function fetchHistory() {
            setLoading(true);
            setError(null);
            
            const isIntraday = ['1m', '5m', '15m', '1h', '4h'].includes(interval);
            let fetchInterval = interval;
            let fetchRange = '1y';

            if (interval === '1m') fetchRange = '7d';
            else if (interval === '5m' || interval === '15m') fetchRange = '60d';
            else if (interval === '1h' || interval === '4h') fetchRange = '730d';
            else if (interval === '1d') fetchRange = '1y';

            if (interval === '4h') fetchInterval = '1h';

            try {
                const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(ticker)}&interval=${fetchInterval}&range=${fetchRange}`);
                if (!res.ok) throw new Error(`Yahoo API error: ${res.status}`);
                
                const json = await res.json();
                if (json.error) throw new Error(json.error);
                if (!json.chart?.result?.[0]) throw new Error("Ticker not found or invalid response format.");

                const result = json.chart.result[0];
                const timestamps = result.timestamp;
                const indicators = result.indicators.quote[0];

                if (!timestamps || !indicators) throw new Error("No data available for this range.");

                let formatted: HistoricalBar[] = [];
                for (let i = 0; i < timestamps.length; i++) {
                    const open = indicators.open[i];
                    const high = indicators.high[i];
                    const low = indicators.low[i];
                    const close = indicators.close[i];
                    const volume = indicators.volume[i];

                    if (open !== null && high !== null && low !== null && close !== null) {
                        const date = new Date(timestamps[i] * 1000);
                        let timeStr = date.toISOString().split('T')[0];
                        if (isIntraday) {
                            // format: YYYY-MM-DD HH:MM
                            timeStr = `${timeStr} ${date.toTimeString().split(' ')[0].slice(0, 5)}`;
                        }
                        formatted.push({
                            time: timeStr,
                            open,
                            high,
                            low,
                            close,
                            volume: volume || 0
                        });
                    }
                }

                // Handle 4h downsampling
                if (interval === '4h' && formatted.length > 0) {
                    const aggregated: HistoricalBar[] = [];
                    let currentCandle: HistoricalBar | null = null;
                    let count = 0;

                    for (const bar of formatted) {
                        if (!currentCandle) {
                            currentCandle = { ...bar };
                            count = 1;
                        } else {
                            currentCandle.high = Math.max(currentCandle.high, bar.high);
                            currentCandle.low = Math.min(currentCandle.low, bar.low);
                            currentCandle.close = bar.close;
                            currentCandle.volume += bar.volume;
                            count++;
                        }

                        if (count === 4) {
                            aggregated.push({ ...currentCandle });
                            currentCandle = null;
                            count = 0;
                        }
                    }
                    if (currentCandle) aggregated.push(currentCandle);
                    formatted = aggregated;
                }

                if (isMounted) {
                    setRawBars(formatted);
                    setCurrentPage(1);
                }
            } catch (err: any) {
                if (isMounted) setError(err.message || "Failed to load asset metrics data");
            } finally {
                if (isMounted) setLoading(false);
            }
        }

        fetchHistory();
        return () => {
            isMounted = false;
        };
    }, [ticker, interval]);

    // 2. Blend Real-Time price tick for the last bar
    const activeBars = useMemo(() => {
        if (rawBars.length === 0) return [];
        if (currentPrice === null) return rawBars;

        const updated = [...rawBars];
        const lastIdx = updated.length - 1;
        const lastBar = { ...updated[lastIdx] };

        // Blend the current live tick into the last bar's open/high/low/close bounds
        lastBar.close = currentPrice;
        lastBar.high = Math.max(lastBar.high, currentPrice);
        lastBar.low = Math.min(lastBar.low, currentPrice);

        updated[lastIdx] = lastBar;
        return updated;
    }, [rawBars, currentPrice]);

    // 3. Quantitative calculations (Yang-Zhang, Log Return, Gaps)
    const calculatedData = useMemo(() => {
        if (activeBars.length === 0) return [];

        const n = activeBars.length;
        const results: CalculatedBar[] = [];

        // Annualization factor M based on interval
        let mFactor = 252; // daily standard
        switch (interval) {
            case '1d': mFactor = 252; break;
            case '4h': mFactor = 504; break;
            case '1h': mFactor = 1638; break;
            case '15m': mFactor = 6552; break;
            case '5m': mFactor = 19656; break;
            case '1m': mFactor = 98280; break;
            default: mFactor = 252; break;
        }

        const kConst = 0.34 / (1.34 + (lookbackWindow + 1) / (lookbackWindow - 1));

        for (let t = 0; t < n; t++) {
            const current = activeBars[t];
            const prev = t > 0 ? activeBars[t - 1] : null;

            // a. Log Return
            const logReturn = prev ? Math.log(current.close / prev.close) : null;

            // b. Gap Quantitative Analysis (Faithful to python/numpy logic)
            let gapDirection: 'Gap Up' | 'Gap Down' | 'No Gap' = 'No Gap';
            let gapStatus: 'Gap Fill' | 'Runaway Gap' | 'N/A' = 'N/A';
            let gapSize: number | null = null;
            let gapClosedPct = 0;
            let runExtensionPct = 0;

            if (prev) {
                // Gap Pembukaan (%)
                gapSize = ((current.open - prev.close) / prev.close) * 100;

                // 1. Tentukan Arah Gap
                if (current.open > prev.close) {
                    gapDirection = 'Gap Up';
                } else if (current.open < prev.close) {
                    gapDirection = 'Gap Down';
                } else {
                    gapDirection = 'No Gap';
                }

                // 2. Deteksi Status: Gap Fill atau Runaway Gap
                const kondisiFillUp = gapDirection === 'Gap Up' && current.low <= prev.close;
                const kondisiFillDown = gapDirection === 'Gap Down' && current.high >= prev.close;

                if (kondisiFillUp || kondisiFillDown) {
                    gapStatus = 'Gap Fill';
                } else if (gapDirection !== 'No Gap') {
                    gapStatus = 'Runaway Gap';
                } else {
                    gapStatus = 'N/A';
                }

                // 3. Hitung Persentase Gap yang Berhasil Ditutup
                const gapNominal = Math.abs(current.open - prev.close);
                if (gapNominal > 0) {
                    let jarakPenutupan = 0;
                    if (gapDirection === 'Gap Up') {
                        jarakPenutupan = current.open - current.low;
                    } else if (gapDirection === 'Gap Down') {
                        jarakPenutupan = current.high - current.open;
                    }
                    const pctVal = jarakPenutupan / gapNominal;
                    gapClosedPct = Math.min(1.0, Math.max(0, pctVal)) * 100; // in percent (0 to 100%)
                }

                // 4. Hitung Persentase Run Extension
                if (gapDirection === 'Gap Up') {
                    runExtensionPct = ((current.high - current.open) / current.open) * 100;
                } else if (gapDirection === 'Gap Down') {
                    runExtensionPct = ((current.open - current.low) / current.open) * 100;
                }
            }

            // c. Yang-Zhang Volatility (requires at least sliding window of lookbackWindow)
            let yzVol: number | null = null;
            let yzVolAnn: number | null = null;

            if (t >= lookbackWindow) {
                // Get segment from t - lookbackWindow + 1 to t
                let u: number[] = []; // Overnight returns: ln(O_i / C_{i-1})
                let d: number[] = []; // Open-to-Close returns: ln(C_i / O_i)
                let rsSum = 0; // Rogers-Satchell sum

                for (let i = t - lookbackWindow + 1; i <= t; i++) {
                    const bar = activeBars[i];
                    const prevBar = activeBars[i - 1]; // Guaranteed to exist because t >= lookbackWindow >= 1
                    
                    const uVal = Math.log(bar.open / prevBar.close);
                    const dVal = Math.log(bar.close / bar.open);
                    u.push(uVal);
                    d.push(dVal);

                    const rsVal = Math.log(bar.high / bar.close) * Math.log(bar.high / bar.open) +
                                  Math.log(bar.low / bar.close) * Math.log(bar.low / bar.open);
                    rsSum += rsVal;
                }

                // Volatilities
                const meanU = u.reduce((sum, val) => sum + val, 0) / lookbackWindow;
                const varU = u.reduce((sum, val) => sum + Math.pow(val - meanU, 2), 0) / (lookbackWindow - 1);

                const meanD = d.reduce((sum, val) => sum + val, 0) / lookbackWindow;
                const varD = d.reduce((sum, val) => sum + Math.pow(val - meanD, 2), 0) / (lookbackWindow - 1);

                const meanRS = rsSum / lookbackWindow;

                const yzVar = varU + kConst * varD + (1 - kConst) * meanRS;
                if (yzVar > 0) {
                    yzVol = Math.sqrt(yzVar);
                    yzVolAnn = yzVol * Math.sqrt(mFactor);
                }
            }

            results.push({
                ...current,
                logReturn,
                yzVol,
                yzVolAnn,
                gapDirection,
                gapStatus,
                gapSize,
                gapClosedPct,
                runExtensionPct
            });
        }

        // Chronological order descending (newest first) for UI display
        return results.reverse();
    }, [activeBars, interval, lookbackWindow]);

    // 4. Filtered rows by search (filters by date, direction, and status)
    const filteredRows = useMemo(() => {
        if (!searchQuery) return calculatedData;
        return calculatedData.filter(row => 
            row.time.toLowerCase().includes(searchQuery.toLowerCase()) ||
            row.gapStatus.toLowerCase().includes(searchQuery.toLowerCase()) ||
            row.gapDirection.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [calculatedData, searchQuery]);

    // 5. Paginated rows
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredRows.slice(start, start + itemsPerPage);
    }, [filteredRows, currentPage]);

    const totalPages = Math.ceil(filteredRows.length / itemsPerPage);

    // 6. Summary metrics (based on all calculated data)
    const summaryStats = useMemo(() => {
        if (calculatedData.length === 0) return null;

        const validReturns = calculatedData.map(r => r.logReturn).filter((r): r is number => r !== null);
        const validVols = calculatedData.map(r => r.yzVolAnn).filter((v): v is number => v !== null);
        
        const avgReturn = validReturns.reduce((s, v) => s + v, 0) / (validReturns.length || 1);
        const avgVolAnn = validVols.reduce((s, v) => s + v, 0) / (validVols.length || 1);
        const currentVolAnn = calculatedData[0]?.yzVolAnn || null;

        let upGaps = 0;
        let downGaps = 0;
        let totalGaps = 0;

        calculatedData.forEach(row => {
            if (row.gapDirection === 'Gap Up') upGaps++;
            if (row.gapDirection === 'Gap Down') downGaps++;
            if (row.gapDirection !== 'No Gap') totalGaps++;
        });

        const winRate = validReturns.length > 0
            ? (validReturns.filter(r => r > 0).length / validReturns.length) * 100
            : 0;

        return {
            avgReturn,
            avgVolAnn,
            currentVolAnn,
            upGaps,
            downGaps,
            totalGaps,
            winRate,
            dataPoints: calculatedData.length
        };
    }, [calculatedData]);

    if (loading) {
        return (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 shadow-xl animate-pulse">
                <div className="h-6 bg-zinc-900 rounded w-1/4 mb-4"></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <div className="h-20 bg-zinc-900 rounded"></div>
                    <div className="h-20 bg-zinc-900 rounded"></div>
                    <div className="h-20 bg-zinc-900 rounded"></div>
                    <div className="h-20 bg-zinc-900 rounded"></div>
                </div>
                <div className="h-64 bg-zinc-900 rounded"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-zinc-950 border border-red-950 rounded-xl p-6 shadow-xl flex flex-col items-center justify-center text-center">
                <ShieldAlert className="text-red-500 w-12 h-12 mb-2 animate-bounce" />
                <h4 className="text-sm font-mono font-bold text-red-400 uppercase">Analysis Error</h4>
                <p className="text-xs font-mono text-zinc-500 mt-1 max-w-md">{error}</p>
            </div>
        );
    }

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-5">
            {/* Header Title with Live Pulse Indicator */}
            <div className="flex justify-between items-center border-b border-zinc-900 pb-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                        <Activity className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-base font-mono font-bold text-zinc-100 uppercase tracking-wider flex items-center gap-2">
                            {ticker} Asset Metrics Dashboard
                            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded uppercase tracking-widest font-bold">
                                {interval}
                            </span>
                        </h3>
                        <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
                            Real-time quantitative estimators and dynamic gap detection engine.
                        </p>
                    </div>
                </div>
                
                {/* Real-time Indicator */}
                {currentPrice !== null && (
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                        LIVE CONNECTED: ${currentPrice.toFixed(2)}
                    </div>
                )}
            </div>

            {/* Summary Statistics Cards */}
            {summaryStats && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/60 relative overflow-hidden group hover:border-indigo-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-indigo-500"></div>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1 flex items-center justify-between">
                            Current Vol (Y-Z Daily)
                            <BarChart2 className="w-3.5 h-3.5 text-zinc-600" />
                        </p>
                        <p className="text-2xl font-mono font-bold text-indigo-400">
                            {summaryStats.currentVolAnn ? `${((summaryStats.currentVolAnn / Math.sqrt(252)) * 100).toFixed(2)}%` : 'Calculating...'}
                        </p>
                        <p className="text-[9px] font-mono text-zinc-500 mt-1">
                            Average YZ Daily: {((summaryStats.avgVolAnn / Math.sqrt(252)) * 100).toFixed(2)}%
                        </p>
                    </div>

                    <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/60 relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500"></div>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1 flex items-center justify-between">
                            Average Log Return
                            {summaryStats.avgReturn >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                        </p>
                        <p className={`text-2xl font-mono font-bold ${summaryStats.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {summaryStats.avgReturn >= 0 ? '+' : ''}{(summaryStats.avgReturn * 100).toFixed(2)}%
                        </p>
                        <p className="text-[9px] font-mono text-zinc-500 mt-1">
                            Bar Win-Rate: {summaryStats.winRate.toFixed(1)}%
                        </p>
                    </div>

                    <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/60 relative overflow-hidden group hover:border-amber-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-amber-500"></div>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1 flex items-center justify-between">
                            Up / Down Gaps
                            <ArrowUpRight className="w-3.5 h-3.5 text-amber-500" />
                        </p>
                        <p className="text-2xl font-mono font-bold text-amber-400">
                            {summaryStats.upGaps} <span className="text-zinc-600 text-sm">/</span> {summaryStats.downGaps}
                        </p>
                        <p className="text-[9px] font-mono text-zinc-500 mt-1">
                            Total Gaps: {summaryStats.totalGaps} in {summaryStats.dataPoints} bars
                        </p>
                    </div>

                    <div className="bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/60 relative overflow-hidden group hover:border-zinc-500/30 transition-colors">
                        <div className="absolute top-0 left-0 w-full h-0.5 bg-zinc-600"></div>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wide mb-1 flex items-center justify-between">
                            Lookback Horizon
                            <Play className="w-3.5 h-3.5 text-zinc-500 rotate-90" />
                        </p>
                        <p className="text-2xl font-mono font-bold text-zinc-200">
                            {summaryStats.dataPoints} <span className="text-xs text-zinc-500">BARS</span>
                        </p>
                        <p className="text-[9px] font-mono text-zinc-500 mt-1 uppercase">
                            Vol Lookback window: {lookbackWindow}
                        </p>
                    </div>
                </div>
            )}

            {/* Search Bar & Table Controls */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="relative w-full sm:w-64">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                            <Search className="w-4 h-4" />
                        </span>
                        <input
                            type="text"
                            placeholder="Search Date (e.g. 2026-05)..."
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            className="w-full bg-zinc-900/60 border border-zinc-800 text-xs font-mono rounded-lg pl-9 pr-3 py-2 text-zinc-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
                        />
                    </div>
                    
                    {/* Interactive Lookback Window Controller */}
                    <div className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5 shadow-inner">
                        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-bold">Window:</span>
                        <input
                            type="number"
                            min="5"
                            max="100"
                            value={lookbackWindow}
                            onChange={(e) => {
                                const val = parseInt(e.target.value);
                                if (!isNaN(val) && val >= 5 && val <= 100) {
                                    setLookbackWindow(val);
                                    setCurrentPage(1);
                                }
                            }}
                            className="bg-zinc-950 border border-zinc-800 w-12 text-xs font-mono text-indigo-400 font-bold focus:outline-none focus:border-indigo-500 text-center rounded py-0.5"
                        />
                        <span className="text-[10px] font-mono text-zinc-500 uppercase">Bars</span>
                    </div>
                </div>

                {/* Pagination info and button arrows */}
                <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-500">
                        Page {currentPage} of {totalPages || 1} ({filteredRows.length} rows)
                    </span>
                    <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Metrics Data Table */}
            <div className="overflow-x-auto border border-zinc-900 rounded-xl">
                <table className="w-full text-left border-collapse font-mono text-xs text-zinc-400">
                    <thead>
                        <tr className="bg-zinc-950 border-b border-zinc-900 text-zinc-500 uppercase tracking-wider text-[10px]">
                            <th className="py-3 px-4 font-bold">Date / Time</th>
                            <th className="py-3 px-3 font-bold text-right">Open</th>
                            <th className="py-3 px-3 font-bold text-right">High</th>
                            <th className="py-3 px-3 font-bold text-right">Low</th>
                            <th className="py-3 px-3 font-bold text-right">Close</th>
                            <th className="py-3 px-4 font-bold text-right">Log Return</th>
                            <th className="py-3 px-4 font-bold text-right">Yang-Zhang Vol (Daily)</th>
                            <th className="py-3 px-4 font-bold text-center">Arah Gap</th>
                            <th className="py-3 px-4 font-bold text-center">Status Gap</th>
                            <th className="py-3 px-4 font-bold text-right">Gap Ditutup / Run Ext</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/60">
                        {paginatedRows.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-12 text-center text-zinc-600 font-mono italic">
                                    No data points found.
                                </td>
                            </tr>
                        ) : (
                            paginatedRows.map((row, index) => {
                                const isLatest = index === 0 && currentPage === 1 && currentPrice !== null;
                                
                                return (
                                    <tr 
                                        key={row.time + '-' + index} 
                                        className={`hover:bg-zinc-900/30 transition-colors group ${
                                            isLatest ? 'bg-indigo-500/5 border-l-2 border-l-indigo-500' : ''
                                        }`}
                                    >
                                        <td className="py-2.5 px-4 text-zinc-200 font-bold whitespace-nowrap flex items-center gap-1.5">
                                            {row.time}
                                            {isLatest && (
                                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping"></span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-zinc-300 font-mono">
                                            {row.open.toFixed(2)}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-zinc-300 font-mono">
                                            {row.high.toFixed(2)}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-zinc-300 font-mono">
                                            {row.low.toFixed(2)}
                                        </td>
                                        <td className="py-2.5 px-3 text-right text-zinc-100 font-bold font-mono">
                                            {row.close.toFixed(2)}
                                        </td>
                                        <td className="py-2.5 px-4 text-right">
                                            {row.logReturn === null ? (
                                                <span className="text-zinc-600 font-mono">---</span>
                                            ) : row.logReturn > 0 ? (
                                                <span className="inline-flex items-center gap-0.5 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-[10.5px] font-bold font-mono border border-emerald-500/10">
                                                    +{ (row.logReturn * 100).toFixed(2) }%
                                                </span>
                                            ) : row.logReturn < 0 ? (
                                                <span className="inline-flex items-center gap-0.5 text-red-400 bg-red-500/10 px-2 py-0.5 rounded text-[10.5px] font-bold font-mono border border-red-500/10">
                                                    { (row.logReturn * 100).toFixed(2) }%
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-0.5 text-zinc-500 bg-zinc-900/60 px-2 py-0.5 rounded text-[10.5px] font-mono border border-zinc-800/50">
                                                    0.00%
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-4 text-right text-zinc-300 font-mono">
                                            {row.yzVolAnn !== null ? (
                                                <div className="flex flex-col items-end">
                                                    <span className="text-indigo-400 font-bold">{((row.yzVolAnn / Math.sqrt(252)) * 100).toFixed(2)}%</span>
                                                    <span className="text-[9px] text-zinc-600">Annualized: {(row.yzVolAnn * 100).toFixed(2)}%</span>
                                                </div>
                                            ) : (
                                                <span className="text-zinc-600 italic">Calculating (N={lookbackWindow})...</span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-4 text-center">
                                            {row.gapDirection === 'Gap Up' ? (
                                                <span className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                                    <TrendingUp className="w-3 h-3" /> Gap Up ({row.gapSize !== null ? `${row.gapSize >= 0 ? '+' : ''}${row.gapSize.toFixed(2)}%` : '0.00%'})
                                                </span>
                                            ) : row.gapDirection === 'Gap Down' ? (
                                                <span className="inline-flex items-center gap-1 bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                                    <TrendingDown className="w-3 h-3" /> Gap Down ({row.gapSize !== null ? `${row.gapSize >= 0 ? '+' : ''}${row.gapSize.toFixed(2)}%` : '0.00%'})
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 bg-zinc-900/80 text-zinc-500 border border-zinc-800/80 px-2.5 py-0.5 rounded text-[10px] font-mono tracking-wider font-semibold">
                                                    ● No Gap ({row.gapSize !== null ? `${row.gapSize >= 0 ? '+' : ''}${row.gapSize.toFixed(2)}%` : '0.00%'})
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-4 text-center">
                                            {row.gapStatus === 'Gap Fill' ? (
                                                <span className="inline-flex items-center gap-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                                    Gap Fill
                                                </span>
                                            ) : row.gapStatus === 'Runaway Gap' ? (
                                                <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                                    Runaway Gap
                                                </span>
                                            ) : (
                                                <span className="text-zinc-600 text-[10px] font-semibold font-mono">N/A</span>
                                            )}
                                        </td>
                                        <td className="py-2.5 px-4 text-right">
                                            <div className="flex flex-col items-end gap-0.5 font-mono text-[10.5px]">
                                                <span className={row.gapClosedPct >= 100 ? "text-emerald-400 font-bold" : row.gapClosedPct > 0 ? "text-indigo-400 font-semibold" : "text-zinc-600"}>
                                                    Closed: {row.gapClosedPct.toFixed(2)}%
                                                </span>
                                                <span className={row.runExtensionPct > 0 ? "text-amber-500 text-[9.5px] font-semibold" : "text-zinc-600 text-[9.5px]"}>
                                                    Run: +{row.runExtensionPct.toFixed(2)}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Quantitative Explanations Footer */}
            <div className="bg-zinc-900/20 p-3 rounded-lg border border-zinc-800/40 text-[10.5px] font-mono text-zinc-500 leading-relaxed grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <span className="text-zinc-400 font-bold block mb-0.5">ℹ️ Log Return</span>
                    Calculates logarithmic returns (R_t = ln(C_t / C_t-1)). Log returns are time-additive, making them superior for mathematical models.
                </div>
                <div>
                    <span className="text-zinc-400 font-bold block mb-0.5">ℹ️ Yang-Zhang Volatility</span>
                    Minimum {lookbackWindow}-period lookback. Combines overnight gap volatility and open-to-close volatility with the Rogers-Satchell range estimator.
                </div>
                <div>
                    <span className="text-zinc-400 font-bold block mb-0.5">ℹ️ Gap Analysis Suite</span>
                    Arah: Gap Up (O &gt; Close Kemarin) / Gap Down. Status: Gap Fill (gap closed by candle range) or Runaway (continuation). Closed %: percentage of gap filled. Run %: move extension.
                </div>
            </div>
        </div>
    );
}

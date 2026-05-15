import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineSeries } from 'lightweight-charts';

export default function YieldSpreadChart() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const series10Y2YRef = useRef<ISeriesApi<"Line"> | null>(null);
    const series10Y3MRef = useRef<ISeriesApi<"Line"> | null>(null);
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [latest10Y2Y, setLatest10Y2Y] = useState<number | null>(null);
    const [latest10Y3M, setLatest10Y3M] = useState<number | null>(null);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // Initialize Chart
        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: '#9ca3af',
            },
            grid: {
                vertLines: { color: '#27272a' },
                horzLines: { color: '#27272a' },
            },
            rightPriceScale: {
                borderColor: '#27272a',
                autoScale: true,
            },
            timeScale: {
                borderColor: '#27272a',
                timeVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            crosshair: {
                vertLine: { color: '#52525b', width: 1, style: 3 },
                horzLine: { color: '#52525b', width: 1, style: 3 },
            },
        });
        
        chartRef.current = chart;

        // Add 10Y-2Y Series
        const series10Y2Y = chart.addSeries(LineSeries, {
            color: '#38bdf8', // Light blue
            lineWidth: 2,
            title: '10Y-2Y Spread',
            crosshairMarkerRadius: 4,
        });
        series10Y2YRef.current = series10Y2Y;

        // Add 10Y-3M Series
        const series10Y3M = chart.addSeries(LineSeries, {
            color: '#fbbf24', // Amber/Gold
            lineWidth: 2,
            title: '10Y-3M Spread',
            crosshairMarkerRadius: 4,
        });
        series10Y3MRef.current = series10Y3M;

        // Add Zero Line Baseline
        const zeroLineSeries = chart.addSeries(LineSeries, {
            color: '#ef4444', // Red
            lineWidth: 1,
            lineStyle: 2, // Dashed
            crosshairMarkerVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
        });

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        // Fetch Data
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/fred/yield-curve');
                if (!res.ok) throw new Error('Failed to fetch FRED data');
                const json = await res.json();
                
                const data = json.data;
                if (!data || data.length === 0) throw new Error('No data returned');

                const mapped10Y2Y = data.map((d: any) => ({ time: d.time, value: d.T10Y2Y }));
                const mapped10Y3M = data.map((d: any) => ({ time: d.time, value: d.T10Y3M }));
                
                // Zero line data
                const mappedZeroLine = data.map((d: any) => ({ time: d.time, value: 0 }));

                series10Y2Y.setData(mapped10Y2Y);
                series10Y3M.setData(mapped10Y3M);
                zeroLineSeries.setData(mappedZeroLine);

                // Set Latest values for UI
                setLatest10Y2Y(data[data.length - 1].T10Y2Y);
                setLatest10Y3M(data[data.length - 1].T10Y3M);

                chart.timeScale().fitContent();
                setLoading(false);
            } catch (err: any) {
                console.error(err);
                setError(err.message);
                setLoading(false);
            }
        };

        fetchData();

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    return (
        <div className="flex flex-col h-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden relative">
            {/* Header / Info Panel */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <h2 className="text-xl font-bold text-zinc-100 font-mono tracking-tight drop-shadow-md">TREASURY YIELD SPREAD</h2>
                <p className="text-xs font-mono text-zinc-400 max-w-sm mt-1 mb-2 drop-shadow-md">
                    Indikator utama makroekonomi (FRED). Ketika garis turun ke bawah 0 (garis merah muda putus-putus), kurva yield terinversi, yang secara historis merupakan sinyal kuat datangnya resesi.
                </p>
                
                <div className="flex gap-4 mt-3 pointer-events-auto">
                    <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-3 py-2 rounded shadow-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-sky-400"></div>
                            <span className="text-xs font-mono font-semibold text-zinc-300">10Y - 2Y</span>
                        </div>
                        <div className={`text-lg font-mono font-bold mt-1 ${latest10Y2Y !== null && latest10Y2Y < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {latest10Y2Y !== null ? `${latest10Y2Y > 0 ? '+' : ''}${latest10Y2Y.toFixed(2)}%` : '--'}
                        </div>
                    </div>
                    
                    <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-3 py-2 rounded shadow-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                            <span className="text-xs font-mono font-semibold text-zinc-300">10Y - 3M</span>
                        </div>
                        <div className={`text-lg font-mono font-bold mt-1 ${latest10Y3M !== null && latest10Y3M < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {latest10Y3M !== null ? `${latest10Y3M > 0 ? '+' : ''}${latest10Y3M.toFixed(2)}%` : '--'}
                        </div>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-zinc-950/50 backdrop-blur-sm">
                    <div className="text-indigo-400 font-mono text-sm animate-pulse">Loading Macro Data...</div>
                </div>
            )}

            {error && (
                <div className="absolute inset-0 flex items-center justify-center z-20">
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded font-mono text-sm">
                        {error}
                    </div>
                </div>
            )}

            <div ref={chartContainerRef} className="flex-1 w-full" style={{ minHeight: '600px' }} />
        </div>
    );
}

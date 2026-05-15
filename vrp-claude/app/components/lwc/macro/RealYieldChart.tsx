import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineSeries } from 'lightweight-charts';

export default function RealYieldChart() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesDfii10Ref = useRef<ISeriesApi<"Line"> | null>(null);
    const seriesTp10Ref = useRef<ISeriesApi<"Line"> | null>(null);
    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [latestDfii10, setLatestDfii10] = useState<number | null>(null);
    const [latestTp10, setLatestTp10] = useState<number | null>(null);

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

        // Add DFII10 (Real Yield) Series
        const seriesDfii10 = chart.addSeries(LineSeries, {
            color: '#10b981', // Emerald/Green
            lineWidth: 2,
            title: 'TIPS 10Y Real Yield',
            crosshairMarkerRadius: 4,
        });
        seriesDfii10Ref.current = seriesDfii10;

        // Add THREEFYTP10 (Term Premium) Series
        const seriesTp10 = chart.addSeries(LineSeries, {
            color: '#c084fc', // Purple
            lineWidth: 2,
            title: '10Y Term Premium',
            crosshairMarkerRadius: 4,
        });
        seriesTp10Ref.current = seriesTp10;

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
                const res = await fetch('http://localhost:8000/api/fred/real-yield');
                if (!res.ok) throw new Error('Failed to fetch FRED data');
                const json = await res.json();
                
                const data = json.data;
                if (!data || data.length === 0) throw new Error('No data returned');

                const mappedDfii10 = data.map((d: any) => ({ time: d.time, value: d.DFII10 }));
                const mappedTp10 = data.map((d: any) => ({ time: d.time, value: d.THREEFYTP10 }));
                
                // Zero line data
                const mappedZeroLine = data.map((d: any) => ({ time: d.time, value: 0 }));

                seriesDfii10.setData(mappedDfii10);
                seriesTp10.setData(mappedTp10);
                zeroLineSeries.setData(mappedZeroLine);

                // Set Latest values for UI
                setLatestDfii10(data[data.length - 1].DFII10);
                setLatestTp10(data[data.length - 1].THREEFYTP10);

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
                <h2 className="text-xl font-bold text-zinc-100 font-mono tracking-tight drop-shadow-md">REAL YIELD & TERM PREMIUM</h2>
                <p className="text-xs font-mono text-zinc-400 max-w-sm mt-1 mb-2 drop-shadow-md">
                    <b>Real Yield (TIPS)</b>: Proksi untuk risk appetite pasar. Semakin tinggi, modal beralih dari aset berisiko.<br/>
                    <b>Term Premium</b>: Kompensasi ekstra atas durasi risiko. Inversi atau penurunan tajam menandakan flight-to-safety.
                </p>
                
                <div className="flex gap-4 mt-3 pointer-events-auto">
                    <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-3 py-2 rounded shadow-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                            <span className="text-xs font-mono font-semibold text-zinc-300">TIPS 10Y</span>
                        </div>
                        <div className={`text-lg font-mono font-bold mt-1 ${latestDfii10 !== null && latestDfii10 < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {latestDfii10 !== null ? `${latestDfii10 > 0 ? '+' : ''}${latestDfii10.toFixed(2)}%` : '--'}
                        </div>
                    </div>
                    
                    <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-3 py-2 rounded shadow-lg">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-400"></div>
                            <span className="text-xs font-mono font-semibold text-zinc-300">Term Premium</span>
                        </div>
                        <div className={`text-lg font-mono font-bold mt-1 ${latestTp10 !== null && latestTp10 < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            {latestTp10 !== null ? `${latestTp10 > 0 ? '+' : ''}${latestTp10.toFixed(2)}%` : '--'}
                        </div>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-20 bg-zinc-950/50 backdrop-blur-sm">
                    <div className="text-purple-400 font-mono text-sm animate-pulse">Loading Macro Data...</div>
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

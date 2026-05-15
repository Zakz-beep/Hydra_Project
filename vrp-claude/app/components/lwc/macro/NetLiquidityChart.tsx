import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, ISeriesApi, LineSeries } from 'lightweight-charts';
import { RefreshCw, Activity } from 'lucide-react';

export default function NetLiquidityChart() {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // eslint-disable-next-line prefer-const
        let chart: any = null;
        let lineSeries: ISeriesApi<"Line"> | undefined;
        let walclSeries: ISeriesApi<"Line"> | undefined;
        let tgaSeries: ISeriesApi<"Line"> | undefined;
        let rrpSeries: ISeriesApi<"Line"> | undefined;

        const handleResize = () => {
            if (chartContainerRef.current && chart) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        // Fetch Data
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/fred/net-liquidity');
                if (!res.ok) throw new Error('Failed to fetch FRED data');
                const json = await res.json();
                
                const data = json.data;
                if (!data || data.length === 0) throw new Error('No data returned');

                const mappedNetLiq = data.map((d: any) => ({ time: d.time, value: d.NetLiquidity }));
                const mappedWalcl = data.map((d: any) => ({ time: d.time, value: d.WALCL }));
                const mappedTga = data.map((d: any) => ({ time: d.time, value: d.WTREGEN }));
                const mappedRrp = data.map((d: any) => ({ time: d.time, value: d.RRPONTSYD }));

                setChartData(data);

                if (chartContainerRef.current) {
                    chartContainerRef.current.innerHTML = '';
                    
                    chart = createChart(chartContainerRef.current, {
                        layout: {
                            background: { type: ColorType.Solid, color: 'transparent' },
                            textColor: '#A1A1AA',
                        },
                        grid: {
                            vertLines: { color: '#27272A' },
                            horzLines: { color: '#27272A' },
                        },
                        width: chartContainerRef.current.clientWidth,
                        height: 400,
                        rightPriceScale: {
                            borderColor: '#27272A',
                            scaleMargins: {
                                top: 0.1,
                                bottom: 0.1,
                            },
                        },
                        timeScale: {
                            borderColor: '#27272A',
                            timeVisible: false,
                        },
                        crosshair: {
                            mode: 1,
                        }
                    });

                    // Net Liquidity Line
                    lineSeries = chart.addSeries(LineSeries, {
                        color: '#10B981', // Emerald
                        lineWidth: 2,
                        title: 'Net Liquidity (B$)',
                        priceFormat: {
                            type: 'price',
                            precision: 1,
                            minMove: 0.1,
                        },
                    });
                    lineSeries!.setData(mappedNetLiq);

                    // WALCL
                    walclSeries = chart.addSeries(LineSeries, {
                        color: '#3B82F6', // Blue
                        lineWidth: 1,
                        lineStyle: 2, // Dashed
                        title: 'Total Assets (B$)',
                        visible: false, // hidden by default to avoid clutter
                    });
                    walclSeries!.setData(mappedWalcl);

                    // TGA
                    tgaSeries = chart.addSeries(LineSeries, {
                        color: '#F59E0B', // Amber
                        lineWidth: 1,
                        lineStyle: 2,
                        title: 'TGA (B$)',
                        visible: false,
                    });
                    tgaSeries!.setData(mappedTga);
                    
                    // RRP
                    rrpSeries = chart.addSeries(LineSeries, {
                        color: '#EF4444', // Red
                        lineWidth: 1,
                        lineStyle: 2,
                        title: 'Reverse Repo (B$)',
                        visible: false,
                    });
                    rrpSeries!.setData(mappedRrp);

                    chart.timeScale().fitContent();
                }

            } catch (err: any) {
                console.error(err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (chart) chart.remove();
        };
    }, []);

    // Get latest values for metrics
    const latest = chartData[chartData.length - 1];

    return (
        <div className="flex flex-col gap-4 border border-zinc-800 bg-zinc-950 rounded-xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                        <Activity className="w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                            Global Net Liquidity
                            {latest && (
                                <span className={`text-sm px-2 py-0.5 rounded ${latest.NetLiquidity > 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                    {latest.NetLiquidity.toFixed(1)} B$
                                </span>
                            )}
                        </h2>
                        <p className="text-xs text-zinc-400 font-mono">
                            WALCL - WTREGEN - RRPONTSYD
                        </p>
                    </div>
                </div>
                {loading && <RefreshCw className="w-4 h-4 text-zinc-500 animate-spin" />}
            </div>

            {/* Metrics */}
            {!loading && !error && latest && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 py-2 bg-zinc-900/30 border-b border-zinc-800">
                    <div className="flex flex-col">
                        <span className="text-xs text-zinc-500">Fed Total Assets (WALCL)</span>
                        <span className="text-sm font-mono text-blue-400">{latest.WALCL.toFixed(1)} B$</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs text-zinc-500">TGA (WTREGEN)</span>
                        <span className="text-sm font-mono text-amber-400">{latest.WTREGEN.toFixed(1)} B$</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs text-zinc-500">Reverse Repo (RRPONTSYD)</span>
                        <span className="text-sm font-mono text-red-400">{latest.RRPONTSYD.toFixed(1)} B$</span>
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && (
                <div className="p-4 text-red-400 bg-red-500/10 border border-red-500/20 m-4 rounded-lg text-sm">
                    {error}
                </div>
            )}

            {/* Chart Area */}
            <div className="p-4 relative">
                <div 
                    ref={chartContainerRef} 
                    className="w-full h-[400px]"
                />
            </div>
        </div>
    );
}

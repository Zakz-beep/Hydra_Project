import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, Time, CandlestickSeries, HistogramSeries, LineSeries, ISeriesApi } from 'lightweight-charts';

interface TradingChartProps {
    ticker: string;
    interval: string;
    showSma?: boolean;
    showVwap?: boolean;
    activePosition?: { entryPrice: number, tpPrice?: number, slPrice?: number, mode: 'long' | 'short' } | null;
    onPriceUpdate?: (price: number) => void;
}

interface ChartData {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export default function TradingChart({ 
    ticker, 
    interval, 
    showSma = true, 
    showVwap = true, 
    activePosition,
    onPriceUpdate 
}: TradingChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    // Series Refs
    const candlestickSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    
    // Price Line Refs for Position Tool
    const entryLineRef = useRef<any>(null);
    const tpLineRef = useRef<any>(null);
    const slLineRef = useRef<any>(null);

    // Meta data
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [avgVolume, setAvgVolume] = useState<number | null>(null);

    // Trigger onPriceUpdate callback when lastPrice changes
    useEffect(() => {
        if (lastPrice !== null && onPriceUpdate) {
            onPriceUpdate(lastPrice);
        }
    }, [lastPrice, onPriceUpdate]);

    // 1. Initialize Chart Only Once
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ 
                    width: chartContainerRef.current.clientWidth,
                });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: '#09090b' }, // zinc-950
                textColor: '#a1a1aa', // zinc-400
            },
            grid: {
                vertLines: { color: '#27272a', style: 1 }, 
                horzLines: { color: '#27272a', style: 1 },
            },
            width: chartContainerRef.current.clientWidth,
            height: 500,
            timeScale: {
                borderColor: '#3f3f46',
                timeVisible: true,
                fixLeftEdge: true,
                fixRightEdge: true,
            },
            rightPriceScale: {
                borderColor: '#3f3f46',
                autoScale: true,
            },
            crosshair: {
                mode: 0,
            }
        });
        chartRef.current = chart;

        candlestickSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: '#10b981', 
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });

        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            color: '#3f3f46',
            priceFormat: { type: 'volume' },
            priceScaleId: '', 
        });
        volumeSeriesRef.current.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        smaSeriesRef.current = chart.addSeries(LineSeries, { 
            color: '#3b82f6', 
            lineWidth: 2, 
            title: 'SMA 20',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            priceLineVisible: false,
            visible: showSma,
        });

        vwapSeriesRef.current = chart.addSeries(LineSeries, {
            color: '#f59e0b', // amber-500
            lineWidth: 2,
            title: 'VWAP',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            priceLineVisible: false,
            visible: showVwap,
        });

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, []);

    // 2. Watch for Toggles (SMA & VWAP)
    useEffect(() => {
        if (smaSeriesRef.current) smaSeriesRef.current.applyOptions({ visible: showSma });
        if (vwapSeriesRef.current) vwapSeriesRef.current.applyOptions({ visible: showVwap });
    }, [showSma, showVwap]);

    // 3. Draw Entry Price Line for Active Position
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;

        // Reset existing lines
        if (entryLineRef.current) { candlestickSeriesRef.current.removePriceLine(entryLineRef.current); entryLineRef.current = null; }
        if (tpLineRef.current) { candlestickSeriesRef.current.removePriceLine(tpLineRef.current); tpLineRef.current = null; }
        if (slLineRef.current) { candlestickSeriesRef.current.removePriceLine(slLineRef.current); slLineRef.current = null; }

        if (activePosition) {
            entryLineRef.current = candlestickSeriesRef.current.createPriceLine({
                price: activePosition.entryPrice,
                color: activePosition.mode === 'long' ? '#10b981' : '#ef4444',
                lineWidth: 2,
                lineStyle: 2, // Dashed
                axisLabelVisible: true,
                title: `ENTRY ${activePosition.mode.toUpperCase()}`,
            });

            if (activePosition.tpPrice) {
                tpLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: activePosition.tpPrice,
                    color: '#10b981', // emerald
                    lineWidth: 2,
                    lineStyle: 1, 
                    axisLabelVisible: true,
                    title: 'TP',
                });
            }

            if (activePosition.slPrice) {
                slLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: activePosition.slPrice,
                    color: '#ef4444', // red
                    lineWidth: 2,
                    lineStyle: 1, 
                    axisLabelVisible: true,
                    title: 'SL',
                });
            }
        }
    }, [activePosition]);

    // 4. Fetch Data when Ticker or Interval changes (with Polling for Real-time)
    useEffect(() => {
        let isMounted = true;
        let pollingTimer: NodeJS.Timeout;

        const fetchData = async (isPolling = false) => {
            if (!ticker) return;
            
            if (!isPolling) {
                setLoading(true);
                setError(null);
            }
            
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
                const json = await res.json();
                
                if (json.error) throw new Error(json.error);
                if (!json.chart?.result?.[0]) throw new Error("Format data dari Yahoo Finance tidak valid atau ticker tidak ditemukan.");

                const result = json.chart.result[0];
                const timestamps = result.timestamp;
                const indicators = result.indicators.quote[0];
                
                if (!timestamps || !indicators) throw new Error("Data historis tidak tersedia untuk interval ini.");

                let formattedData: ChartData[] = [];
                let totalVolume = 0;

                for (let i = 0; i < timestamps.length; i++) {
                    const open = indicators.open[i];
                    const high = indicators.high[i];
                    const low = indicators.low[i];
                    const close = indicators.close[i];
                    const volume = indicators.volume[i];

                    if (open !== null && high !== null && low !== null && close !== null) {
                        let timeVal: Time;
                        if (isIntraday) {
                            timeVal = timestamps[i] as Time;
                        } else {
                            const date = new Date(timestamps[i] * 1000);
                            timeVal = date.toISOString().split('T')[0] as Time;
                        }
                        
                        formattedData.push({
                            time: timeVal,
                            open, high, low, close, volume: volume || 0
                        });
                        totalVolume += (volume || 0);
                    }
                }

                // Downsampling untuk 4h
                if (interval === '4h' && formattedData.length > 0) {
                    const aggregatedData: ChartData[] = [];
                    let currentCandle: ChartData | null = null;
                    let count = 0;

                    for (const dataPoint of formattedData) {
                        if (!currentCandle) {
                            currentCandle = { ...dataPoint };
                            count = 1;
                        } else {
                            currentCandle.high = Math.max(currentCandle.high, dataPoint.high);
                            currentCandle.low = Math.min(currentCandle.low, dataPoint.low);
                            currentCandle.close = dataPoint.close;
                            currentCandle.volume += dataPoint.volume;
                            count++;
                        }

                        if (count === 4) {
                            aggregatedData.push({ ...currentCandle });
                            currentCandle = null;
                            count = 0;
                        }
                    }
                    if (currentCandle) {
                        aggregatedData.push(currentCandle);
                    }
                    formattedData = aggregatedData;
                }

                if (formattedData.length === 0) throw new Error("Tidak ada titik data yang valid.");

                if (isMounted) {
                    // Buang duplikasi & urutkan
                    const uniqueData = formattedData.filter((v, i, a) => a.findIndex(t => t.time === v.time) === i);
                    uniqueData.sort((a, b) => {
                        const timeA = typeof a.time === 'string' ? new Date(a.time).getTime() : a.time;
                        const timeB = typeof b.time === 'string' ? new Date(b.time).getTime() : b.time;
                        return timeA - timeB;
                    });

                    const candleData = uniqueData.map(d => ({
                        time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
                    }));
                    
                    const volData = uniqueData.map(d => ({
                        time: d.time,
                        value: d.volume,
                        color: d.close > d.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
                    }));

                    // SMA Calculation
                    const smaPeriod = 20;
                    const smaData = [];
                    for (let i = 0; i < uniqueData.length; i++) {
                        if (i >= smaPeriod - 1) {
                            let sum = 0;
                            for (let j = 0; j < smaPeriod; j++) {
                                sum += uniqueData[i - j].close;
                            }
                            smaData.push({ time: uniqueData[i].time, value: sum / smaPeriod });
                        }
                    }

                    // VWAP Calculation
                    const vwapData = [];
                    if (isIntraday) {
                        let cumulativePV = 0;
                        let cumulativeVol = 0;
                        let currentDay = -1;

                        for (const d of uniqueData) {
                            const dateObj = new Date((d.time as number) * 1000);
                            const day = dateObj.getUTCDate();
                            
                            if (day !== currentDay) {
                                cumulativePV = 0;
                                cumulativeVol = 0;
                                currentDay = day;
                            }
                            
                            const typicalPrice = (d.high + d.low + d.close) / 3;
                            cumulativePV += typicalPrice * d.volume;
                            cumulativeVol += d.volume;
                            
                            if (cumulativeVol > 0) {
                                vwapData.push({ time: d.time, value: cumulativePV / cumulativeVol });
                            }
                        }
                    } else {
                        const vwapPeriod = 20;
                        for (let i = 0; i < uniqueData.length; i++) {
                            if (i >= vwapPeriod - 1) {
                                let sumPV = 0;
                                let sumV = 0;
                                for (let j = 0; j < vwapPeriod; j++) {
                                    const pastD = uniqueData[i - j];
                                    const pastTP = (pastD.high + pastD.low + pastD.close) / 3;
                                    sumPV += pastTP * pastD.volume;
                                    sumV += pastD.volume;
                                }
                                if (sumV > 0) {
                                    vwapData.push({ time: uniqueData[i].time, value: sumPV / sumV });
                                }
                            }
                        }
                    }

                    // Save scroll position before replacing data
                    const visibleRange = chartRef.current?.timeScale().getVisibleLogicalRange();

                    candlestickSeriesRef.current?.setData(candleData);
                    volumeSeriesRef.current?.setData(volData);
                    smaSeriesRef.current?.setData(smaData);
                    vwapSeriesRef.current?.setData(vwapData);
                    
                    if (!isPolling && chartRef.current) {
                        const totalCandles = candleData.length;
                        if (totalCandles > 0) {
                            chartRef.current.timeScale().setVisibleLogicalRange({
                                from: Math.max(0, totalCandles - 80),
                                to: totalCandles,
                            });
                        }
                    } else if (isPolling && chartRef.current && visibleRange) {
                        // Restore scroll position so user can pan without snapping back
                        chartRef.current.timeScale().setVisibleLogicalRange(visibleRange);
                    }
                    
                    setLastPrice(candleData[candleData.length - 1].close);
                    setAvgVolume(Math.floor(totalVolume / formattedData.length)); 
                }
            } catch (err: any) {
                if (isMounted) setError(err.message || "Gagal mengambil data dari Yahoo Finance");
                candlestickSeriesRef.current?.setData([]);
                volumeSeriesRef.current?.setData([]);
                smaSeriesRef.current?.setData([]);
                vwapSeriesRef.current?.setData([]);
                setLastPrice(null);
                setAvgVolume(null);
            } finally {
                if (isMounted && !isPolling) setLoading(false);
            }
        };

        fetchData(false);

        pollingTimer = setInterval(() => {
            fetchData(true);
        }, 15000);

        return () => {
            isMounted = false;
            clearInterval(pollingTimer);
        };
    }, [ticker, interval]);

    return (
        <div className="w-full h-full relative bg-zinc-950">
            {loading && (
                <div className="absolute inset-0 z-10 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex items-center gap-2 text-indigo-400 font-mono text-sm">
                        <div className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                        Loading {ticker} ({interval})...
                    </div>
                </div>
            )}
            
            {error && !loading && (
                <div className="absolute inset-0 z-10 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                    <p className="text-red-400 font-mono text-sm uppercase">Failed to load data</p>
                    <p className="text-zinc-500 font-mono text-xs mt-1">{error}</p>
                </div>
            )}

            <div ref={chartContainerRef} className="w-full" style={{ opacity: loading ? 0.3 : 1, transition: 'opacity 0.3s' }} />
        </div>
    );
}

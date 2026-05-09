"use client";

import React, { useEffect, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi } from "lightweight-charts";

interface OHLCV {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  value: number; // Volume
}

export default function MarketChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const [ticker, setTicker] = useState("SPY");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Initialize chart
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#A1A1AA', // zinc-400
      },
      grid: {
        vertLines: { color: 'rgba(39, 39, 42, 0.4)' }, // zinc-800
        horzLines: { color: 'rgba(39, 39, 42, 0.4)' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(63, 63, 70, 0.5)', // zinc-700
      },
      rightPriceScale: {
        borderColor: 'rgba(63, 63, 70, 0.5)',
      },
      crosshair: {
        mode: 1, // Normal mode
        vertLine: {
          color: '#71717A',
          width: 1,
          style: 1,
        },
        horzLine: {
          color: '#71717A',
          width: 1,
          style: 1,
        },
      },
      autoSize: true,
    });

    // Create Candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#34D399', // emerald-400
      downColor: '#F87171', // red-400
      borderVisible: false,
      wickUpColor: '#34D399',
      wickDownColor: '#F87171',
    });

    // Create Volume series
    const volumeSeries = chart.addCustomSeries({
      color: '#3F3F46', // zinc-700
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // set as an overlay by setting a blank priceScaleId
    });

    // Scale overlay volume
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8, // highest point of the series will be at 80% from top
        bottom: 0,
      },
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
    };
  }, []);

  // Fetch Data
  const fetchData = async (targetTicker: string) => {
    if (!seriesRef.current || !volumeSeriesRef.current) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:8007/api/market/ohlcv?ticker=${targetTicker}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch data for ${targetTicker}`);
      }
      const data: OHLCV[] = await res.json();
      
      // Update candlestick
      seriesRef.current.setData(
        data.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }))
      );

      // Update volume
      volumeSeriesRef.current.setData(
        data.map(d => ({
          time: d.time,
          value: d.value,
          color: d.close > d.open ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)'
        }))
      );

      chartRef.current?.timeScale().fitContent();

    } catch (err: any) {
      setError(err.message || "Failed to load data");
      seriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchData(ticker);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData(ticker.toUpperCase());
  };

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-5 flex flex-col gap-4 w-full h-[500px]">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-mono font-bold text-zinc-200">Interactive Market Chart</h2>
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <input
            type="text"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Ticker (e.g. SPY)"
            className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-violet-500/60 transition-colors w-28"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-1.5 rounded-md border border-zinc-700 text-sm font-mono text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800/50 disabled:opacity-40 transition-colors cursor-pointer"
          >
            {loading ? "..." : "Load"}
          </button>
        </form>
      </div>
      
      {error && (
        <div className="text-xs font-mono text-red-400 bg-red-950/20 px-3 py-2 rounded-md border border-red-900/50">
          {error}
        </div>
      )}

      {/* Chart Container */}
      <div className="flex-1 w-full relative">
        <div ref={chartContainerRef} className="absolute inset-0" />
      </div>
    </div>
  );
}

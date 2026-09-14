'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    createChart,
    createSeriesMarkers,
    ColorType,
    IChartApi,
    Time,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    BaselineSeries,
    LineStyle,
    ISeriesApi,
    CrosshairMode,
} from 'lightweight-charts';
import { TerminalTheme, getTheme } from './TerminalThemes';
import type { IndicatorConfig, MovingAverageConfig, RSIConfig, CVDConfig, MASource } from '../../../types/indicators';

// ─── Protobuf Decoder ──────────────────────────────────────────────────────────
function decodeYFMessage(base64str: string) {
    const binaryString = atob(base64str);
    const buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        buffer[i] = binaryString.charCodeAt(i);
    }
    let i = 0;
    const result: any = {};
    while (i < buffer.length) {
        const tag = buffer[i++];
        const field = tag >> 3;
        const type = tag & 7;
        if (type === 0) {
            let val = 0; let shift = 0;
            while (true) { if (i >= buffer.length) break; const b = buffer[i++]; val |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
            if (field === 3) result.time = val;
            if (field === 9) result.dayVolume = val;
        } else if (type === 1) { i += 8; }
        else if (type === 2) {
            let len = 0; let shift = 0;
            while (true) { if (i >= buffer.length) break; const b = buffer[i++]; len |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
            if (field === 1) { const strBytes = buffer.slice(i, i + len); result.id = new TextDecoder().decode(strBytes); }
            i += len;
        } else if (type === 5) {
            if (field === 2) { const view = new DataView(buffer.buffer, buffer.byteOffset + i, 4); result.price = view.getFloat32(0, true); }
            else if (field === 8) { const view = new DataView(buffer.buffer, buffer.byteOffset + i, 4); result.changePercent = view.getFloat32(0, true); }
            i += 4;
        } else { break; }
    }
    return result;
}

// ─── HA Calculation Engine ────────────────────────────────────────────────────
export function toHeikinAshi(data: ChartData[]): ChartData[] {
    const result: ChartData[] = [];
    if (data.length === 0) return result;
    
    let prevOpen = data[0].open;
    let prevClose = data[0].close;
    
    for (let i = 0; i < data.length; i++) {
        const bar = data[i];
        
        const haClose = (bar.open + bar.high + bar.low + bar.close) / 4;
        const haOpen = i === 0 ? (bar.open + bar.close) / 2 : (prevOpen + prevClose) / 2;
        const haHigh = Math.max(bar.high, haOpen, haClose);
        const haLow = Math.min(bar.low, haOpen, haClose);
        
        result.push({
            ...bar,
            open: haOpen,
            high: haHigh,
            low: haLow,
            close: haClose
        });
        
        prevOpen = haOpen;
        prevClose = haClose;
    }
    return result;
}

// ─── Renko Calculation Engine ───────────────────────────────────────────────────
export function toRenkoLWC(data: ChartData[], brickSize: number): ChartData[] {
    if (data.length === 0 || brickSize <= 0) return [];
    
    const result: ChartData[] = [];
    let lastClose = Math.round(data[0].close / brickSize) * brickSize;
    let lastTime = (typeof data[0].time === 'string' ? new Date(data[0].time as string).getTime() / 1000 : data[0].time as number) - 1;
    
    for (let i = 1; i < data.length; i++) {
        const price = data[i].close;
        const baseTime = typeof data[i].time === 'string' ? new Date(data[i].time as string).getTime() / 1000 : data[i].time as number;
        let currentTime = Math.max(baseTime, lastTime + 1);
        
        let formed = false;
        
        // Bullish bricks
        while (price >= lastClose + brickSize) {
            const newClose = lastClose + brickSize;
            result.push({
                time: currentTime as Time,
                open: lastClose,
                high: newClose,
                low: lastClose,
                close: newClose,
                volume: data[i].volume,
            });
            lastClose = newClose;
            currentTime++;
            formed = true;
        }
        
        // Bearish bricks
        while (price <= lastClose - brickSize) {
            const newClose = lastClose - brickSize;
            result.push({
                time: currentTime as Time,
                open: lastClose,
                high: lastClose,
                low: newClose,
                close: newClose,
                volume: data[i].volume,
            });
            lastClose = newClose;
            currentTime++;
            formed = true;
        }
        
        // Partial brick
        if (i === data.length - 1) {
            result.push({
                time: Math.max(baseTime, lastTime + 1) as Time,
                open: lastClose,
                high: Math.max(lastClose, price),
                low: Math.min(lastClose, price),
                close: price,
                volume: data[i].volume,
            });
        }
        
        if (formed) {
            lastTime = currentTime - 1;
        }
    }
    
    if (result.length === 0 && data.length > 1) {
        const lastBar = data[data.length - 1];
        const baseTime = typeof lastBar.time === 'string' ? new Date(lastBar.time as string).getTime() / 1000 : lastBar.time as number;
        result.push({
            time: baseTime as Time,
            open: lastClose,
            high: Math.max(lastClose, lastBar.close),
            low: Math.min(lastClose, lastBar.close),
            close: lastBar.close,
            volume: lastBar.volume,
        });
    }
    
    return result;
}

// ─── Types ──────────────────────────────────────────────────────────────────────
interface TerminalChartProps {
    ticker: string;
    interval: string;
    themeId: string;
    showSma?: boolean;
    showVwap?: boolean;
    isHeikinAshi?: boolean;
    chartType?: string;
    renkoBrickSize?: number;
    indicators?: IndicatorConfig[];
    activePosition?: { entryPrice: number; tpPrice?: number; slPrice?: number; mode: 'long' | 'short' } | null;
    onPriceUpdate?: (price: number) => void;
    onChartReady?: (api: IChartApi, series: ISeriesApi<'Candlestick'>) => void;
    onCrosshairMove?: (data: {
        time: any;
        price: number | null;
        ohlc: { open: number; high: number; low: number; close: number; volume: number } | null;
    }) => void;
    onDataLoaded?: (data: ChartData[]) => void;
}

// ─── MA Calculation Engine ────────────────────────────────────────────────────
function getSourceValue(d: ChartData, source: MASource): number {
    switch (source) {
        case 'open':  return d.open;
        case 'high':  return d.high;
        case 'low':   return d.low;
        case 'hl2':   return (d.high + d.low) / 2;
        case 'hlc3':  return (d.high + d.low + d.close) / 3;
        case 'ohlc4': return (d.open + d.high + d.low + d.close) / 4;
        case 'close':
        default:      return d.close;
    }
}

function calcSMA(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += getSourceValue(data[i - j], source);
        result.push({ time: data[i].time, value: sum / period });
    }
    return result;
}

function calcEMA(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    if (data.length < period) return result;
    const k = 2 / (period + 1);
    // Seed with SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += getSourceValue(data[i], source);
    let ema = sum / period;
    result.push({ time: data[period - 1].time, value: ema });
    for (let i = period; i < data.length; i++) {
        ema = getSourceValue(data[i], source) * k + ema * (1 - k);
        result.push({ time: data[i].time, value: ema });
    }
    return result;
}

function calcWMA(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    const denom = (period * (period + 1)) / 2;
    for (let i = period - 1; i < data.length; i++) {
        let wsum = 0;
        for (let j = 0; j < period; j++) {
            wsum += getSourceValue(data[i - j], source) * (period - j);
        }
        result.push({ time: data[i].time, value: wsum / denom });
    }
    return result;
}

function calcDEMA(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const ema1 = calcEMA(data, period, source);
    // Build synthetic data from ema1 to compute EMA of EMA
    const ema1Data: ChartData[] = ema1.map(d => ({
        time: d.time, open: d.value, high: d.value, low: d.value, close: d.value, volume: 0,
    }));
    const ema2 = calcEMA(ema1Data, period, 'close');
    // DEMA = 2*EMA1 - EMA2
    const result: { time: Time; value: number }[] = [];
    const offset2 = ema1.length - ema2.length;
    for (let i = 0; i < ema2.length; i++) {
        result.push({ time: ema2[i].time, value: 2 * ema1[i + offset2].value - ema2[i].value });
    }
    return result;
}

function calcTEMA(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const ema1 = calcEMA(data, period, source);
    const ema1Data: ChartData[] = ema1.map(d => ({
        time: d.time, open: d.value, high: d.value, low: d.value, close: d.value, volume: 0,
    }));
    const ema2 = calcEMA(ema1Data, period, 'close');
    const ema2Data: ChartData[] = ema2.map(d => ({
        time: d.time, open: d.value, high: d.value, low: d.value, close: d.value, volume: 0,
    }));
    const ema3 = calcEMA(ema2Data, period, 'close');
    // TEMA = 3*EMA1 - 3*EMA2 + EMA3
    const result: { time: Time; value: number }[] = [];
    const off2 = ema1.length - ema2.length;
    const off3 = ema1.length - ema3.length;
    for (let i = 0; i < ema3.length; i++) {
        const v = 3 * ema1[i + off3].value - 3 * ema2[i + off3 - off2].value + ema3[i].value;
        result.push({ time: ema3[i].time, value: v });
    }
    return result;
}

function calcKAMA(data: ChartData[], period: number, source: MASource, fastEma: number, slowEma: number): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    if (data.length <= period) return result;

    const fastC = 2 / (fastEma + 1);
    const slowC = 2 / (slowEma + 1);

    // Initial KAMA is SMA over period
    let sum = 0;
    for (let i = 0; i < period; i++) sum += getSourceValue(data[i], source);
    let kama = sum / period;
    
    result.push({ time: data[period - 1].time, value: kama });

    for (let i = period; i < data.length; i++) {
        const currentPrice = getSourceValue(data[i], source);
        const priorPeriodPrice = getSourceValue(data[i - period], source);
        const change = Math.abs(currentPrice - priorPeriodPrice);
        
        let volatility = 0;
        for (let j = 0; j < period; j++) {
            const p1 = getSourceValue(data[i - j], source);
            const p2 = getSourceValue(data[i - j - 1], source);
            volatility += Math.abs(p1 - p2);
        }
        
        const er = volatility === 0 ? 0 : change / volatility;
        const sc = Math.pow(er * (fastC - slowC) + slowC, 2);
        
        kama = kama + sc * (currentPrice - kama);
        result.push({ time: data[i].time, value: kama });
    }
    
    return result;
}


function calcMA(data: ChartData[], cfg: MovingAverageConfig): { time: Time; value: number }[] {
    let raw: { time: Time; value: number }[];
    switch (cfg.maType) {
        case 'EMA':  raw = calcEMA(data, cfg.period, cfg.source); break;
        case 'WMA':  raw = calcWMA(data, cfg.period, cfg.source); break;
        case 'DEMA': raw = calcDEMA(data, cfg.period, cfg.source); break;
        case 'TEMA': raw = calcTEMA(data, cfg.period, cfg.source); break;
        case 'KAMA': raw = calcKAMA(data, cfg.period, cfg.source, cfg.kamaFast ?? 2, cfg.kamaSlow ?? 30); break;
        case 'SMA':
        default:     raw = calcSMA(data, cfg.period, cfg.source); break;
    }
    // Apply offset shift
    if (cfg.offset === 0) return raw;
    return raw.map((d, i) => {
        const targetIdx = i + cfg.offset;
        if (targetIdx < 0 || targetIdx >= data.length) return null;
        return { time: data[targetIdx >= 0 ? Math.min(targetIdx, data.length - 1) : 0].time, value: d.value };
    }).filter(Boolean) as { time: Time; value: number }[];
}

function calcRSI(data: ChartData[], period: number, source: MASource): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    if (data.length <= period) return result;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const change = getSourceValue(data[i], source) - getSourceValue(data[i - 1], source);
        if (change > 0) avgGain += change;
        if (change < 0) avgLoss += Math.abs(change);
    }

    avgGain /= period;
    avgLoss /= period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));
    
    result.push({ time: data[period].time, value: rsi });

    for (let i = period + 1; i < data.length; i++) {
        const change = getSourceValue(data[i], source) - getSourceValue(data[i - 1], source);
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));

        result.push({ time: data[i].time, value: rsi });
    }

    return result;
}


// ─── CVD Engine ─────────────────────────────────────────────────────────────
function calcCVD(data: ChartData[], method: 'ohlc' | 'bidask'): { time: Time; value: number }[] {
    const result: { time: Time; value: number }[] = [];
    let cumulative = 0;
    for (const d of data) {
        // OHLC proxy: +volume if bullish candle, -volume if bearish
        const delta = d.close > d.open ? d.volume : d.close < d.open ? -d.volume : 0;
        cumulative += delta;
        result.push({ time: d.time, value: cumulative });
    }
    return result;
}

interface DivergencePoint { time: Time; type: 'bullish' | 'bearish'; }

function detectCVDDivergences(
    priceData: ChartData[],
    cvdData: { time: Time; value: number }[],
    lookback: number
): DivergencePoint[] {
    const divergences: DivergencePoint[] = [];
    if (priceData.length !== cvdData.length || priceData.length < lookback * 2 + 1) return divergences;

    const isPivotLow = (arr: number[], i: number, lb: number) => {
        if (i - lb < 0 || i + lb >= arr.length) return false;
        for (let j = i - lb; j <= i + lb; j++) { if (j !== i && arr[j] <= arr[i]) return false; }
        return true;
    };
    const isPivotHigh = (arr: number[], i: number, lb: number) => {
        if (i - lb < 0 || i + lb >= arr.length) return false;
        for (let j = i - lb; j <= i + lb; j++) { if (j !== i && arr[j] >= arr[i]) return false; }
        return true;
    };

    const prices = priceData.map(d => d.low);
    const highs  = priceData.map(d => d.high);
    const cvds   = cvdData.map(d => d.value);

    // Bullish divergence: price makes lower low, CVD makes higher low
    const lowPivots: number[] = [];
    for (let i = lookback; i < priceData.length - lookback; i++) {
        if (isPivotLow(prices, i, lookback)) lowPivots.push(i);
    }
    for (let k = 1; k < lowPivots.length; k++) {
        const prev = lowPivots[k - 1];
        const curr = lowPivots[k];
        if (prices[curr] < prices[prev] && cvds[curr] > cvds[prev]) {
            divergences.push({ time: priceData[curr].time, type: 'bullish' });
        }
    }

    // Bearish divergence: price makes higher high, CVD makes lower high
    const highPivots: number[] = [];
    for (let i = lookback; i < priceData.length - lookback; i++) {
        if (isPivotHigh(highs, i, lookback)) highPivots.push(i);
    }
    for (let k = 1; k < highPivots.length; k++) {
        const prev = highPivots[k - 1];
        const curr = highPivots[k];
        if (highs[curr] > highs[prev] && cvds[curr] < cvds[prev]) {
            divergences.push({ time: priceData[curr].time, type: 'bearish' });
        }
    }

    return divergences;
}

function lwcLineStyle(style: string): LineStyle {
    switch (style) {
        case 'dashed': return LineStyle.Dashed;
        case 'dotted': return LineStyle.Dotted;
        default:       return LineStyle.Solid;
    }
}

function hexWithOpacity(hex: string, opacity: number): string {
    if (!hex || typeof hex !== 'string' || hex.length < 7) {
        return `rgba(128,128,128,${opacity})`;
    }
    // Convert hex + opacity to rgba string
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r || 0},${g || 0},${b || 0},${opacity})`;
}

export interface ChartData {
    time: Time;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface OHLCVOverlay {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    prevClose: number | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
function formatPrice(p: number): string {
    if (p >= 1000) return p.toFixed(2);
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(6);
}

function formatVolume(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
    return v.toFixed(2);
}

function getRangeForInterval(interval: string): string {
    if (interval === '1m') return '7d';
    if (interval === '5m' || interval === '15m') return '60d';
    if (interval === '1h' || interval === '4h') return '730d';
    return '1y';
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function TerminalChart({
    ticker,
    interval,
    themeId,
    showSma = true,
    showVwap = true,
    isHeikinAshi = false,
    chartType = 'candlestick',
    renkoBrickSize = 0.5,
    indicators = [],
    activePosition,
    onPriceUpdate,
    onChartReady,
    onCrosshairMove,
    onDataLoaded,
}: TerminalChartProps) {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);

    // Series refs
    const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

    // Dynamic indicator series registry: id → LWC series
    const indicatorSeriesRef = useRef<Map<string, any>>(new Map());

    // Position line refs
    const entryLineRef = useRef<any>(null);
    const tpLineRef = useRef<any>(null);
    const slLineRef = useRef<any>(null);

    // Oscillator real-time data
    const [oscillatorValues, setOscillatorValues] = useState<Record<string, number>>({});
    const [cvdDivergences, setCvdDivergences] = useState<DivergencePoint[]>([]);

    const allDataRef = useRef<ChartData[]>([]);
    const latestOscillatorsRef = useRef<Record<string, number>>({});
    const lastCandleRef = useRef<ChartData | null>(null);
    const lastVolumeRef = useRef<{ time: Time; value: number; color: string } | null>(null);
    const prevHaBarRef = useRef<{ open: number; close: number } | null>(null);
    const pendingPriceRef = useRef<number | null>(null);
    const rafIdRef = useRef<number>(0);
    // Holds the ISeriesMarkerPluginApi returned by createSeriesMarkers so we can remove/update it
    const divMarkerApiRef = useRef<{ setMarkers: (m: any[]) => void } | null>(null);

    // Keep a ref to indicators to avoid stale closures in async callbacks
    const indicatorsRef = useRef<IndicatorConfig[]>(indicators);
    useEffect(() => {
        indicatorsRef.current = indicators;
    }, [indicators]);

    const isMountedRef = useRef(true);
    const isHeikinAshiRef = useRef(isHeikinAshi);
    const chartTypeRef = useRef(chartType);
    const renkoBrickSizeRef = useRef(renkoBrickSize);
    const prevRenkoDataLengthRef = useRef(0);

    useEffect(() => {
        isHeikinAshiRef.current = isHeikinAshi;
        chartTypeRef.current = chartType;
        renkoBrickSizeRef.current = renkoBrickSize;
    }, [isHeikinAshi, chartType, renkoBrickSize]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // State
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [overlayData, setOverlayData] = useState<OHLCVOverlay | null>(null);
    const [isHovering, setIsHovering] = useState(false);

    // Memoized theme
    const theme = getTheme(themeId);

    // ─── 1. Chart Initialization ────────────────────────────────────────────────
    useEffect(() => {
        if (!chartContainerRef.current) return;
        const container = chartContainerRef.current;
        const t = getTheme(themeId);

        const chart = createChart(container, {
            layout: {
                background: { type: ColorType.Solid, color: t.background },
                textColor: t.textColor,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 11,
            },
            grid: {
                vertLines: { color: t.gridLines, style: 4 },
                horzLines: { color: t.gridLines, style: 4 },
            },
            width: container.clientWidth,
            height: container.clientHeight,
            timeScale: {
                borderColor: t.borderColor,
                timeVisible: true,
                fixLeftEdge: false,
                fixRightEdge: false,
                rightOffset: 15,
            },
            rightPriceScale: {
                borderColor: t.borderColor,
                autoScale: true,
            },
            crosshair: {
                mode: CrosshairMode.Normal,
                vertLine: { color: t.crosshairColor, labelBackgroundColor: t.crosshairColor },
                horzLine: { color: t.crosshairColor, labelBackgroundColor: t.crosshairColor },
            },
        });
        chartRef.current = chart;

        // Candlestick series
        candlestickSeriesRef.current = chart.addSeries(CandlestickSeries, {
            upColor: t.candleUp,
            downColor: t.candleDown,
            borderVisible: false,
            wickUpColor: t.wickUp,
            wickDownColor: t.wickDown,
        });

        // Volume histogram
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
            color: t.volumeDown,
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });
        volumeSeriesRef.current.priceScale().applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });

        // SMA line
        smaSeriesRef.current = chart.addSeries(LineSeries, {
            color: t.smaColor,
            lineWidth: 1,
            title: 'SMA 20',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            priceLineVisible: false,
            visible: showSma,
        });

        // VWAP line
        vwapSeriesRef.current = chart.addSeries(LineSeries, {
            color: t.vwapColor,
            lineWidth: 1,
            title: 'VWAP',
            crosshairMarkerVisible: false,
            lastValueVisible: true,
            priceLineVisible: false,
            visible: showVwap,
        });

        // ─── Crosshair subscription ────────────────────────────────────────────
        chart.subscribeCrosshairMove((param) => {
            if (!param || !param.time) {
                // Not hovering — show last candle data
                setIsHovering(false);
                setOscillatorValues({ ...latestOscillatorsRef.current });
                if (lastCandleRef.current) {
                    const lc = lastCandleRef.current;
                    const data = allDataRef.current;
                    const prevClose = data.length >= 2 ? data[data.length - 2].close : null;
                    setOverlayData({
                        open: lc.open,
                        high: lc.high,
                        low: lc.low,
                        close: lc.close,
                        volume: lc.volume,
                        prevClose,
                    });
                }
                if (onCrosshairMove) {
                    onCrosshairMove({ time: null, price: null, ohlc: null });
                }
                return;
            }

            setIsHovering(true);

            // Extract oscillator values
            const oscVals: Record<string, number> = {};
            indicatorSeriesRef.current.forEach((series, id) => {
                const cfg = indicatorsRef.current.find(i => i.id === id);
                if (cfg && (cfg.type === 'rsi' || cfg.type === 'cvd')) {
                    const data = param.seriesData.get(series) as any;
                    if (data && data.value !== undefined) {
                        oscVals[id] = data.value;
                    }
                }
            });
            setOscillatorValues(oscVals);

            // Extract OHLCV from the candlestick series
            let ohlcData: { open: number; high: number; low: number; close: number; volume: number } | null = null;
            let priceVal: number | null = null;

            if (candlestickSeriesRef.current) {
                const seriesData = param.seriesData.get(candlestickSeriesRef.current);
                if (seriesData && 'open' in seriesData) {
                    const cd = seriesData as any;
                    ohlcData = {
                        open: cd.open,
                        high: cd.high,
                        low: cd.low,
                        close: cd.close,
                        volume: 0,
                    };
                    priceVal = cd.close;
                }
            }

            // Get volume from the volume series
            if (volumeSeriesRef.current && ohlcData) {
                const volData = param.seriesData.get(volumeSeriesRef.current);
                if (volData && 'value' in volData) {
                    ohlcData.volume = (volData as any).value || 0;
                }
            }

            if (ohlcData) {
                // Find previous candle for change calculation
                const data = allDataRef.current;
                const idx = data.findIndex((d) => d.time === param.time);
                const prevClose = idx > 0 ? data[idx - 1].close : null;
                setOverlayData({
                    ...ohlcData,
                    prevClose,
                });
            }

            if (onCrosshairMove) {
                onCrosshairMove({ time: param.time, price: priceVal, ohlc: ohlcData });
            }
        });

        // ─── ResizeObserver ─────────────────────────────────────────────────────
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    chart.applyOptions({ width, height });
                }
            }
        });
        resizeObserver.observe(container);

        // Expose chart API to parent
        if (onChartReady && candlestickSeriesRef.current) {
            onChartReady(chart, candlestickSeriesRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            chart.remove();
            chartRef.current = null;
            candlestickSeriesRef.current = null;
            volumeSeriesRef.current = null;
            smaSeriesRef.current = null;
            vwapSeriesRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ─── 2. Theme Application ───────────────────────────────────────────────────
    useEffect(() => {
        if (!chartRef.current) return;
        const t = getTheme(themeId);

        chartRef.current.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: t.background },
                textColor: t.textColor,
            },
            grid: {
                vertLines: { color: t.gridLines },
                horzLines: { color: t.gridLines },
            },
            timeScale: { borderColor: t.borderColor },
            rightPriceScale: { borderColor: t.borderColor },
            crosshair: {
                vertLine: { color: t.crosshairColor, labelBackgroundColor: t.crosshairColor },
                horzLine: { color: t.crosshairColor, labelBackgroundColor: t.crosshairColor },
            },
        });

        if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.applyOptions({
                upColor: t.candleUp,
                downColor: t.candleDown,
                wickUpColor: t.wickUp,
                wickDownColor: t.wickDown,
            });
        }

        if (volumeSeriesRef.current) {
            // Re-colorize existing volume data
            const data = allDataRef.current;
            if (data.length > 0) {
                const volData = data.map((d) => ({
                    time: d.time,
                    value: d.volume,
                    color: d.close > d.open ? t.volumeUp : t.volumeDown,
                }));
                volumeSeriesRef.current.setData(volData);
            }
        }

        if (smaSeriesRef.current) {
            smaSeriesRef.current.applyOptions({ color: t.smaColor });
        }
        if (vwapSeriesRef.current) {
            vwapSeriesRef.current.applyOptions({ color: t.vwapColor });
        }
    }, [themeId]);

    // ─── 3. SMA / VWAP Toggle ───────────────────────────────────────────────────
    useEffect(() => {
        if (smaSeriesRef.current) smaSeriesRef.current.applyOptions({ visible: showSma });
        if (vwapSeriesRef.current) vwapSeriesRef.current.applyOptions({ visible: showVwap });
    }, [showSma, showVwap]);

    // ─── 3b. Dynamic Indicators Sync ────────────────────────────────────────────
    useEffect(() => {
        if (!chartRef.current) return;
        const chart = chartRef.current;
        const data = allDataRef.current;
        const registry = indicatorSeriesRef.current;

        // Remove series for indicators no longer in the list
        const currentIds = new Set(indicators.map(i => i.id));
        registry.forEach((series, id) => {
            if (!currentIds.has(id)) {
                try { chart.removeSeries(series); } catch { /* already removed */ }
                registry.delete(id);
            }
        });

        // Check active oscillators to adjust layout
        // RSI overlays on main pane → needs bottom margin. CVD uses its own sub-pane (paneIndex=1) → no margin needed
        const activeRSI = indicators.filter(ind => ind.type === 'rsi' && ind.enabled);
        const hasRSI = activeRSI.length > 0;

        if (hasRSI) {
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } });
            if (volumeSeriesRef.current) {
                volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.65, bottom: 0.25 } });
            }
        } else {
            chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0 } });
            if (volumeSeriesRef.current) {
                volumeSeriesRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
            }
        }

        // Add or update each indicator
        for (const ind of indicators) {
            if (ind.type === 'moving_average') {
                const cfg = ind as import('../../../types/indicators').MovingAverageConfig;
                const lineColor = hexWithOpacity(cfg.color, cfg.opacity);

                if (!registry.has(cfg.id)) {
                    // Create new series
                    const clampedWidth = Math.max(1, Math.min(4, cfg.lineWidth)) as 1 | 2 | 3 | 4;
                    const series = chart.addSeries(LineSeries, {
                        color: lineColor,
                        lineWidth: clampedWidth,
                        lineStyle: lwcLineStyle(cfg.lineStyle),
                        title: cfg.showLabel ? `${cfg.maType} ${cfg.period}` : '',
                        crosshairMarkerVisible: false,
                        lastValueVisible: cfg.showLabel && cfg.labelPosition === 'right',
                        priceLineVisible: false,
                        visible: cfg.enabled,
                    });
                    registry.set(cfg.id, series);
                    // Set data immediately if we have chart data
                    if (data.length > 0) {
                        const maData = calcMA(data, cfg);
                        series.setData(maData);
                    }
                } else {
                    // Update existing series options
                    const series = registry.get(cfg.id)!;
                    const clampedWidth = Math.max(1, Math.min(4, cfg.lineWidth)) as 1 | 2 | 3 | 4;
                    series.applyOptions({
                        color: lineColor,
                        lineWidth: clampedWidth,
                        lineStyle: lwcLineStyle(cfg.lineStyle),
                        title: cfg.showLabel ? `${cfg.maType} ${cfg.period}` : '',
                        lastValueVisible: cfg.showLabel && cfg.labelPosition === 'right',
                        visible: cfg.enabled,
                    });
                    // Recalculate data
                    if (data.length > 0) {
                        const maData = calcMA(data, cfg);
                        series.setData(maData);
                    }
                }
            } else if (ind.type === 'rsi') {
                const cfg = ind as import('../../../types/indicators').RSIConfig;
                const lineColor = cfg.color;

                // For RSI, we destroy and recreate the series if settings change, to easily update bands/lines
                if (registry.has(cfg.id)) {
                    try { chart.removeSeries(registry.get(cfg.id)!); } catch { /* ignore */ }
                    registry.delete(cfg.id);
                }

                const clampedWidth = Math.max(1, Math.min(4, cfg.lineWidth)) as 1 | 2 | 3 | 4;
                const series = chart.addSeries(BaselineSeries, {
                    baseValue: { type: 'price', price: 50 },
                    topLineColor: theme.priceUp,
                    topFillColor1: hexWithOpacity(theme.priceUp, 0.28),
                    topFillColor2: hexWithOpacity(theme.priceUp, 0.05),
                    bottomLineColor: theme.priceDown,
                    bottomFillColor1: hexWithOpacity(theme.priceDown, 0.05),
                    bottomFillColor2: hexWithOpacity(theme.priceDown, 0.28),
                    lineWidth: clampedWidth,
                    lineStyle: lwcLineStyle(cfg.lineStyle),
                    title: '',
                    crosshairMarkerVisible: false,
                    lastValueVisible: true,
                    priceLineVisible: false,
                    visible: cfg.enabled,
                    priceScaleId: 'rsi_scale_' + cfg.id, // dedicated price scale
                });

                series.priceScale().applyOptions({
                    scaleMargins: { top: 0.75, bottom: 0 },
                });

                // Add bands
                series.createPriceLine({ price: cfg.upperBand, color: cfg.bandColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });
                series.createPriceLine({ price: cfg.lowerBand, color: cfg.bandColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false });

                registry.set(cfg.id, series);

                if (data.length > 0) {
                    const rsiData = calcRSI(data, cfg.period, cfg.source);
                    series.setData(rsiData);
                    if (rsiData.length > 0) {
                        latestOscillatorsRef.current[cfg.id] = rsiData[rsiData.length - 1].value;
                        if (!isHovering) {
                            setOscillatorValues(prev => ({ ...prev, [cfg.id]: rsiData[rsiData.length - 1].value }));
                        }
                    }
                }
            } else if (ind.type === 'cvd') {
                const cfg = ind as import('../../../types/indicators').CVDConfig;

                // Always destroy and recreate so color/style changes apply cleanly
                if (registry.has(cfg.id)) {
                    try { chart.removeSeries(registry.get(cfg.id)!); } catch { /* ignore */ }
                    registry.delete(cfg.id);
                }

                const clampedWidth = Math.max(1, Math.min(4, cfg.lineWidth)) as 1 | 2 | 3 | 4;
                // LWC v5: use paneIndex=1 to create a true sub-pane below main chart
                const series = chart.addSeries(BaselineSeries, {
                    baseValue: { type: 'price', price: 0 },
                    topLineColor: cfg.bullColor || '#26a69a',
                    topFillColor1: hexWithOpacity(cfg.bullColor || '#26a69a', 0.3),
                    topFillColor2: hexWithOpacity(cfg.bullColor || '#26a69a', 0.05),
                    bottomLineColor: cfg.bearColor || '#ef5350',
                    bottomFillColor1: hexWithOpacity(cfg.bearColor || '#ef5350', 0.05),
                    bottomFillColor2: hexWithOpacity(cfg.bearColor || '#ef5350', 0.3),
                    lineWidth: clampedWidth,
                    title: '',
                    crosshairMarkerVisible: false,
                    lastValueVisible: false,
                    priceLineVisible: false,
                    visible: cfg.enabled,
                    priceScaleId: 'cvd',
                }, 1 as any);  // paneIndex=1: dedicated sub-pane

                series.priceScale().applyOptions({
                    scaleMargins: { top: 0.05, bottom: 0.05 },
                    autoScale: true,
                });

                // Resize panes: main=75%, cvd=25%
                try {
                    const panes = (chart as any).panes?.();
                    if (panes && panes.length >= 2) {
                        const totalH = chartRef.current?.options()?.height ?? 500;
                        panes[1].setHeight(Math.floor(totalH * 0.25));
                    }
                } catch { /* panes API not available */ }

                registry.set(cfg.id, series);

                if (data.length > 0) {
                    const cvdData = calcCVD(data, cfg.sourceMethod);
                    series.setData(cvdData);
                    if (cvdData.length > 0) {
                        latestOscillatorsRef.current[cfg.id] = cvdData[cvdData.length - 1].value;
                        if (!isHovering) {
                            setOscillatorValues(prev => ({ ...prev, [cfg.id]: cvdData[cvdData.length - 1].value }));
                        }
                    }
                    if (cfg.showDivergence && candlestickSeriesRef.current) {
                        const divs = detectCVDDivergences(data, cvdData, cfg.pivotLookback);
                        setCvdDivergences(divs);
                        const markers = divs.map(d => ({
                            time: d.time,
                            position: d.type === 'bullish' ? 'belowBar' : 'aboveBar',
                            color: d.type === 'bullish' ? cfg.bullDivColor : cfg.bearDivColor,
                            shape: d.type === 'bullish' ? 'arrowUp' : 'arrowDown',
                            text: d.type === 'bullish' ? 'Bull Div' : 'Bear Div',
                            size: 1,
                        } as const));
                        // LWC v5: use createSeriesMarkers instead of series.setMarkers
                        if (divMarkerApiRef.current) {
                            divMarkerApiRef.current.setMarkers(markers);
                        } else {
                            divMarkerApiRef.current = createSeriesMarkers(candlestickSeriesRef.current, markers) as any;
                        }
                    } else {
                        // Clear markers if divergence turned off
                        if (divMarkerApiRef.current) {
                            divMarkerApiRef.current.setMarkers([]);
                        }
                        setCvdDivergences([]);
                    }
                }
            }

        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [indicators]);

    // ─── 4. Position Lines ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!candlestickSeriesRef.current) return;
        const t = getTheme(themeId);

        // Remove old lines
        if (entryLineRef.current) { candlestickSeriesRef.current.removePriceLine(entryLineRef.current); entryLineRef.current = null; }
        if (tpLineRef.current) { candlestickSeriesRef.current.removePriceLine(tpLineRef.current); tpLineRef.current = null; }
        if (slLineRef.current) { candlestickSeriesRef.current.removePriceLine(slLineRef.current); slLineRef.current = null; }

        if (activePosition) {
            entryLineRef.current = candlestickSeriesRef.current.createPriceLine({
                price: activePosition.entryPrice,
                color: activePosition.mode === 'long' ? t.priceUp : t.priceDown,
                lineWidth: 2,
                lineStyle: 2,
                axisLabelVisible: true,
                title: `ENTRY ${activePosition.mode.toUpperCase()}`,
            });

            if (activePosition.tpPrice) {
                tpLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: activePosition.tpPrice,
                    color: t.priceUp,
                    lineWidth: 2,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: 'TP',
                });
            }

            if (activePosition.slPrice) {
                slLineRef.current = candlestickSeriesRef.current.createPriceLine({
                    price: activePosition.slPrice,
                    color: t.priceDown,
                    lineWidth: 2,
                    lineStyle: 1,
                    axisLabelVisible: true,
                    title: 'SL',
                });
            }
        }
    }, [activePosition, themeId]);

    // ─── 5. onPriceUpdate callback ──────────────────────────────────────────────
    useEffect(() => {
        if (lastPrice !== null && onPriceUpdate) {
            onPriceUpdate(lastPrice);
        }
    }, [lastPrice, onPriceUpdate]);

    // ─── 6. Data Fetch + WebSocket ──────────────────────────────────────────────
    useEffect(() => {
        let isMounted = true;
        let pollingTimer: NodeJS.Timeout;
        let ws: WebSocket | null = null;
        const t = getTheme(themeId);

        const fetchData = async (isPolling = false) => {
            if (!ticker) return;

            if (!isPolling) {
                setLoading(true);
                setError(null);
            }

            const isIntraday = ['1m', '5m', '15m', '1h', '4h'].includes(interval);
            let fetchInterval = interval;
            const fetchRange = getRangeForInterval(interval);

            if (interval === '4h') fetchInterval = '1h';

            try {
                const res = await fetch(
                    `/api/yahoo?ticker=${encodeURIComponent(ticker)}&interval=${fetchInterval}&range=${fetchRange}`
                );
                const json = await res.json();

                if (json.error) throw new Error(json.error);
                if (!json.chart?.result?.[0]) throw new Error('Invalid data format or ticker not found.');

                const result = json.chart.result[0];
                const timestamps = result.timestamp;
                const yfQuote = result.indicators.quote[0];

                if (!timestamps || !yfQuote) throw new Error('No historical data available for this interval.');

                let formattedData: ChartData[] = [];
                let totalVolume = 0;

                for (let idx = 0; idx < timestamps.length; idx++) {
                    const open = yfQuote.open[idx];
                    const high = yfQuote.high[idx];
                    const low = yfQuote.low[idx];
                    const close = yfQuote.close[idx];
                    const volume = yfQuote.volume[idx];

                    if (open !== null && high !== null && low !== null && close !== null) {
                        let timeVal: Time;
                        if (isIntraday) {
                            timeVal = timestamps[idx] as Time;
                        } else {
                            const date = new Date(timestamps[idx] * 1000);
                            timeVal = date.toISOString().split('T')[0] as Time;
                        }

                        formattedData.push({
                            time: timeVal,
                            open,
                            high,
                            low,
                            close,
                            volume: volume || 0,
                        });
                        totalVolume += volume || 0;
                    }
                }

                // 4h aggregation
                if (interval === '4h' && formattedData.length > 0) {
                    const aggregatedData: ChartData[] = [];
                    let currentCandle: ChartData | null = null;
                    let count = 0;

                    for (const dp of formattedData) {
                        if (!currentCandle) {
                            currentCandle = { ...dp };
                            count = 1;
                        } else {
                            currentCandle.high = Math.max(currentCandle.high, dp.high);
                            currentCandle.low = Math.min(currentCandle.low, dp.low);
                            currentCandle.close = dp.close;
                            currentCandle.volume += dp.volume;
                            count++;
                        }

                        if (count === 4) {
                            aggregatedData.push({ ...currentCandle });
                            currentCandle = null;
                            count = 0;
                        }
                    }
                    if (currentCandle) aggregatedData.push(currentCandle);
                    formattedData = aggregatedData;
                }

                if (formattedData.length === 0) throw new Error('No valid data points.');

                if (isMounted) {
                    // Deduplicate & sort
                    const uniqueData = formattedData.filter(
                        (v, i, a) => a.findIndex((x) => x.time === v.time) === i
                    );
                    uniqueData.sort((a, b) => {
                        const timeA = typeof a.time === 'string' ? new Date(a.time).getTime() : (a.time as number);
                        const timeB = typeof b.time === 'string' ? new Date(b.time).getTime() : (b.time as number);
                        return timeA - timeB;
                    });

                    allDataRef.current = uniqueData;

                    const currentTheme = getTheme(themeId);

                    let displayData = uniqueData;
                    if (chartTypeRef.current === 'renko') {
                        displayData = toRenkoLWC(uniqueData, renkoBrickSizeRef.current || 0.5);
                        prevRenkoDataLengthRef.current = displayData.length;
                    } else if (isHeikinAshiRef.current) {
                        displayData = toHeikinAshi(uniqueData);
                        if (displayData.length > 1) {
                            const prev = displayData[displayData.length - 2];
                            prevHaBarRef.current = { open: prev.open, close: prev.close };
                        }
                    }

                    const candleData = displayData.map((d) => ({
                        time: d.time,
                        open: d.open,
                        high: d.high,
                        low: d.low,
                        close: d.close,
                    }));

                    const volData = uniqueData.map((d) => ({
                        time: d.time,
                        value: d.volume,
                        color: d.close > d.open ? currentTheme.volumeUp : currentTheme.volumeDown,
                    }));

                    // SMA 20
                    const smaPeriod = 20;
                    const smaData: { time: Time; value: number }[] = [];
                    for (let i = 0; i < uniqueData.length; i++) {
                        if (i >= smaPeriod - 1) {
                            let sum = 0;
                            for (let j = 0; j < smaPeriod; j++) {
                                sum += uniqueData[i - j].close;
                            }
                            smaData.push({ time: uniqueData[i].time, value: sum / smaPeriod });
                        }
                    }

                    // VWAP
                    const vwapData: { time: Time; value: number }[] = [];
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

                    // Preserve scroll during polling
                    const visibleRange = chartRef.current?.timeScale().getVisibleLogicalRange();

                    candlestickSeriesRef.current?.setData(candleData);
                    volumeSeriesRef.current?.setData(volData);
                    smaSeriesRef.current?.setData(smaData);
                    vwapSeriesRef.current?.setData(vwapData);

                    // Sync all active indicator series with fresh data
                    indicatorSeriesRef.current.forEach((series: any, id: string) => {
                        const cfg = indicatorsRef.current.find((i: IndicatorConfig) => i.id === id);
                        if (!cfg) return;
                        if (cfg.type === 'moving_average') {
                            const maData = calcMA(uniqueData, cfg as import('../../../types/indicators').MovingAverageConfig);
                            series.setData(maData);
                        } else if (cfg.type === 'rsi') {
                            const rsiCfg = cfg as import('../../../types/indicators').RSIConfig;
                            const rsiData = calcRSI(uniqueData, rsiCfg.period, rsiCfg.source);
                            series.setData(rsiData);
                            if (rsiData.length > 0) {
                                latestOscillatorsRef.current[id] = rsiData[rsiData.length - 1].value;
                            }
                        } else if (cfg.type === 'cvd') {
                            const cvdCfg = cfg as import('../../../types/indicators').CVDConfig;
                            const cvdData = calcCVD(uniqueData, cvdCfg.sourceMethod);
                            series.setData(cvdData);
                            if (cvdData.length > 0) {
                                latestOscillatorsRef.current[id] = cvdData[cvdData.length - 1].value;
                            }
                            // Update divergence markers
                            if (cvdCfg.showDivergence && candlestickSeriesRef.current) {
                                const divs = detectCVDDivergences(uniqueData, cvdData, cvdCfg.pivotLookback);
                                setCvdDivergences(divs);
                                const markers = divs.map(d => ({
                                    time: d.time,
                                    position: d.type === 'bullish' ? 'belowBar' : 'aboveBar',
                                    color: d.type === 'bullish' ? cvdCfg.bullDivColor : cvdCfg.bearDivColor,
                                    shape: d.type === 'bullish' ? 'arrowUp' : 'arrowDown',
                                    text: d.type === 'bullish' ? 'Bull Div' : 'Bear Div',
                                    size: 1,
                                } as const));
                                // LWC v5: use createSeriesMarkers
                                if (divMarkerApiRef.current) {
                                    divMarkerApiRef.current.setMarkers(markers);
                                } else {
                                    divMarkerApiRef.current = createSeriesMarkers(candlestickSeriesRef.current, markers) as any;
                                }
                            }
                        }
                    });

                    // Update oscillator values if not hovering
                    if (!isHovering) {
                        setOscillatorValues({ ...latestOscillatorsRef.current });
                    }

                    // Track last candle & volume for WS updates
                    if (candleData.length > 0) {
                        lastCandleRef.current = {
                            ...candleData[candleData.length - 1],
                            volume: uniqueData[uniqueData.length - 1].volume,
                        };
                    }
                    if (volData.length > 0) {
                        lastVolumeRef.current = { ...volData[volData.length - 1] };
                    }
                    
                    if (onDataLoaded) {
                        onDataLoaded([...uniqueData]);
                    }

                    // Set visible range
                    if (!isPolling && chartRef.current) {
                        const totalCandles = candleData.length;
                        if (totalCandles > 0) {
                            chartRef.current.timeScale().setVisibleLogicalRange({
                                from: Math.max(0, totalCandles - 80),
                                to: totalCandles + 15,
                            });
                        }
                        // Reset price scale auto-scale if the user previously dragged it manually
                        chartRef.current.priceScale('right').applyOptions({
                            autoScale: true,
                        });
                    } else if (isPolling && chartRef.current && visibleRange) {
                        chartRef.current.timeScale().setVisibleLogicalRange(visibleRange);
                    }

                    const closePrice = candleData[candleData.length - 1].close;
                    setLastPrice(closePrice);

                    // Set overlay to last candle
                    const lastD = uniqueData[uniqueData.length - 1];
                    const prevClose = uniqueData.length >= 2 ? uniqueData[uniqueData.length - 2].close : null;
                    setOverlayData({
                        open: lastD.open,
                        high: lastD.high,
                        low: lastD.low,
                        close: lastD.close,
                        volume: lastD.volume,
                        prevClose,
                    });

                    // Init WS on first fetch
                    if (!ws && !isPolling) {
                        initWebSocket();
                    }
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Failed to fetch data');
                    candlestickSeriesRef.current?.setData([]);
                    volumeSeriesRef.current?.setData([]);
                    smaSeriesRef.current?.setData([]);
                    vwapSeriesRef.current?.setData([]);
                    setLastPrice(null);
                    setOverlayData(null);
                    allDataRef.current = [];
                }
            } finally {
                if (isMounted && !isPolling) setLoading(false);
            }
        };

        const initWebSocket = () => {
            if (ws) ws.close();
            ws = new WebSocket('wss://streamer.finance.yahoo.com/');

            ws.onopen = () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: [ticker] }));
                }
            };

            ws.onmessage = (event) => {
                try {
                    const data = decodeYFMessage(event.data);
                    if (data && data.id === ticker && data.price && isMounted) {
                        const price = data.price;

                        // rAF batching for smooth updates
                        pendingPriceRef.current = price;
                        if (!rafIdRef.current) {
                            rafIdRef.current = requestAnimationFrame(() => {
                                const p = pendingPriceRef.current;
                                if (p !== null && lastCandleRef.current && candlestickSeriesRef.current) {
                                    const current = lastCandleRef.current;
                                    current.close = p;
                                    current.high = Math.max(current.high, p);
                                    current.low = Math.min(current.low, p);

                                    // Update allDataRef last entry
                                    const allData = allDataRef.current;
                                    if (allData.length > 0) {
                                        allData[allData.length - 1].close = current.close;
                                        allData[allData.length - 1].high = current.high;
                                        allData[allData.length - 1].low = current.low;
                                    }

                                    let updateBar: any = { 
                                        time: current.time, 
                                        open: current.open, 
                                        high: current.high, 
                                        low: current.low, 
                                        close: current.close 
                                    };
                                    
                                    if (chartTypeRef.current === 'renko') {
                                        const renkoData = toRenkoLWC(allData, renkoBrickSizeRef.current || 0.5);
                                        const startIdx = Math.max(0, prevRenkoDataLengthRef.current - 1);
                                        for (let i = startIdx; i < renkoData.length; i++) {
                                            candlestickSeriesRef.current.update(renkoData[i]);
                                        }
                                        prevRenkoDataLengthRef.current = renkoData.length;
                                        
                                        // Also update volume series to match new bricks
                                        if (lastVolumeRef.current && volumeSeriesRef.current) {
                                            const currentTheme = getTheme(themeId);
                                            for (let i = startIdx; i < renkoData.length; i++) {
                                                volumeSeriesRef.current.update({
                                                    time: renkoData[i].time,
                                                    value: renkoData[i].volume,
                                                    color: renkoData[i].close > renkoData[i].open ? currentTheme.volumeUp : currentTheme.volumeDown
                                                });
                                            }
                                        }
                                    } else {
                                        if (isHeikinAshiRef.current && prevHaBarRef.current) {
                                            const haOpen = (prevHaBarRef.current.open + prevHaBarRef.current.close) / 2;
                                            const haClose = (current.open + current.high + current.low + current.close) / 4;
                                            const haHigh = Math.max(current.high, haOpen, haClose);
                                            const haLow = Math.min(current.low, haOpen, haClose);
                                            updateBar = { ...updateBar, open: haOpen, high: haHigh, low: haLow, close: haClose };
                                        }

                                        candlestickSeriesRef.current.update(updateBar);
                                        
                                        // Update volume color
                                        const currentTheme = getTheme(themeId);
                                        if (lastVolumeRef.current && volumeSeriesRef.current) {
                                            lastVolumeRef.current.color =
                                                current.close > current.open
                                                    ? currentTheme.volumeUp
                                                    : currentTheme.volumeDown;
                                            volumeSeriesRef.current.update(lastVolumeRef.current);
                                        }
                                    }

                                    setLastPrice(p);

                                    if (onDataLoaded) {
                                        onDataLoaded([...allData]);
                                    }

                                    // Update overlay if not hovering
                                    if (!isHovering) {
                                        const prevClose =
                                            allData.length >= 2 ? allData[allData.length - 2].close : null;
                                        setOverlayData({
                                            open: current.open,
                                            high: current.high,
                                            low: current.low,
                                            close: current.close,
                                            volume: current.volume,
                                            prevClose,
                                        });
                                    }
                                }
                                pendingPriceRef.current = null;
                                rafIdRef.current = 0;
                            });
                        }
                    }
                } catch (e) {
                    console.error('WS Parse Error', e);
                }
            };

            ws.onerror = (e) => console.error('Yahoo WS Error', e);

            ws.onclose = () => {
                if (isMounted) {
                    setTimeout(() => initWebSocket(), 5000);
                }
            };
        };

        fetchData(false);

        // REST polling backup (60s)
        pollingTimer = setInterval(() => {
            fetchData(true);
        }, 60000);

        return () => {
            isMounted = false;
            clearInterval(pollingTimer);
            if (ws) {
                ws.close();
                ws = null;
            }
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = 0;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticker, interval]);

    // Recompute display data when chart type / HA toggles change
    useEffect(() => {
        if (!isMountedRef.current || !candlestickSeriesRef.current || allDataRef.current.length === 0) return;
        
        const currentTheme = getTheme(themeId);
        const uniqueData = allDataRef.current;
        
        let displayData = uniqueData;
        if (chartType === 'renko') {
            displayData = toRenkoLWC(uniqueData, renkoBrickSize || 0.5);
            prevRenkoDataLengthRef.current = displayData.length;
        } else if (isHeikinAshi) {
            displayData = toHeikinAshi(uniqueData);
            if (displayData.length > 1) {
                const prev = displayData[displayData.length - 2];
                prevHaBarRef.current = { open: prev.open, close: prev.close };
            }
        }
        
        const candleData = displayData.map((d) => ({
            time: d.time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
        }));
        
        const volData = displayData.map((d) => ({
            time: d.time,
            value: d.volume,
            color: d.close > d.open ? currentTheme.volumeUp : currentTheme.volumeDown,
        }));
        
        candlestickSeriesRef.current.setData(candleData);
        volumeSeriesRef.current?.setData(volData);
        
    }, [chartType, renkoBrickSize, isHeikinAshi, themeId]);

    // ─── Render ─────────────────────────────────────────────────────────────────
    const change = overlayData && overlayData.prevClose !== null
        ? overlayData.close - overlayData.prevClose
        : overlayData
            ? overlayData.close - overlayData.open
            : 0;
    const changePercent = overlayData
        ? overlayData.prevClose !== null && overlayData.prevClose !== 0
            ? (change / overlayData.prevClose) * 100
            : overlayData.open !== 0
                ? (change / overlayData.open) * 100
                : 0
        : 0;
    const isPositive = change >= 0;

    return (
        <div className="w-full h-full relative">
            {/* ─── Loading Overlay ───────────────────────────────────────────── */}
            {loading && (
                <div
                    className="absolute inset-0 z-30 flex items-center justify-center"
                    style={{ backgroundColor: `${theme.background}cc` }}
                >
                    <div className="flex items-center gap-2 font-mono text-sm" style={{ color: theme.accent }}>
                        <div
                            className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                            style={{ borderColor: theme.accent, borderTopColor: 'transparent' }}
                        />
                        Loading {ticker} ({interval})...
                    </div>
                </div>
            )}

            {/* ─── Error Overlay ─────────────────────────────────────────────── */}
            {error && !loading && (
                <div
                    className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center"
                    style={{ backgroundColor: `${theme.background}dd` }}
                >
                    <p className="font-mono text-sm uppercase" style={{ color: theme.priceDown }}>
                        Failed to load data
                    </p>
                    <p className="font-mono text-xs mt-1" style={{ color: theme.panelTextDim }}>
                        {error}
                    </p>
                </div>
            )}

            {/* ─── OHLCV Header Overlay (Kiyotaka Style) ────────────────────── */}
            {overlayData && !loading && (
                <div
                    className="absolute top-0 left-0 z-20 pointer-events-none select-none"
                    style={{ padding: '10px 14px' }}
                >
                    {/* Row 1: Ticker badge + interval */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: theme.accent }}
                        />
                        <span
                            className="font-mono text-[11px] font-bold tracking-wider uppercase"
                            style={{ color: theme.panelText }}
                        >
                            YAHOO
                        </span>
                        <span
                            className="font-mono text-[10px] px-1.5 py-0 rounded"
                            style={{
                                color: theme.accent,
                                backgroundColor: theme.accentDim,
                            }}
                        >
                            {interval}
                        </span>
                    </div>

                    {/* Row 2: Ticker symbol */}
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span
                            className="font-mono text-sm font-bold tracking-wider"
                            style={{ color: theme.panelText }}
                        >
                            {ticker}
                        </span>
                        <span
                            className="font-mono text-[10px]"
                            style={{ color: theme.panelTextDim }}
                        >
                            USD
                        </span>
                    </div>

                    {/* Row 3: OHLC values + change */}
                    <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>
                            O:
                        </span>
                        <span
                            className="font-mono text-[11px]"
                            style={{ color: overlayData.close >= overlayData.open ? theme.priceUp : theme.priceDown }}
                        >
                            {formatPrice(overlayData.open)}
                        </span>

                        <span className="font-mono text-[10px] ml-1" style={{ color: theme.panelTextDim }}>
                            H:
                        </span>
                        <span
                            className="font-mono text-[11px]"
                            style={{ color: overlayData.close >= overlayData.open ? theme.priceUp : theme.priceDown }}
                        >
                            {formatPrice(overlayData.high)}
                        </span>

                        <span className="font-mono text-[10px] ml-1" style={{ color: theme.panelTextDim }}>
                            L:
                        </span>
                        <span
                            className="font-mono text-[11px]"
                            style={{ color: overlayData.close >= overlayData.open ? theme.priceUp : theme.priceDown }}
                        >
                            {formatPrice(overlayData.low)}
                        </span>

                        <span className="font-mono text-[10px] ml-1" style={{ color: theme.panelTextDim }}>
                            C:
                        </span>
                        <span
                            className="font-mono text-[11px] font-bold"
                            style={{ color: overlayData.close >= overlayData.open ? theme.priceUp : theme.priceDown }}
                        >
                            {formatPrice(overlayData.close)}
                        </span>

                        {/* Change */}
                        <span
                            className="font-mono text-[10px] ml-2"
                            style={{ color: isPositive ? theme.priceUp : theme.priceDown }}
                        >
                            {isPositive ? '+' : ''}{change.toFixed(2)}
                        </span>
                        <span
                            className="font-mono text-[10px]"
                            style={{ color: isPositive ? theme.priceUp : theme.priceDown }}
                        >
                            ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
                        </span>
                    </div>

                    {/* Row 4: Volume */}
                    <div className="flex items-center gap-1 mt-0.5">
                        <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>
                            Vol
                        </span>
                        <span className="font-mono text-[11px]" style={{ color: theme.panelText }}>
                            {formatVolume(overlayData.volume)}
                        </span>
                    </div>
                </div>
            )}

            {/* ─── Chart Container ──────────────────────────────────────────── */}
            <div
                ref={chartContainerRef}
                className="w-full h-full"
                style={{
                    opacity: loading ? 0.3 : 1,
                    transition: 'opacity 0.3s ease',
                }}
            />

            {/* ─── Pane Separators (RSI only — CVD has its own LWC pane) ─────── */}
            {indicators && indicators.some(i => i.type === 'rsi' && i.enabled) && (
                <div 
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{
                        top: '75%',
                        height: '1px',
                        backgroundColor: theme.gridLines,
                    }}
                />
            )}

            {/* ─── Oscillator Overlays (RSI) ────────────────────────────────── */}
            {indicators && indicators.filter(i => i.type === 'rsi' && i.enabled).map((ind, idx) => {
                const rsi = ind as import('../../../types/indicators').RSIConfig;
                const val = oscillatorValues[rsi.id];
                const topPercent = 75 + (idx * 5) + 2; // Stack them if multiple
                return (
                    <div
                        key={rsi.id}
                        className="absolute z-20 flex items-center gap-2 rounded shadow-sm"
                        style={{ 
                            top: `${topPercent}%`, 
                            left: '14px', 
                            padding: '4px 8px',
                            backgroundColor: `${theme.panelBg}cc`,
                            border: `1px solid ${theme.borderColor}`,
                            backdropFilter: 'blur(4px)',
                            pointerEvents: 'auto'
                        }}
                    >
                        <div className="flex items-center gap-2" style={{ color: theme.panelText, fontSize: 11, fontFamily: 'monospace' }}>
                            <span style={{ fontWeight: 600 }}>RSI ({rsi.period}, {rsi.source.toUpperCase()})</span>
                            {val !== undefined && (
                                <span 
                                    className="px-1.5 py-0.5 rounded-sm"
                                    style={{ 
                                        color: theme.background, 
                                        backgroundColor: val >= 50 ? theme.priceUp : theme.priceDown, 
                                        fontWeight: 'bold' 
                                    }}
                                >
                                    {val.toFixed(2)}
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}

            {/* ─── CVD Overlay (positioned at bottom-left of chart area) ──────── */}
            {indicators && indicators.filter(i => i.type === 'cvd' && i.enabled).map((ind) => {
                const cvd = ind as import('../../../types/indicators').CVDConfig;
                const val = oscillatorValues[cvd.id];
                const isPositive = val !== undefined && val >= 0;
                const formatCVD = (v: number) => {
                    const abs = Math.abs(v);
                    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
                    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
                    return v.toFixed(0);
                };
                return (
                    <div
                        key={cvd.id}
                        className="absolute z-20 flex items-center gap-2 rounded shadow-sm"
                        style={{
                            bottom: '2px',
                            left: '14px',
                            padding: '3px 7px',
                            backgroundColor: `${theme.panelBg}cc`,
                            border: `1px solid ${theme.borderColor}`,
                            backdropFilter: 'blur(4px)',
                            pointerEvents: 'auto',
                        }}
                    >
                        <div className="flex items-center gap-2" style={{ color: theme.panelText, fontSize: 11, fontFamily: 'monospace' }}>
                            <span style={{ fontWeight: 600 }}>CVD</span>
                            <span style={{ fontSize: 9, color: theme.panelTextDim }}>{cvd.showDivergence ? `DIV·${cvd.pivotLookback}` : 'RAW'}</span>
                            {val !== undefined && (
                                <span
                                    className="px-1.5 py-0.5 rounded-sm"
                                    style={{
                                        color: '#fff',
                                        backgroundColor: isPositive ? (cvd.bullColor || '#26a69a') : (cvd.bearColor || '#ef5350'),
                                        fontWeight: 'bold',
                                    }}
                                >
                                    {isPositive ? '+' : ''}{formatCVD(val)}
                                </span>
                            )}
                            {cvd.showDivergence && cvdDivergences.length > 0 && (
                                <span style={{ fontSize: 9, color: theme.panelTextDim }}>
                                    {cvdDivergences.filter(d => d.type === 'bullish').length}↑{' '}
                                    {cvdDivergences.filter(d => d.type === 'bearish').length}↓
                                </span>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ChartEngine } from './ChartEngine';
import { getTheme } from '../core/TerminalThemes';
import type { ChartType, OHLCVBar, OHLCVOverlay, ActivePosition } from './types';
import type { IndicatorConfig } from '../../../types/indicators';

// ─── Protobuf Decoder (Yahoo Finance WebSocket) ────────────────────────────────
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

function formatPrice(p: number, tickInterval?: number): string {
    let decimals = 2; // default to standard cents (USD)

    if (tickInterval !== undefined) {
        if (tickInterval < 1) {
            const str = tickInterval.toString();
            if (str.includes('e-')) decimals = parseInt(str.split('e-')[1], 10);
            else if (str.includes('.')) decimals = Math.max(2, str.split('.')[1].length);
        } else if (Math.abs(p) > 100000) {
            decimals = 0;
        }
    } else {
        const absP = Math.abs(p);
        if (absP === 0) decimals = 2;
        else if (absP < 0.001) decimals = 6;
        else if (absP < 0.1) decimals = 4;
        else if (absP < 1) decimals = 3;
    }

    const raw = p.toFixed(decimals);
    const parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

function formatVolume(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(2) + 'K';
    return v.toFixed(0);
}

function getRangeForInterval(interval: string): string {
    if (interval === '1m') return '7d';
    if (interval === '5m' || interval === '15m') return '60d';
    if (interval === '1h' || interval === '4h') return '730d';
    return '1y';
}

// ─── Props ──────────────────────────────────────────────────────────────────────
interface CanvasTerminalChartProps {
    ticker: string;
    interval: string;
    themeId: string;
    showSma?: boolean;
    showVwap?: boolean;
    indicators?: IndicatorConfig[];
    activePosition?: ActivePosition | null;
    onPriceUpdate?: (price: number) => void;
    // Chart type settings
    chartType?: ChartType;
    rangeSize?: number;
    renkoBrickSize?: number;
    // Drawing tool
    drawingTool?: string;
    onClearDrawings?: (clearFn: (() => void) | null) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function CanvasTerminalChart({
    ticker,
    interval,
    themeId,
    showSma = true,
    showVwap = true,
    indicators = [],
    activePosition,
    onPriceUpdate,
    chartType = 'candlestick',
    rangeSize = 1.0,
    renkoBrickSize = 0.5,
    drawingTool = 'cursor',
    onClearDrawings,
}: CanvasTerminalChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<ChartEngine | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const isMountedRef = useRef(true);
    const pendingPriceRef = useRef<number | null>(null);
    const rafIdRef = useRef<number>(0);
    // Generation counter — incremented on every ticker/interval change.
    // Guards against stale WS messages or RAF callbacks from previous tickers
    // writing incorrect prices into the current chart's data.
    const fetchGenRef = useRef<number>(0);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [overlayData, setOverlayData] = useState<OHLCVOverlay | null>(null);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [engineInstance, setEngineInstance] = useState<ChartEngine | null>(null);

    const theme = getTheme(themeId);

    // ─── 1. Engine Mount/Unmount ────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        isMountedRef.current = true;

        const engine = new ChartEngine(getTheme(themeId), {
            chartType,
            rangeSize,
            renkoBrickSize,
        });

        engine.callbacks = {
            onPriceUpdate: (price) => {
                setLastPrice(price);
            },
            onCrosshairMove: (overlay) => {
                setOverlayData(overlay);
            },
            onOverlayUpdate: (overlay) => {
                setOverlayData(overlay);
            },
        };

        // Register clear function with parent
        onClearDrawings?.(() => engine.clearDrawings());

        engine.mount(containerRef.current);
        engineRef.current = engine;
        setEngineInstance(engine);

        return () => {
            isMountedRef.current = false;
            onClearDrawings?.(null); // deregister
            engine.destroy();
            engineRef.current = null;
            setEngineInstance(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themeId, chartType, rangeSize, renkoBrickSize]);

    // ─── 2. Theme Update ────────────────────────────────────────────────────────
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setTheme(getTheme(themeId));
        }
    }, [themeId]);

    // ─── 3. Chart Type Update ───────────────────────────────────────────────────
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setChartType(chartType);
        }
    }, [chartType]);

    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setRangeSize(rangeSize);
        }
    }, [rangeSize]);

    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setRenkoBrickSize(renkoBrickSize);
        }
    }, [renkoBrickSize]);

    // ─── 4. Indicators Update ───────────────────────────────────────────────────
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setIndicators(indicators);
        }
    }, [indicators]);

    // ─── 5. Position Lines ──────────────────────────────────────────────────────
    useEffect(() => {
        if (engineRef.current) {
            engineRef.current.setPosition(activePosition || null);
        }
    }, [activePosition]);

    // ─── 5b. Drawing Tool ────────────────────────────────────
    useEffect(() => {
        if (engineInstance) {
            // Map sidebar tool IDs → DrawingStore tool names
            const TOOL_MAP: Record<string, string> = {
                'cursor': 'cursor',
                'trendline': 'trendline',
                'horizontal_line': 'horizontal',
                'fibonacci': 'fib',
                'rectangle': 'rectangle',
                'long_position': 'cursor',
                'short_position': 'cursor',
                'measure': 'cursor',
                'anchored_volume_profile': 'cursor',
                'ray': 'ray',
                'vertical': 'vertical',
                'text': 'text',
                'eraser': 'eraser',
            };
            const mapped = TOOL_MAP[drawingTool] ?? 'cursor';
            engineInstance.debugText = `DT=${drawingTool} MAP=${mapped} AT=${engineInstance.drawingStore.activeTool}`;
            engineInstance.setDrawingTool(mapped as any);
        }
    }, [drawingTool, engineInstance]);


    // ─── 6. Price Callback ──────────────────────────────────────────────────────
    useEffect(() => {
        if (lastPrice !== null && onPriceUpdate) {
            onPriceUpdate(lastPrice);
        }
    }, [lastPrice, onPriceUpdate]);

    // ─── 7. Data Fetch + WebSocket ──────────────────────────────────────────────
    useEffect(() => {
        let pollingTimer: ReturnType<typeof setInterval>;

        const isIntraday = ['1m', '5m', '15m', '1h', '4h'].includes(interval);

        // Increment generation — any callbacks from previous gen will be ignored
        fetchGenRef.current += 1;
        const myGen = fetchGenRef.current;

        const fetchData = async (isPolling = false) => {
            if (!ticker || !engineRef.current) return;

            if (!isPolling) {
                setLoading(true);
                setError(null);
            }

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

                if (!timestamps || !yfQuote) throw new Error('No historical data available.');

                let formattedData: OHLCVBar[] = [];

                for (let idx = 0; idx < timestamps.length; idx++) {
                    const open = yfQuote.open[idx];
                    const high = yfQuote.high[idx];
                    const low = yfQuote.low[idx];
                    const close = yfQuote.close[idx];
                    const volume = yfQuote.volume[idx];

                    if (open !== null && high !== null && low !== null && close !== null) {
                        formattedData.push({
                            time: timestamps[idx],
                            open, high, low, close,
                            volume: volume || 0,
                        });
                    }
                }

                // 4h aggregation
                if (interval === '4h' && formattedData.length > 0) {
                    const aggregated: OHLCVBar[] = [];
                    let current: OHLCVBar | null = null;
                    let count = 0;

                    for (const dp of formattedData) {
                        if (!current) {
                            current = { ...dp };
                            count = 1;
                        } else {
                            current.high = Math.max(current.high, dp.high);
                            current.low = Math.min(current.low, dp.low);
                            current.close = dp.close;
                            current.volume += dp.volume;
                            count++;
                        }
                        if (count === 4) {
                            aggregated.push({ ...current });
                            current = null;
                            count = 0;
                        }
                    }
                    if (current) aggregated.push(current);
                    formattedData = aggregated;
                }

                if (formattedData.length === 0) throw new Error('No valid data points.');

                if (isMountedRef.current && engineRef.current && fetchGenRef.current === myGen) {
                    // Deduplicate & sort
                    const uniqueData = formattedData.filter(
                        (v, i, a) => a.findIndex(x => x.time === v.time) === i
                    );
                    uniqueData.sort((a, b) => a.time - b.time);

                    engineRef.current.setIsIntraday(isIntraday);
                    engineRef.current.setIntervalStr(interval);
                    engineRef.current.setData(uniqueData, !isPolling);

                    setLastPrice(uniqueData[uniqueData.length - 1].close);

                    // Init WS on first fetch (only if this generation is still current)
                    if (!wsRef.current && !isPolling && fetchGenRef.current === myGen) {
                        initWebSocket(myGen);
                    }
                }
            } catch (err: any) {
                if (isMountedRef.current) {
                    setError(err.message || 'Failed to fetch data');
                    setLastPrice(null);
                    setOverlayData(null);
                }
            } finally {
                if (isMountedRef.current && !isPolling) setLoading(false);
            }
        };

        const initWebSocket = (gen: number) => {
            if (wsRef.current) wsRef.current.close();
            const ws = new WebSocket('wss://streamer.finance.yahoo.com/');
            wsRef.current = ws;

            ws.onopen = () => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ subscribe: [ticker] }));
                }
            };

            ws.onmessage = (event) => {
                try {
                    const data = decodeYFMessage(event.data);
                    // Guard: ignore messages if this WS belongs to a stale generation
                    if (data?.id === ticker && data.price && isMountedRef.current && fetchGenRef.current === gen) {
                        const price = data.price;
                        pendingPriceRef.current = price;
                        if (!rafIdRef.current) {
                            rafIdRef.current = requestAnimationFrame(() => {
                                // Double-check generation inside RAF callback
                                const p = pendingPriceRef.current;
                                if (p !== null && engineRef.current && fetchGenRef.current === gen) {
                                    engineRef.current.updateLastBar(p);
                                    setLastPrice(p);
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

            ws.onerror = () => {};
            ws.onclose = () => {
                wsRef.current = null;
                // Only reconnect if this generation is still active (same ticker/interval)
                // This prevents old-ticker WebSockets from coming back to life after cleanup
                if (isMountedRef.current && fetchGenRef.current === gen) {
                    setTimeout(() => {
                        if (isMountedRef.current && fetchGenRef.current === gen) {
                            initWebSocket(gen);
                        }
                    }, 5000);
                }
            };
        };

        fetchData(false);
        pollingTimer = setInterval(() => fetchData(true), 60000);

        return () => {
            clearInterval(pollingTimer);
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = 0;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticker, interval]);

    // ─── Derived Values ─────────────────────────────────────────────────────────
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

    // ─── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="w-full h-full relative">
            {/* ─── Loading Overlay ─────────────────────────────────────────── */}
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

            {/* ─── Error Overlay ───────────────────────────────────────────── */}
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

            {/* ─── OHLCV Header Overlay ────────────────────────────────────── */}
            {overlayData && !loading && (
                <div
                    className="absolute top-0 left-0 z-20 pointer-events-none select-none"
                    style={{ padding: '10px 14px' }}
                >
                    {/* Row 1: Source badge + interval */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: theme.accent }}
                        />
                        <span
                            className="font-mono text-[11px] font-bold tracking-wider uppercase"
                            style={{ color: theme.panelText }}
                        >
                            CANVAS
                        </span>
                        <span
                            className="font-mono text-[10px] px-1.5 py-0 rounded"
                            style={{ color: theme.accent, backgroundColor: theme.accentDim }}
                        >
                            {interval}
                        </span>
                        <span
                            className="font-mono text-[10px] px-1.5 py-0 rounded"
                            style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' }}
                        >
                            {chartType.toUpperCase()}
                        </span>
                    </div>

                    {/* Row 2: Ticker */}
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span className="font-mono text-sm font-bold tracking-wider" style={{ color: theme.panelText }}>
                            {ticker}
                        </span>
                        <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>USD</span>
                    </div>

                    {/* Row 3: OHLC + change */}
                    <div className="flex items-center gap-1 flex-wrap">
                        {[
                            { label: 'O', value: overlayData.open },
                            { label: 'H', value: overlayData.high },
                            { label: 'L', value: overlayData.low },
                            { label: 'C', value: overlayData.close },
                        ].map(({ label, value }) => (
                            <React.Fragment key={label}>
                                <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>
                                    {label}:
                                </span>
                                <span
                                    className="font-mono text-[11px]"
                                    style={{ color: overlayData.close >= overlayData.open ? theme.priceUp : theme.priceDown }}
                                >
                                    {formatPrice(value)}
                                </span>
                            </React.Fragment>
                        ))}

                        <span className="font-mono text-[10px] ml-2" style={{ color: isPositive ? theme.priceUp : theme.priceDown }}>
                            {isPositive ? '+' : ''}{change.toFixed(2)}
                        </span>
                        <span className="font-mono text-[10px]" style={{ color: isPositive ? theme.priceUp : theme.priceDown }}>
                            ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
                        </span>
                    </div>

                    {/* Row 4: Volume */}
                    <div className="flex items-center gap-1 mt-0.5">
                        <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>Vol</span>
                        <span className="font-mono text-[11px]" style={{ color: theme.panelText }}>
                            {formatVolume(overlayData.volume)}
                        </span>
                    </div>
                </div>
            )}

            {/* ─── Canvas Container ────────────────────────────────────────── */}
            <div
                ref={containerRef}
                className="w-full h-full"
                style={{
                    opacity: loading ? 0.3 : 1,
                    transition: 'opacity 0.3s ease',
                }}
            />
        </div>
    );
}

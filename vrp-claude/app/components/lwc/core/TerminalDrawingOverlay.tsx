'use client';

import React, {
    useRef,
    useState,
    useEffect,
    useCallback,
    useImperativeHandle,
    forwardRef,
} from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { TerminalTheme } from './TerminalThemes';
import type { DrawingTool } from './TerminalSidebar';
import type { ChartData } from './TerminalChart';
import { flushSync } from 'react-dom';

// ── Drawing data ──────────────────────────────────────────────────────────────
export interface Drawing {
    id: string;
    type: 'trendline' | 'fibonacci' | 'rectangle' | 'long_position' | 'short_position' | 'horizontal_line' | 'anchored_volume_profile' | 'label';
    startTime: number;   // unix timestamp
    startPrice: number;
    endTime: number;
    endPrice: number;
    // Optional metadata for Object Tree
    label?: string;
    color?: string;
    lineWidth?: number;
    visible?: boolean;  // undefined = visible
    textPosition?: string;
    avpRows?: number;
    avpValueAreaPct?: number;
    avpPlacement?: 'Left' | 'Right';
    avpWidth?: number;
    avpUpColor?: string;
    avpDownColor?: string;
    avpVaUpColor?: string;
    avpVaDownColor?: string;
    avpShowVAH?: boolean;
    avpShowVAL?: boolean;
}

interface MeasureInfo {
    startTime: number;
    startPrice: number;
    endTime: number;
    endPrice: number;
    mouseX: number;
    mouseY: number;
}

export interface TerminalDrawingOverlayHandle {
    clearAll: () => void;
}

interface TerminalDrawingOverlayProps {
    activeTool: DrawingTool;
    chartApi: IChartApi | null;
    mainSeries: ISeriesApi<'Candlestick'> | null;
    theme: TerminalTheme;
    width: number;
    height: number;
    // Lifted state — parent manages the drawings array
    drawings: Drawing[];
    indicatorDrawings?: Drawing[]; // Computed drawings from indicators (read-only, not saved)
    onDrawingsChange: (drawings: Drawing[]) => void;
    // Selected states
    selectedId?: string | null;
    onSelectId?: (id: string | null) => void;
    timeframe?: string;
    chartData?: ChartData[];
}

// ── Fibonacci levels ──────────────────────────────────────────────────────────
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
let _drawId = 0;
function uid(): string {
    return `d_${Date.now()}_${++_drawId}`;
}

function getUnixTime(t: any): number {
    if (typeof t === 'string') {
        return new Date(t).getTime() / 1000;
    }
    if (typeof t === 'object' && t !== null && 'year' in t) {
        return new Date(Date.UTC(t.year, t.month - 1, t.day)).getTime() / 1000;
    }
    return t as number;
}

function coordToPixel(
    chartApi: IChartApi | null,
    mainSeries: ISeriesApi<'Candlestick'> | null,
    time: number,
    price: number,
): { x: number; y: number } | null {
    if (!chartApi || !mainSeries) return null;
    let x = chartApi.timeScale().timeToCoordinate(time as any);
    
    if (x === null) {
        try {
            const data = mainSeries.data();
            if (data && data.length > 0) {
                let minDiff = Infinity;
                let closestIdx = -1;
                let left = 0;
                let right = data.length - 1;
                
                // Binary search for closest time
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    const midTime = getUnixTime(data[mid].time);
                    const diff = Math.abs(midTime - time);
                    
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = mid;
                    }
                    
                    if (midTime < time) {
                        left = mid + 1;
                    } else if (midTime > time) {
                        right = mid - 1;
                    } else {
                        break;
                    }
                }
                
                // Also check neighbors of the closest index just to be absolutely sure
                for (let i = Math.max(0, closestIdx - 1); i <= Math.min(data.length - 1, closestIdx + 1); i++) {
                    const tTime = getUnixTime(data[i].time);
                    const diff = Math.abs(tTime - time);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                    }
                }
                
                if (closestIdx >= 0) {
                    const bestTime = data[closestIdx].time;
                    x = chartApi.timeScale().timeToCoordinate(bestTime as any);
                }
            }
        } catch (e) {
            console.warn("Could not find closest time coordinate", e);
        }
    }
    
    const y = mainSeries.priceToCoordinate(price);
    if (x === null || y === null) return null;
    return { x: x as number, y: y as number };
}

function pixelToCoord(
    chartApi: IChartApi | null,
    mainSeries: ISeriesApi<'Candlestick'> | null,
    px: number,
    py: number,
): { time: number; price: number } | null {
    if (!chartApi || !mainSeries) return null;
    const time = chartApi.timeScale().coordinateToTime(px);
    const price = mainSeries.coordinateToPrice(py);
    if (time === null || time === undefined || price === null || price === undefined) return null;
    return { time: time as number, price: price as number };
}

// ── Component ─────────────────────────────────────────────────────────────────
const TerminalDrawingOverlay = forwardRef<TerminalDrawingOverlayHandle, TerminalDrawingOverlayProps>(
    function TerminalDrawingOverlay({ activeTool, chartApi, mainSeries, theme, width, height, drawings, indicatorDrawings = [], onDrawingsChange, selectedId, onSelectId, timeframe, chartData }, ref) {
        // Bump counter to force SVG re-render on scroll/zoom
        const [renderKey, setRenderKey] = useState(0);
        const bump = useCallback(() => setRenderKey((k) => k + 1), []);

        // Re-render when timeframe changes
        useEffect(() => {
            bump();
        }, [timeframe, bump]);

        // Ref to SVG element
        const svgRef = useRef<SVGSVGElement>(null);

        // Dragging handle info
        const dragInfo = useRef<{
            drawingId: string;
            handleType: 'start' | 'end';
        } | null>(null);

        // Drawing-in-progress state
        const isDrawing = useRef(false);
        const startCoord = useRef<{ time: number; price: number } | null>(null);
        const [preview, setPreview] = useState<Drawing | null>(null);
        const [measure, setMeasure] = useState<MeasureInfo | null>(null);
        const [isDrawingActive, setIsDrawingActive] = useState(false);

        // ── Expose clearAll to parent ─────────────────────────────────────────
        useImperativeHandle(ref, () => ({
            clearAll() {
                onDrawingsChange([]);
                setPreview(null);
                setMeasure(null);
            },
        }), [onDrawingsChange]);

        // ── Fast Sync Loop for Perfect Smoothness ─────────────────────────────
        // Bypasses React's asynchronous render delay (1-frame lag) during 
        // chart panning and Y-axis (price scale) dragging.
        useEffect(() => {
            if (!chartApi || !mainSeries) return;
            
            let frameId: number;
            let active = true;
            let lastCoords = '';

            const loop = () => {
                if (!active) return;
                
                // Track coordinates of up to 5 drawings (manual or indicator) to detect any chart movement
                // (including price scale dragging and container resizes which don't fire traditional events)
                const allDrawings = [...drawings, ...indicatorDrawings];
                let currentCoords = '';
                for (let i = 0; i < Math.min(allDrawings.length, 5); i++) {
                    const d = allDrawings[i];
                    const px = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
                    if (px) {
                        // Use 1 decimal precision to avoid micro-jitters
                        currentCoords += `${px.x.toFixed(1)},${px.y.toFixed(1)}|`;
                    }
                }
                
                // If coordinates changed, force a synchronous React render
                if (currentCoords !== lastCoords && currentCoords !== '') {
                    lastCoords = currentCoords;
                    flushSync(() => {
                        setRenderKey(k => k + 1);
                    });
                }
                
                frameId = requestAnimationFrame(loop);
            };
            
            frameId = requestAnimationFrame(loop);
            
            return () => { 
                active = false;
                cancelAnimationFrame(frameId);
            };
        }, [chartApi, mainSeries, drawings, indicatorDrawings]);

        // ── Reset drawing state when tool changes ─────────────────────────────
        useEffect(() => {
            isDrawing.current = false;
            startCoord.current = null;
            setPreview(null);
            setMeasure(null);
            setIsDrawingActive(false);
        }, [activeTool]);

        // ── Apply cursor and capture mousedown on parent container ────────────
        useEffect(() => {
            const svg = svgRef.current;
            const parent = svg?.parentElement;
            if (!parent) return;

            // Set crosshair cursor on chart container when drawing tool is selected
            if (activeTool !== 'cursor') {
                parent.style.cursor = 'crosshair';
            } else {
                parent.style.cursor = '';
            }

            // Capture initial mousedown on parent to start drawing without letting the event bubble to chart (panning)
            const handleParentMouseDown = (e: MouseEvent) => {
                if (activeTool === 'cursor') return;
                if (e.button !== 0) return; // Only left mouse button

                const rect = parent.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const coord = pixelToCoord(chartApi, mainSeries, x, y);
                if (!coord) return; // Let clicks outside valid chart coordinates fall through

                e.stopPropagation();
                e.preventDefault();

                isDrawing.current = true;
                startCoord.current = coord;
                setIsDrawingActive(true);

                if (activeTool !== 'measure') {
                    setPreview({
                        id: '__preview__',
                        type: activeTool as Drawing['type'],
                        startTime: coord.time,
                        startPrice: coord.price,
                        endTime: coord.time,
                        endPrice: coord.price,
                    });
                } else {
                    setMeasure({
                        startTime: coord.time,
                        startPrice: coord.price,
                        endTime: coord.time,
                        endPrice: coord.price,
                        mouseX: x,
                        mouseY: y,
                    });
                }
            };

            parent.addEventListener('mousedown', handleParentMouseDown, true);
            return () => {
                parent.style.cursor = '';
                parent.removeEventListener('mousedown', handleParentMouseDown, true);
            };
        }, [activeTool, chartApi, mainSeries]);

        // ── Mouse handlers ────────────────────────────────────────────────────
        const getRelativePos = (e: React.MouseEvent<SVGSVGElement>) => {
            const rect = e.currentTarget.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };

        const handleHandleMouseDown = useCallback((
            e: React.MouseEvent,
            drawingId: string,
            handleType: 'start' | 'end'
        ) => {
            e.stopPropagation();
            e.preventDefault();
            dragInfo.current = { drawingId, handleType };
            setIsDrawingActive(true);
            isDrawing.current = true;
        }, []);

        const handleMouseMove = useCallback(
            (e: React.MouseEvent<SVGSVGElement>) => {
                if (!isDrawing.current) return;
                const { x, y } = getRelativePos(e);
                const coord = pixelToCoord(chartApi, mainSeries, x, y);
                if (!coord) return;

                // Handle dragging/resizing handle
                if (dragInfo.current) {
                    const { drawingId, handleType } = dragInfo.current;
                    onDrawingsChange(
                        drawings.map((d) => {
                            if (d.id === drawingId) {
                                if (d.type === 'horizontal_line') {
                                    return { ...d, startTime: coord.time, startPrice: coord.price, endTime: coord.time, endPrice: coord.price };
                                }
                                if (handleType === 'start') {
                                    return { ...d, startTime: coord.time, startPrice: coord.price };
                                } else {
                                    return { ...d, endTime: coord.time, endPrice: coord.price };
                                }
                            }
                            return d;
                        })
                    );
                    return;
                }

                if (activeTool === 'cursor' || !startCoord.current) return;

                if (activeTool !== 'measure') {
                    setPreview((prev) => {
                        if (!prev) return null;
                        if (prev.type === 'horizontal_line') {
                            return { ...prev, startTime: coord.time, startPrice: coord.price, endTime: coord.time, endPrice: coord.price };
                        }
                        return { ...prev, endTime: coord.time, endPrice: coord.price };
                    });
                } else {
                    setMeasure((prev) =>
                        prev
                            ? { ...prev, endTime: coord.time, endPrice: coord.price, mouseX: x, mouseY: y }
                            : null,
                    );
                }
            },
            [activeTool, chartApi, mainSeries, drawings, onDrawingsChange],
        );

        const handleMouseUp = useCallback(
            () => {
                if (!isDrawing.current) return;
                isDrawing.current = false;
                setIsDrawingActive(false);

                // End handle dragging
                if (dragInfo.current) {
                    dragInfo.current = null;
                    startCoord.current = null;
                    return;
                }

                if (activeTool !== 'measure' && preview) {
                    // Only store if the user actually dragged (non-zero movement) or it's a horizontal line
                    const dx = Math.abs(preview.endTime - preview.startTime);
                    const dy = Math.abs(preview.endPrice - preview.startPrice);
                    if (preview.type === 'horizontal_line' || dx > 0 || dy > 0) {
                        onDrawingsChange([...drawings, { ...preview, id: uid() }]);
                    }
                    setPreview(null);
                }

                startCoord.current = null;
            },
            [activeTool, preview, drawings, onDrawingsChange],
        );

        // ── Pixel converters for a drawing ────────────────────────────────────
        const toPixels = useCallback(
            (d: { startTime: number; startPrice: number; endTime: number; endPrice: number }) => {
                const p1 = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
                const p2 = coordToPixel(chartApi, mainSeries, d.endTime, d.endPrice);
                return p1 && p2 ? { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } : null;
            },
            [chartApi, mainSeries],
        );

        const getDrawingColor = (d: Drawing | { color?: string }) => {
            const rawCol = (d as Drawing).color || theme.drawingDefault;
            if (rawCol && rawCol.includes('rgba')) {
                return rawCol.replace(/18$/, '');
            }
            return rawCol;
        };

        const renderTrendline = (
            d: Drawing | { id: string; type: string; startTime: number; startPrice: number; endTime: number; endPrice: number; color?: string; label?: string; textPosition?: string; lineWidth?: number },
            isDashed: boolean,
        ) => {
            const px = toPixels(d);
            if (!px) return null;
            const labelText = d.label;
            const pos = d.textPosition || 'center';
            let tx = (px.x1 + px.x2) / 2;
            let ty = (px.y1 + px.y2) / 2 - 8;
            let textAnchor: 'start' | 'middle' | 'end' = 'middle';

            if (labelText) {
                if (pos === 'left') {
                    if (px.x1 < px.x2) {
                        tx = px.x1 + 10;
                        ty = px.y1 - 8;
                        textAnchor = 'start';
                    } else {
                        tx = px.x2 + 10;
                        ty = px.y2 - 8;
                        textAnchor = 'start';
                    }
                } else if (pos === 'right') {
                    if (px.x1 > px.x2) {
                        tx = px.x1 - 10;
                        ty = px.y1 - 8;
                        textAnchor = 'end';
                    } else {
                        tx = px.x2 - 10;
                        ty = px.y2 - 8;
                        textAnchor = 'end';
                    }
                }
            }

            return (
                <g key={d.id}>
                    <line
                        x1={px.x1} y1={px.y1} x2={px.x2} y2={px.y2}
                        stroke={getDrawingColor(d)}
                        strokeWidth={d.lineWidth || 1.5}
                        strokeDasharray={isDashed ? '6 4' : undefined}
                    />
                    {labelText && (
                        <text
                            x={tx} y={ty}
                            fill={getDrawingColor(d)}
                            fontSize={10}
                            fontFamily="monospace"
                            fontWeight="bold"
                            textAnchor={textAnchor}
                            stroke={theme.background}
                            strokeWidth={3.5}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                        >
                            {labelText}
                        </text>
                    )}
                </g>
            );
        };

        const renderHorizontalLine = (
            d: Drawing | { id: string; type: string; startTime: number; startPrice: number; endTime: number; endPrice: number; color?: string; label?: string; textPosition?: string; lineWidth?: number },
            isDashed: boolean,
        ) => {
            const pt = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            if (!pt) return null;
            const y = pt.y;
            const col = getDrawingColor(d);
            const thickness = d.lineWidth || 1.5;
            const labelText = d.label;
            const pos = d.textPosition || 'left';
            
            let tx = 10;
            let textAnchor: 'start' | 'middle' | 'end' = 'start';
            if (pos === 'right') {
                tx = width - 10;
                textAnchor = 'end';
            } else if (pos === 'center') {
                tx = width / 2;
                textAnchor = 'middle';
            }

            return (
                <g key={d.id}>
                    <line
                        x1={0} y1={y} x2={width} y2={y}
                        stroke={col}
                        strokeWidth={thickness}
                        strokeDasharray={isDashed ? '6 4' : undefined}
                    />
                    {labelText && (
                        <text
                            x={tx} y={y - 6}
                            fill={col}
                            fontSize={10}
                            fontFamily="monospace"
                            fontWeight="bold"
                            textAnchor={textAnchor}
                            stroke={theme.background}
                            strokeWidth={3.5}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                        >
                            {labelText}
                        </text>
                    )}
                </g>
            );
        };

        const renderRectangle = (
            d: Drawing | { id: string; type: string; startTime: number; startPrice: number; endTime: number; endPrice: number; color?: string; label?: string; textPosition?: string; lineWidth?: number },
            isDashed: boolean,
        ) => {
            const px = toPixels(d);
            if (!px) return null;
            const x = Math.min(px.x1, px.x2);
            const y = Math.min(px.y1, px.y2);
            const w = Math.abs(px.x2 - px.x1);
            const h = Math.abs(px.y2 - px.y1);
            const col = getDrawingColor(d);
            const labelText = d.label;
            const pos = d.textPosition || 'top_left';
            let tx = x + 8;
            let ty = y + 16;
            let textAnchor: 'start' | 'middle' | 'end' = 'start';

            if (labelText) {
                if (pos === 'top_center') {
                    tx = x + w / 2;
                    textAnchor = 'middle';
                } else if (pos === 'top_right') {
                    tx = x + w - 8;
                    textAnchor = 'end';
                } else if (pos === 'center') {
                    tx = x + w / 2;
                    ty = y + h / 2 + 4;
                    textAnchor = 'middle';
                } else if (pos === 'bottom_left') {
                    tx = x + 8;
                    ty = y + h - 8;
                    textAnchor = 'start';
                } else if (pos === 'bottom_center') {
                    tx = x + w / 2;
                    ty = y + h - 8;
                    textAnchor = 'middle';
                } else if (pos === 'bottom_right') {
                    tx = x + w - 8;
                    ty = y + h - 8;
                    textAnchor = 'end';
                }
            }

            // Robust color resolution to avoid black boxes and ensure transparency
            let fillCol = col;
            let fillOp = 0.08;
            let strokeCol = col;
            let strokeOp = 1.0;

            if (col.includes('rgba')) {
                // Remove corrupt "18" suffix if present
                const cleanCol = col.replace(/18$/, '');
                fillCol = cleanCol;
                strokeCol = cleanCol;
                // If it already contains alpha (rgba), let it use its natural transparency
                fillOp = 1.0;
            } else if (col.startsWith('#')) {
                if (col.length === 9) {
                    fillCol = col;
                    fillOp = 1.0;
                } else {
                    fillCol = col;
                    fillOp = 0.06; // Faint, modern background session visual
                }
            }

            // If it's an ICT S&D session drawing, make the border and label extremely subtle
            const isIctSession = d.id.startsWith('ict_');
            if (isIctSession) {
                strokeOp = 0.3; // Very subtle borders
            }

            return (
                <g key={d.id}>
                    <rect
                        x={x} y={y} width={w} height={h}
                        fill={fillCol}
                        fillOpacity={fillOp}
                        stroke={strokeCol}
                        strokeOpacity={strokeOp}
                        strokeWidth={d.lineWidth || 1.5}
                        strokeDasharray={isDashed ? '6 4' : undefined}
                    />
                    {labelText && (
                        <text
                            x={tx} y={ty}
                            fill={strokeCol}
                            fillOpacity={isIctSession ? 0.7 : 1.0}
                            fontSize={10}
                            fontFamily="monospace"
                            fontWeight="bold"
                            textAnchor={textAnchor}
                            stroke={theme.background}
                            strokeWidth={3.5}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                        >
                            {labelText}
                        </text>
                    )}
                </g>
            );
        };

        const renderLabel = (
            d: Drawing | { id: string; type: string; startTime: number; startPrice: number; endTime: number; endPrice: number; color?: string; label?: string; textPosition?: string; lineWidth?: number }
        ) => {
            const pt = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            if (!pt) return null;
            const col = getDrawingColor(d);
            const pos = d.textPosition || 'top_center'; // where to place text relative to the point
            
            let tx = pt.x;
            let ty = pt.y;
            let textAnchor: 'start' | 'middle' | 'end' = 'middle';
            
            if (pos === 'top_center') { ty -= 10; }
            else if (pos === 'bottom_center') { ty += 18; }
            else if (pos === 'middle_left') { tx -= 10; ty += 4; textAnchor = 'end'; }
            else if (pos === 'middle_right') { tx += 10; ty += 4; textAnchor = 'start'; }

            return (
                <g key={d.id}>
                    {/* Tiny dot anchor */}
                    <circle cx={pt.x} cy={pt.y} r={2} fill={col} opacity={0.5} />
                    {d.label && (
                        <text
                            x={tx} y={ty}
                            fill={col}
                            fontSize={10}
                            fontFamily="monospace"
                            fontWeight="bold"
                            textAnchor={textAnchor}
                            stroke={theme.background}
                            strokeWidth={3.5}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                        >
                            {d.label}
                        </text>
                    )}
                </g>
            );
        };

        const renderFibonacci = (
            d: Drawing | { id: string; type: string; startTime: number; startPrice: number; endTime: number; endPrice: number; color?: string; label?: string; textPosition?: string; lineWidth?: number },
            isDashed: boolean,
        ) => {
            const pStart = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            const pEnd = coordToPixel(chartApi, mainSeries, d.endTime, d.endPrice);
            if (!pStart || !pEnd) return null;

            const left = Math.min(pStart.x, pEnd.x);
            const right = Math.max(pStart.x, pEnd.x);
            const w = right - left;
            if (w < 2) return null;

            const priceRange = d.endPrice - d.startPrice;
            const elements: React.ReactNode[] = [];
            const col = d.color || theme.fibColor;
            const thickness = d.lineWidth || 1;

            for (let i = 0; i < FIB_LEVELS.length; i++) {
                const level = FIB_LEVELS[i];
                const price = d.startPrice + priceRange * level;
                const pt = coordToPixel(chartApi, mainSeries, d.startTime, price);
                if (!pt) continue;
                const y = pt.y;

                // Fill band between this level and the next
                if (i < FIB_LEVELS.length - 1) {
                    const nextPrice = d.startPrice + priceRange * FIB_LEVELS[i + 1];
                    const ptNext = coordToPixel(chartApi, mainSeries, d.startTime, nextPrice);
                    if (ptNext) {
                        elements.push(
                            <rect
                                key={`${d.id}_fb_${i}`}
                                x={left} y={Math.min(y, ptNext.y)}
                                width={w} height={Math.abs(ptNext.y - y)}
                                fill={d.color ? `${d.color}0c` : theme.fibFill}
                            />,
                        );
                    }
                }

                // Horizontal line
                elements.push(
                    <line
                        key={`${d.id}_fl_${i}`}
                        x1={left} y1={y} x2={right} y2={y}
                        stroke={col}
                        strokeWidth={thickness}
                        strokeDasharray={isDashed ? '4 3' : (level === 0 || level === 1 ? undefined : '3 2')}
                        opacity={level === 0 || level === 1 ? 1 : 0.7}
                    />,
                );

                // Label
                elements.push(
                    <text
                        key={`${d.id}_ft_${i}`}
                        x={right + 4} y={y + 3}
                        fill={col}
                        fontSize={10}
                        fontFamily="monospace"
                        opacity={0.9}
                    >
                        {(level * 100).toFixed(1)}%
                    </text>,
                );
            }

            // Custom label for Fibonacci
            if (d.label) {
                const ptLabel = coordToPixel(chartApi, mainSeries, d.startTime, Math.max(d.startPrice, d.endPrice));
                if (ptLabel) {
                    const pos = d.textPosition || 'left';
                    let tx = left + 10;
                    let textAnchor: 'start' | 'middle' | 'end' = 'start';
                    if (pos === 'right') {
                        tx = right - 10;
                        textAnchor = 'end';
                    } else if (pos === 'center') {
                        tx = left + w / 2;
                        textAnchor = 'middle';
                    }
                    elements.push(
                        <text
                            key={`${d.id}_custom_label`}
                            x={tx} y={ptLabel.y - 8}
                            fill={col}
                            fontSize={10}
                            fontFamily="monospace"
                            fontWeight="bold"
                            textAnchor={textAnchor}
                            stroke={theme.background}
                            strokeWidth={3.5}
                            paintOrder="stroke fill"
                            strokeLinejoin="round"
                        >
                            {d.label}
                        </text>
                    );
                }
            }

            return <g key={d.id}>{elements}</g>;
        };

        const renderPositionTool = (
            d: Drawing,
            isLong: boolean,
            isDashed: boolean,
        ) => {
            const pStart = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            const pEnd = coordToPixel(chartApi, mainSeries, d.endTime, d.endPrice);
            if (!pStart || !pEnd) return null;

            const left = Math.min(pStart.x, pEnd.x);
            const right = Math.max(pStart.x, pEnd.x);
            const w = right - left;
            if (w < 4) return null;

            const entryPrice = d.startPrice;
            const priceDiff = Math.abs(d.endPrice - d.startPrice);
            if (priceDiff === 0) return null;

            // Target & Stop calculations (R:R Ratio = 2.0)
            const targetPrice = isLong ? entryPrice + priceDiff : entryPrice - priceDiff;
            const stopPrice = isLong ? entryPrice - priceDiff / 2 : entryPrice + priceDiff / 2;

            const pTarget = coordToPixel(chartApi, mainSeries, d.startTime, targetPrice);
            const pStop = coordToPixel(chartApi, mainSeries, d.startTime, stopPrice);
            if (!pTarget || !pStop) return null;

            const entryY = pStart.y;
            const targetY = pTarget.y;
            const stopY = pStop.y;

            const targetPct = entryPrice !== 0 ? ((targetPrice - entryPrice) / entryPrice) * 100 : 0;
            const stopPct = entryPrice !== 0 ? ((stopPrice - entryPrice) / entryPrice) * 100 : 0;

            const profitBg = isLong ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)';
            const profitBorder = isLong ? 'rgba(34, 197, 94, 0.45)' : 'rgba(239, 68, 68, 0.45)';
            const lossBg = isLong ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)';
            const lossBorder = isLong ? 'rgba(239, 68, 68, 0.45)' : 'rgba(34, 197, 94, 0.45)';

            const profitTop = Math.min(entryY, targetY);
            const profitHeight = Math.abs(targetY - entryY);

            const lossTop = Math.min(entryY, stopY);
            const lossHeight = Math.abs(stopY - entryY);

            // Info box at center of horizontal width, aligned vertically near entry line
            const infoW = 140;
            const infoH = 50;
            const infoX = left + w / 2 - infoW / 2;
            const infoY = entryY - infoH / 2;

            const customColor = d.color;
            const thickness = d.lineWidth || 1.5;

            return (
                <g key={d.id}>
                    {/* Profit Box Area */}
                    <rect
                        x={left} y={profitTop} width={w} height={profitHeight}
                        fill={profitBg}
                        stroke={profitBorder}
                        strokeWidth={d.lineWidth || 1}
                        strokeDasharray={isDashed ? '3 3' : undefined}
                    />

                    {/* Loss Box Area */}
                    <rect
                        x={left} y={lossTop} width={w} height={lossHeight}
                        fill={lossBg}
                        stroke={lossBorder}
                        strokeWidth={d.lineWidth || 1}
                        strokeDasharray={isDashed ? '3 3' : undefined}
                    />

                    {/* Entry Center Line */}
                    <line
                        x1={left} y1={entryY} x2={right} y2={entryY}
                        stroke={customColor || theme.drawingDefault}
                        strokeWidth={thickness}
                    />

                    {/* Info Card in Center */}
                    <rect
                        x={infoX} y={infoY} width={infoW} height={infoH} rx={4}
                        fill={theme.panelBg}
                        stroke={customColor || theme.panelBorder}
                        strokeWidth={1}
                        opacity={0.92}
                    />
                    <text
                        x={infoX + infoW / 2} y={infoY + 16}
                        fill={theme.panelText}
                        fontSize={8.5} fontFamily="monospace" fontWeight="bold"
                        textAnchor="middle"
                    >
                        {d.label || (isLong ? 'LONG POSITION' : 'SHORT POSITION')}
                    </text>
                    <text
                        x={infoX + infoW / 2} y={infoY + 30}
                        fill={theme.accent}
                        fontSize={9.5} fontFamily="monospace" fontWeight="bold"
                        textAnchor="middle"
                    >
                        Risk/Reward: 2.00
                    </text>
                    <text
                        x={infoX + infoW / 2} y={infoY + 42}
                        fill={isLong ? theme.priceUp : theme.priceDown}
                        fontSize={8} fontFamily="monospace"
                        textAnchor="middle"
                    >
                        T:{targetPct >= 0 ? '+' : ''}{targetPct.toFixed(2)}%|S:{stopPct >= 0 ? '+' : ''}{stopPct.toFixed(2)}%
                    </text>
                </g>
            );
        };

        const renderAnchoredVolumeProfile = (
            d: Drawing,
            isDashed: boolean,
        ) => {
            if (!chartData || chartData.length === 0) return null;

            const pStart = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            const pEnd = coordToPixel(chartApi, mainSeries, d.endTime, d.endPrice);
            if (!pStart || !pEnd) return null;

            // Determine time boundaries
            const t1 = Math.min(d.startTime, d.endTime);
            const t2 = Math.max(d.startTime, d.endTime);

            // Filter data
            const rangeData = chartData.filter(c => {
                const ct = getUnixTime(c.time);
                return ct >= t1 && ct <= t2;
            });
            if (rangeData.length === 0) return null;

            // Find price range
            let minP = Infinity;
            let maxP = -Infinity;
            for (const c of rangeData) {
                if (c.low < minP) minP = c.low;
                if (c.high > maxP) maxP = c.high;
            }
            if (minP === Infinity || maxP === -Infinity || maxP === minP) return null;

            const rows = d.avpRows || 24;
            const rowHeight = (maxP - minP) / rows;
            const bins: { priceStart: number, priceEnd: number, upVol: number, downVol: number, totalVol: number }[] = [];
            for (let i = 0; i < rows; i++) {
                bins.push({
                    priceStart: minP + i * rowHeight,
                    priceEnd: minP + (i + 1) * rowHeight,
                    upVol: 0,
                    downVol: 0,
                    totalVol: 0
                });
            }

            // Distribute volume
            let totalVolume = 0;
            for (const c of rangeData) {
                const typicalPrice = (c.high + c.low + c.close) / 3;
                let binIdx = Math.floor((typicalPrice - minP) / rowHeight);
                if (binIdx < 0) binIdx = 0;
                if (binIdx >= rows) binIdx = rows - 1;
                
                const isUp = c.close >= c.open;
                if (isUp) {
                    bins[binIdx].upVol += c.volume;
                } else {
                    bins[binIdx].downVol += c.volume;
                }
                bins[binIdx].totalVol += c.volume;
                totalVolume += c.volume;
            }

            if (totalVolume === 0) return null;

            // Find POC
            let pocIdx = 0;
            let maxVol = 0;
            for (let i = 0; i < rows; i++) {
                if (bins[i].totalVol > maxVol) {
                    maxVol = bins[i].totalVol;
                    pocIdx = i;
                }
            }

            // Calculate Value Area
            const vaPct = (d.avpValueAreaPct || 70) / 100;
            const targetVaVol = totalVolume * vaPct;
            let currentVaVol = bins[pocIdx].totalVol;
            
            let upIdx = pocIdx + 1;
            let downIdx = pocIdx - 1;
            const inVa = new Set<number>();
            inVa.add(pocIdx);

            while (currentVaVol < targetVaVol && (upIdx < rows || downIdx >= 0)) {
                let upVol = upIdx < rows ? bins[upIdx].totalVol : -1;
                let downVol = downIdx >= 0 ? bins[downIdx].totalVol : -1;

                if (upVol >= downVol && upVol !== -1) {
                    currentVaVol += upVol;
                    inVa.add(upIdx);
                    upIdx++;
                } else if (downVol > upVol && downVol !== -1) {
                    currentVaVol += downVol;
                    inVa.add(downIdx);
                    downIdx--;
                } else {
                    break;
                }
            }

            // Draw Profile
            const placement = d.avpPlacement || 'Right';
            const widthPct = d.avpWidth || 30;
            
            const boxW = Math.abs(pEnd.x - pStart.x);
            // If user just clicked without dragging, give it a default max bar width
            const maxBarWidth = boxW > 10 ? boxW * (widthPct / 100) : 120;
            const anchorX = placement === 'Right' ? Math.max(pStart.x, pEnd.x) : Math.min(pStart.x, pEnd.x);
            
            const upColor = d.avpUpColor || '#0d9488'; // teal-600
            const downColor = d.avpDownColor || '#be123c'; // rose-700
            const vaUpColor = d.avpVaUpColor || '#2dd4bf'; // teal-400
            const vaDownColor = d.avpVaDownColor || '#fb7185'; // rose-400
            
            const elements: React.ReactNode[] = [];

            for (let i = 0; i < rows; i++) {
                const bin = bins[i];
                if (bin.totalVol === 0) continue;

                const py1 = coordToPixel(chartApi, mainSeries, d.startTime, bin.priceEnd)?.y;
                const py2 = coordToPixel(chartApi, mainSeries, d.startTime, bin.priceStart)?.y;
                if (py1 === undefined || py2 === undefined) continue;

                const topY = Math.min(py1, py2);
                const bottomY = Math.max(py1, py2);
                const h = Math.abs(bottomY - topY);
                const barH = Math.max(1, h - 0.5); 
                
                const upW = (bin.upVol / maxVol) * maxBarWidth;
                const downW = (bin.downVol / maxVol) * maxBarWidth;
                
                const isVa = inVa.has(i);
                const colorUp = isVa ? vaUpColor : upColor;
                const colorDown = isVa ? vaDownColor : downColor;
                const opacity = isVa ? 0.85 : 0.35;
                
                if (placement === 'Right') {
                    if (upW > 0) {
                        elements.push(
                            <rect key={`${d.id}_up_${i}`} x={anchorX - upW} y={topY} width={upW} height={barH} fill={colorUp} opacity={opacity} />
                        );
                    }
                    if (downW > 0) {
                        elements.push(
                            <rect key={`${d.id}_down_${i}`} x={anchorX - upW - downW} y={topY} width={downW} height={barH} fill={colorDown} opacity={opacity} />
                        );
                    }
                } else {
                    if (upW > 0) {
                        elements.push(
                            <rect key={`${d.id}_up_${i}`} x={anchorX} y={topY} width={upW} height={barH} fill={colorUp} opacity={opacity} />
                        );
                    }
                    if (downW > 0) {
                        elements.push(
                            <rect key={`${d.id}_down_${i}`} x={anchorX + upW} y={topY} width={downW} height={barH} fill={colorDown} opacity={opacity} />
                        );
                    }
                }
            }

            // POC Line
            const pocBin = bins[pocIdx];
            const pocY = coordToPixel(chartApi, mainSeries, d.startTime, (pocBin.priceStart + pocBin.priceEnd) / 2)?.y;
            
            if (pocY !== undefined) {
                const p1 = placement === 'Right' ? anchorX - maxBarWidth - 10 : anchorX;
                const p2 = placement === 'Right' ? anchorX : anchorX + maxBarWidth + 10;
                elements.push(
                    <line
                        key={`${d.id}_poc`}
                        x1={p1}
                        y1={pocY}
                        x2={p2}
                        y2={pocY}
                        stroke="#ef4444"
                        strokeWidth={d.lineWidth || 1.5}
                        strokeDasharray={isDashed ? '4 3' : undefined}
                    />
                );
            }

            // VAH and VAL lines
            let maxVaBinIdx = -1;
            let minVaBinIdx = rows;
            Array.from(inVa).forEach(idx => {
                if (idx > maxVaBinIdx) maxVaBinIdx = idx;
                if (idx < minVaBinIdx) minVaBinIdx = idx;
            });
            if (maxVaBinIdx !== -1 && d.avpShowVAH) {
                const vahY = coordToPixel(chartApi, mainSeries, d.startTime, bins[maxVaBinIdx].priceEnd)?.y;
                if (vahY !== undefined) {
                    const boxLeft = Math.min(pStart.x, pEnd.x);
                    const boxRight = Math.max(pStart.x, pEnd.x);
                    elements.push(
                        <line key={`${d.id}_vah`} x1={boxLeft} y1={vahY} x2={boxRight} y2={vahY} stroke={vaUpColor} strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
                    );
                }
            }
            if (minVaBinIdx !== rows && d.avpShowVAL) {
                const valY = coordToPixel(chartApi, mainSeries, d.startTime, bins[minVaBinIdx].priceStart)?.y;
                if (valY !== undefined) {
                    const boxLeft = Math.min(pStart.x, pEnd.x);
                    const boxRight = Math.max(pStart.x, pEnd.x);
                    elements.push(
                        <line key={`${d.id}_val`} x1={boxLeft} y1={valY} x2={boxRight} y2={valY} stroke={vaDownColor} strokeWidth={1} strokeDasharray="4 4" opacity={0.8} />
                    );
                }
            }

            // Bounding box
            const maxPY = coordToPixel(chartApi, mainSeries, d.startTime, maxP)?.y;
            const minPY = coordToPixel(chartApi, mainSeries, d.startTime, minP)?.y;
            if (maxPY !== undefined && minPY !== undefined) {
                const boxLeft = Math.min(pStart.x, pEnd.x);
                elements.push(
                    <rect
                        key={`${d.id}_box`}
                        x={boxLeft}
                        y={Math.min(maxPY, minPY)}
                        width={Math.max(1, boxW)}
                        height={Math.abs(minPY - maxPY)}
                        fill="none"
                        stroke={d.color || theme.accent}
                        opacity={0.2}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                    />
                );
            }

            return <g key={d.id}>{elements}</g>;
        };

        const renderDrawing = (d: Drawing, isDashed = false) => {
            let element: React.ReactNode = null;
            switch (d.type) {
                case 'trendline':
                    element = renderTrendline(d, isDashed);
                    break;
                case 'rectangle':
                    element = renderRectangle(d, isDashed);
                    break;
                case 'fibonacci':
                    element = renderFibonacci(d, isDashed);
                    break;
                case 'long_position':
                    element = renderPositionTool(d, true, isDashed);
                    break;
                case 'short_position':
                    element = renderPositionTool(d, false, isDashed);
                    break;
                case 'horizontal_line':
                    element = renderHorizontalLine(d, isDashed);
                    break;
                case 'anchored_volume_profile':
                    element = renderAnchoredVolumeProfile(d, isDashed);
                    break;
                case 'label':
                    element = renderLabel(d);
                    break;
            }
            if (!element) return null;

            // Raw rendering during drawing preview or when tool is not cursor
            if (isDashed || activeTool !== 'cursor') {
                return element;
            }

            const pStart = coordToPixel(chartApi, mainSeries, d.startTime, d.startPrice);
            const pEnd = coordToPixel(chartApi, mainSeries, d.endTime, d.endPrice);
            const isSelected = selectedId === d.id;

            return (
                <g
                    key={d.id}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelectId?.(d.id);
                    }}
                >
                    {/* Invisible hitboxes for easier clicking on lines and shapes */}
                    {pStart && pEnd && d.type === 'trendline' && (
                        <line
                            x1={pStart.x} y1={pStart.y} x2={pEnd.x} y2={pEnd.y}
                            stroke="transparent"
                            strokeWidth={12}
                            style={{ pointerEvents: 'stroke' }}
                        />
                    )}
                    {pStart && d.type === 'horizontal_line' && (
                        <line
                            x1={0} y1={pStart.y} x2={width} y2={pStart.y}
                            stroke="transparent"
                            strokeWidth={12}
                            style={{ pointerEvents: 'stroke' }}
                        />
                    )}
                    {pStart && pEnd && (d.type === 'rectangle' || d.type === 'anchored_volume_profile') && (
                        <rect
                            x={Math.min(pStart.x, pEnd.x) - 4}
                            y={Math.min(pStart.y, pEnd.y) - 4}
                            width={Math.abs(pEnd.x - pStart.x) + 8}
                            height={Math.abs(pEnd.y - pStart.y) + 8}
                            fill="transparent"
                            stroke="transparent"
                            strokeWidth={1}
                            style={{ pointerEvents: 'all' }}
                        />
                    )}

                    {/* Actual drawing element */}
                    <g style={{ pointerEvents: 'all' }}>
                        {element}
                    </g>

                    {/* Anchor/Resizing handles */}
                    {isSelected && pStart && (
                        <g style={{ pointerEvents: 'all' }}>
                            {d.type === 'horizontal_line' ? (
                                <circle
                                    cx={pStart.x} cy={pStart.y} r={6}
                                    fill="#ffffff"
                                    stroke={theme.accent}
                                    strokeWidth={2}
                                    style={{ cursor: 'row-resize' }}
                                    onMouseDown={(e) => handleHandleMouseDown(e, d.id, 'start')}
                                />
                            ) : (
                                pEnd && (
                                    <>
                                        <circle
                                            cx={pStart.x} cy={pStart.y} r={6}
                                            fill="#ffffff"
                                            stroke={theme.accent}
                                            strokeWidth={2}
                                            style={{ cursor: 'move' }}
                                            onMouseDown={(e) => handleHandleMouseDown(e, d.id, 'start')}
                                        />
                                        <circle
                                            cx={pEnd.x} cy={pEnd.y} r={6}
                                            fill="#ffffff"
                                            stroke={theme.accent}
                                            strokeWidth={2}
                                            style={{ cursor: 'move' }}
                                            onMouseDown={(e) => handleHandleMouseDown(e, d.id, 'end')}
                                        />
                                    </>
                                )
                            )}
                        </g>
                    )}
                </g>
            );
        };

        // ── Measure info box ──────────────────────────────────────────────────
        const renderMeasureBox = () => {
            if (!measure) return null;
            const px = toPixels(measure);
            if (!px) return null;

            const priceChange = measure.endPrice - measure.startPrice;
            const pricePct = measure.startPrice !== 0
                ? (priceChange / measure.startPrice) * 100
                : 0;

            // Estimate bar count using time difference and a rough per-bar duration
            const timeDiff = Math.abs(measure.endTime - measure.startTime);
            // We'll show raw seconds converted to a human label
            const formatDuration = (secs: number) => {
                if (secs < 60) return `${secs}s`;
                if (secs < 3600) return `${Math.round(secs / 60)}m`;
                if (secs < 86400) return `${(secs / 3600).toFixed(1)}h`;
                return `${(secs / 86400).toFixed(1)}d`;
            };

            // Box position – keep near mouse but clamped inside overlay
            const boxW = 180;
            const boxH = 80;
            let bx = measure.mouseX + 14;
            let by = measure.mouseY - boxH - 8;
            if (bx + boxW > width) bx = measure.mouseX - boxW - 14;
            if (by < 0) by = measure.mouseY + 14;

            // Draw a dashed rectangle for the measured area
            const rx = Math.min(px.x1, px.x2);
            const ry = Math.min(px.y1, px.y2);
            const rw = Math.abs(px.x2 - px.x1);
            const rh = Math.abs(px.y2 - px.y1);

            const isPositive = priceChange >= 0;

            return (
                <g key="__measure__">
                    <rect
                        x={rx} y={ry} width={rw} height={rh}
                        fill={`${isPositive ? theme.priceUp : theme.priceDown}12`}
                        stroke={isPositive ? theme.priceUp : theme.priceDown}
                        strokeWidth={1}
                        strokeDasharray="4 3"
                    />
                    {/* Info box */}
                    <rect
                        x={bx} y={by} width={boxW} height={boxH} rx={4}
                        fill={theme.panelBg}
                        stroke={theme.panelBorder}
                        strokeWidth={1}
                        opacity={0.95}
                    />
                    <text x={bx + 8} y={by + 18} fill={theme.panelText} fontSize={11} fontFamily="monospace">
                        {measure.startPrice.toFixed(2)} → {measure.endPrice.toFixed(2)}
                    </text>
                    <text
                        x={bx + 8} y={by + 34}
                        fill={isPositive ? theme.priceUp : theme.priceDown}
                        fontSize={12} fontFamily="monospace" fontWeight="bold"
                    >
                        {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{pricePct.toFixed(2)}%)
                    </text>
                    <text x={bx + 8} y={by + 52} fill={theme.panelTextDim} fontSize={10} fontFamily="monospace">
                        Duration: {formatDuration(timeDiff)}
                    </text>
                    <text x={bx + 8} y={by + 68} fill={theme.panelTextDim} fontSize={10} fontFamily="monospace">
                        Δt {timeDiff}s | Range {Math.abs(priceChange).toFixed(2)}
                    </text>
                </g>
            );
        };

        // Force read renderKey so React re-renders when we bump
        void renderKey;

        return (
            <svg
                ref={svgRef}
                width={width}
                height={height}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    pointerEvents: isDrawingActive ? 'all' : 'none',
                    zIndex: 10,
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    if (isDrawing.current) handleMouseUp();
                }}
            >
                {/* ── 2. Render computed indicator drawings (read-only) ── */}
                {indicatorDrawings.map((d) => renderDrawing(d, false))}

                {/* ── 3. Render persisted manual drawings ── */}
                {drawings
                    .filter(d => d.visible !== false)
                    .map((d) => renderDrawing(d, false))}

                {/* Preview (in-progress drawing) */}
                {preview && renderDrawing(preview as Drawing, true)}

                {/* Measure overlay */}
                {measure && renderMeasureBox()}
            </svg>
        );
    },
);

TerminalDrawingOverlay.displayName = 'TerminalDrawingOverlay';
export default TerminalDrawingOverlay;

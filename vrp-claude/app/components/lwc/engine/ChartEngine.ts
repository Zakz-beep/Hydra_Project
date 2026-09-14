// ─── ChartEngine — Main Orchestrator ────────────────────────────────────────────
// Ties together DataStore, CoordMapper, PaneManager, Renderer, and InteractionHandler
// into a single cohesive charting engine.
//
// Architecture:
//   • 3-layer canvas per pane (bg, main, ui)
//   • Decoupled dirty-flag render loop (rAF only redraws dirty layers)
//   • Spring Physics kinetic scrolling with rubber-band OOB effect

import type {
    ChartType, EngineConfig, OHLCVBar, CrosshairState, ActivePosition,
    OHLCVOverlay, IndicatorConfig, PaneType,
} from './types';
import { DEFAULT_ENGINE_CONFIG } from './types';
import type { TerminalTheme } from '../core/TerminalThemes';
import type { MovingAverageConfig, RSIConfig, CVDConfig } from '../../../types/indicators';

import { CoordMapper } from './CoordMapper';
import { DataStore } from './DataStore';
import { PaneManager } from './PaneManager';
import type { LayerName } from './PaneManager';
import { InteractionHandler } from './InteractionHandler';
import * as Renderer from './Renderer';
import { DrawingStore } from './DrawingStore';
import type { DrawingToolType, DrawingPoint } from './DrawingStore';

// ─── Callbacks to React ─────────────────────────────────────────────────────────

export interface ChartEngineCallbacks {
    onPriceUpdate?: (price: number) => void;
    onCrosshairMove?: (overlay: OHLCVOverlay | null) => void;
    onOverlayUpdate?: (overlay: OHLCVOverlay | null) => void;
}

// ─── ChartEngine Class ──────────────────────────────────────────────────────────

export class ChartEngine {
    // Core modules
    dataStore: DataStore;
    coordMapper: CoordMapper;
    paneManager: PaneManager;
    private interactionHandler: InteractionHandler | null = null;
    drawingStore: DrawingStore;

    // Drawing interaction state
    private _drawingDown: boolean = false;

    // Configuration
    config: EngineConfig;
    theme: TerminalTheme;
    indicators: IndicatorConfig[] = [];
    activePosition: ActivePosition | null = null;
    isIntraday: boolean = true;
    debugText: string = "";

    // Crosshair state
    crosshair: CrosshairState = {
        visible: false, x: 0, y: 0,
        barIndex: -1, price: 0, paneId: '',
    };

    // Callbacks
    callbacks: ChartEngineCallbacks = {};

    // ─── Dirty Flags ────────────────────────────────────────────────────────────
    private _dirtyBg: boolean = false;
    private _dirtyMain: boolean = false;
    private _dirtyUI: boolean = false;
    private _dirtyTimeAxis: boolean = false; // separate from UI — only redraws on zoom/pan/data
    private _rafId: number = 0;
    private _running: boolean = false;
    private _container: HTMLDivElement | null = null;
    private _timeAxisCanvas: HTMLCanvasElement | null = null;
    private _timeAxisCtx: CanvasRenderingContext2D | null = null;

    private _intervalStr: string = '1m';
    private _lastCountdown: string = '';

    // ─── Spring Physics State ───────────────────────────────────────────────────
    private _velocityX: number = 0;           // px per ms (kinetic momentum)
    private _isAnimating: boolean = false;     // true while momentum/spring is active
    private _lastFrameTime: number = 0;        // for delta-time calculation
    private _isDragging: boolean = false;       // true while user is dragging

    constructor(theme: TerminalTheme, config?: Partial<EngineConfig>) {
        this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
        this.theme = theme;
        this.dataStore = new DataStore();
        this.coordMapper = new CoordMapper(this.config);
        this.paneManager = new PaneManager();
        this.drawingStore = new DrawingStore();

        // alert('Canvas Engine Update V5 Loaded!');

        // TEST DRAWING
        this.drawingStore.drawings.push({
            id: 'test',
            type: 'trendline',
            visible: true,
            selected: false,
            color: '#ff00ff',
            lineWidth: 3,
            locked: false,
            p1: { barIndex: 0, price: 100 },
            p2: { barIndex: 100, price: 200 },
            dashed: false,
            extendLeft: false,
            extendRight: false
        } as any);
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    mount(container: HTMLDivElement): void {
        this._container = container;
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.cursor = 'crosshair';

        this.paneManager.mount(container);

        // Create time axis canvas
        this._timeAxisCanvas = document.createElement('canvas');
        this._timeAxisCanvas.style.position = 'absolute';
        this._timeAxisCanvas.style.left = '0';
        this._timeAxisCanvas.style.pointerEvents = 'none';
        this._timeAxisCanvas.style.zIndex = '10';
        container.appendChild(this._timeAxisCanvas);
        this._timeAxisCtx = this._timeAxisCanvas.getContext('2d');

        // ─── Bind Drawing Handlers FIRST ─────────────────────────────────────────
        const onDrawMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (this.drawingStore.activeTool === 'cursor') return;
            
            // Stop panning/InteractionHandler from interfering on the SAME element
            e.stopImmediatePropagation();
            
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const point = this._getCursorDrawingPoint(x, y);
            if (!point) return;

            if (this.drawingStore.inProgress) {
                // Second click of click-move-click
                this._drawingDown = false;
                this.drawingStore.commitDrawing();
                const tool = this.drawingStore.activeTool;
                if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') {
                    this.drawingStore.setTool('cursor');
                    if (this._container) this._container.style.cursor = 'crosshair';
                }
                this._dirtyMain = true;
                return;
            }

            // Start drawing
            this.drawingStore.startDrawing(this.drawingStore.activeTool, point);
            this._drawingDown = true;
            this._dirtyMain = true;
        };

        const onDrawMouseUp = (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (this.drawingStore.activeTool === 'cursor') return;
            e.stopImmediatePropagation();

            if (this._drawingDown && this.drawingStore.inProgress) {
                const d = this.drawingStore.inProgress as any;
                const isDegenerate = Math.abs(d.p1.barIndex - d.p2.barIndex) < 0.5 && Math.abs(d.p1.price - d.p2.price) < 1e-9;
                
                // If they dragged, commit. If they just clicked, leave it inProgress for click-move-click
                if (!isDegenerate) {
                    this._drawingDown = false;
                    this.drawingStore.commitDrawing();
                    const tool = this.drawingStore.activeTool;
                    if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') {
                        this.drawingStore.setTool('cursor');
                        if (this._container) this._container.style.cursor = 'crosshair';
                    }
                    this._dirtyMain = true;
                }
            }
        };

        const onDrawMouseMove = (e: MouseEvent) => {
            if (this.drawingStore.activeTool === 'cursor') return;
            
            // Stop InteractionHandler from panning
            e.stopImmediatePropagation();
            
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Only update preview if drawing is in progress
            if (this._drawingDown && this.drawingStore.inProgress) {
                const point = this._getCursorDrawingPoint(x, y);
                if (point) this.drawingStore.updatePreview(point);
                this._dirtyMain = true;
            }
        };

        const onDrawTouchStart = (e: TouchEvent) => {
            if (this.drawingStore.activeTool === 'cursor') return;
            if (e.touches.length !== 1) return;
            
            e.stopImmediatePropagation();
            
            const rect = container.getBoundingClientRect();
            const x = e.touches[0].clientX - rect.left;
            const y = e.touches[0].clientY - rect.top;

            const point = this._getCursorDrawingPoint(x, y);
            if (!point) return;

            if (this.drawingStore.inProgress) {
                this._drawingDown = false;
                this.drawingStore.commitDrawing();
                const tool = this.drawingStore.activeTool;
                if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') {
                    this.drawingStore.setTool('cursor');
                }
                this._dirtyMain = true;
                return;
            }

            this.drawingStore.startDrawing(this.drawingStore.activeTool, point);
            this._drawingDown = true;
            this._dirtyMain = true;
        };

        const onDrawTouchMove = (e: TouchEvent) => {
            if (this.drawingStore.activeTool === 'cursor') return;
            if (e.touches.length !== 1) return;
            
            // Stop InteractionHandler from panning
            e.stopImmediatePropagation();
            // Prevent native browser scrolling while drawing
            e.preventDefault();
            
            if (this._drawingDown && this.drawingStore.inProgress) {
                const rect = container.getBoundingClientRect();
                const x = e.touches[0].clientX - rect.left;
                const y = e.touches[0].clientY - rect.top;
                
                const point = this._getCursorDrawingPoint(x, y);
                if (point) this.drawingStore.updatePreview(point);
                this._dirtyMain = true;
            }
        };

        const onDrawTouchEnd = (e: TouchEvent) => {
            if (this.drawingStore.activeTool === 'cursor') return;
            e.stopImmediatePropagation();

            if (this._drawingDown && this.drawingStore.inProgress) {
                const d = this.drawingStore.inProgress as any;
                const isDegenerate = Math.abs(d.p1.barIndex - d.p2.barIndex) < 0.5 && Math.abs(d.p1.price - d.p2.price) < 1e-9;
                
                if (!isDegenerate) {
                    this._drawingDown = false;
                    this.drawingStore.commitDrawing();
                    const tool = this.drawingStore.activeTool;
                    if (tool === 'horizontal' || tool === 'vertical' || tool === 'text') {
                        this.drawingStore.setTool('cursor');
                    }
                    this._dirtyMain = true;
                }
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.drawingStore.selectedId) {
                    this.drawingStore.deleteSelected();
                    this._dirtyMain = true;
                }
            } else if (e.key === 'Escape') {
                this.drawingStore.cancelDrawing();
                this.drawingStore.setTool('cursor');
                if (this._container) this._container.style.cursor = 'crosshair';
                this._dirtyMain = true;
            }
        };

        // Register them first
        container.addEventListener('mousedown', onDrawMouseDown, true);
        window.addEventListener('mousemove', onDrawMouseMove, true);
        window.addEventListener('mouseup', onDrawMouseUp, true);
        container.addEventListener('touchstart', onDrawTouchStart, true);
        window.addEventListener('touchmove', onDrawTouchMove, { capture: true, passive: false });
        window.addEventListener('touchend', onDrawTouchEnd, true);
        window.addEventListener('keydown', onKeyDown);
        (this as any)._drawListeners = { onDrawMouseDown, onDrawMouseMove, onDrawMouseUp, onDrawTouchStart, onDrawTouchMove, onDrawTouchEnd, onKeyDown, container };

        // ─── Setup InteractionHandler ────────────────────────────────────────────────
        this.interactionHandler = new InteractionHandler(container, {
            hitTest: (x, y) => {
                const chartW = this.paneManager.totalWidth - this.config.priceAxisWidth;
                if (x > chartW) return 'price';
                const chartH = this.paneManager.totalHeight - this.config.timeAxisHeight;
                if (y > chartH) return 'time';
                return 'main';
            },
            onPriceScaleDrag: (dy, mouseY) => {
                // Scale around the price at the current mouse Y position
                const pricePane = this.paneManager.getPaneById('price_0');
                const paneH = pricePane?.height ?? this.coordMapper.chartHeight;
                const localY = (mouseY ?? 0) - (pricePane?.yOffset ?? 0);
                const pivotPrice = this.coordMapper.priceForY(localY, paneH);
                // drag down (dy>0) → expand range (zoom out) → factor > 1
                // drag up  (dy<0) → contract range (zoom in)  → factor < 1
                const factor = Math.exp(dy * 0.008);
                this.coordMapper.scaleY(factor, pivotPrice);
                this._dirtyBg = true;
                this._dirtyMain = true;
                this._dirtyUI = true;
            },
            onPriceScaleDoubleClick: () => {
                this.coordMapper.viewState.autoScale = true;
                this.coordMapper.fitToData(this.dataStore.display);
                this._dirtyBg = true;
                this._dirtyMain = true;
                this._dirtyUI = true;
            },
            onMainDoubleClick: () => {
                this.coordMapper.viewState.autoScale = true;
                this.coordMapper.fitToData(this.dataStore.display);
                this._dirtyBg = true;
                this._dirtyMain = true;
                this._dirtyUI = true;
                this._dirtyTimeAxis = true;
            },
            onPan: (dx, dy) => {
                // If a drawing tool is active, delegate to drawing handler
                if (this.drawingStore.activeTool !== 'cursor') {
                    // In drawing mode: update the second anchor point
                    if (this._drawingDown && this.drawingStore.inProgress) {
                        const point = this._getCursorDrawingPoint(this.crosshair.x, this.crosshair.y);
                        if (point) this.drawingStore.updatePreview(point);
                        this._dirtyMain = true;
                    }
                    return; // don't pan chart
                }

                // Stop any ongoing animation when user grabs
                this._velocityX = 0;
                this._isDragging = true;

                // Apply rubber-band resistance if OOB
                let effectiveDx = dx;
                const totalBars = this.dataStore.display.length;
                const oob = this.coordMapper.getOutOfBoundsOffset(totalBars);
                if (oob !== 0) {
                    effectiveDx *= this.config.rubberBandFactor;
                }

                this.coordMapper.pan(effectiveDx, totalBars);
                if (this.coordMapper.viewState.autoScale) {
                    this.coordMapper.fitToData(this.dataStore.display);
                } else {
                    // Only pan vertically on main chart if autoScale is already off
                    const pricePane = this.paneManager.getPaneById('price_0');
                    const paneH = pricePane?.height ?? this.coordMapper.chartHeight;
                    this.coordMapper.panY(dy, paneH);
                }
                
                this._dirtyBg = true;
                this._dirtyMain = true;
                this._dirtyUI = true;
                this._dirtyTimeAxis = true;
            },
            onZoom: (factor, pivotX) => {
                this._velocityX = 0; // stop momentum on zoom
                this.coordMapper.zoom(factor, pivotX, this.dataStore.display.length);
                if (this.coordMapper.viewState.autoScale) {
                    this.coordMapper.fitToData(this.dataStore.display);
                }
                this._dirtyBg = true;
                this._dirtyMain = true;
                this._dirtyUI = true;
            },
            onCrosshairMove: (x, y) => {
                const pane = this.paneManager.getPaneByY(y);
                const nearestIdx = this.coordMapper.nearestBarIndex(x);
                const pricePane = this.paneManager.getPaneById('price_0');
                const localY = y - (pane?.yOffset ?? 0);
                const paneH = pricePane?.height ?? this.coordMapper.chartHeight;
                // Always compute price from the price pane's coordinate space
                const price = this.coordMapper.priceForY(y - (pricePane?.yOffset ?? 0), paneH);

                this.crosshair = {
                    visible: true,
                    x, y,
                    barIndex: nearestIdx,
                    price,
                    paneId: pane?.id || '',
                };

                // Update drawing preview while dragging second anchor
                if (this.drawingStore.inProgress) {
                    const point = this._getCursorDrawingPoint(x, y);
                    if (point) this.drawingStore.updatePreview(point);
                    this._dirtyMain = true;
                }

                const bar = this.dataStore.getBarAtIndex(nearestIdx);
                if (bar && this.callbacks.onCrosshairMove) {
                    const bars = this.dataStore.display;
                    const prevClose = nearestIdx > 0 ? bars[nearestIdx - 1]?.close ?? null : null;
                    this.callbacks.onCrosshairMove({
                        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
                        volume: bar.volume, prevClose, time: bar.time,
                    });
                }

                this._dirtyUI = true;
            },
            onCrosshairLeave: () => {
                this.crosshair.visible = false;
                const bars = this.dataStore.display;
                if (bars.length > 0 && this.callbacks.onOverlayUpdate) {
                    const last = bars[bars.length - 1];
                    const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : null;
                    this.callbacks.onOverlayUpdate({
                        open: last.open, high: last.high, low: last.low, close: last.close,
                        volume: last.volume, prevClose, time: last.time,
                    });
                }
                this._dirtyUI = true;
            },
            onDragEnd: (velocityPxPerMs) => {
                // Handled natively by onDrawMouseUp / onDrawTouchEnd now.
                // We just do nothing here for drawings, InteractionHandler only manages panning.
                
                this._drawingDown = false;
                this._isDragging = false;

                if (!this.config.kineticEnabled) {
                    // If kinetic disabled, just clamp
                    this.coordMapper.clampToBounds(this.dataStore.display.length);
                    this._dirtyBg = true;
                    this._dirtyMain = true;
                    return;
                }

                // Start momentum animation if velocity is significant
                this._velocityX = velocityPxPerMs;
                const oob = this.coordMapper.getOutOfBoundsOffset(this.dataStore.display.length);

                if (Math.abs(velocityPxPerMs) > 0.05 || Math.abs(oob) > 0.5) {
                    this._isAnimating = true;
                    this._lastFrameTime = performance.now();
                }
            },
            onRedraw: () => { /* no-op — dirty flags handle rendering */ },
        });

        // Initial layout
        this._doLayout();

        // ResizeObserver
        const ro = new ResizeObserver(() => {
            this._doLayout();
            this._dirtyBg = true;
            this._dirtyMain = true;
            this._dirtyUI = true;
        });
        ro.observe(container);
        (this as any)._resizeObserver = ro;

        // ─── Drawing tool: mousedown/touch start intercept ──────────────────
        // Start persistent rAF loop
        this._running = true;
        this._tick();
    }

    destroy(): void {
        this._running = false;
        if (this.interactionHandler) {
            this.interactionHandler.destroy();
            this.interactionHandler = null as any;
        }
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
        if ((this as any)._resizeObserver) {
            (this as any)._resizeObserver.disconnect();
        }
        if ((this as any)._drawListeners) {
            const l = (this as any)._drawListeners;
            if (l.container) {
                l.container.removeEventListener('mousedown', l.onDrawMouseDown, true);
                l.container.removeEventListener('touchstart', l.onDrawTouchStart, true);
            }
            window.removeEventListener('mousemove', l.onDrawMouseMove, true);
            window.removeEventListener('mouseup', l.onDrawMouseUp, true);
            window.removeEventListener('touchmove', l.onDrawTouchMove, true);
            window.removeEventListener('touchend', l.onDrawTouchEnd, true);
            window.removeEventListener('keydown', l.onKeyDown);
        }
        if (this._timeAxisCanvas) {
            this._timeAxisCanvas.remove();
            this._timeAxisCanvas = null;
            this._timeAxisCtx = null;
        }
        this.paneManager.destroy();
        this._container = null;
    }

    // ─── Drawing API ─────────────────────────────────────────────────────────────

    setDrawingTool(tool: DrawingToolType): void {
        this.drawingStore.setTool(tool);
        if (this._container) {
            this._container.style.cursor = tool === 'cursor' ? 'crosshair' : 'crosshair';
        }
        this._dirtyUI = true;
        this._dirtyMain = true; // Force main render to update debug text
    }

    clearDrawings(): void {
        this.drawingStore.deleteAll();
        this._dirtyMain = true;
    }

    deleteSelectedDrawing(): void {
        this.drawingStore.deleteSelected();
        this._dirtyMain = true;
    }

    private _getCursorDrawingPoint(x: number, y: number): DrawingPoint | null {
        const pricePane = this.paneManager.getPaneById('price_0');
        if (!pricePane) return null;
        const paneH = pricePane.height;
        const localY = y - pricePane.yOffset;
        if (localY < 0 || localY > paneH) return null;
        const barIndex = this.coordMapper.nearestBarIndex(x);
        const price = this.coordMapper.priceForY(localY, paneH);
        return { barIndex, price };
    }

    // ─── Layout ─────────────────────────────────────────────────────────────────

    private _doLayout(): void {
        if (!this._container) return;
        const rect = this._container.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;

        if (w <= 0 || h <= 0) return; // not visible yet

        // Determine which panes we need
        const paneConfigs: { id: string; type: PaneType; heightFraction: number }[] = [];

        let priceFraction = 0.75;
        const hasRSI = this.indicators.some(i => i.type === 'rsi' && i.enabled);
        const hasCVD = this.indicators.some(i => i.type === 'cvd' && i.enabled);

        if (hasRSI && hasCVD) priceFraction = 0.50;
        else if (hasRSI || hasCVD) priceFraction = 0.60;

        paneConfigs.push({ id: 'price_0', type: 'price', heightFraction: priceFraction });
        paneConfigs.push({ id: 'volume_0', type: 'volume', heightFraction: 0.15 });

        if (hasRSI) {
            paneConfigs.push({ id: 'rsi_0', type: 'rsi', heightFraction: 0.15 });
        }
        if (hasCVD) {
            paneConfigs.push({ id: 'cvd_0', type: 'cvd', heightFraction: 0.15 });
        }

        const chartH = h - this.config.timeAxisHeight;
        this.paneManager.setupPanes(paneConfigs);
        this.paneManager.layout(w, chartH);

        // Time axis canvas
        if (this._timeAxisCanvas && this._timeAxisCtx) {
            const dpr = window.devicePixelRatio || 1;
            this._timeAxisCanvas.style.top = chartH + 'px';
            this._timeAxisCanvas.style.width = w + 'px';
            this._timeAxisCanvas.style.height = this.config.timeAxisHeight + 'px';

            const bufW = Math.floor(w * dpr);
            const bufH = Math.floor(this.config.timeAxisHeight * dpr);
            if (this._timeAxisCanvas.width !== bufW || this._timeAxisCanvas.height !== bufH) {
                this._timeAxisCanvas.width = bufW;
                this._timeAxisCanvas.height = bufH;
            }
            this._timeAxisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // Update coord mapper size (use price pane dimensions)
        const pricePane = this.paneManager.getPaneById('price_0');
        if (pricePane) {
            this.coordMapper.setSize(w, pricePane.height);
        }
    }

    // ─── Data ───────────────────────────────────────────────────────────────────

    setData(bars: OHLCVBar[], isInitial: boolean = true): void {
        this.dataStore.setRaw(bars);
        this.dataStore.recompute(this.config.chartType, this.config.rangeSize, this.config.renkoBrickSize);
        this._recomputeIndicators();

        if (isInitial) {
            this.coordMapper.setInitialView(this.dataStore.display.length);
        }

        this.coordMapper.fitToData(this.dataStore.display);

        const display = this.dataStore.display;
        if (display.length > 0 && this.callbacks.onOverlayUpdate) {
            const last = display[display.length - 1];
            const prevClose = display.length >= 2 ? display[display.length - 2].close : null;
            this.callbacks.onOverlayUpdate({
                open: last.open, high: last.high, low: last.low, close: last.close,
                volume: last.volume, prevClose, time: last.time,
            });
        }

        if (display.length > 0 && this.callbacks.onPriceUpdate) {
            this.callbacks.onPriceUpdate(display[display.length - 1].close);
        }

        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
        this._dirtyTimeAxis = true;
    }

    updateLastBar(price: number): void {
        this.dataStore.updateLastBar(price);
        // Only re-fit Y axis if autoScale is enabled — otherwise preserve user's manual scale
        if (this.coordMapper.viewState.autoScale) {
            this.coordMapper.fitToData(this.dataStore.display);
        }

        if (this.callbacks.onPriceUpdate) {
            this.callbacks.onPriceUpdate(price);
        }

        if (!this.crosshair.visible) {
            const bars = this.dataStore.display;
            if (bars.length > 0 && this.callbacks.onOverlayUpdate) {
                const last = bars[bars.length - 1];
                const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : null;
                this.callbacks.onOverlayUpdate({
                    open: last.open, high: last.high, low: last.low, close: last.close,
                    volume: last.volume, prevClose, time: last.time,
                });
            }
        }

        this._dirtyMain = true;
        this._dirtyUI = true;
        this._dirtyTimeAxis = true;
    }

    // ─── Settings ───────────────────────────────────────────────────────────────

    setIntervalStr(interval: string): void {
        this._intervalStr = interval;
        this._dirtyUI = true;
    }

    setChartType(type: ChartType): void {
        this.config.chartType = type;
        this.dataStore.recompute(type, this.config.rangeSize, this.config.renkoBrickSize);
        this._recomputeIndicators();
        this.coordMapper.setInitialView(this.dataStore.display.length);
        this.coordMapper.fitToData(this.dataStore.display);
        this._doLayout();
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
        this._dirtyTimeAxis = true;
    }

    setRangeSize(size: number): void {
        this.config.rangeSize = size;
        if (this.config.chartType === 'range') {
            this.dataStore.recompute('range', size, this.config.renkoBrickSize);
            this._recomputeIndicators();
            this.coordMapper.setInitialView(this.dataStore.display.length);
            this.coordMapper.fitToData(this.dataStore.display);
            this._dirtyBg = true;
            this._dirtyMain = true;
            this._dirtyUI = true;
        }
    }

    setRenkoBrickSize(size: number): void {
        this.config.renkoBrickSize = size;
        if (this.config.chartType === 'renko') {
            this.dataStore.recompute('renko', this.config.rangeSize, size);
            this._recomputeIndicators();
            this.coordMapper.setInitialView(this.dataStore.display.length);
            this.coordMapper.fitToData(this.dataStore.display);
            this._dirtyBg = true;
            this._dirtyMain = true;
            this._dirtyUI = true;
        }
    }

    setTheme(theme: TerminalTheme): void {
        this.theme = theme;
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
    }

    setIndicators(indicators: IndicatorConfig[]): void {
        this.indicators = indicators;
        this._recomputeIndicators();
        this._doLayout();
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
    }

    setPosition(position: ActivePosition | null): void {
        this.activePosition = position;
        this._dirtyMain = true;
        this._dirtyUI = true;
    }

    setIsIntraday(isIntraday: boolean): void {
        this.isIntraday = isIntraday;
    }

    // ─── Indicator Recomputation ────────────────────────────────────────────────

    private _recomputeIndicators(): void {
        this.dataStore.maData.clear();
        this.dataStore.rsiData.clear();

        for (const ind of this.indicators) {
            if (!ind.enabled) continue;

            switch (ind.type) {
                case 'moving_average':
                    this.dataStore.computeMA(ind.id, ind as MovingAverageConfig);
                    break;
                case 'rsi':
                    this.dataStore.computeRSI(ind.id, ind as RSIConfig);
                    break;
                case 'cvd':
                    this.dataStore.computeCVD(ind as CVDConfig);
                    break;
            }
        }
    }

    // ─── Persistent rAF Render Loop ─────────────────────────────────────────────

    private _tick = (): void => {
        if (!this._running) return;

        const now = performance.now();

        // ─── Spring Physics Step ────────────────────────────────────────────
        if (this._isAnimating && !this._isDragging && this.config.kineticEnabled) {
            const dt = Math.min(now - this._lastFrameTime, 32); // cap at ~30fps min
            this._lastFrameTime = now;

            if (dt > 0) {
                this._stepPhysics(dt);
            }
        }

        // ─── Continuous UI Updates ──────────────────────────────────────────
        // Check countdown timer update every frame (independent of physics)
        let currentCountdown = '';
        if (this.config.chartType === 'candlestick' && this.dataStore.display.length > 0) {
            const lastBar = this.dataStore.display[this.dataStore.display.length - 1];
            currentCountdown = this._computeCountdown(lastBar.time);
        }
        if (currentCountdown !== this._lastCountdown) {
            this._lastCountdown = currentCountdown;
            this._dirtyUI = true;
        }

        // ─── Render dirty layers ────────────────────────────────────────────
        if (this._dirtyBg || this._dirtyMain || this._dirtyUI) {
            this._render();
        }

        this._rafId = requestAnimationFrame(this._tick);
    };

    // ─── Spring Physics Simulation Step ─────────────────────────────────────────

    private _stepPhysics(dtMs: number): void {
        const totalBars = this.dataStore.display.length;
        const oob = this.coordMapper.getOutOfBoundsOffset(totalBars);
        const cfg = this.config;

        // Convert velocity to index units for physics calculation
        // but keep it in px/ms for consistency
        const dtSec = dtMs / 1000;

        if (Math.abs(oob) > 0.01) {
            // ─── Out of Bounds: Spring Force ─────────────────────────────────
            // F = -k * x - c * v  (spring + damping)
            // a = F / m
            // We work in "pixels" for velocity and "index" for displacement
            // Convert oob (index units) to pixel displacement
            const oobPx = (oob / this.coordMapper.barsVisible) * this.coordMapper.chartWidth;

            const springForce = -cfg.springStiffness * oobPx;
            const dampingForce = -cfg.springDamping * (this._velocityX * 1000); // convert px/ms to px/s
            const accel = (springForce + dampingForce) / cfg.springMass;

            // Update velocity (px/s → px/ms)
            this._velocityX += (accel * dtSec) / 1000;

            // Apply displacement
            const displacementPx = this._velocityX * dtMs;
            this.coordMapper.pan(displacementPx, totalBars);

        } else {
            // ─── In Bounds: Exponential Friction ─────────────────────────────
            // Each frame, velocity *= friction^(dt_normalized)
            const framesEquiv = dtMs / 16.67; // normalize to 60fps
            this._velocityX *= Math.pow(cfg.kineticFriction, framesEquiv);

            // Apply displacement
            const displacementPx = this._velocityX * dtMs;
            this.coordMapper.pan(displacementPx, totalBars);
        }

        // Auto-scale Y during animation
        if (this.coordMapper.viewState.autoScale) {
            this.coordMapper.fitToData(this.dataStore.display);
        }

        // Check if animation should stop
        const newOob = this.coordMapper.getOutOfBoundsOffset(totalBars);
        const speed = Math.abs(this._velocityX);

        if (speed < cfg.velocityThreshold / 1000 && Math.abs(newOob) < 0.3) {
            // Settled — snap exactly to bounds and stop
            this._velocityX = 0;
            this._isAnimating = false;
            if (Math.abs(newOob) > 0.01) {
                this.coordMapper.clampToBounds(totalBars);
            }
        }

        // Mark dirty
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
    }

    scheduleRender(): void {
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
        this._dirtyTimeAxis = true;
    }

    // ─── Layer-Aware Render ─────────────────────────────────────────────────────

    private _render(): void {
        const bars = this.dataStore.display;
        const theme = this.theme;
        const mapper = this.coordMapper;

        if (this._dirtyBg) {
            this.paneManager.clearAllLayer('bg');
            this._renderBgLayer(bars, theme, mapper);
            this._dirtyBg = false;
        }

        if (this._dirtyMain) {
            this.paneManager.clearAllLayer('main');
            this._renderMainLayer(bars, theme, mapper);
            this._dirtyMain = false;
        }

        if (this._dirtyUI) {
            this.paneManager.clearAllLayer('ui');
            this._renderUILayer(bars, theme, mapper);
            this._dirtyUI = false;
        }

        // Time axis — always redraw base first to clear previous crosshair labels
        if (this._timeAxisCtx && this._timeAxisCanvas) {
            // Only recompute the base labels when dirty (zoom/pan/data), but always
            // repaint to a clean state before drawing the crosshair label on top
            if (this._dirtyTimeAxis || this.crosshair.visible) {
                Renderer.drawTimeAxis(
                    this._timeAxisCtx, bars, mapper, theme,
                    this.paneManager.totalWidth, this.config.timeAxisHeight,
                    this.isIntraday,
                );
                this._dirtyTimeAxis = false;
            }

            // Crosshair time label — drawn on top of the freshly cleared time axis
            if (this.crosshair.visible) {
                const bar = this.dataStore.getBarAtIndex(this.crosshair.barIndex);
                if (bar) {
                    const x = this.crosshair.x;
                    const ts = bar.realTime || bar.time;
                    const d = new Date(ts * 1000);
                    const timeStr = this.isIntraday
                        ? `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
                        : `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`;

                    const ctx = this._timeAxisCtx;
                    const FONT = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Arial, sans-serif';
                    ctx.save();
                    ctx.font = FONT;
                    const tw = ctx.measureText(timeStr).width;
                    ctx.fillStyle = theme.crosshairColor;
                    ctx.fillRect(x - tw / 2 - 8, 1, tw + 16, this.config.timeAxisHeight - 2);
                    ctx.fillStyle = theme.background;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(timeStr, x, this.config.timeAxisHeight / 2);
                    ctx.restore();
                }
            }
        }
    }

    // ─── BG Layer ───────────────────────────────────────────────────────────────

    private _renderBgLayer(bars: any[], theme: TerminalTheme, mapper: CoordMapper): void {
        const bgCtx = this.paneManager.getContext('price_0', 'bg');
        const pricePane = this.paneManager.getPaneById('price_0');
        if (bgCtx && pricePane) {
            Renderer.drawPriceAxis(bgCtx, mapper, theme, this.paneManager.totalWidth, pricePane.height);
        }

        const volBgCtx = this.paneManager.getContext('volume_0', 'bg');
        const volPane = this.paneManager.getPaneById('volume_0');
        if (volBgCtx && volPane) {
            volBgCtx.fillStyle = theme.background;
            volBgCtx.fillRect(0, 0, this.paneManager.totalWidth, volPane.height);
            Renderer.drawPaneSeparator(volBgCtx, this.paneManager.totalWidth, theme.borderColor);

            volBgCtx.save();
            volBgCtx.font = '9px monospace';
            volBgCtx.fillStyle = theme.textColor + '60';
            volBgCtx.textAlign = 'left';
            volBgCtx.fillText('Vol', 6, 12);
            volBgCtx.restore();
        }

        const rsiBgCtx = this.paneManager.getContext('rsi_0', 'bg');
        const rsiPane = this.paneManager.getPaneById('rsi_0');
        if (rsiBgCtx && rsiPane) {
            Renderer.drawPaneSeparator(rsiBgCtx, this.paneManager.totalWidth, theme.borderColor);
        }

        const cvdBgCtx = this.paneManager.getContext('cvd_0', 'bg');
        const cvdPane = this.paneManager.getPaneById('cvd_0');
        if (cvdBgCtx && cvdPane) {
            Renderer.drawPaneSeparator(cvdBgCtx, this.paneManager.totalWidth, theme.borderColor);
        }
    }

    // ─── Main Layer ─────────────────────────────────────────────────────────────

    private _renderMainLayer(bars: any[], theme: TerminalTheme, mapper: CoordMapper): void {
        const mainCtx = this.paneManager.getContext('price_0', 'main');
        const pricePane = this.paneManager.getPaneById('price_0');
        if (mainCtx && pricePane) {
            // DEBUG TOOL TEXT
            mainCtx.save();
            mainCtx.fillStyle = 'red';
            mainCtx.font = '24px monospace';
            mainCtx.fillText(`[${this.debugText}] TOOL: ${this.drawingStore.activeTool}`, 20, 40);
            mainCtx.restore();

            switch (this.config.chartType) {
                case 'renko':
                    Renderer.drawRenko(mainCtx, bars, mapper, theme);
                    break;
                case 'line':
                    Renderer.drawLineChart(mainCtx, bars, mapper, theme);
                    break;
                case 'bars':
                    Renderer.drawBars(mainCtx, bars, mapper, theme);
                    break;
                case 'range':
                case 'candlestick':
                default:
                    Renderer.drawCandlesticks(mainCtx, bars, mapper, theme);
                    break;
            }

            // MA overlays
            this.dataStore.maData.forEach((points, id) => {
                const cfg = this.indicators.find(i => i.id === id) as MovingAverageConfig | undefined;
                if (cfg && cfg.enabled) {
                    Renderer.drawMALine(mainCtx, points, mapper, cfg.color, cfg.lineWidth, cfg.opacity);
                }
            });

            // Position lines
            if (this.activePosition) {
                Renderer.drawPositionLines(mainCtx, this.activePosition, mapper, theme, this.paneManager.totalWidth);
            }

            // Divergence markers
            const cvdCfg = this.indicators.find(i => i.type === 'cvd' && i.enabled) as CVDConfig | undefined;
            if (cvdCfg && cvdCfg.showDivergence && this.dataStore.cvdDivergences.length > 0) {
                Renderer.drawDivergenceMarkers(
                    mainCtx, this.dataStore.cvdDivergences, bars, mapper,
                    cvdCfg.bullDivColor || '#00e5ff', cvdCfg.bearDivColor || '#ff1744',
                );
            }

            // ── User drawings (trendlines, fibs, rectangles, etc.) ─────────
            const allDrawings = [
                ...this.drawingStore.drawings,
                ...(this.drawingStore.inProgress ? [this.drawingStore.inProgress] : []),
            ];
            
            // VISUAL DEBUGGER FOR DRAWINGS:
            if (allDrawings.length > 0) {
                mainCtx.save();
                mainCtx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                mainCtx.beginPath();
                mainCtx.arc(this.paneManager.totalWidth / 2, pricePane.height / 2, 100, 0, Math.PI * 2);
                mainCtx.fill();
                mainCtx.fillStyle = 'white';
                mainCtx.font = '24px sans-serif';
                mainCtx.fillText(`DRAWINGS: ${allDrawings.length}`, this.paneManager.totalWidth / 2 - 80, pricePane.height / 2);
                mainCtx.restore();
            }

            if (allDrawings.length > 0) {
                const chartW2 = this.paneManager.totalWidth - this.config.priceAxisWidth;
                Renderer.drawDrawings(mainCtx, allDrawings as any, mapper, pricePane.height, chartW2);
            }
        }

        // Volume pane
        const volCtx = this.paneManager.getContext('volume_0', 'main');
        const volPane = this.paneManager.getPaneById('volume_0');
        if (volCtx && volPane) {
            const visStart = Math.max(0, Math.floor(mapper.viewState.startIndex));
            const visEnd = Math.min(this.dataStore.volumeData.length - 1, Math.ceil(mapper.viewState.endIndex));
            let maxVol = 1;
            for (let i = visStart; i <= visEnd; i++) {
                if (this.dataStore.volumeData[i]) {
                    maxVol = Math.max(maxVol, this.dataStore.volumeData[i].value);
                }
            }

            Renderer.drawVolume(volCtx, this.dataStore.volumeData, mapper, theme, volPane.height, maxVol);
        }

        // RSI pane
        const rsiCtx = this.paneManager.getContext('rsi_0', 'main');
        const rsiPane = this.paneManager.getPaneById('rsi_0');
        if (rsiCtx && rsiPane) {
            const rsiCfg = this.indicators.find(i => i.type === 'rsi' && i.enabled) as RSIConfig | undefined;
            if (rsiCfg) {
                const rsiPoints = this.dataStore.rsiData.get(rsiCfg.id) || [];
                Renderer.drawRSI(rsiCtx, rsiPoints, mapper, theme, rsiPane.height, rsiCfg);
            }

            rsiCtx.save();
            rsiCtx.font = '9px monospace';
            rsiCtx.fillStyle = theme.textColor + '80';
            rsiCtx.textAlign = 'left';
            const rsiVal = this.dataStore.rsiData.values().next().value;
            const lastRSI = rsiVal && rsiVal.length > 0 ? rsiVal[rsiVal.length - 1].value : null;
            rsiCtx.fillText(`RSI${lastRSI !== null ? ` ${lastRSI.toFixed(1)}` : ''}`, 6, 12);
            rsiCtx.restore();
        }

        // CVD pane
        const cvdCtx = this.paneManager.getContext('cvd_0', 'main');
        const cvdPane = this.paneManager.getPaneById('cvd_0');
        if (cvdCtx && cvdPane) {
            const cvdCfgRender = this.indicators.find(i => i.type === 'cvd' && i.enabled) as CVDConfig | undefined;
            if (cvdCfgRender && this.dataStore.cvdData.length > 0) {
                Renderer.drawCVD(cvdCtx, this.dataStore.cvdData, mapper, theme, cvdPane.height, cvdCfgRender);
            }

            cvdCtx.save();
            cvdCtx.font = '9px monospace';
            cvdCtx.fillStyle = theme.textColor + '80';
            cvdCtx.textAlign = 'left';
            const lastCVD = this.dataStore.cvdData.length > 0 ? this.dataStore.cvdData[this.dataStore.cvdData.length - 1].value : null;
            const fmtCVD = lastCVD !== null ? (Math.abs(lastCVD) >= 1e6 ? `${(lastCVD / 1e6).toFixed(1)}M` : Math.abs(lastCVD) >= 1e3 ? `${(lastCVD / 1e3).toFixed(1)}K` : lastCVD.toFixed(0)) : '';
            cvdCtx.fillText(`CVD${fmtCVD ? ` ${fmtCVD}` : ''}`, 6, 12);
            cvdCtx.restore();
        }
    }

    private _computeCountdown(barTime: number): string {
        if (!this._intervalStr) return '';
        let seconds = 60;
        if (this._intervalStr.endsWith('m')) seconds = parseInt(this._intervalStr) * 60;
        else if (this._intervalStr.endsWith('h')) seconds = parseInt(this._intervalStr) * 3600;
        else if (this._intervalStr.endsWith('d')) seconds = parseInt(this._intervalStr) * 86400;

        // Next open time
        const nextOpenMs = (barTime + seconds) * 1000;
        const remainingMs = nextOpenMs - Date.now();
        if (remainingMs <= 0) return '00:00';

        const totalSecs = Math.floor(remainingMs / 1000);
        const h = Math.floor(totalSecs / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;

        if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // ─── UI Layer (Crosshair — Very Cheap) ──────────────────────────────────────

    private _renderUILayer(bars: any[], theme: TerminalTheme, mapper: CoordMapper): void {
        const pricePane = this.paneManager.getPaneById('price_0');
        const priceUiCtx = pricePane ? this.paneManager.getContext('price_0', 'ui') : null;

        // Always draw the live last-price tag on the right axis (like TradingView)
        if (priceUiCtx && pricePane && bars.length > 0) {
            const lastBar = bars[bars.length - 1];
            const prevClose = bars.length >= 2 ? bars[bars.length - 2].close : lastBar.open;
            const isUp = lastBar.close >= prevClose;
            const countdown = this.config.chartType === 'candlestick' ? this._lastCountdown : undefined;
            Renderer.drawLastPriceTag(priceUiCtx, lastBar.close, mapper, theme, pricePane.height, isUp, countdown);
        }

        // Crosshair lines (only when mouse is hovering)
        if (!this.crosshair.visible) return;

        for (const pane of this.paneManager.panes) {
            const uiCtx = this.paneManager.getContext(pane.id, 'ui');
            if (!uiCtx) continue;

            if (this.crosshair.paneId === pane.id) {
                const localY = this.crosshair.y - pane.yOffset;
                Renderer.drawCrosshair(uiCtx, this.crosshair, mapper, theme, pane.height, localY);
            } else {
                // Vertical line extends across all other panes
                uiCtx.save();
                uiCtx.setLineDash([3, 4]);
                uiCtx.strokeStyle = theme.crosshairColor;
                uiCtx.lineWidth = 0.8;
                uiCtx.globalAlpha = 0.85;
                uiCtx.beginPath();
                const sx = Math.round(this.crosshair.x) + 0.5;
                uiCtx.moveTo(sx, 0);
                uiCtx.lineTo(sx, pane.height);
                uiCtx.stroke();
                uiCtx.restore();
            }
        }
    }

    // ─── Legacy ─────────────────────────────────────────────────────────────────

    render(): void {
        this._dirtyBg = true;
        this._dirtyMain = true;
        this._dirtyUI = true;
        this._render();
    }
}

// ─── Custom Canvas Chart Engine — Types ─────────────────────────────────────────
// Shared type definitions for the zero-dependency charting engine.

import type { TerminalTheme } from '../core/TerminalThemes';
import type { IndicatorConfig, MovingAverageConfig, RSIConfig, CVDConfig } from '../../../types/indicators';

// Re-export for convenience
export type { TerminalTheme, IndicatorConfig, MovingAverageConfig, RSIConfig, CVDConfig };

// ─── Chart Types ────────────────────────────────────────────────────────────────

export type ChartType = 'candlestick' | 'range' | 'renko' | 'line' | 'bars';

// ─── Data Types ─────────────────────────────────────────────────────────────────

export interface OHLCVBar {
    time: number;        // Unix timestamp (seconds)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    realTime?: number;   // Original timestamp for Range/Renko bars
}

/**
 * RenderBar is what actually gets drawn on the canvas.
 * For candlestick mode, it's identical to OHLCVBar.
 * For Range/Renko, each bar is derived from aggregation.
 */
export interface RenderBar extends OHLCVBar {
    index: number;       // Sequential index for X-axis mapping
    isBullish: boolean;  // close >= open
}

// ─── Viewport State ─────────────────────────────────────────────────────────────

export interface ViewState {
    startIndex: number;  // First visible bar index (can be fractional for smooth pan)
    endIndex: number;    // Last visible bar index
    minPrice: number;    // Bottom of the visible price range
    maxPrice: number;    // Top of the visible price range
    autoScale: boolean;  // Whether Y-axis auto-fits to visible data
}

// ─── Pane Configuration ─────────────────────────────────────────────────────────

export type PaneType = 'price' | 'volume' | 'rsi' | 'cvd';

export interface PaneConfig {
    id: string;
    type: PaneType;
    heightFraction: number;   // e.g. 0.70 for price pane
    minHeight: number;        // px
    yOffset: number;          // computed: top pixel of this pane in container
    height: number;           // computed: pixel height of this pane
}

// ─── Crosshair State ────────────────────────────────────────────────────────────

export interface CrosshairState {
    visible: boolean;
    x: number;           // pixel X in container
    y: number;           // pixel Y in container
    barIndex: number;    // nearest bar index
    price: number;       // price at cursor
    paneId: string;      // which pane the cursor is in
}

// ─── Rendered Indicator Data ────────────────────────────────────────────────────

export interface IndicatorPoint {
    index: number;
    value: number;
}

// ─── Active Position Lines ──────────────────────────────────────────────────────

export interface ActivePosition {
    entryPrice: number;
    tpPrice?: number;
    slPrice?: number;
    mode: 'long' | 'short';
}

// ─── OHLCV Overlay (for header display) ─────────────────────────────────────────

export interface OHLCVOverlay {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    prevClose: number | null;
    time?: number;
}

// ─── Engine Configuration ───────────────────────────────────────────────────────

export interface EngineConfig {
    chartType: ChartType;
    rangeSize: number;        // For range bars (e.g. 1.0 = $1 per bar)
    renkoBrickSize: number;   // For renko (e.g. 0.5 = $0.50 per brick)
    rightMargin: number;      // Bars of empty space on right (default: 15)
    priceAxisWidth: number;   // px width of price axis area (default: 70)
    timeAxisHeight: number;   // px height of time axis area (default: 28)
    minBarWidth: number;      // px (default: 2)
    maxBarWidth: number;      // px (default: 40)
    // ─── Kinetic Scrolling (Spring Physics) ─────────────────────────────────
    kineticEnabled: boolean;       // Enable momentum scrolling
    springStiffness: number;       // k — how strongly OOB snaps back (default: 180)
    springDamping: number;         // c — friction coefficient (default: 18)
    springMass: number;            // m — inertial mass (default: 1)
    kineticFriction: number;       // exponential decay per frame while in-bounds (default: 0.94)
    velocityThreshold: number;     // minimum velocity to keep animating (default: 0.08)
    rubberBandFactor: number;      // resistance when dragging OOB (0-1, default: 0.35)
    oobLeftLimit: number;          // max bars beyond left edge (default: -30)
    oobRightExtra: number;         // extra bars beyond right edge (default: 40)
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
    chartType: 'candlestick',
    rangeSize: 1.0,
    renkoBrickSize: 0.5,
    rightMargin: 15,
    priceAxisWidth: 70,
    timeAxisHeight: 28,
    minBarWidth: 2,
    maxBarWidth: 40,
    // Kinetic defaults (iOS-like feel)
    kineticEnabled: true,
    springStiffness: 180,
    springDamping: 18,
    springMass: 1,
    kineticFriction: 0.94,
    velocityThreshold: 0.08,
    rubberBandFactor: 0.35,
    oobLeftLimit: -30,
    oobRightExtra: 40,
};

// ─── CoordMapper — Coordinate Transform ─────────────────────────────────────────
// Bidirectional mapping between data space (index + price) and pixel space.
// Manages zoom/pan state via ViewState.
// Supports rubber-band out-of-bounds (OOB) for spring physics.

import type { ViewState, RenderBar, EngineConfig } from './types';
import { DEFAULT_ENGINE_CONFIG } from './types';

export class CoordMapper {
    viewState: ViewState;
    canvasWidth: number = 0;
    canvasHeight: number = 0;
    config: EngineConfig;

    constructor(config?: Partial<EngineConfig>) {
        this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
        this.viewState = {
            startIndex: 0,
            endIndex: 80,
            minPrice: 0,
            maxPrice: 100,
            autoScale: true,
        };
    }

    // ─── Set Canvas Size ────────────────────────────────────────────────────────

    setSize(width: number, height: number) {
        this.canvasWidth = width;
        this.canvasHeight = height;
    }

    // ─── Chart Area (excluding axes) ────────────────────────────────────────────

    get chartWidth(): number {
        return Math.max(1, this.canvasWidth - this.config.priceAxisWidth);
    }

    get chartHeight(): number {
        return Math.max(1, this.canvasHeight);
    }

    // ─── Bar Metrics ────────────────────────────────────────────────────────────

    get barsVisible(): number {
        return Math.max(1, this.viewState.endIndex - this.viewState.startIndex);
    }

    get barWidth(): number {
        const raw = this.chartWidth / this.barsVisible;
        return Math.max(this.config.minBarWidth, Math.min(this.config.maxBarWidth, raw));
    }

    get barBodyWidth(): number {
        return Math.max(1, this.barWidth * 0.7);
    }

    // ─── Data → Pixel ───────────────────────────────────────────────────────────

    xForIndex(index: number): number {
        const fraction = (index - this.viewState.startIndex) / this.barsVisible;
        return fraction * this.chartWidth;
    }

    yForPrice(price: number, paneHeight?: number): number {
        const h = paneHeight || this.chartHeight;
        const { minPrice, maxPrice } = this.viewState;
        const range = maxPrice - minPrice;
        if (range === 0) return h / 2;
        return h * (1 - (price - minPrice) / range);
    }

    // ─── Pixel → Data ───────────────────────────────────────────────────────────

    indexForX(x: number): number {
        const fraction = x / this.chartWidth;
        return this.viewState.startIndex + fraction * this.barsVisible;
    }

    priceForY(y: number, paneHeight?: number): number {
        const h = paneHeight || this.chartHeight;
        const { minPrice, maxPrice } = this.viewState;
        const range = maxPrice - minPrice;
        return maxPrice - (y / h) * range;
    }

    nearestBarIndex(x: number): number {
        return Math.round(this.indexForX(x));
    }

    // ─── Binary Search — O(log N) Index by Timestamp ────────────────────────────

    findIndexByTime(bars: RenderBar[], targetTime: number): number {
        if (bars.length === 0) return -1;

        let lo = 0;
        let hi = bars.length - 1;

        if (targetTime <= bars[lo].time) return lo;
        if (targetTime >= bars[hi].time) return hi;

        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const midTime = bars[mid].time;

            if (midTime === targetTime) return mid;
            if (midTime < targetTime) lo = mid + 1;
            else hi = mid - 1;
        }

        if (lo >= bars.length) return bars.length - 1;
        if (lo === 0) return 0;

        const dLo = Math.abs(bars[lo].time - targetTime);
        const dHi = Math.abs(bars[lo - 1].time - targetTime);
        return dLo < dHi ? lo : lo - 1;
    }

    getVisibleRange(totalBars: number): { start: number; end: number } {
        return {
            start: Math.max(0, Math.floor(this.viewState.startIndex) - 1),
            end: Math.min(totalBars - 1, Math.ceil(this.viewState.endIndex) + 1),
        };
    }

    // ─── Bounds ─────────────────────────────────────────────────────────────────

    /** Returns the "ideal" left/right bounds — used for OOB calculations. */
    getBounds(totalBars: number): { minStart: number; maxEnd: number } {
        return {
            minStart: this.config.oobLeftLimit,
            maxEnd: totalBars + this.config.rightMargin,
        };
    }

    /**
     * Returns how far the viewport is beyond the ideal bounds (in index units).
     * Negative = over the left edge, positive = over the right edge, 0 = in bounds.
     */
    getOutOfBoundsOffset(totalBars: number): number {
        const { minStart, maxEnd } = this.getBounds(totalBars);
        const currentRange = this.barsVisible;

        if (this.viewState.startIndex < minStart) {
            return this.viewState.startIndex - minStart; // negative
        }
        if (this.viewState.endIndex > maxEnd) {
            return this.viewState.endIndex - maxEnd; // positive
        }
        return 0;
    }

    // ─── Pan (no hard clamping — allows OOB for rubber-band) ────────────────────

    pan(deltaPx: number, totalBars: number): void {
        const deltaIndex = -(deltaPx / this.chartWidth) * this.barsVisible;
        this.viewState.startIndex += deltaIndex;
        this.viewState.endIndex += deltaIndex;
        // No clamping here — ChartEngine's spring physics will handle OOB snap-back
    }

    /** Hard-clamp to bounds (used by spring physics to settle exactly at boundary) */
    clampToBounds(totalBars: number): void {
        const { minStart, maxEnd } = this.getBounds(totalBars);
        const range = this.barsVisible;

        if (this.viewState.startIndex < minStart) {
            this.viewState.startIndex = minStart;
            this.viewState.endIndex = minStart + range;
        }
        if (this.viewState.endIndex > maxEnd) {
            this.viewState.endIndex = maxEnd;
            this.viewState.startIndex = maxEnd - range;
        }
    }

    // ─── Zoom ───────────────────────────────────────────────────────────────────

    zoom(factor: number, pivotX: number, totalBars: number): void {
        const pivotIndex = this.indexForX(pivotX);
        const currentRange = this.barsVisible;
        const newRange = Math.max(5, Math.min(totalBars + 50, currentRange * factor));

        const pivotFraction = (pivotX / this.chartWidth);
        this.viewState.startIndex = pivotIndex - newRange * pivotFraction;
        this.viewState.endIndex = pivotIndex + newRange * (1 - pivotFraction);

        // Soft clamp for zoom (don't allow extreme OOB via zoom)
        const { minStart, maxEnd } = this.getBounds(totalBars);
        if (this.viewState.startIndex < minStart) {
            this.viewState.endIndex += (minStart - this.viewState.startIndex);
            this.viewState.startIndex = minStart;
        }
        if (this.viewState.endIndex > maxEnd) {
            this.viewState.startIndex -= (this.viewState.endIndex - maxEnd);
            this.viewState.endIndex = maxEnd;
        }
    }

    // ─── Y-Axis Scaling & Panning ───────────────────────────────────────────────

    /**
     * Scale the Y axis around a pivot price (mouse position on price axis).
     * factor > 1 → expand (zoom out), factor < 1 → contract (zoom in).
     * @param factor Multiplicative scale factor.
     * @param pivotPrice The price to keep fixed while scaling (default: midpoint).
     */
    scaleY(factor: number, pivotPrice?: number): void {
        this.viewState.autoScale = false;
        const range = this.viewState.maxPrice - this.viewState.minPrice;
        if (range <= 0) return;
        // Clamp factor so range never collapses to zero or explodes
        const newRange = Math.max(range * 0.001, Math.min(range * 1000, range * factor));
        const anchor = pivotPrice ?? (this.viewState.maxPrice + this.viewState.minPrice) / 2;
        // Keep anchor price at the same relative position
        const anchorFrac = (this.viewState.maxPrice - anchor) / range;
        this.viewState.maxPrice = anchor + anchorFrac * newRange;
        this.viewState.minPrice = this.viewState.maxPrice - newRange;
    }

    /**
     * Pan the Y axis by deltaPx pixels.
     * Positive dy (mouse moved down) → chart shifts down → shows lower prices.
     */
    panY(deltaPx: number, paneHeight?: number): void {
        this.viewState.autoScale = false;
        const range = this.viewState.maxPrice - this.viewState.minPrice;
        const h = paneHeight || this.chartHeight || 1;
        // positive deltaPx = mouse dragged down = chart content moves down = prices go up
        const priceDelta = (deltaPx / h) * range;
        this.viewState.minPrice += priceDelta;
        this.viewState.maxPrice += priceDelta;
    }

    // ─── Auto-scale Y ───────────────────────────────────────────────────────────

    fitToData(bars: RenderBar[], padding: number = 0.05): void {
        const start = Math.max(0, Math.floor(this.viewState.startIndex));
        const end = Math.min(bars.length - 1, Math.ceil(this.viewState.endIndex));

        if (start > end || bars.length === 0) return;

        let min = Infinity;
        let max = -Infinity;

        for (let i = start; i <= end; i++) {
            if (i < 0 || i >= bars.length) continue;
            min = Math.min(min, bars[i].low);
            max = Math.max(max, bars[i].high);
        }

        if (min === Infinity || max === -Infinity) return;

        const range = max - min || 1;
        this.viewState.minPrice = min - range * padding;
        this.viewState.maxPrice = max + range * padding;
    }

    // ─── Initial View ───────────────────────────────────────────────────────────

    setInitialView(totalBars: number, visibleCount: number = 80): void {
        this.viewState.startIndex = Math.max(0, totalBars - visibleCount);
        this.viewState.endIndex = totalBars + this.config.rightMargin;
    }
}

// ─── InteractionHandler — Mouse/Touch/Wheel Events ──────────────────────────────
// Captures user interactions and translates them into chart actions
// (panning, zooming, crosshair position updates).
// Includes velocity tracking for kinetic scrolling momentum.

import type { CrosshairState } from './types';

export interface InteractionCallbacks {
    hitTest?: (x: number, y: number) => 'main' | 'price' | 'time';
    onPan: (dx: number, dy: number) => void;
    onPriceScaleDrag?: (dy: number, mouseY: number) => void;
    onPriceScaleDoubleClick?: () => void;
    onMainDoubleClick?: () => void;
    onZoom: (factor: number, pivotX: number) => void;
    onCrosshairMove: (x: number, y: number) => void;
    onCrosshairLeave: () => void;
    onDragEnd: (velocityPxPerMs: number) => void;  // velocity at release for momentum
    onRedraw: () => void;
}

// Velocity sampling: store last N position+time samples
interface VelocitySample {
    x: number;
    time: number; // performance.now() ms
}

const VELOCITY_BUFFER_SIZE = 5;

export class InteractionHandler {
    private container: HTMLDivElement;
    private callbacks: InteractionCallbacks;

    // Pan state
    private isPanning: boolean = false;
    private dragMode: 'main' | 'price' | 'time' | null = null;
    private lastPanX: number = 0;
    private lastPanY: number = 0;

    // Velocity tracking for kinetic momentum
    private velocityBuffer: VelocitySample[] = [];

    // Pinch-to-zoom state (touch)
    private lastPinchDist: number = 0;
    private isTouching: boolean = false;
    private touchCount: number = 0;

    // Bound event handlers (for cleanup)
    private _onMouseDown: (e: MouseEvent) => void;
    private _onMouseMove: (e: MouseEvent) => void;
    private _onMouseUp: (e: MouseEvent) => void;
    private _onMouseLeave: (e: MouseEvent) => void;
    private _onWheel: (e: WheelEvent) => void;
    private _onTouchStart: (e: TouchEvent) => void;
    private _onTouchMove: (e: TouchEvent) => void;
    private _onTouchEnd: (e: TouchEvent) => void;
    private _onContextMenu: (e: Event) => void;
    private _onDoubleClick: (e: MouseEvent) => void;

    constructor(container: HTMLDivElement, callbacks: InteractionCallbacks) {
        this.container = container;
        this.callbacks = callbacks;

        // Bind handlers
        this._onMouseDown = this.handleMouseDown.bind(this);
        this._onMouseMove = this.handleMouseMove.bind(this);
        this._onMouseUp = this.handleMouseUp.bind(this);
        this._onMouseLeave = this.handleMouseLeave.bind(this);
        this._onWheel = this.handleWheel.bind(this);
        this._onTouchStart = this.handleTouchStart.bind(this);
        this._onTouchMove = this.handleTouchMove.bind(this);
        this._onTouchEnd = this.handleTouchEnd.bind(this);
        this._onContextMenu = (e: Event) => e.preventDefault();
        this._onDoubleClick = this.handleDoubleClick.bind(this);

        this.attach();
    }

    // ─── Attach / Detach ────────────────────────────────────────────────────────

    private attach(): void {
        const el = this.container;
        el.addEventListener('mousedown', this._onMouseDown);
        el.addEventListener('mousemove', this._onMouseMove);
        el.addEventListener('mouseup', this._onMouseUp);
        el.addEventListener('mouseleave', this._onMouseLeave);
        el.addEventListener('wheel', this._onWheel, { passive: false });
        el.addEventListener('touchstart', this._onTouchStart, { passive: false });
        el.addEventListener('touchmove', this._onTouchMove, { passive: false });
        el.addEventListener('touchend', this._onTouchEnd);
        el.addEventListener('contextmenu', this._onContextMenu);
        el.addEventListener('dblclick', this._onDoubleClick);

        // Also listen for mouseup on window (in case user drags outside container)
        window.addEventListener('mouseup', this._onMouseUp);
    }

    destroy(): void {
        const el = this.container;
        el.removeEventListener('mousedown', this._onMouseDown);
        el.removeEventListener('mousemove', this._onMouseMove);
        el.removeEventListener('mouseup', this._onMouseUp);
        el.removeEventListener('mouseleave', this._onMouseLeave);
        el.removeEventListener('wheel', this._onWheel);
        el.removeEventListener('touchstart', this._onTouchStart);
        el.removeEventListener('touchmove', this._onTouchMove);
        el.removeEventListener('touchend', this._onTouchEnd);
        el.removeEventListener('contextmenu', this._onContextMenu);
        el.removeEventListener('dblclick', this._onDoubleClick);
        window.removeEventListener('mouseup', this._onMouseUp);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private getRelativeCoords(e: MouseEvent): { x: number; y: number } {
        const rect = this.container.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }

    private getTouchRelativeCoords(touch: Touch): { x: number; y: number } {
        const rect = this.container.getBoundingClientRect();
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
        };
    }

    private getPinchDistance(t1: Touch, t2: Touch): number {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ─── Velocity Tracking ──────────────────────────────────────────────────────

    private recordVelocitySample(clientX: number): void {
        const now = performance.now();
        this.velocityBuffer.push({ x: clientX, time: now });
        // Keep only the latest N samples
        if (this.velocityBuffer.length > VELOCITY_BUFFER_SIZE) {
            this.velocityBuffer.shift();
        }
    }

    /** Calculate velocity in px/ms from recent samples */
    private computeVelocity(): number {
        if (this.velocityBuffer.length < 2) return 0;

        // Use the oldest and newest samples for a stable velocity estimate
        const oldest = this.velocityBuffer[0];
        const newest = this.velocityBuffer[this.velocityBuffer.length - 1];
        const dt = newest.time - oldest.time;

        if (dt < 1) return 0; // avoid division by near-zero

        return (newest.x - oldest.x) / dt; // px per ms
    }

    // ─── Mouse Events ───────────────────────────────────────────────────────────

    private handleMouseDown(e: MouseEvent): void {
        if (e.button !== 0) return; // Left button only
        const { x, y } = this.getRelativeCoords(e);
        
        this.dragMode = this.callbacks.hitTest ? this.callbacks.hitTest(x, y) : 'main';
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        
        if (this.dragMode === 'price') {
            this.container.style.cursor = 'ns-resize';
        } else if (this.dragMode === 'time') {
            this.container.style.cursor = 'ew-resize';
        } else {
            this.container.style.cursor = 'grabbing';
        }

        // Reset velocity buffer on new drag
        this.velocityBuffer = [];
        this.recordVelocitySample(e.clientX);
    }

    private handleMouseMove(e: MouseEvent): void {
        const { x, y } = this.getRelativeCoords(e);

        if (this.isPanning) {
            const dx = e.clientX - this.lastPanX;
            const dy = e.clientY - this.lastPanY;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            
            if (this.dragMode === 'price' && this.callbacks.onPriceScaleDrag) {
                this.callbacks.onPriceScaleDrag(dy, y);
            } else {
                this.callbacks.onPan(dx, dy);
                // Track velocity for momentum (only X-axis for now)
                this.recordVelocitySample(e.clientX);
            }
        }

        // Always update crosshair position
        this.callbacks.onCrosshairMove(x, y);
    }

    private handleMouseUp(_e: MouseEvent): void {
        if (this.isPanning) {
            this.isPanning = false;
            this.container.style.cursor = 'crosshair';

            // Compute release velocity and trigger momentum
            const velocity = this.computeVelocity();
            this.velocityBuffer = [];
            this.callbacks.onDragEnd(velocity);
        }
    }

    private handleMouseLeave(_e: MouseEvent): void {
        if (this.isPanning) {
            this.isPanning = false;
            this.container.style.cursor = 'crosshair';

            // Trigger momentum on leave too
            const velocity = this.computeVelocity();
            this.velocityBuffer = [];
            this.callbacks.onDragEnd(velocity);
        }
        this.callbacks.onCrosshairLeave();
    }

    private handleDoubleClick(e: MouseEvent): void {
        if (e.button !== 0) return;
        const { x, y } = this.getRelativeCoords(e);
        const mode = this.callbacks.hitTest ? this.callbacks.hitTest(x, y) : 'main';
        
        if (mode === 'price' && this.callbacks.onPriceScaleDoubleClick) {
            this.callbacks.onPriceScaleDoubleClick();
        } else if (mode === 'main' && this.callbacks.onMainDoubleClick) {
            this.callbacks.onMainDoubleClick();
        }
    }

    // ─── Wheel / Zoom ───────────────────────────────────────────────────────────

    private handleWheel(e: WheelEvent): void {
        e.preventDefault();
        const { x } = this.getRelativeCoords(e);

        // Determine zoom factor from scroll delta
        const delta = e.deltaY;
        const factor = delta > 0 ? 1.08 : 0.92; // zoom out / zoom in

        this.callbacks.onZoom(factor, x);
    }

    // ─── Touch Events ───────────────────────────────────────────────────────────

    private handleTouchStart(e: TouchEvent): void {
        e.preventDefault();
        this.touchCount = e.touches.length;

        if (e.touches.length === 1) {
            // Single touch: pan
            this.isTouching = true;
            this.lastPanX = e.touches[0].clientX;
            this.lastPanY = e.touches[0].clientY;
            
            const { x, y } = this.getTouchRelativeCoords(e.touches[0]);
            this.dragMode = this.callbacks.hitTest ? this.callbacks.hitTest(x, y) : 'main';

            // Reset velocity buffer
            this.velocityBuffer = [];
            this.recordVelocitySample(e.touches[0].clientX);
        } else if (e.touches.length === 2) {
            // Two fingers: pinch to zoom
            this.lastPinchDist = this.getPinchDistance(e.touches[0], e.touches[1]);
        }
    }

    private handleTouchMove(e: TouchEvent): void {
        e.preventDefault();

        if (e.touches.length === 1 && this.isTouching) {
            // Pan
            const dx = e.touches[0].clientX - this.lastPanX;
            const dy = e.touches[0].clientY - this.lastPanY;
            this.lastPanX = e.touches[0].clientX;
            this.lastPanY = e.touches[0].clientY;
            
            if (this.dragMode === 'price' && this.callbacks.onPriceScaleDrag) {
                const { y: touchY } = this.getTouchRelativeCoords(e.touches[0]);
                this.callbacks.onPriceScaleDrag(dy, touchY);
            } else {
                this.callbacks.onPan(dx, dy);
                this.recordVelocitySample(e.touches[0].clientX);
            }

            // Crosshair
            const { x, y } = this.getTouchRelativeCoords(e.touches[0]);
            this.callbacks.onCrosshairMove(x, y);
        } else if (e.touches.length === 2) {
            // Pinch zoom
            const newDist = this.getPinchDistance(e.touches[0], e.touches[1]);
            if (this.lastPinchDist > 0) {
                const ratio = this.lastPinchDist / newDist;
                const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const rect = this.container.getBoundingClientRect();
                const pivotX = midX - rect.left;
                this.callbacks.onZoom(ratio, pivotX);
            }
            this.lastPinchDist = newDist;
        }
    }

    private handleTouchEnd(e: TouchEvent): void {
        if (e.touches.length === 0) {
            this.isTouching = false;
            this.lastPinchDist = 0;

            // Trigger momentum
            const velocity = this.computeVelocity();
            this.velocityBuffer = [];
            this.callbacks.onDragEnd(velocity);

            this.callbacks.onCrosshairLeave();
        } else if (e.touches.length === 1) {
            // Transitioning from pinch back to single-finger pan
            this.lastPanX = e.touches[0].clientX;
            this.lastPanY = e.touches[0].clientY;
            this.lastPinchDist = 0;
            // Reset velocity buffer for new single-finger tracking
            this.velocityBuffer = [];
            this.recordVelocitySample(e.touches[0].clientX);
        }
    }
}

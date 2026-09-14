// ─── PaneManager — Multi-Layer Canvas Pane Layout ───────────────────────────────
// Manages multiple canvas strips (price, volume, oscillators) arranged vertically.
// Each pane has 3 stacked canvas layers for TradingView-style rendering:
//   bg   → Grid lines, price axis (rarely redrawn)
//   main → Candlesticks, volume, indicators (redrawn on data/pan/zoom)
//   ui   → Crosshair, tooltips, drawings (redrawn on every mouse move)

import type { PaneConfig, PaneType } from './types';

export type LayerName = 'bg' | 'main' | 'ui';
const LAYERS: LayerName[] = ['bg', 'main', 'ui'];
const LAYER_Z: Record<LayerName, number> = { bg: 1, main: 2, ui: 3 };

export class PaneManager {
    panes: PaneConfig[] = [];
    totalHeight: number = 0;
    totalWidth: number = 0;

    private container: HTMLDivElement | null = null;
    // Keyed by `${paneId}:${layer}`, e.g. "price_0:bg"
    private canvasElements: Map<string, HTMLCanvasElement> = new Map();
    private contexts: Map<string, CanvasRenderingContext2D> = new Map();
    // Pane wrapper divs (one per pane, holds 3 canvases)
    private paneWrappers: Map<string, HTMLDivElement> = new Map();

    // ─── Mount ──────────────────────────────────────────────────────────────────

    mount(container: HTMLDivElement): void {
        this.container = container;
    }

    // ─── Key Helper ─────────────────────────────────────────────────────────────

    private layerKey(paneId: string, layer: LayerName): string {
        return `${paneId}:${layer}`;
    }

    // ─── Setup Panes ────────────────────────────────────────────────────────────

    setupPanes(configs: { id: string; type: PaneType; heightFraction: number }[]): void {
        if (!this.container) return;

        // Normalize fractions to sum to 1.0
        const totalFraction = configs.reduce((s, c) => s + c.heightFraction, 0);
        const normalized = configs.map(c => ({
            ...c,
            heightFraction: c.heightFraction / (totalFraction || 1),
        }));

        // Build pane configs
        this.panes = normalized.map(c => ({
            id: c.id,
            type: c.type,
            heightFraction: c.heightFraction,
            minHeight: 40,
            yOffset: 0,   // computed in layout()
            height: 0,    // computed in layout()
        }));

        // Create pane wrapper + 3 layer canvases for each pane
        for (const pane of this.panes) {
            if (!this.paneWrappers.has(pane.id)) {
                // Create pane wrapper div
                const wrapper = document.createElement('div');
                wrapper.setAttribute('data-pane-id', pane.id);
                wrapper.style.position = 'absolute';
                wrapper.style.left = '0';
                wrapper.style.overflow = 'hidden';
                // Let pointer events pass through wrapper to the container behind
                wrapper.style.pointerEvents = 'none';
                this.container.appendChild(wrapper);
                this.paneWrappers.set(pane.id, wrapper);

                // Create 3 canvas layers inside the wrapper
                for (const layer of LAYERS) {
                    const key = this.layerKey(pane.id, layer);
                    const canvas = document.createElement('canvas');
                    canvas.setAttribute('data-pane-id', pane.id);
                    canvas.setAttribute('data-layer', layer);
                    canvas.style.position = 'absolute';
                    canvas.style.left = '0';
                    canvas.style.top = '0';
                    canvas.style.pointerEvents = 'none';
                    canvas.style.zIndex = String(LAYER_Z[layer]);
                    wrapper.appendChild(canvas);
                    this.canvasElements.set(key, canvas);

                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        this.contexts.set(key, ctx);
                    }
                }
            }
        }

        // Remove wrappers/canvases for panes that no longer exist
        const activeIds = new Set(this.panes.map(p => p.id));
        const toRemove: string[] = [];
        this.paneWrappers.forEach((wrapper, id) => {
            if (!activeIds.has(id)) {
                wrapper.remove();
                toRemove.push(id);
            }
        });
        for (const id of toRemove) {
            this.paneWrappers.delete(id);
            for (const layer of LAYERS) {
                const key = this.layerKey(id, layer);
                this.canvasElements.delete(key);
                this.contexts.delete(key);
            }
        }
    }

    // ─── Layout ─────────────────────────────────────────────────────────────────

    layout(width: number, height: number): void {
        this.totalWidth = width;
        this.totalHeight = height;

        const dpr = window.devicePixelRatio || 1;
        let yOffset = 0;

        for (const pane of this.panes) {
            const paneHeight = Math.max(pane.minHeight, Math.floor(height * pane.heightFraction));
            pane.yOffset = yOffset;
            pane.height = paneHeight;

            // Position the pane wrapper div
            const wrapper = this.paneWrappers.get(pane.id);
            if (wrapper) {
                wrapper.style.top = yOffset + 'px';
                wrapper.style.width = width + 'px';
                wrapper.style.height = paneHeight + 'px';
            }

            // Size all 3 layer canvases identically
            for (const layer of LAYERS) {
                const key = this.layerKey(pane.id, layer);
                const canvas = this.canvasElements.get(key);
                if (canvas) {
                    // CSS size (logical pixels)
                    canvas.style.width = width + 'px';
                    canvas.style.height = paneHeight + 'px';

                    // Canvas buffer size (physical / retina)
                    const bufW = Math.floor(width * dpr);
                    const bufH = Math.floor(paneHeight * dpr);

                    // Only resize buffer if dimensions actually changed (avoids expensive clear)
                    if (canvas.width !== bufW || canvas.height !== bufH) {
                        canvas.width = bufW;
                        canvas.height = bufH;
                    }

                    // Scale context for retina
                    const ctx = this.contexts.get(key);
                    if (ctx) {
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    }
                }
            }

            yOffset += paneHeight;
        }
    }

    // ─── Layer-Aware Accessors ──────────────────────────────────────────────────

    /** Get canvas for a specific pane + layer. Default layer = 'main' for backward compat. */
    getCanvas(paneId: string, layer: LayerName = 'main'): HTMLCanvasElement | null {
        return this.canvasElements.get(this.layerKey(paneId, layer)) || null;
    }

    /** Get 2D context for a specific pane + layer. Default = 'main'. */
    getContext(paneId: string, layer: LayerName = 'main'): CanvasRenderingContext2D | null {
        return this.contexts.get(this.layerKey(paneId, layer)) || null;
    }

    getPaneByY(y: number): PaneConfig | null {
        for (const pane of this.panes) {
            if (y >= pane.yOffset && y < pane.yOffset + pane.height) {
                return pane;
            }
        }
        return null;
    }

    getPaneById(id: string): PaneConfig | null {
        return this.panes.find(p => p.id === id) || null;
    }

    // ─── Clear ──────────────────────────────────────────────────────────────────

    /** Clear a single layer of a single pane. */
    clearLayer(paneId: string, layer: LayerName): void {
        const key = this.layerKey(paneId, layer);
        const canvas = this.canvasElements.get(key);
        const ctx = this.contexts.get(key);
        if (ctx && canvas) {
            const dpr = window.devicePixelRatio || 1;
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        }
    }

    /** Clear all layers of all panes. */
    clearAll(): void {
        for (const pane of this.panes) {
            for (const layer of LAYERS) {
                this.clearLayer(pane.id, layer);
            }
        }
    }

    /** Clear only the specified layer across all panes. */
    clearAllLayer(layer: LayerName): void {
        for (const pane of this.panes) {
            this.clearLayer(pane.id, layer);
        }
    }

    // ─── Destroy ────────────────────────────────────────────────────────────────

    destroy(): void {
        this.paneWrappers.forEach(wrapper => wrapper.remove());
        this.paneWrappers.clear();
        this.canvasElements.clear();
        this.contexts.clear();
        this.panes = [];
        this.container = null;
    }
}

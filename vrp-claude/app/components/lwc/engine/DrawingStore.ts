// ─── DrawingStore — Canvas Drawing Layer ─────────────────────────────────────
// Stores all user-drawn objects (trendlines, rays, horizontals, rectangles, fibs)
// and provides serializable export/import.

export type DrawingToolType =
    | 'cursor'
    | 'trendline'
    | 'ray'
    | 'horizontal'
    | 'vertical'
    | 'rectangle'
    | 'fib'
    | 'text'
    | 'eraser';

export interface DrawingPoint {
    barIndex: number;  // snapped bar index
    price: number;     // price at the point
}

export interface BaseDrawing {
    id: string;
    type: DrawingToolType;
    color: string;
    lineWidth: number;
    locked: boolean;
    visible: boolean;
    selected: boolean;
}

export interface TrendlineDrawing extends BaseDrawing {
    type: 'trendline';
    p1: DrawingPoint;
    p2: DrawingPoint;
    extendRight: boolean;
    extendLeft: boolean;
    dashed: boolean;
}

export interface RayDrawing extends BaseDrawing {
    type: 'ray';
    p1: DrawingPoint;
    p2: DrawingPoint;
    dashed: boolean;
}

export interface HorizontalDrawing extends BaseDrawing {
    type: 'horizontal';
    price: number;
    dashed: boolean;
    label: string;
}

export interface VerticalDrawing extends BaseDrawing {
    type: 'vertical';
    barIndex: number;
    dashed: boolean;
}

export interface RectangleDrawing extends BaseDrawing {
    type: 'rectangle';
    p1: DrawingPoint;
    p2: DrawingPoint;
    fillOpacity: number;
}

export interface FibDrawing extends BaseDrawing {
    type: 'fib';
    p1: DrawingPoint;
    p2: DrawingPoint;
    levels: number[];   // e.g. [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
}

export interface TextDrawing extends BaseDrawing {
    type: 'text';
    p1: DrawingPoint;
    text: string;
    fontSize: number;
}

export type Drawing =
    | TrendlineDrawing
    | RayDrawing
    | HorizontalDrawing
    | VerticalDrawing
    | RectangleDrawing
    | FibDrawing
    | TextDrawing;

// ─── Default values per tool ─────────────────────────────────────────────────

export const DEFAULT_DRAWING_COLOR = '#f7c948';
export const DEFAULT_LINE_WIDTH = 1.5;
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

function genId(): string {
    return `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── DrawingStore Class ───────────────────────────────────────────────────────

export class DrawingStore {
    drawings: Drawing[] = [];
    selectedId: string | null = null;

    // Active drawing state (while user is still drawing)
    activeTool: DrawingToolType = 'cursor';
    inProgress: Drawing | null = null;   // drawing being placed
    previewPoint: DrawingPoint | null = null;  // live cursor position

    // ─── Tool ────────────────────────────────────────────────────────────────

    setTool(tool: DrawingToolType): void {
        this.activeTool = tool;
        this.inProgress = null;
        this.previewPoint = null;
        this.selectedId = null;
    }

    // ─── Create / Commit ─────────────────────────────────────────────────────

    /** Start placing a new drawing at the first anchor point */
    startDrawing(tool: DrawingToolType, p: DrawingPoint): Drawing | null {
        const base: BaseDrawing = {
            id: genId(),
            type: tool,
            color: DEFAULT_DRAWING_COLOR,
            lineWidth: DEFAULT_LINE_WIDTH,
            locked: false,
            visible: true,
            selected: false,
        };

        let drawing: Drawing | null = null;

        switch (tool) {
            case 'trendline':
                drawing = { ...base, type: 'trendline', p1: p, p2: p, extendRight: false, extendLeft: false, dashed: false };
                break;
            case 'ray':
                drawing = { ...base, type: 'ray', p1: p, p2: p, dashed: false };
                break;
            case 'horizontal':
                drawing = { ...base, type: 'horizontal', price: p.price, dashed: false, label: '' };
                break;
            case 'vertical':
                drawing = { ...base, type: 'vertical', barIndex: p.barIndex, dashed: false };
                break;
            case 'rectangle':
                drawing = { ...base, type: 'rectangle', p1: p, p2: p, fillOpacity: 0.08 };
                break;
            case 'fib':
                drawing = { ...base, type: 'fib', p1: p, p2: p, levels: FIB_LEVELS };
                break;
            case 'text':
                drawing = { ...base, type: 'text', p1: p, text: 'Text', fontSize: 12 };
                break;
            default:
                return null;
        }

        this.inProgress = drawing;
        return drawing;
    }

    /** Update the in-progress drawing's second anchor as the cursor moves */
    updatePreview(p: DrawingPoint): void {
        this.previewPoint = p;
        if (!this.inProgress) return;
        const d = this.inProgress;
        if (d.type === 'trendline' || d.type === 'ray' || d.type === 'rectangle' || d.type === 'fib') {
            (d as any).p2 = p;
        } else if (d.type === 'horizontal') {
            (d as HorizontalDrawing).price = p.price;
        } else if (d.type === 'vertical') {
            (d as VerticalDrawing).barIndex = p.barIndex;
        }
    }

    /** Commit the in-progress drawing to the store */
    commitDrawing(): Drawing | null {
        if (!this.inProgress) return null;
        const d = this.inProgress;

        // Skip degenerate drawings (zero-length lines)
        if (d.type === 'trendline' || d.type === 'ray' || d.type === 'rectangle' || d.type === 'fib') {
            const dd = d as any;
            if (Math.abs(dd.p1.barIndex - dd.p2.barIndex) < 0.5 &&
                Math.abs(dd.p1.price - dd.p2.price) < 1e-9) {
                this.inProgress = null;
                return null;
            }
        }

        this.drawings.push(d);
        this.inProgress = null;
        return d;
    }

    cancelDrawing(): void {
        this.inProgress = null;
    }

    // ─── Selection ───────────────────────────────────────────────────────────

    selectById(id: string | null): void {
        this.selectedId = id;
        this.drawings.forEach(d => d.selected = (d.id === id));
    }

    deleteSelected(): void {
        if (!this.selectedId) return;
        this.drawings = this.drawings.filter(d => d.id !== this.selectedId);
        this.selectedId = null;
    }

    deleteAll(): void {
        this.drawings = [];
        this.selectedId = null;
        this.inProgress = null;
    }

    // ─── Hit-test ────────────────────────────────────────────────────────────

    /**
     * Returns the id of the first drawing under pixel (px, py).
     * xForIndex and yForPrice are provided by CoordMapper.
     */
    hitTest(
        px: number,
        py: number,
        xForIndex: (i: number) => number,
        yForPrice: (p: number, h: number) => number,
        paneHeight: number,
        tolerance = 8,
    ): string | null {
        for (let i = this.drawings.length - 1; i >= 0; i--) {
            const d = this.drawings[i];
            if (!d.visible) continue;

            if (d.type === 'horizontal') {
                const y = yForPrice(d.price, paneHeight);
                if (Math.abs(py - y) <= tolerance) return d.id;
            } else if (d.type === 'vertical') {
                const x = xForIndex(d.barIndex);
                if (Math.abs(px - x) <= tolerance) return d.id;
            } else if (d.type === 'trendline' || d.type === 'ray') {
                const dd = d as TrendlineDrawing | RayDrawing;
                const x1 = xForIndex(dd.p1.barIndex);
                const y1 = yForPrice(dd.p1.price, paneHeight);
                const x2 = xForIndex(dd.p2.barIndex);
                const y2 = yForPrice(dd.p2.price, paneHeight);
                if (distToSegment(px, py, x1, y1, x2, y2) <= tolerance) return d.id;
            } else if (d.type === 'rectangle') {
                const dd = d as RectangleDrawing;
                const x1 = xForIndex(dd.p1.barIndex);
                const y1 = yForPrice(dd.p1.price, paneHeight);
                const x2 = xForIndex(dd.p2.barIndex);
                const y2 = yForPrice(dd.p2.price, paneHeight);
                const minX = Math.min(x1, x2); const maxX = Math.max(x1, x2);
                const minY = Math.min(y1, y2); const maxY = Math.max(y1, y2);
                if (px >= minX - tolerance && px <= maxX + tolerance &&
                    py >= minY - tolerance && py <= maxY + tolerance) {
                    // Near edge or fill
                    const nearEdge = px <= minX + tolerance || px >= maxX - tolerance ||
                        py <= minY + tolerance || py >= maxY - tolerance;
                    if (nearEdge || dd.fillOpacity > 0) return d.id;
                }
            } else if (d.type === 'fib') {
                const dd = d as FibDrawing;
                for (const level of dd.levels) {
                    const price = dd.p1.price + (dd.p2.price - dd.p1.price) * level;
                    const y = yForPrice(price, paneHeight);
                    if (Math.abs(py - y) <= tolerance) return d.id;
                }
            } else if (d.type === 'text') {
                const dd = d as TextDrawing;
                const x = xForIndex(dd.p1.barIndex);
                const y = yForPrice(dd.p1.price, paneHeight);
                if (Math.abs(px - x) <= 40 && Math.abs(py - y) <= 20) return d.id;
            }
        }
        return null;
    }
}

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

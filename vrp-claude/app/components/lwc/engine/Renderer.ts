// ─── Renderer — Canvas 2D Drawing Functions ─────────────────────────────────────
// Pure functions: each takes a CanvasRenderingContext2D, data, CoordMapper, and theme.
// No state — stateless drawing primitives.
// Optimized with pixel-snapping for TradingView-level sharpness on HiDPI screens.

import type { RenderBar, IndicatorPoint, CrosshairState, ActivePosition } from './types';
import type { TerminalTheme } from '../core/TerminalThemes';
import type { CoordMapper } from './CoordMapper';
import type { RSIConfig, CVDConfig } from '../../../types/indicators';

// ─── Pixel Snapping ─────────────────────────────────────────────────────────────
// For odd-width strokes (1px, 3px, …), shifting coordinates by 0.5px aligns the
// stroke center to a physical pixel boundary, eliminating anti-aliasing blur.

const CHART_FONT = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Arial, sans-serif';
const CHART_FONT_BOLD = 'bold 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Arial, sans-serif';

/** Snap a coordinate to the nearest pixel center for crisp 1px lines. */
function snap(v: number): number {
    return Math.round(v) + 0.5;
}

/** Snap to nearest pixel edge (for even-width strokes or fills). */
function snapFloor(v: number): number {
    return Math.round(v);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatPrice(p: number, tickInterval?: number): string {
    let decimals = 2; // default to standard cents (USD)

    if (tickInterval !== undefined) {
        if (tickInterval < 1) {
            // Find exactly how many decimals the tick interval needs
            const str = tickInterval.toString();
            if (str.includes('e-')) {
                decimals = parseInt(str.split('e-')[1], 10);
            } else if (str.includes('.')) {
                decimals = Math.max(2, str.split('.')[1].length);
            }
        } else if (Math.abs(p) > 100000) {
            decimals = 0; // Huge numbers (e.g. indices like NIKKEI) don't need cents
        }
    } else {
        const absP = Math.abs(p);
        if (absP === 0) decimals = 2;
        else if (absP < 0.001) decimals = 6;
        else if (absP < 0.1) decimals = 4;
        else if (absP < 1) decimals = 3;
    }

    // Use Intl.NumberFormat for commas if number is large, but toFixed is faster for rendering loop.
    // We'll stick to toFixed for speed, and maybe format with regex for commas.
    const raw = p.toFixed(decimals);
    // Add thousands separators for readability on large prices (BTC, SPX, etc)
    const parts = raw.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

function formatTimestamp(ts: number, isIntraday: boolean): string {
    const d = new Date(ts * 1000);
    if (isIntraday) {
        const h = d.getHours().toString().padStart(2, '0');
        const m = d.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    }
    const mon = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${mon}/${day}`;
}

function niceTickInterval(range: number, targetTicks: number): number {
    if (range <= 0 || targetTicks <= 0) return 1;
    const rough = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / mag;
    
    let nice: number;
    if (normalized <= 1.2) nice = 1;
    else if (normalized <= 2.5) nice = 2.5; // perfect for futures (quarters: 0.25, 2.5, 25)
    else if (normalized <= 5) nice = 5;     // halves/fives (0.5, 5, 50)
    else nice = 10;                         // wholes (1, 10, 100)
    
    return nice * mag;
}

function drawDashedLine(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    color: string,
    dashPattern: number[] = [4, 4],
    lineWidth: number = 1,
): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashPattern);
    ctx.beginPath();
    // Pixel-snap horizontal / vertical dashed lines
    const isHorizontal = Math.abs(y1 - y2) < 0.5;
    const isVertical = Math.abs(x1 - x2) < 0.5;
    if (isHorizontal) {
        const sy = snap(y1);
        ctx.moveTo(snapFloor(x1), sy);
        ctx.lineTo(snapFloor(x2), sy);
    } else if (isVertical) {
        const sx = snap(x1);
        ctx.moveTo(sx, snapFloor(y1));
        ctx.lineTo(sx, snapFloor(y2));
    } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();
}

// ─── Visible Range Helper ───────────────────────────────────────────────────────

function getVisibleRange(mapper: CoordMapper, totalBars: number): { start: number; end: number } {
    return {
        start: Math.max(0, Math.floor(mapper.viewState.startIndex) - 1),
        end: Math.min(totalBars - 1, Math.ceil(mapper.viewState.endIndex) + 1),
    };
}

// ─── 1. Candlestick Renderer ────────────────────────────────────────────────────

export function drawCandlesticks(
    ctx: CanvasRenderingContext2D,
    bars: RenderBar[],
    mapper: CoordMapper,
    theme: TerminalTheme,
): void {
    if (bars.length === 0) return;
    const { start, end } = getVisibleRange(mapper, bars.length);
    const bodyW = mapper.barBodyWidth;
    const halfBody = bodyW / 2;

    for (let i = start; i <= end; i++) {
        const bar = bars[i];
        if (!bar) continue;

        const cx = mapper.xForIndex(bar.index);
        const yOpen = mapper.yForPrice(bar.open);
        const yClose = mapper.yForPrice(bar.close);
        const yHigh = mapper.yForPrice(bar.high);
        const yLow = mapper.yForPrice(bar.low);

        const upColor = theme.candleUp;
        const downColor = theme.candleDown;
        const wickUpColor = theme.wickUp;
        const wickDownColor = theme.wickDown;

        // Wick — pixel-snapped for crispness
        const wickX = snap(cx);
        ctx.strokeStyle = bar.isBullish ? wickUpColor : wickDownColor;
        ctx.lineWidth = Math.max(1, bodyW * 0.12);
        ctx.beginPath();
        ctx.moveTo(wickX, snapFloor(yHigh));
        ctx.lineTo(wickX, snapFloor(yLow));
        ctx.stroke();

        // Body
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(Math.abs(yOpen - yClose), 1);

        ctx.fillStyle = bar.isBullish ? upColor : downColor;
        ctx.fillRect(snapFloor(cx - halfBody), snapFloor(bodyTop), snapFloor(bodyW), snapFloor(bodyHeight));
    }
}

// ─── 2. Renko Renderer ──────────────────────────────────────────────────────────

export function drawRenko(
    ctx: CanvasRenderingContext2D,
    bars: RenderBar[],
    mapper: CoordMapper,
    theme: TerminalTheme,
): void {
    if (bars.length === 0) return;
    const { start, end } = getVisibleRange(mapper, bars.length);
    const bodyW = mapper.barBodyWidth * 0.9;
    const halfBody = bodyW / 2;

    for (let i = start; i <= end; i++) {
        const bar = bars[i];
        if (!bar) continue;

        const cx = mapper.xForIndex(bar.index);
        const yOpen = mapper.yForPrice(bar.open);
        const yClose = mapper.yForPrice(bar.close);

        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(Math.abs(yOpen - yClose), 2);

        const x = snapFloor(cx - halfBody);
        const y = snapFloor(bodyTop);
        const w = snapFloor(bodyW);
        const h = snapFloor(bodyHeight);

        ctx.fillStyle = bar.isBullish ? theme.candleUp : theme.candleDown;
        ctx.fillRect(x, y, w, h);

        // Border — pixel-snapped
        ctx.strokeStyle = bar.isBullish ? theme.wickUp : theme.wickDown;
        ctx.lineWidth = 1;
        ctx.strokeRect(snap(cx - halfBody) - 0.5, snap(bodyTop) - 0.5, w, h);
    }
}

// ─── 3. Line Renderer ───────────────────────────────────────────────────────────

export function drawLineChart(
    ctx: CanvasRenderingContext2D,
    bars: RenderBar[],
    mapper: CoordMapper,
    theme: TerminalTheme,
): void {
    if (bars.length === 0) return;
    const { start, end } = getVisibleRange(mapper, bars.length);

    ctx.save();
    ctx.strokeStyle = theme.candleUp;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let first = true;
    for (let i = start; i <= end; i++) {
        const bar = bars[i];
        if (!bar) continue;
        const x = mapper.xForIndex(bar.index);
        const y = mapper.yForPrice(bar.close);
        if (first) {
            ctx.moveTo(x, y);
            first = false;
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Area fill below line
    if (!first && bars[end]) {
        const lastX = mapper.xForIndex(bars[end].index);
        const firstX = mapper.xForIndex(bars[start].index);
        const paneH = mapper.chartHeight;

        ctx.lineTo(lastX, paneH);
        ctx.lineTo(firstX, paneH);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, 0, 0, paneH);
        gradient.addColorStop(0, theme.candleUp + '30');
        gradient.addColorStop(1, theme.candleUp + '05');
        ctx.fillStyle = gradient;
        ctx.fill();
    }

    ctx.restore();
}

// ─── 4. OHLC Bars Renderer ──────────────────────────────────────────────────────

export function drawBars(
    ctx: CanvasRenderingContext2D,
    bars: RenderBar[],
    mapper: CoordMapper,
    theme: TerminalTheme,
): void {
    if (bars.length === 0) return;
    const { start, end } = getVisibleRange(mapper, bars.length);
    const bodyW = mapper.barBodyWidth;
    const tickLen = bodyW / 2;

    for (let i = start; i <= end; i++) {
        const bar = bars[i];
        if (!bar) continue;

        const cx = snap(mapper.xForIndex(bar.index));
        const yOpen = snap(mapper.yForPrice(bar.open));
        const yClose = snap(mapper.yForPrice(bar.close));
        const yHigh = snapFloor(mapper.yForPrice(bar.high));
        const yLow = snapFloor(mapper.yForPrice(bar.low));

        const color = bar.isBullish ? theme.candleUp : theme.candleDown;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, bodyW * 0.15);

        // Vertical line (high to low)
        ctx.beginPath();
        ctx.moveTo(cx, yHigh);
        ctx.lineTo(cx, yLow);
        ctx.stroke();

        // Open tick (left)
        ctx.beginPath();
        ctx.moveTo(snapFloor(cx - 0.5 - tickLen), yOpen);
        ctx.lineTo(cx, yOpen);
        ctx.stroke();

        // Close tick (right)
        ctx.beginPath();
        ctx.moveTo(cx, yClose);
        ctx.lineTo(snapFloor(cx - 0.5 + tickLen), yClose);
        ctx.stroke();
    }
}

// ─── 5. Volume Histogram ────────────────────────────────────────────────────────

export function drawVolume(
    ctx: CanvasRenderingContext2D,
    data: { index: number; value: number; isBullish: boolean }[],
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneHeight: number,
    maxVolume: number,
): void {
    if (data.length === 0 || maxVolume <= 0) return;
    const { start, end } = getVisibleRange(mapper, data.length);
    const bodyW = mapper.barBodyWidth;
    const halfBody = bodyW / 2;

    for (let i = start; i <= end; i++) {
        const vol = data[i];
        if (!vol) continue;

        const cx = mapper.xForIndex(vol.index);
        const barH = (vol.value / maxVolume) * paneHeight * 0.85;
        const y = paneHeight - barH;

        ctx.fillStyle = vol.isBullish ? theme.volumeUp : theme.volumeDown;
        ctx.fillRect(snapFloor(cx - halfBody), snapFloor(y), snapFloor(bodyW), snapFloor(barH));
    }
}

// ─── 6. MA Line ─────────────────────────────────────────────────────────────────

export function drawMALine(
    ctx: CanvasRenderingContext2D,
    points: IndicatorPoint[],
    mapper: CoordMapper,
    color: string,
    lineWidth: number = 1,
    opacity: number = 1,
): void {
    if (points.length < 2) return;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let first = true;
    for (const pt of points) {
        const x = mapper.xForIndex(pt.index);
        const y = mapper.yForPrice(pt.value);
        // Only draw if within visible area (with margin)
        if (x < -50 || x > mapper.canvasWidth + 50) continue;
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
}

// ─── 7. RSI Oscillator ─────────────────────────────────────────────────────────

export function drawRSI(
    ctx: CanvasRenderingContext2D,
    points: IndicatorPoint[],
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneHeight: number,
    cfg: RSIConfig,
): void {
    if (points.length < 2) return;

    // RSI Y-axis is always 0-100
    const yForRSI = (val: number) => paneHeight * (1 - val / 100);

    // Background
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, mapper.canvasWidth, paneHeight);

    // Overbought / Oversold bands
    const upperY = snap(yForRSI(cfg.upperBand));
    const lowerY = snap(yForRSI(cfg.lowerBand));
    const midY = snap(yForRSI(50));

    // Band fill (overbought zone)
    ctx.fillStyle = theme.priceDown + '10';
    ctx.fillRect(0, 0, mapper.chartWidth, upperY - 0.5);

    // Band fill (oversold zone)
    ctx.fillStyle = theme.priceUp + '10';
    ctx.fillRect(0, lowerY - 0.5, mapper.chartWidth, paneHeight - lowerY + 0.5);

    // Band lines — pixel-snapped
    drawDashedLine(ctx, 0, upperY - 0.5, mapper.chartWidth, upperY - 0.5, theme.priceDown + '60', [3, 3]);
    drawDashedLine(ctx, 0, lowerY - 0.5, mapper.chartWidth, lowerY - 0.5, theme.priceUp + '60', [3, 3]);
    drawDashedLine(ctx, 0, midY - 0.5, mapper.chartWidth, midY - 0.5, theme.textColor + '30', [2, 4]);

    // RSI line
    ctx.save();
    ctx.strokeStyle = cfg.color || theme.candleUp;
    ctx.lineWidth = Math.max(1, Math.min(4, cfg.lineWidth));
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let first = true;
    for (const pt of points) {
        const x = mapper.xForIndex(pt.index);
        const y = yForRSI(pt.value);
        if (x < -50 || x > mapper.canvasWidth + 50) continue;
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Area fill: above 50 = bullish tint, below 50 = bearish tint
    // Use baseline series style fill
    if (points.length > 0) {
        // Fill above 50
        ctx.beginPath();
        let started = false;
        for (const pt of points) {
            const x = mapper.xForIndex(pt.index);
            const y = yForRSI(Math.max(pt.value, 50));
            if (x < -50 || x > mapper.canvasWidth + 50) continue;
            if (!started) { ctx.moveTo(x, midY - 0.5); ctx.lineTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        if (started) {
            const lastPt = points[points.length - 1];
            ctx.lineTo(mapper.xForIndex(lastPt.index), midY - 0.5);
            ctx.closePath();
            ctx.fillStyle = theme.priceUp + '18';
            ctx.fill();
        }

        // Fill below 50
        ctx.beginPath();
        started = false;
        for (const pt of points) {
            const x = mapper.xForIndex(pt.index);
            const y = yForRSI(Math.min(pt.value, 50));
            if (x < -50 || x > mapper.canvasWidth + 50) continue;
            if (!started) { ctx.moveTo(x, midY - 0.5); ctx.lineTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        if (started) {
            const lastPt = points[points.length - 1];
            ctx.lineTo(mapper.xForIndex(lastPt.index), midY - 0.5);
            ctx.closePath();
            ctx.fillStyle = theme.priceDown + '18';
            ctx.fill();
        }
    }

    // Labels
    ctx.font = CHART_FONT;
    ctx.fillStyle = theme.textColor + '80';
    ctx.textAlign = 'right';
    ctx.fillText(cfg.upperBand.toString(), mapper.chartWidth - 4, upperY - 0.5 + 12);
    ctx.fillText(cfg.lowerBand.toString(), mapper.chartWidth - 4, lowerY - 0.5 - 4);
    ctx.fillText('50', mapper.chartWidth - 4, midY - 0.5 - 4);

    ctx.restore();
}

// ─── 8. CVD Area Chart ──────────────────────────────────────────────────────────

export function drawCVD(
    ctx: CanvasRenderingContext2D,
    points: IndicatorPoint[],
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneHeight: number,
    cfg: CVDConfig,
): void {
    if (points.length < 2) return;

    // Background
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, mapper.canvasWidth, paneHeight);

    // Find min/max of CVD for Y scaling
    let minVal = Infinity, maxVal = -Infinity;
    for (const pt of points) {
        minVal = Math.min(minVal, pt.value);
        maxVal = Math.max(maxVal, pt.value);
    }
    const range = maxVal - minVal || 1;
    const padding = range * 0.1;
    const yMin = minVal - padding;
    const yMax = maxVal + padding;

    const yForCVD = (val: number) => paneHeight * (1 - (val - yMin) / (yMax - yMin));

    // Zero line — pixel-snapped
    const zeroY = snap(yForCVD(0));
    if (zeroY >= 0 && zeroY <= paneHeight) {
        drawDashedLine(ctx, 0, zeroY, mapper.chartWidth, zeroY, theme.textColor + '30', [3, 4]);
    }

    // Area fill + line (positive = bullColor, negative = bearColor)
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.min(4, cfg.lineWidth));
    ctx.lineJoin = 'round';

    // Draw positive fill (above zero)
    ctx.beginPath();
    let started = false;
    for (const pt of points) {
        const x = mapper.xForIndex(pt.index);
        const y = yForCVD(Math.max(pt.value, 0));
        if (x < -50 || x > mapper.canvasWidth + 50) continue;
        if (!started) {
            ctx.moveTo(x, zeroY);
            ctx.lineTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
    if (started) {
        const lastPt = points[points.length - 1];
        ctx.lineTo(mapper.xForIndex(lastPt.index), zeroY);
        ctx.closePath();
        ctx.fillStyle = (cfg.bullColor || '#26a69a') + '25';
        ctx.fill();
    }

    // Draw negative fill (below zero)
    ctx.beginPath();
    started = false;
    for (const pt of points) {
        const x = mapper.xForIndex(pt.index);
        const y = yForCVD(Math.min(pt.value, 0));
        if (x < -50 || x > mapper.canvasWidth + 50) continue;
        if (!started) {
            ctx.moveTo(x, zeroY);
            ctx.lineTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
    if (started) {
        const lastPt = points[points.length - 1];
        ctx.lineTo(mapper.xForIndex(lastPt.index), zeroY);
        ctx.closePath();
        ctx.fillStyle = (cfg.bearColor || '#ef5350') + '25';
        ctx.fill();
    }

    // Line on top
    ctx.beginPath();
    let firstLine = true;
    for (const pt of points) {
        const x = mapper.xForIndex(pt.index);
        const y = yForCVD(pt.value);
        if (x < -50 || x > mapper.canvasWidth + 50) continue;
        if (firstLine) { ctx.moveTo(x, y); firstLine = false; }
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = points[points.length - 1].value >= 0
        ? (cfg.bullColor || '#26a69a')
        : (cfg.bearColor || '#ef5350');
    ctx.stroke();

    ctx.restore();
}

// ─── 9. Crosshair ───────────────────────────────────────────────────────────────

export function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    crosshair: CrosshairState,
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneHeight: number,
    localY: number,
): void {
    if (!crosshair.visible) return;

    const chartW = mapper.chartWidth;
    const priceAxisW = mapper.config.priceAxisWidth;

    // Pixel-snapped crosshair lines
    const sx = snap(Math.max(0, Math.min(crosshair.x, chartW)));
    const sy = snap(Math.max(0, Math.min(localY, paneHeight)));

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = theme.crosshairColor;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.85;

    // Vertical line (full pane height, stays in chart area only)
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, paneHeight);
    ctx.stroke();

    // Horizontal line (chart area only, not over price axis)
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(chartW, sy);
    ctx.stroke();

    ctx.restore();

    // ─── Price label on right axis ────────────────────────────────────────────
    ctx.save();

    // Use tick interval to match axis decimal precision
    const range = mapper.viewState.maxPrice - mapper.viewState.minPrice;
    const targetTicks = Math.max(3, Math.floor(paneHeight / 40));
    const tickInterval = niceTickInterval(range, targetTicks);
    const labelText = formatPrice(crosshair.price, tickInterval);

    ctx.font = CHART_FONT;
    const textW = ctx.measureText(labelText).width;
    const labelH = 20;
    const labelY = Math.max(1, Math.min(paneHeight - labelH - 1, snapFloor(localY - labelH / 2)));
    // Label starts at the axis separator line
    const labelX = chartW;

    // Label background
    ctx.fillStyle = theme.crosshairColor;
    ctx.fillRect(labelX, labelY, priceAxisW, labelH);
    // Label text, centered in price axis area
    ctx.fillStyle = theme.background;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, labelX + priceAxisW / 2, labelY + labelH / 2);

    ctx.restore();
}

/** Draw the "last price" tag on the right axis — the live price indicator. */
export function drawLastPriceTag(
    ctx: CanvasRenderingContext2D,
    price: number,
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneHeight: number,
    isUp: boolean,
    countdown?: string,
): void {
    const y = mapper.yForPrice(price, paneHeight);
    if (y < 0 || y > paneHeight) return; // off screen

    const chartW = mapper.chartWidth;
    const priceAxisW = mapper.config.priceAxisWidth;

    const range = mapper.viewState.maxPrice - mapper.viewState.minPrice;
    const targetTicks = Math.max(3, Math.floor(paneHeight / 40));
    const tickInterval = niceTickInterval(range, targetTicks);
    const labelText = formatPrice(price, tickInterval);

    const color = isUp ? '#26a69a' : '#ef5350'; // green/red like TradingView
    const hasTimer = !!countdown;
    const labelH = hasTimer ? 32 : 18;
    const sy = snap(y);

    ctx.save();
    // Dashed price line across chart
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(chartW, sy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);

    // Price tag background
    ctx.fillStyle = color;
    const labelY = Math.max(1, Math.min(paneHeight - labelH - 1, snapFloor(y - (hasTimer ? 9 : 9))));
    ctx.fillRect(chartW, labelY, priceAxisW, labelH);

    // Price tag text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (hasTimer) {
        ctx.font = CHART_FONT_BOLD;
        ctx.fillText(labelText, chartW + priceAxisW / 2, labelY + 9);
        ctx.font = CHART_FONT;
        ctx.fillStyle = '#ffffffcc';
        ctx.fillText(countdown!, chartW + priceAxisW / 2, labelY + 23);
    } else {
        ctx.font = CHART_FONT;
        ctx.fillText(labelText, chartW + priceAxisW / 2, labelY + labelH / 2);
    }

    ctx.restore();
}

// ─── 10. Price Axis ─────────────────────────────────────────────────────────────

export function drawPriceAxis(
    ctx: CanvasRenderingContext2D,
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneWidth: number,
    paneHeight: number,
): void {
    const { minPrice, maxPrice } = mapper.viewState;
    const range = maxPrice - minPrice;
    if (range <= 0) return;

    const targetTicks = Math.max(3, Math.floor(paneHeight / 40));
    const tickInterval = niceTickInterval(range, targetTicks);
    const firstTick = Math.ceil(minPrice / tickInterval) * tickInterval;

    ctx.save();
    ctx.font = CHART_FONT;
    ctx.fillStyle = theme.textColor;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const axisX = paneWidth - 4;
    const chartW = paneWidth - mapper.config.priceAxisWidth;

    for (let p = firstTick; p <= maxPrice; p += tickInterval) {
        const rawY = mapper.yForPrice(p, paneHeight);
        if (rawY < 5 || rawY > paneHeight - 5) continue;

        // Grid line — pixel-snapped
        const y = snap(rawY);
        ctx.strokeStyle = theme.gridLines;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();

        // Price label
        ctx.fillStyle = theme.textColor;
        ctx.setLineDash([]);
        ctx.fillText(formatPrice(p, tickInterval), axisX, y);
    }

    // Axis separator line — pixel-snapped
    const sepX = snap(chartW);
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sepX, 0);
    ctx.lineTo(sepX, paneHeight);
    ctx.stroke();

    ctx.restore();
}

// ─── 11. Time Axis ──────────────────────────────────────────────────────────────

export function drawTimeAxis(
    ctx: CanvasRenderingContext2D,
    bars: RenderBar[],
    mapper: CoordMapper,
    theme: TerminalTheme,
    width: number,
    height: number,
    isIntraday: boolean,
): void {
    if (bars.length === 0) return;

    ctx.save();
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);

    // Border line at top — pixel-snapped
    ctx.strokeStyle = theme.borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, snap(0));
    ctx.lineTo(width, snap(0));
    ctx.stroke();

    ctx.font = CHART_FONT;
    ctx.fillStyle = theme.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // ─── Pixel-space label placement ─────────────────────────────────────────
    // Measure a real sample label to know how wide each label is in pixels
    const sampleLabel = isIntraday ? '02:30' : '12/31';
    const labelW = ctx.measureText(sampleLabel).width;
    const MIN_GAP_PX = labelW + 24; // minimum pixels between label centers

    const chartW = mapper.chartWidth; // exclude price axis
    const start = Math.max(0, Math.floor(mapper.viewState.startIndex));
    const end   = Math.min(bars.length - 1, Math.ceil(mapper.viewState.endIndex));

    let lastDrawnX = -MIN_GAP_PX; // so the first eligible label always renders

    for (let i = start; i <= end; i++) {
        if (i < 0 || i >= bars.length) continue;
        const bar = bars[i];
        const idx = bar.index !== undefined ? bar.index : i;
        const x = mapper.xForIndex(idx);

        // Skip labels outside the visible chart area (leave margins)
        if (x < labelW / 2 + 4 || x > chartW - labelW / 2 - 4) continue;

        // Only draw if far enough from the previous label
        if (x - lastDrawnX < MIN_GAP_PX) continue;

        const ts = bar.realTime || bar.time;
        ctx.fillText(formatTimestamp(ts, isIntraday), snapFloor(x), snapFloor(height / 2));
        lastDrawnX = x;
    }

    ctx.restore();
}

// ─── 12. Position Lines ─────────────────────────────────────────────────────────

export function drawPositionLines(
    ctx: CanvasRenderingContext2D,
    position: ActivePosition,
    mapper: CoordMapper,
    theme: TerminalTheme,
    paneWidth: number,
): void {
    const chartW = paneWidth - mapper.config.priceAxisWidth;

    const drawPriceLine = (price: number, color: string, label: string) => {
        const y = mapper.yForPrice(price);
        if (y < 0 || y > mapper.chartHeight) return;

        drawDashedLine(ctx, 0, y, chartW, y, color, [6, 4], 2);

        // Label
        ctx.save();
        ctx.font = CHART_FONT_BOLD;
        const text = `${label} ${formatPrice(price, 0.01)}`; // Force 2+ decimals for position lines
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = color;
        ctx.fillRect(chartW - tw - 16, snapFloor(y - 10), tw + 12, 20);
        ctx.fillStyle = theme.background;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, chartW - tw - 10, snapFloor(y));
        ctx.restore();
    };

    // Entry line
    const entryColor = position.mode === 'long' ? theme.priceUp : theme.priceDown;
    drawPriceLine(position.entryPrice, entryColor, `ENTRY ${position.mode.toUpperCase()}`);

    // TP line
    if (position.tpPrice) {
        drawPriceLine(position.tpPrice, theme.priceUp, 'TP');
    }

    // SL line
    if (position.slPrice) {
        drawPriceLine(position.slPrice, theme.priceDown, 'SL');
    }
}

// ─── 13. Divergence Markers ─────────────────────────────────────────────────────

export function drawDivergenceMarkers(
    ctx: CanvasRenderingContext2D,
    divergences: { index: number; type: 'bullish' | 'bearish' }[],
    bars: RenderBar[],
    mapper: CoordMapper,
    bullColor: string,
    bearColor: string,
): void {
    if (divergences.length === 0) return;

    ctx.save();
    ctx.font = CHART_FONT_BOLD;
    ctx.textAlign = 'center';

    for (const div of divergences) {
        const bar = bars[div.index];
        if (!bar) continue;

        const x = mapper.xForIndex(bar.index);
        if (x < -20 || x > mapper.canvasWidth + 20) continue;

        const isBull = div.type === 'bullish';
        const y = isBull
            ? mapper.yForPrice(bar.low) + 16
            : mapper.yForPrice(bar.high) - 16;
        const arrowY = isBull
            ? mapper.yForPrice(bar.low) + 6
            : mapper.yForPrice(bar.high) - 6;

        const color = isBull ? bullColor : bearColor;

        // Arrow
        ctx.fillStyle = color;
        ctx.beginPath();
        if (isBull) {
            ctx.moveTo(x, arrowY - 6);
            ctx.lineTo(x - 4, arrowY);
            ctx.lineTo(x + 4, arrowY);
        } else {
            ctx.moveTo(x, arrowY + 6);
            ctx.lineTo(x - 4, arrowY);
            ctx.lineTo(x + 4, arrowY);
        }
        ctx.fill();

        // Label
        ctx.fillStyle = color;
        ctx.textBaseline = isBull ? 'top' : 'bottom';
        ctx.fillText(isBull ? 'B' : 'S', x, y);
    }

    ctx.restore();
}

// ─── 14. Pane Separator ─────────────────────────────────────────────────────────

export function drawPaneSeparator(
    ctx: CanvasRenderingContext2D,
    width: number,
    color: string,
): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, snap(0));
    ctx.lineTo(width, snap(0));
    ctx.stroke();
    ctx.restore();
}

// ─── 15. Drawings Layer ──────────────────────────────────────────────────────────

import type { Drawing, TrendlineDrawing, RayDrawing, HorizontalDrawing, VerticalDrawing, RectangleDrawing, FibDrawing, TextDrawing } from './DrawingStore';

export function drawDrawings(
    ctx: CanvasRenderingContext2D,
    drawings: Drawing[],
    mapper: CoordMapper,
    paneHeight: number,
    chartWidth: number,
): void {
    if (drawings.length === 0) return;

    const xFor = (idx: number) => mapper.xForIndex(idx);
    const yFor = (price: number) => mapper.yForPrice(price, paneHeight);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const d of drawings) {
        if (!d.visible) continue;
        const selected = d.selected;
        const color = d.color;
        const lineW = selected ? d.lineWidth + 1.5 : d.lineWidth;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineW;
        ctx.setLineDash([]);
        ctx.shadowBlur = selected ? 6 : 0;
        ctx.shadowColor = selected ? color : 'transparent';

        if (d.type === 'trendline' || d.type === 'ray') {
            const dd = d as TrendlineDrawing | RayDrawing;
            const x1 = xFor(dd.p1.barIndex); const y1 = yFor(dd.p1.price);
            const x2 = xFor(dd.p2.barIndex); const y2 = yFor(dd.p2.price);
            if (dd.dashed) ctx.setLineDash([8, 5]);
            ctx.beginPath();
            if (d.type === 'ray') {
                const { ex, ey } = _extendRay(x1, y1, x2, y2, chartWidth, paneHeight);
                ctx.moveTo(x1, y1); ctx.lineTo(ex, ey);
            } else {
                const tl = d as TrendlineDrawing;
                let sx1 = x1; let sy1 = y1; let sx2 = x2; let sy2 = y2;
                if (tl.extendLeft) { const r = _extendRay(x2, y2, x1, y1, chartWidth, paneHeight); sx1 = r.ex; sy1 = r.ey; }
                if (tl.extendRight) { const r = _extendRay(x1, y1, x2, y2, chartWidth, paneHeight); sx2 = r.ex; sy2 = r.ey; }
                ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            _anchorDot(ctx, x1, y1, color, selected);
            _anchorDot(ctx, x2, y2, color, selected);

        } else if (d.type === 'horizontal') {
            const dd = d as HorizontalDrawing;
            const y = yFor(dd.price);
            if (y < -2 || y > paneHeight + 2) continue;
            if (dd.dashed) ctx.setLineDash([8, 5]);
            ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(chartWidth, y + 0.5); ctx.stroke();
            ctx.setLineDash([]);
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.font = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Arial, sans-serif';
            const lbl = y > 0 ? dd.price.toFixed(2) : dd.price.toFixed(2);
            const tw2 = ctx.measureText(lbl).width + 10;
            ctx.fillStyle = color;
            ctx.fillRect(chartWidth, y - 9, tw2, 18);
            ctx.fillStyle = '#000'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(lbl, chartWidth + 5, y);
            ctx.restore();

        } else if (d.type === 'vertical') {
            const dd = d as VerticalDrawing;
            const x = xFor(dd.barIndex);
            if (x < -2 || x > chartWidth + 2) continue;
            if (dd.dashed) ctx.setLineDash([8, 5]);
            ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, paneHeight); ctx.stroke();
            ctx.setLineDash([]);

        } else if (d.type === 'rectangle') {
            const dd = d as RectangleDrawing;
            const x1 = xFor(dd.p1.barIndex); const y1 = yFor(dd.p1.price);
            const x2 = xFor(dd.p2.barIndex); const y2 = yFor(dd.p2.price);
            const rx = Math.min(x1, x2); const ry = Math.min(y1, y2);
            const rw = Math.abs(x2 - x1); const rh = Math.abs(y2 - y1);
            if (dd.fillOpacity > 0) {
                ctx.save(); ctx.shadowBlur = 0;
                ctx.globalAlpha = dd.fillOpacity; ctx.fillStyle = color;
                ctx.fillRect(rx, ry, rw, rh); ctx.restore();
            }
            ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
            _anchorDot(ctx, x1, y1, color, selected);
            _anchorDot(ctx, x2, y2, color, selected);

        } else if (d.type === 'fib') {
            const dd = d as FibDrawing;
            const x1 = xFor(dd.p1.barIndex); const x2 = xFor(dd.p2.barIndex);
            const pr = dd.p2.price - dd.p1.price;
            const leftX = Math.min(x1, x2); const rightX = Math.max(x1, x2);
            const FC: Record<number, string> = { 0:'#ef5350', 0.236:'#f7c948', 0.382:'#26a69a', 0.5:'#7b61ff', 0.618:'#26a69a', 0.786:'#f7c948', 1:'#ef5350' };
            for (const lv of dd.levels) {
                const price = dd.p1.price + pr * lv;
                const y = yFor(price);
                if (y < -2 || y > paneHeight + 2) continue;
                const fc = FC[lv] ?? color;
                ctx.strokeStyle = fc; ctx.lineWidth = selected ? 1.5 : 1;
                ctx.beginPath(); ctx.moveTo(leftX, y + 0.5); ctx.lineTo(rightX, y + 0.5); ctx.stroke();
                ctx.save(); ctx.shadowBlur = 0;
                ctx.font = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Arial, sans-serif';
                ctx.fillStyle = fc; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
                ctx.fillText(`${(lv*100).toFixed(1)}%  ${price.toFixed(2)}`, leftX + 4, y);
                ctx.restore();
            }
            ctx.strokeStyle = color; ctx.lineWidth = lineW;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(x1, yFor(dd.p1.price)); ctx.lineTo(x2, yFor(dd.p2.price));
            ctx.stroke(); ctx.setLineDash([]);
            _anchorDot(ctx, x1, yFor(dd.p1.price), color, selected);
            _anchorDot(ctx, x2, yFor(dd.p2.price), color, selected);

        } else if (d.type === 'text') {
            const dd = d as TextDrawing;
            const x = xFor(dd.p1.barIndex); const y = yFor(dd.p1.price);
            ctx.save(); ctx.shadowBlur = 0;
            ctx.font = `${dd.fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", sans-serif`;
            ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(dd.text, x, y);
            if (selected) {
                const tw3 = ctx.measureText(dd.text).width;
                ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
                ctx.strokeRect(x-2, y-dd.fontSize-2, tw3+4, dd.fontSize+4);
                ctx.setLineDash([]);
            }
            ctx.restore();
        }
    }

    ctx.shadowBlur = 0;
    ctx.restore();
}

function _anchorDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, selected: boolean): void {
    const r = selected ? 5 : 3.5;
    ctx.save(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = selected ? color : '#1a1d27';
    ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
}

function _extendRay(x1: number, y1: number, x2: number, y2: number, cw: number, ch: number): { ex: number; ey: number } {
    const dx = x2 - x1; const dy = y2 - y1;
    if (Math.abs(dx) < 0.001) return { ex: x2, ey: dy > 0 ? ch : 0 };
    const tR = (cw - x1) / dx;
    const tT = Math.abs(dy) > 0.001 ? (0 - y1) / dy : Infinity;
    const tB = Math.abs(dy) > 0.001 ? (ch - y1) / dy : Infinity;
    const t = Math.min(...([tR, tT, tB].filter(v => v > 0.001)));
    return { ex: x1 + dx * t, ey: y1 + dy * t };
}

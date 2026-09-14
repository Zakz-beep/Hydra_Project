// ─── DataAggregator — Chart Type Converters ─────────────────────────────────────
// Converts raw OHLCV data into Range Bars, Renko bricks, etc.

import type { OHLCVBar, RenderBar } from './types';

/**
 * Pass-through: converts raw bars to RenderBars with index and isBullish.
 */
export function toCandlestick(raw: OHLCVBar[]): RenderBar[] {
    return raw.map((bar, i) => ({
        ...bar,
        index: i,
        isBullish: bar.close >= bar.open,
    }));
}

/**
 * Converts raw OHLCV data to Range Bars.
 * A new bar is formed when high - low >= rangeSize.
 *
 * @param raw - Raw OHLCV bars (typically 1m resolution for best results)
 * @param rangeSize - Price range per bar (e.g. 1.0 means $1 per bar)
 */
export function toRangeBars(raw: OHLCVBar[], rangeSize: number): RenderBar[] {
    if (raw.length === 0 || rangeSize <= 0) return [];

    const result: RenderBar[] = [];
    let currentOpen = raw[0].open;
    let currentHigh = raw[0].high;
    let currentLow = raw[0].low;
    let currentVolume = raw[0].volume;
    let currentRealTime = raw[0].time;
    let barStartTime = raw[0].time;

    for (let i = 1; i < raw.length; i++) {
        const tick = raw[i];
        currentHigh = Math.max(currentHigh, tick.high);
        currentLow = Math.min(currentLow, tick.low);
        currentVolume += tick.volume;
        currentRealTime = tick.time;

        // Check if the range has been filled
        while (currentHigh - currentLow >= rangeSize) {
            const isBullish = tick.close >= currentOpen;
            let close: number;
            let nextOpen: number;

            if (isBullish) {
                // Bullish: close at open + rangeSize
                close = currentOpen + rangeSize;
                // Clamp high to close
                const barHigh = Math.max(currentOpen, close);
                const barLow = Math.min(currentOpen, close);

                result.push({
                    time: barStartTime,
                    realTime: currentRealTime,
                    open: currentOpen,
                    high: barHigh,
                    low: barLow,
                    close: close,
                    volume: currentVolume,
                    index: result.length,
                    isBullish: true,
                });

                nextOpen = close;
            } else {
                // Bearish: close at open - rangeSize
                close = currentOpen - rangeSize;
                const barHigh = Math.max(currentOpen, close);
                const barLow = Math.min(currentOpen, close);

                result.push({
                    time: barStartTime,
                    realTime: currentRealTime,
                    open: currentOpen,
                    high: barHigh,
                    low: barLow,
                    close: close,
                    volume: currentVolume,
                    index: result.length,
                    isBullish: false,
                });

                nextOpen = close;
            }

            // Start new bar
            currentOpen = nextOpen;
            currentHigh = Math.max(currentOpen, tick.high);
            currentLow = Math.min(currentOpen, tick.low);
            currentVolume = 0;
            barStartTime = currentRealTime;

            // Check if the remaining range still fills another bar
            if (currentHigh - currentLow < rangeSize) break;
        }
    }

    // Add the incomplete (in-progress) bar if it exists
    if (currentHigh !== currentLow || result.length === 0) {
        const lastClose = raw[raw.length - 1].close;
        result.push({
            time: barStartTime,
            realTime: currentRealTime,
            open: currentOpen,
            high: currentHigh,
            low: currentLow,
            close: lastClose,
            volume: currentVolume,
            index: result.length,
            isBullish: lastClose >= currentOpen,
        });
    }

    return result;
}

/**
 * Converts raw OHLCV data to Renko bricks.
 * A new brick is formed when price moves >= brickSize from the last brick close.
 *
 * @param raw - Raw OHLCV bars
 * @param brickSize - Size of each brick (e.g. 1.0 means $1 per brick)
 */
export function toRenko(raw: OHLCVBar[], brickSize: number): RenderBar[] {
    if (raw.length === 0 || brickSize <= 0) return [];

    const result: RenderBar[] = [];
    let lastClose = Math.round(raw[0].close / brickSize) * brickSize;

    for (let i = 1; i < raw.length; i++) {
        const price = raw[i].close;
        const diff = price - lastClose;

        // Bullish bricks
        while (price >= lastClose + brickSize) {
            const newClose = lastClose + brickSize;
            result.push({
                time: raw[i].time,
                realTime: raw[i].time,
                open: lastClose,
                high: newClose,
                low: lastClose,
                close: newClose,
                volume: raw[i].volume,
                index: result.length,
                isBullish: true,
            });
            lastClose = newClose;
        }

        // Bearish bricks
        while (price <= lastClose - brickSize) {
            const newClose = lastClose - brickSize;
            result.push({
                time: raw[i].time,
                realTime: raw[i].time,
                open: lastClose,
                high: lastClose,
                low: newClose,
                close: newClose,
                volume: raw[i].volume,
                index: result.length,
                isBullish: false,
            });
            lastClose = newClose;
        }
    }

    return result;
}

/**
 * Line chart: uses close prices only.
 */
export function toLine(raw: OHLCVBar[]): RenderBar[] {
    return raw.map((bar, i) => ({
        ...bar,
        index: i,
        isBullish: i > 0 ? bar.close >= raw[i - 1].close : true,
    }));
}

/**
 * Bars (OHLC bars without filled bodies)
 */
export function toBars(raw: OHLCVBar[]): RenderBar[] {
    return toCandlestick(raw); // Same data, just rendered differently
}

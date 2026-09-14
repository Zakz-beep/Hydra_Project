// ─── DataStore — Data Management + Indicator Calculations ───────────────────────
// Stores raw OHLCV data, computes display bars via aggregation,
// and calculates all indicator values (MA, RSI, CVD).

import type { OHLCVBar, RenderBar, ChartType, IndicatorPoint } from './types';
import type { MovingAverageConfig, RSIConfig, CVDConfig, MASource } from '../../../types/indicators';
import { toCandlestick, toRangeBars, toRenko, toLine, toBars } from './DataAggregator';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getSourceValue(bar: RenderBar, source: MASource): number {
    switch (source) {
        case 'open':  return bar.open;
        case 'high':  return bar.high;
        case 'low':   return bar.low;
        case 'hl2':   return (bar.high + bar.low) / 2;
        case 'hlc3':  return (bar.high + bar.low + bar.close) / 3;
        case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
        case 'close':
        default:      return bar.close;
    }
}

// ─── DataStore Class ────────────────────────────────────────────────────────────

export class DataStore {
    raw: OHLCVBar[] = [];
    display: RenderBar[] = [];

    // Indicator outputs
    maData: Map<string, IndicatorPoint[]> = new Map();
    rsiData: Map<string, IndicatorPoint[]> = new Map();
    cvdData: IndicatorPoint[] = [];
    cvdDivergences: { index: number; type: 'bullish' | 'bearish' }[] = [];

    // Volume data
    volumeData: { index: number; value: number; isBullish: boolean }[] = [];

    // Config
    private chartType: ChartType = 'candlestick';
    private rangeSize: number = 1.0;
    private renkoBrickSize: number = 0.5;

    // ─── Set Raw Data ───────────────────────────────────────────────────────────

    setRaw(data: OHLCVBar[]): void {
        this.raw = data;
    }

    // ─── Recompute Display Bars ─────────────────────────────────────────────────

    recompute(type: ChartType, rangeSize: number, renkoBrickSize: number): void {
        this.chartType = type;
        this.rangeSize = rangeSize;
        this.renkoBrickSize = renkoBrickSize;

        switch (type) {
            case 'range':
                this.display = toRangeBars(this.raw, rangeSize);
                break;
            case 'renko':
                this.display = toRenko(this.raw, renkoBrickSize);
                break;
            case 'line':
                this.display = toLine(this.raw);
                break;
            case 'bars':
                this.display = toBars(this.raw);
                break;
            case 'candlestick':
            default:
                this.display = toCandlestick(this.raw);
                break;
        }

        // Compute volume data from display bars
        this.volumeData = this.display.map(bar => ({
            index: bar.index,
            value: bar.volume,
            isBullish: bar.isBullish,
        }));
    }

    // ─── Moving Averages ────────────────────────────────────────────────────────

    computeMA(id: string, cfg: MovingAverageConfig): void {
        const data = this.display;
        let result: IndicatorPoint[];

        switch (cfg.maType) {
            case 'EMA':
                result = this._calcEMA(data, cfg.period, cfg.source);
                break;
            case 'WMA':
                result = this._calcWMA(data, cfg.period, cfg.source);
                break;
            case 'DEMA':
                result = this._calcDEMA(data, cfg.period, cfg.source);
                break;
            case 'TEMA':
                result = this._calcTEMA(data, cfg.period, cfg.source);
                break;
            case 'KAMA':
                result = this._calcKAMA(data, cfg.period, cfg.source, cfg.kamaFast || 2, cfg.kamaSlow || 30);
                break;
            case 'SMA':
            default:
                result = this._calcSMA(data, cfg.period, cfg.source);
                break;
        }

        this.maData.set(id, result);
    }

    private _calcSMA(data: RenderBar[], period: number, source: MASource): IndicatorPoint[] {
        const result: IndicatorPoint[] = [];
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += getSourceValue(data[i - j], source);
            result.push({ index: data[i].index, value: sum / period });
        }
        return result;
    }

    private _calcEMA(data: RenderBar[], period: number, source: MASource): IndicatorPoint[] {
        const result: IndicatorPoint[] = [];
        if (data.length < period) return result;
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += getSourceValue(data[i], source);
        let ema = sum / period;
        result.push({ index: data[period - 1].index, value: ema });
        for (let i = period; i < data.length; i++) {
            ema = getSourceValue(data[i], source) * k + ema * (1 - k);
            result.push({ index: data[i].index, value: ema });
        }
        return result;
    }

    private _calcWMA(data: RenderBar[], period: number, source: MASource): IndicatorPoint[] {
        const result: IndicatorPoint[] = [];
        const denom = (period * (period + 1)) / 2;
        for (let i = period - 1; i < data.length; i++) {
            let wsum = 0;
            for (let j = 0; j < period; j++) {
                wsum += getSourceValue(data[i - j], source) * (period - j);
            }
            result.push({ index: data[i].index, value: wsum / denom });
        }
        return result;
    }

    private _calcDEMA(data: RenderBar[], period: number, source: MASource): IndicatorPoint[] {
        const ema1 = this._calcEMA(data, period, source);
        // Build synthetic bars from EMA1
        const synthBars: RenderBar[] = ema1.map((p, i) => ({
            time: 0, open: p.value, high: p.value, low: p.value, close: p.value,
            volume: 0, index: p.index, isBullish: true, realTime: 0,
        }));
        const ema2 = this._calcEMA(synthBars, period, 'close');
        const result: IndicatorPoint[] = [];
        const offset = ema1.length - ema2.length;
        for (let i = 0; i < ema2.length; i++) {
            result.push({
                index: ema2[i].index,
                value: 2 * ema1[i + offset].value - ema2[i].value,
            });
        }
        return result;
    }

    private _calcTEMA(data: RenderBar[], period: number, source: MASource): IndicatorPoint[] {
        const ema1 = this._calcEMA(data, period, source);
        const synthBars1: RenderBar[] = ema1.map(p => ({
            time: 0, open: p.value, high: p.value, low: p.value, close: p.value,
            volume: 0, index: p.index, isBullish: true, realTime: 0,
        }));
        const ema2 = this._calcEMA(synthBars1, period, 'close');
        const synthBars2: RenderBar[] = ema2.map(p => ({
            time: 0, open: p.value, high: p.value, low: p.value, close: p.value,
            volume: 0, index: p.index, isBullish: true, realTime: 0,
        }));
        const ema3 = this._calcEMA(synthBars2, period, 'close');
        const result: IndicatorPoint[] = [];
        const off2 = ema1.length - ema2.length;
        const off3 = ema1.length - ema3.length;
        for (let i = 0; i < ema3.length; i++) {
            const v = 3 * ema1[i + off3].value - 3 * ema2[i + off3 - off2].value + ema3[i].value;
            result.push({ index: ema3[i].index, value: v });
        }
        return result;
    }

    private _calcKAMA(data: RenderBar[], period: number, source: MASource, fastEma: number, slowEma: number): IndicatorPoint[] {
        const result: IndicatorPoint[] = [];
        if (data.length <= period) return result;
        const fastC = 2 / (fastEma + 1);
        const slowC = 2 / (slowEma + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += getSourceValue(data[i], source);
        let kama = sum / period;
        result.push({ index: data[period - 1].index, value: kama });
        for (let i = period; i < data.length; i++) {
            const currentPrice = getSourceValue(data[i], source);
            const priorPrice = getSourceValue(data[i - period], source);
            const change = Math.abs(currentPrice - priorPrice);
            let volatility = 0;
            for (let j = 0; j < period; j++) {
                volatility += Math.abs(getSourceValue(data[i - j], source) - getSourceValue(data[i - j - 1], source));
            }
            const er = volatility === 0 ? 0 : change / volatility;
            const sc = Math.pow(er * (fastC - slowC) + slowC, 2);
            kama = kama + sc * (currentPrice - kama);
            result.push({ index: data[i].index, value: kama });
        }
        return result;
    }

    // ─── RSI ────────────────────────────────────────────────────────────────────

    computeRSI(id: string, cfg: RSIConfig): void {
        const data = this.display;
        const period = cfg.period;
        const source = cfg.source;
        const result: IndicatorPoint[] = [];

        if (data.length < period + 1) {
            this.rsiData.set(id, result);
            return;
        }

        // Calculate initial average gain/loss
        let avgGain = 0;
        let avgLoss = 0;
        for (let i = 1; i <= period; i++) {
            const diff = getSourceValue(data[i], source) - getSourceValue(data[i - 1], source);
            if (diff >= 0) avgGain += diff;
            else avgLoss -= diff;
        }
        avgGain /= period;
        avgLoss /= period;

        // First RSI value
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push({ index: data[period].index, value: 100 - 100 / (1 + rs) });

        // Subsequent values using Wilder's smoothing
        for (let i = period + 1; i < data.length; i++) {
            const diff = getSourceValue(data[i], source) - getSourceValue(data[i - 1], source);
            const gain = diff >= 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            const rsVal = avgLoss === 0 ? 100 : avgGain / avgLoss;
            result.push({ index: data[i].index, value: 100 - 100 / (1 + rsVal) });
        }

        this.rsiData.set(id, result);
    }

    // ─── CVD ────────────────────────────────────────────────────────────────────

    computeCVD(cfg: CVDConfig): void {
        const data = this.display;
        const result: IndicatorPoint[] = [];
        let cumulative = 0;

        for (const bar of data) {
            let delta: number;
            if (cfg.sourceMethod === 'bidask') {
                const range = bar.high - bar.low;
                delta = range > 0
                    ? bar.volume * ((bar.close - bar.low) - (bar.high - bar.close)) / range
                    : 0;
            } else {
                // ohlc method
                delta = (bar.close - bar.open) * bar.volume;
            }
            cumulative += delta;
            result.push({ index: bar.index, value: cumulative });
        }

        this.cvdData = result;

        // Detect divergences if enabled
        if (cfg.showDivergence) {
            this.cvdDivergences = this._detectDivergences(result, cfg.pivotLookback);
        } else {
            this.cvdDivergences = [];
        }
    }

    private _detectDivergences(cvdPoints: IndicatorPoint[], lookback: number): { index: number; type: 'bullish' | 'bearish' }[] {
        const bars = this.display;
        const divs: { index: number; type: 'bullish' | 'bearish' }[] = [];

        if (bars.length < lookback * 2 + 1 || cvdPoints.length < lookback * 2 + 1) return divs;

        // Find local lows and highs in price
        const priceLows: { index: number; price: number }[] = [];
        const priceHighs: { index: number; price: number }[] = [];

        for (let i = lookback; i < bars.length - lookback; i++) {
            let isLow = true;
            let isHigh = true;
            const bar = bars[i];

            for (let j = 1; j <= lookback; j++) {
                if (bars[i - j].low <= bar.low) isLow = false;
                if (bars[i + j].low <= bar.low) isLow = false;
                if (bars[i - j].high >= bar.high) isHigh = false;
                if (bars[i + j].high >= bar.high) isHigh = false;
            }

            if (isLow) priceLows.push({ index: bar.index, price: bar.low });
            if (isHigh) priceHighs.push({ index: bar.index, price: bar.high });
        }

        // CVD value at a given bar index
        const cvdAt = (idx: number): number | null => {
            const pt = cvdPoints.find(p => p.index === idx);
            return pt ? pt.value : null;
        };

        // Bullish divergence: price lower low, CVD higher low
        for (let i = 1; i < priceLows.length; i++) {
            const prev = priceLows[i - 1];
            const curr = priceLows[i];
            const prevCVD = cvdAt(prev.index);
            const currCVD = cvdAt(curr.index);
            if (prevCVD !== null && currCVD !== null) {
                if (curr.price < prev.price && currCVD > prevCVD) {
                    divs.push({ index: curr.index, type: 'bullish' });
                }
            }
        }

        // Bearish divergence: price higher high, CVD lower high
        for (let i = 1; i < priceHighs.length; i++) {
            const prev = priceHighs[i - 1];
            const curr = priceHighs[i];
            const prevCVD = cvdAt(prev.index);
            const currCVD = cvdAt(curr.index);
            if (prevCVD !== null && currCVD !== null) {
                if (curr.price > prev.price && currCVD < prevCVD) {
                    divs.push({ index: curr.index, type: 'bearish' });
                }
            }
        }

        return divs;
    }

    // ─── Real-time Update ───────────────────────────────────────────────────────

    updateLastBar(price: number): void {
        if (this.raw.length === 0) return;
        const last = this.raw[this.raw.length - 1];
        last.close = price;
        last.high = Math.max(last.high, price);
        last.low = Math.min(last.low, price);

        // Update display bars (just recompute - it's fast for candlestick)
        if (this.display.length > 0) {
            const lastDisplay = this.display[this.display.length - 1];
            lastDisplay.close = price;
            lastDisplay.high = Math.max(lastDisplay.high, price);
            lastDisplay.low = Math.min(lastDisplay.low, price);
            lastDisplay.isBullish = lastDisplay.close >= lastDisplay.open;
        }

        // Update volume data
        if (this.volumeData.length > 0 && this.display.length > 0) {
            const lastVol = this.volumeData[this.volumeData.length - 1];
            lastVol.isBullish = this.display[this.display.length - 1].isBullish;
        }
    }

    // ─── Accessors ──────────────────────────────────────────────────────────────

    getBarAtIndex(index: number): RenderBar | null {
        if (index < 0 || index >= this.display.length) return null;
        return this.display[index];
    }

    get maxVolume(): number {
        if (this.volumeData.length === 0) return 1;
        return Math.max(...this.volumeData.map(v => v.value)) || 1;
    }
}

import type { HistoricalDay } from './marketdataHistory';
import type { VolatilitySurfaceInput } from './volatilitySurface';

export const historicalDTE = (reference: string, expiry: string) =>
  (Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${reference}T00:00:00Z`)) / 86400000;

export function historicalExpiries(day: HistoricalDay, horizon: number | null, weekday: string) {
  return Array.from(new Set((day.contracts || []).map(c => c.expiry))).sort().filter(expiry => {
    const dte = historicalDTE(day.date, expiry);
    return Number.isFinite(dte) && dte >= 0 && (horizon === null || dte <= horizon)
      && (!weekday || new Date(`${expiry}T00:00:00Z`).getUTCDay() === Number(weekday));
  });
}

export function historicalSurface(day: HistoricalDay, ticker: string, expiries: string[]): VolatilitySurfaceInput | null {
  if (day.spot == null || !Number.isFinite(day.spot) || day.spot <= 0) return null;
  const selected = new Set(expiries);
  return {ticker, timestamp: `${day.date}:${day.captured_at}`, spot: day.spot, data_source: 'marketdata-historical-bsm',
    by_expiry: {history: {strikes: (day.contracts || []).filter(c => selected.has(c.expiry)).map(c => ({
      strike: c.strike, iv: c.iv, oi: c.oi, dte: historicalDTE(day.date, c.expiry), expiry: c.expiry, option_type: c.side,
    }))}}};
}

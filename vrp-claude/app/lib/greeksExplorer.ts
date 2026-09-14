import type { GreeksSnapshot, StrikeGreeks } from "./greeks";
import { expiryWeekday } from './optionExpiries';

export type ContractRow = StrikeGreeks & { bucket: string };
export type ChainFilters = { bucket: string; side: string; search: string; minOI: number; nearSpot: boolean; sort: "gex" | "oi" | "strike"; weekday?:string; expiry?:string };

export function filterContracts(data: GreeksSnapshot, filters: ChainFilters): ContractRow[] {
  const seen = new Set<string>();
  return Object.entries(data.by_expiry || {})
    .filter(([bucket]) => filters.bucket === "all" || bucket === filters.bucket)
    .flatMap(([bucket, value]) => (value.strikes || []).map(s => ({ ...s, bucket })))
    .filter(s => {
      const key = `${s.expiry}:${s.option_type}:${s.strike}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return (filters.bucket === "all" || s.bucket === filters.bucket)
        && (!filters.weekday || filters.weekday === 'all' || expiryWeekday(s.expiry) === filters.weekday)
        && (!filters.expiry || filters.expiry === 'all' || s.expiry === filters.expiry)
        && (filters.side === "all" || s.option_type === filters.side)
        && `${s.strike} ${s.expiry}`.includes(filters.search.trim())
        && s.oi >= filters.minOI
        && (!filters.nearSpot || (data.spot > 0 && Math.abs(s.strike / data.spot - 1) <= 0.1));
    }).sort((a, b) => filters.sort === "strike" ? a.strike - b.strike : filters.sort === "oi" ? b.oi - a.oi : Math.abs(b.gex_spotgamma) - Math.abs(a.gex_spotgamma));
}

export function contractsCSV(data: GreeksSnapshot, rows: ContractRow[]): string {
  const columns = ["ticker", "snapshot", "source", "expiry", "dte", "type", "strike", "oi", "volume", "iv_percent", "delta", "gamma", "gex_usd_per_1pct", "vanna_exposure", "charm_exposure", "provider", "feed", "oi_date", "quote_timestamp"];
  const cell = (value: string | number | null) => {
    const text = String(value ?? '');
    // Prevent spreadsheet formulas in provider-controlled string fields.
    const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...rows.map(s => [data.ticker, data.timestamp, data.data_source, s.expiry, s.dte, s.option_type, s.strike, s.oi, s.volume, s.iv * 100, s.delta, s.gamma, s.gex_spotgamma * 1e7, s.vanna_exp, s.charm_exp, data.provenance?.provider ?? 'legacy', data.provenance?.feed ?? '', s.oi_date ?? '', s.quote_timestamp ?? ''].map(cell).join(","))].join("\r\n");
}

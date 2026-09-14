import type { GreeksSnapshot } from "./greeks";
import { filterContracts } from "./greeksExplorer";

export type ExposureMetric = "gex" | "vanna" | "charm";
export type StrikeExposure = { strike: number; call: number; put: number; net: number; callOI: number; putOI: number };

export function exposureByStrike(data: GreeksSnapshot, bucket: string, metric: ExposureMetric): StrikeExposure[] {
  const contracts = filterContracts(data, { bucket, side: "all", search: "", minOI: 0, nearSpot: false, sort: "strike" });
  const grouped = new Map<number, StrikeExposure>();
  for (const contract of contracts) {
    if (!Number.isFinite(contract.strike) || !["call", "put"].includes(contract.option_type)) continue;
    const value = metric === "gex" ? contract.gex_spotgamma * 1e7 : metric === "vanna" ? contract.vanna_exp : contract.charm_exp;
    if (!Number.isFinite(value)) continue;
    const row = grouped.get(contract.strike) ?? { strike: contract.strike, call: 0, put: 0, net: 0, callOI: 0, putOI: 0 };
    if (contract.option_type === "call") { row.call += value; row.callOI += contract.oi; }
    else { row.put += value; row.putOI += contract.oi; }
    row.net += value;
    grouped.set(contract.strike, row);
  }
  return Array.from(grouped.values()).sort((a, b) => a.strike - b.strike);
}

export function strongestOIStrike(rows: StrikeExposure[], side: "callOI" | "putOI"): number | null {
  const strongest = rows.reduce<StrikeExposure | null>((best, row) => row[side] > (best?.[side] ?? 0) ? row : best, null);
  return strongest?.strike ?? null;
}

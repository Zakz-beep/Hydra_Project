// Minimal renderer input shared by live captures and historical reconstructions.
// Historical adapters must provide DTE relative to their reference session.
export interface VolatilitySurfaceInput {
  ticker: string; timestamp: string; spot: number; data_source: string;
  by_expiry?: Record<string, { strikes?: {
    strike: number; iv: number; oi: number; dte: number; expiry: string; option_type: string;
  }[] }>;
}

export type SurfaceSide = "otm" | "all" | "call" | "put";
export type SmilePoint = { strike: number; iv: number; oi: number };
export type ExpirySmile = { expiry: string; dte: number; points: SmilePoint[] };
export type SurfaceGrid = { x: number[]; y: number[]; z: number[][]; smiles: ExpirySmile[]; observed: number; excludedExpiries: number; reason?: string };
export type SurfaceOptions = { side: SurfaceSide; minOI: number; rangePct: number; quality: "fast" | "smooth" };

// Shape-preserving cubic Hermite interpolation. Sorted, unique x coordinates;
// never extrapolate beyond observed support or overshoot adjacent observations.
export function interpolateSmile(x: number[], y: number[]): (value: number) => number | null {
  const n = x.length;
  if (n < 2 || y.length !== n || x.some((v, i) => !Number.isFinite(v) || (i > 0 && v <= x[i - 1])) || y.some(v => !Number.isFinite(v))) return () => null;
  const h = x.slice(1).map((v, i) => v - x[i]);
  const delta = h.map((v, i) => (y[i + 1] - y[i]) / v);
  const slopes = Array<number>(n).fill(0);
  const edge = (h0: number, h1: number, d0: number, d1: number) => {
    const slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(slope) !== Math.sign(d0)) return 0;
    return Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > 3 * Math.abs(d0) ? 3 * d0 : slope;
  };
  slopes[0] = n === 2 ? delta[0] : edge(h[0], h[1], delta[0], delta[1]);
  slopes[n - 1] = n === 2 ? delta[0] : edge(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);
  for (let i = 1; i < n - 1; i++) {
    if (delta[i - 1] * delta[i] <= 0) continue;
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  return value => {
    if (!Number.isFinite(value) || value < x[0] || value > x[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= value) lo = mid; else hi = mid; }
    const t = (value - x[lo]) / h[lo];
    const result = (2 * t ** 3 - 3 * t ** 2 + 1) * y[lo] + (t ** 3 - 2 * t ** 2 + t) * h[lo] * slopes[lo]
      + (-2 * t ** 3 + 3 * t ** 2) * y[lo + 1] + (t ** 3 - t ** 2) * h[lo] * slopes[lo + 1];
    return Math.max(Math.min(y[lo], y[lo + 1]), Math.min(Math.max(y[lo], y[lo + 1]), result));
  };
}

export function collectExpirySmiles(data: VolatilitySurfaceInput, side: SurfaceSide, minOI: number): ExpirySmile[] {
  const groups = new Map<string, { dte: number; strikes: Map<number, { weightedIV: number; oi: number; count: number }> }>();
  const seen = new Set<string>();
  for (const bucket of Object.values(data.by_expiry || {})) for (const s of bucket.strikes || []) {
    if (!Number.isFinite(s.strike) || s.strike <= 0 || !Number.isFinite(s.iv) || s.iv <= 0 || !Number.isFinite(s.oi) || s.oi < minOI || !Number.isFinite(s.dte) || s.dte < 0 || !s.expiry || !["call", "put"].includes(s.option_type)) continue;
    if ((side === "call" || side === "put") && side !== s.option_type) continue;
    if (side === "otm" && ((s.strike < data.spot && s.option_type !== "put") || (s.strike > data.spot && s.option_type !== "call"))) continue;
    const key = `${s.expiry}:${s.strike}:${s.option_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groups.get(s.expiry) ?? { dte: s.dte, strikes: new Map() };
    const point = group.strikes.get(s.strike) ?? { weightedIV: 0, oi: 0, count: 0 };
    // Zero-OI contracts may be explicitly included; equal unit weight then.
    const weight = Math.max(1, s.oi);
    point.weightedIV += s.iv * 100 * weight; point.oi += s.oi; point.count += weight;
    group.strikes.set(s.strike, point); groups.set(s.expiry, group);
  }
  return Array.from(groups, ([expiry, group]) => ({ expiry, dte: group.dte, points: Array.from(group.strikes, ([strike, value]) => ({ strike, iv: value.weightedIV / value.count, oi: value.oi })).sort((a, b) => a.strike - b.strike) })).sort((a, b) => a.dte - b.dte || a.expiry.localeCompare(b.expiry));
}

export function smileIV(smile: ExpirySmile, strike: number): number | null {
  return interpolateSmile(smile.points.map(p => p.strike), smile.points.map(p => p.iv))(strike);
}

export function buildVolatilitySurface(data: VolatilitySurfaceInput, options: SurfaceOptions): SurfaceGrid {
  const all = collectExpirySmiles(data, options.side, options.minOI);
  const smiles = all.filter(s => s.points.length >= 2);
  const base = { x: [], y: [], z: [], smiles, observed: smiles.reduce((n, s) => n + s.points.length, 0), excludedExpiries: all.length - smiles.length };
  if (!Number.isFinite(data.spot) || data.spot <= 0 || smiles.length < 2) return { ...base, reason: smiles.length === 1
    ? "Only one eligible expiry. Select more expiries for a time surface; the individual smile remains available below."
    : "Need at least two expiries with two valid strikes each. Lower the OI filter or change the option side." };
  if (smiles.some((s, i) => i > 0 && s.dte <= smiles[i - 1].dte)) return { ...base, reason: "Expiry times overlap in this snapshot. A reliable time surface is unavailable; individual expiry slices remain available." };
  const low = Math.max(data.spot * (1 - options.rangePct / 100), ...smiles.map(s => s.points[0].strike));
  const high = Math.min(data.spot * (1 + options.rangePct / 100), ...smiles.map(s => s.points[s.points.length - 1].strike));
  if (low >= high) return { ...base, reason: "No shared strike coverage across these expiries. Widen the range or lower the OI filter." };
  const nx = options.quality === "smooth" ? 96 : 48, ny = options.quality === "smooth" ? 48 : 24;
  const grid = (from: number, to: number, n: number) => Array.from({ length: n }, (_, i) => i === n - 1 ? to : from + (to - from) * i / (n - 1));
  const x = grid(low, high, nx), y = grid(smiles[0].dte, smiles[smiles.length - 1].dte, ny);
  const sampled = smiles.map(s => { const sample = interpolateSmile(s.points.map(p => p.strike), s.points.map(p => p.iv)); return x.map(strike => sample(strike)!); });
  const z = y.map(() => Array<number>(nx));
  for (let col = 0; col < nx; col++) {
    const sample = interpolateSmile(smiles.map(s => s.dte), sampled.map(row => row[col]));
    y.forEach((dte, row) => { z[row][col] = sample(dte)!; });
  }
  return { ...base, x, y, z };
}

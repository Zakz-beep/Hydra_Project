"use client";

import { memo, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Layers3, RotateCcw } from "lucide-react";
import { buildVolatilitySurface, SurfaceOptions, SurfaceSide, VolatilitySurfaceInput } from "../../lib/volatilitySurface";
import VolatilitySurfaceSlices from "./VolatilitySurfaceSlices";

const Plot = dynamic(() => import("./VolatilitySurfacePlot"), { ssr: false, loading: () => <div role="status" className="flex h-full items-center justify-center text-sm text-zinc-400">Loading surface renderer…</div> });
const field = "mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-200 focus-visible:outline focus-visible:outline-cyan-400";
const defaultOptions: SurfaceOptions = { side: "otm", minOI: 10, rangePct: 15, quality: "smooth" };

function VolatilityTermStructure({ data }: { data: VolatilitySurfaceInput; scopeKey?: string }) {
  const [options, setOptions] = useState(defaultOptions);
  const [mode, setMode] = useState<"surface" | "heatmap">("surface");
  const [reset, setReset] = useState(0);
  const [plotError, setPlotError] = useState<string | null>(null);
  const onError = useCallback((error: Error) => setPlotError(error.message || "Renderer unavailable"), []);
  const grid = useMemo(() => buildVolatilitySurface(data, options), [data, options]);
  const update = (patch: Partial<SurfaceOptions>) => { setOptions(current => ({ ...current, ...patch })); setPlotError(null); };
  const changeMode = (value: typeof mode) => { setMode(value); setPlotError(null); };

  return <section aria-label="Volatility term structure analysis" className="min-w-0 space-y-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="mb-2 flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-400"><Layers3 size={14} /> Volatility lab</p><h3 className="text-base font-semibold">3D Volatility Term Structure</h3><p className="mt-1 text-xs text-zinc-400">Actual expiries. A continuous view of the volatility smile.</p></div>
      <div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">{(["surface", "heatmap"] as const).map(value => <button key={value} onClick={() => changeMode(value)} aria-pressed={mode === value} className={`rounded px-3 py-1.5 text-xs font-mono focus-visible:outline focus-visible:outline-cyan-400 ${mode === value ? "bg-zinc-800 text-cyan-300" : "text-zinc-400 hover:text-zinc-100"}`}>{value === "surface" ? "3D surface" : "Heatmap"}</button>)}</div><button onClick={() => setReset(value => value + 1)} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 focus-visible:outline focus-visible:outline-cyan-400"><RotateCcw size={13} />Reset view</button></div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <label className="text-xs text-zinc-400">Options used<select aria-label="Surface option side" className={field} value={options.side} onChange={e => update({ side: e.target.value as SurfaceSide })}><option value="otm">OTM puts + calls</option><option value="all">All · OI weighted</option><option value="call">Calls only</option><option value="put">Puts only</option></select></label>
      <label className="text-xs text-zinc-400">Strike range<select aria-label="Surface strike range" className={field} value={options.rangePct} onChange={e => update({ rangePct: Number(e.target.value) })}>{[5, 10, 15, 30].map(n => <option key={n} value={n}>±{n}% of spot</option>)}</select></label>
      <label className="text-xs text-zinc-400">Minimum open interest<select aria-label="Surface minimum OI" className={field} value={options.minOI} onChange={e => update({ minOI: Number(e.target.value) })}>{[0, 10, 100, 500].map(n => <option key={n} value={n}>{n === 0 ? "Include zero OI" : `${n}+ contracts`}</option>)}</select></label>
      <label className="text-xs text-zinc-400">Rendering<select aria-label="Surface rendering quality" className={field} value={options.quality} onChange={e => update({ quality: e.target.value as SurfaceOptions["quality"] })}><option value="smooth">Smooth</option><option value="fast">Lightweight</option></select></label>
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-[11px] font-mono text-zinc-400"><span>{grid.smiles.length} actual expiries · {grid.observed.toLocaleString()} observed strike/expiry points{grid.excludedExpiries > 0 ? ` · ${grid.excludedExpiries} sparse expiries excluded` : ""}</span><span>{mode === "surface" ? "Drag to rotate · pinch to zoom" : "Drag to zoom · double-click to reset"}</span></div>
    {grid.reason ? <div role="status" className="rounded-lg border border-amber-800/50 bg-amber-950/10 p-6 text-sm text-amber-200">{grid.reason}</div> : plotError ? <div role="alert" className="rounded-lg border border-amber-800/50 p-6 text-sm text-amber-200">The 3D renderer is unavailable. <button className="underline" onClick={() => changeMode("heatmap")}>Open the 2D heatmap</button><p className="mt-2 text-xs">{plotError}</p></div> : <div className="h-80 min-w-0 rounded-lg border border-zinc-800/70 bg-zinc-950/30 sm:h-[440px]" data-testid="volatility-plot" role="img" aria-label={`Interpolated volatility ${mode}. ${grid.smiles.length} actual expiries. Detailed expiry values are available below.`}><Plot grid={grid} ticker={data.ticker} mode={mode} reset={reset} onError={onError} /></div>}
    <p className="text-xs leading-relaxed text-zinc-400">Smooth interpolation between observed IVs; no extrapolation beyond shared strike coverage.{grid.x.length > 0 && <> Displayed strikes: <span className="font-mono text-zinc-200">${grid.x[0].toFixed(2)}–${grid.x.at(-1)!.toFixed(2)}</span>.</>} {options.side === "otm" && "OTM uses puts below spot and calls above spot."} Interpolated values are visual estimates, not additional quotes or an arbitrage-free calibration.</p>
    <VolatilitySurfaceSlices grid={grid} spot={data.spot} />
  </section>;
}

// The API returns the same immutable snapshot with fresh cache metadata every
// 15 seconds. Redraw only when the snapshot itself changes, not on cache polls.
export default memo(VolatilityTermStructure, (a, b) => a.scopeKey === b.scopeKey && a.data.ticker === b.data.ticker && a.data.timestamp === b.data.timestamp && a.data.spot === b.data.spot && a.data.data_source === b.data.data_source);

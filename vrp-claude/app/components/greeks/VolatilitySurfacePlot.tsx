"use client";

import { memo, useMemo } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js/lib/core";
import surface from "plotly.js/lib/surface";
import heatmap from "plotly.js/lib/heatmap";
import type { Config, Data, Layout } from "plotly.js";
import type { SurfaceGrid } from "../../lib/volatilitySurface";

Plotly.register([surface, heatmap]);
const Plot = createPlotlyComponent(Plotly);
const style = { width: "100%", height: "100%" };
const config: Partial<Config> = { displaylogo: false, responsive: true, scrollZoom: false, plotGlPixelRatio: 1, displayModeBar: false };
const colorscale: [number, string][] = [[0, "#153b69"], [.25, "#168a9a"], [.5, "#53d8b0"], [.75, "#f3d074"], [1, "#ef825d"]];
const camera = { eye: { x: 1.5, y: -1.65, z: 1.1 } };

interface Props { grid: SurfaceGrid; ticker: string; mode: "surface" | "heatmap"; reset: number; onError: (error: Error) => void }

export default memo(function VolatilitySurfacePlot({ grid, ticker, mode, reset, onError }: Props) {
  const traces = useMemo<Data[]>(() => [{
    // Plotly can mutate input arrays; keep the analysis model immutable.
    x: [...grid.x], y: [...grid.y], z: grid.z.map(row => [...row]), type: mode,
    colorscale, showscale: true, connectgaps: false,
    colorbar: { title: { text: "IV %", font: { size: 11 } }, tickfont: { size: 10 }, thickness: 10, len: .75, outlinewidth: 0 },
    hovertemplate: "Strike $%{x:.2f}<br>DTE %{y:.1f}<br>Interpolated IV %{z:.2f}%<extra></extra>",
    ...(mode === "surface" ? { lighting: { ambient: .8, diffuse: .8, roughness: .8, specular: .15 }, contours: { z: { show: false } } } : { zsmooth: "best" }),
  } as Data], [grid, mode]);
  const layout = useMemo<Partial<Layout>>(() => {
    const axis = (text: string) => ({ title: { text, font: { size: 11 } }, color: "#a1a1aa", gridcolor: "#303038", zerolinecolor: "#303038", tickfont: { size: 10 }, showspikes: false });
    return {
      autosize: true, margin: mode === "surface" ? { l: 0, r: 20, b: 0, t: 0 } : { l: 48, r: 30, b: 44, t: 12 },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { color: "#a1a1aa", family: "monospace" },
      uirevision: `${ticker}-${reset}`,
      scene: { uirevision: `${ticker}-${reset}`, xaxis: axis("Strike ($)"), yaxis: axis("Days to expiry"), zaxis: axis("IV (%)"), camera: { eye: { ...camera.eye } }, aspectratio: { x: 1.5, y: 1.3, z: .8 }, dragmode: "orbit" },
      xaxis: axis("Strike ($)"), yaxis: axis("Days to expiry"),
    };
  }, [ticker, mode, reset]);
  return <Plot data={traces} layout={layout} config={config} style={style} useResizeHandler onError={onError} />;
});

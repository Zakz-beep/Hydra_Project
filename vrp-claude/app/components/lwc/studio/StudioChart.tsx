'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AreaSeries, BarSeries, CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, LineStyle, type ISeriesMarkersPluginApi, type SeriesMarkerBar, type IChartApi, type ISeriesApi, type SeriesType, type Time, type UTCTimestamp } from 'lightweight-charts';
import { Bar, Drawing, Plot, Study, StudyResult, Tool } from '../../../lib/chart-studio/types';
import DrawingLayer from './DrawingLayer';
import { resolvePlotStyle, plotColor } from '../../../lib/chart-studio/plotStyle';
import { ChartAppearance } from '../../../lib/chart-studio/appearance';
import { VolumeProfile } from '../../../lib/chart-studio/orderflow';
import { VolumeProfilePrimitive } from '../../../lib/chart-studio/volumeProfilePrimitive';

export interface ChartHandle { fit: () => void; image: () => Promise<string | undefined>; reset: () => void; view: () => { from: number; to: number } | undefined; getCanvas?: () => HTMLCanvasElement | null; getSvg?: () => SVGSVGElement | null; }
interface Props {
  appearance: ChartAppearance; intervalSeconds: number; stayInDrawing: boolean; bars: Bar[]; instrumentKey: string; light: boolean; chartType: string; logScale: boolean;
  studies: Study[]; results: Record<string, StudyResult>; drawings: Drawing[]; tool: Tool; color: string; magnet: boolean;
  onDrawings: (d: Drawing[]) => void; onTool: (t: Tool) => void; onCrosshair: (b: Bar | null) => void;
  viewport?: { key: string; from: number; to: number };
  profile?: VolumeProfile | null; onVisibleRange?: (range: { from: number; to: number } | null) => void;
}
const timestamp = (n: number) => n as UTCTimestamp;
export default forwardRef<ChartHandle, Props>(function StudioChart(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null); const price = useRef<ISeriesApi<SeriesType> | null>(null); const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const previous = useRef<Bar[]>([]); const first = useRef(true); const allBars = useRef(p.bars); allBars.current = p.bars;
  const crosshair = useRef(p.onCrosshair); crosshair.current = p.onCrosshair;
  const [revision, setRevision] = useState(0);
  const profilePrimitive = useRef<VolumeProfilePrimitive | null>(null);
  const visibleRangeCallback = useRef(p.onVisibleRange); visibleRangeCallback.current = p.onVisibleRange;
  useImperativeHandle(ref, () => ({
    fit: () => chart.current?.timeScale().fitContent(),
    reset: () => { chart.current?.priceScale('right').applyOptions({ autoScale: true }); chart.current?.timeScale().fitContent(); },
    view: () => { const range = chart.current?.timeScale().getVisibleRange(); return range ? { from: Number(range.from), to: Number(range.to) } : undefined; },
    getCanvas: () => chart.current?.takeScreenshot() || null,
    getSvg: () => (host.current?.parentElement?.querySelector('svg') as SVGSVGElement | null) || null,
    image: async () => {
    const canvas = chart.current?.takeScreenshot(); const svg = host.current?.parentElement?.querySelector('svg');
    if (!canvas) return undefined;
    if (svg) {
      const clone = svg.cloneNode(true) as SVGSVGElement; clone.querySelectorAll('[data-handle],.cs-drawing-hit').forEach(el => el.remove()); clone.setAttribute('width', String(svg.clientWidth)); clone.setAttribute('height', String(svg.clientHeight));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      try { const img = new Image(); img.src = url; await img.decode(); const scale = canvas.width / (host.current?.clientWidth || canvas.width); canvas.getContext('2d')?.drawImage(img, 0, 0, svg.clientWidth * scale, svg.clientHeight * scale); } finally { URL.revokeObjectURL(url); }
    }
    return canvas.toDataURL('image/png');
  } }), []);
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: p.light ? '#f6f8fa' : '#0c1119' }, textColor: p.light ? '#526079' : '#8999b1', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace', attributionLogo: true, panes: { separatorColor: p.light ? '#dfe5ed' : '#1f2a3a', separatorHoverColor: '#3f756e', enableResize: true } },
      grid: { vertLines: { color: p.light ? '#edf0f4' : '#151e2b' }, horzLines: { color: p.light ? '#edf0f4' : '#151e2b' } },
      rightPriceScale: { borderVisible: false, minimumWidth: 72 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 8, minBarSpacing: 2, rightBarStaysOnScroll: true },
      crosshair: { mode: 0, vertLine: { color: '#64748b', style: LineStyle.Dashed }, horzLine: { color: '#64748b', style: LineStyle.Dashed } },
    });
    chart.current = c;
    if (p.chartType === 'line') price.current = c.addSeries(LineSeries, { color: '#45c9b0', lineWidth: 2 });
    else if (p.chartType === 'area') price.current = c.addSeries(AreaSeries, { lineColor: '#45c9b0', topColor: '#45c9b044', bottomColor: '#45c9b002', lineWidth: 2 });
    else if (p.chartType === 'bars') price.current = c.addSeries(BarSeries, { upColor: '#45c9b0', downColor: '#df7884' });
    else price.current = c.addSeries(CandlestickSeries, { upColor: '#45c9b0', downColor: '#df7884', wickUpColor: '#45c9b0', wickDownColor: '#df7884', borderVisible: false });
    volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    profilePrimitive.current = new VolumeProfilePrimitive(); price.current.attachPrimitive(profilePrimitive.current);
    c.timeScale().subscribeVisibleTimeRangeChange(range => visibleRangeCallback.current?.(range ? { from: Number(range.from), to: Number(range.to) } : null));
    c.subscribeCrosshairMove(event => { const t = Number(event.time); crosshair.current(allBars.current.find(b => b.time === t) || null); });
    previous.current = []; first.current = true; setRevision(v => v + 1);
    return () => { c.remove(); chart.current = null; price.current = null; volume.current = null; profilePrimitive.current = null; };
  }, [p.chartType]);
  useEffect(() => {
    const a = p.appearance; const c = chart.current; const main = price.current;
    if (!c || !main) return;
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: a.background }, textColor: a.text, fontSize: 12, fontFamily: 'Arial, sans-serif', panes: { separatorColor: a.grid, separatorHoverColor: a.crosshair } },
      grid: { vertLines: { color: a.grid, visible: a.gridMode === 'both' }, horzLines: { color: a.grid, visible: a.gridMode !== 'none' } },
      crosshair: { vertLine: { color: a.crosshair, labelBackgroundColor: a.crosshair }, horzLine: { color: a.crosshair, labelBackgroundColor: a.crosshair } },
    });
    if (p.chartType === 'candles') main.applyOptions({ upColor: a.up, downColor: a.down, wickUpColor: a.wickUp, wickDownColor: a.wickDown, borderUpColor: a.borderUp, borderDownColor: a.borderDown, borderVisible: a.borders, wickVisible: a.wicks });
    else if (p.chartType === 'bars') main.applyOptions({ upColor: a.up, downColor: a.down });
    else if (p.chartType === 'area') main.applyOptions({ lineColor: a.up, topColor: a.up + '44', bottomColor: a.up + '02' });
    else main.applyOptions({ color: a.up });
    volume.current?.applyOptions({ visible: a.volume });
    volume.current?.setData(allBars.current.map(b => ({ time: timestamp(b.time), value: b.volume, color: (b.close >= b.open ? a.up : a.down) + '40' })));
  }, [p.appearance, p.chartType, revision]);
  useEffect(() => { previous.current = []; first.current = true; chart.current?.priceScale('right').applyOptions({ autoScale: true }); }, [p.instrumentKey]);
  useEffect(() => {
    const series = price.current; if (!series || !volume.current || !chart.current) return;
    const bars = p.bars; const old = previous.current;
    const value = (b: Bar) => p.chartType === 'line' || p.chartType === 'area' ? { time: timestamp(b.time), value: b.close } : { ...b, time: timestamp(b.time) };
    const vol = (b: Bar) => ({ time: timestamp(b.time), value: b.volume, color: b.close >= b.open ? p.appearance.up + '40' : p.appearance.down + '40' });
    const incremental = old.length > 0 && bars.length >= old.length && bars.length <= old.length + 1 && bars[0] === old[0] && (old.length < 2 || bars[old.length - 2] === old[old.length - 2]);
    if (incremental) { for (let i = old.length - 1; i < bars.length; i++) { series.update(value(bars[i])); volume.current.update(vol(bars[i])); } }
    else { series.setData(bars.map(value)); volume.current.setData(bars.map(vol)); }
    if (first.current && bars.length) {
      if (p.viewport?.key === p.instrumentKey && Number.isFinite(p.viewport.from) && Number.isFinite(p.viewport.to) && p.viewport.to > p.viewport.from) chart.current.timeScale().setVisibleRange({ from: timestamp(p.viewport.from), to: timestamp(p.viewport.to) });
      else chart.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 160), to: bars.length + 12 });
      first.current = false;
    }
    previous.current = bars;
  }, [p.bars, p.chartType, revision, p.instrumentKey]);
  useEffect(() => { chart.current?.priceScale('right').applyOptions({ mode: p.logScale ? 1 : 0 }); }, [p.logScale, revision]);
  useEffect(() => { profilePrimitive.current?.setData(p.profile || null, p.light); }, [p.profile, p.light, revision]);
  const studySeries = useRef(new Map<string, { series: ISeriesApi<SeriesType>; plot: Plot; studyId: string }>());
  const studyMarkers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const styleSignature = JSON.stringify(p.studies.map(s => [s.id, s.styles]));
  const enabledStudies = p.studies.map(s => `${s.id}:${s.enabled}`).join('|');
  useEffect(() => {
    const c = chart.current; const main = price.current; if (!c || !main) return;
    studySeries.current.clear();
    const added: ISeriesApi<SeriesType>[] = []; const panes = new Map<string, number>(); 
    for (const study of p.studies.filter(s => s.enabled)) {
      for (const plot of p.results[study.id]?.plots || []) {
        if (plot.kind === 'box') continue;
        if (plot.kind === 'marker') continue;
        const paneKey = `${study.id}:${plot.pane}`;
        if (plot.pane !== 'price' && !panes.has(paneKey)) panes.set(paneKey, panes.size + 1);
        const pane = plot.pane === 'price' ? 0 : panes.get(paneKey)!;
        const options = { color: plot.color, title: plot.title, lastValueVisible: true, priceLineVisible: false };
        let s: ISeriesApi<SeriesType>;
        if (plot.kind === 'histogram') s = c.addSeries(HistogramSeries, options, pane);
        else if (plot.kind === 'area') s = c.addSeries(AreaSeries, { ...options, lineColor: plot.color, topColor: `${plot.color}40`, bottomColor: `${plot.color}04`, lineWidth: 1 }, pane);
        else s = c.addSeries(LineSeries, { ...options, lineWidth: 1, lineStyle: plot.kind === 'hline' ? LineStyle.Dashed : LineStyle.Solid }, pane);
        if (plot.kind === 'hline') {
          const bars = allBars.current;
          s.setData(bars.length > 1 ? [{ time: timestamp(bars[0].time), value: plot.value! }, { time: timestamp(bars[bars.length - 1].time), value: plot.value! }] : []);
        } else s.setData(plot.data.map(d => d.value == null ? { time: timestamp(d.time) } : { time: timestamp(d.time), value: d.value }));
        added.push(s); studySeries.current.set(JSON.stringify([study.id, plot.id]), { series: s, plot, studyId: study.id });
      }
    }
    for (let i = 1; i < c.panes().length; i++) c.panes()[i].setHeight(120);
    const markerApi = createSeriesMarkers(main, []); studyMarkers.current = markerApi;
    return () => { if (chart.current !== c) return; markerApi.detach(); studyMarkers.current = null; studySeries.current.clear(); for (const s of added.reverse()) c.removeSeries(s); };
    // Studies update only when a run finishes, never for each market tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.results, enabledStudies, revision]);
  useEffect(() => {
    // Style-only edits keep the series, pane sizes and viewport intact.
    for (const { series, plot, studyId } of Array.from(studySeries.current.values())) {
      const study = p.studies.find(s => s.id === studyId); const style = resolvePlotStyle(plot, study?.styles?.[plot.id]);
      const color = plotColor(style.color, style.opacity);
      series.applyOptions({ visible: style.visible, title: style.priceLabel ? style.title : '', lastValueVisible: style.priceLabel, priceLineVisible: style.priceLine, color });
      if (plot.kind !== 'histogram') series.applyOptions({ lineWidth: style.width, lineStyle: style.dash === 'dashed' ? LineStyle.Dashed : style.dash === 'dotted' ? LineStyle.Dotted : LineStyle.Solid, lineType: style.interpolation === 'step' ? 1 : 0 });
      if (plot.kind === 'area') series.applyOptions({ lineColor: color, topColor: plotColor(style.color, style.fillOpacity * style.opacity / 100), bottomColor: plotColor(style.color, 0) });
    }
    const markers: SeriesMarkerBar<Time>[] = []; const times = new Set(allBars.current.map(b => b.time));
    for (const study of p.studies.filter(s => s.enabled)) for (const plot of p.results[study.id]?.plots || []) {
      if (plot.kind !== 'marker') continue; const style = resolvePlotStyle(plot, study.styles?.[plot.id]); if (!style.visible) continue;
      for (const d of plot.data) if (d.value != null && times.has(d.time)) markers.push({ time: timestamp(d.time), color: plotColor(style.color, style.opacity), position: style.markerPosition, shape: style.markerShape, size: style.markerSize, text: study.styles?.[plot.id]?.title !== undefined ? style.title : d.text || plot.title });
    }
    studyMarkers.current?.setMarkers(markers.sort((a,b) => Number(a.time) - Number(b.time)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSignature, enabledStudies, p.results, revision]);
  const boxes: Drawing[] = p.studies.filter(s => s.enabled).flatMap(s => (p.results[s.id]?.plots || []).filter(v => v.kind === 'box' && v.pane === 'price').map(v => {
    const style = resolvePlotStyle(v, s.styles?.[v.id]);
    return { id: 'study:' + s.id + ':' + v.id, type: 'rectangle' as const, color: style.color, hidden: !style.visible, lineWidth: style.width, lineStyle: style.dash, fillOpacity: style.fillOpacity / 100, opacity: style.opacity / 100, points: [{ time: v.value!, price: v.top! }, { time: v.endTime!, price: v.bottom! }], locked: true, text: style.title };
  }));
  return <div className="cs-chart-wrap"><div ref={host} className="cs-chart-canvas" />{chart.current && price.current && <DrawingLayer key={p.instrumentKey} intervalSeconds={p.intervalSeconds} stayInDrawing={p.stayInDrawing} chart={chart.current} series={price.current} bars={p.bars} drawings={p.drawings} overlays={boxes} tool={p.tool} color={p.color} magnet={p.magnet} onChange={p.onDrawings} onTool={p.onTool} revision={revision} />}</div>;
});

'use client';
import { useEffect, useRef, useState } from 'react';
import { Code2, Play, RotateCcw, X } from 'lucide-react';
import type { Plot, Study, StudyResult } from '../../../lib/chart-studio/types';
import { PlotStyle, resolvePlotStyle } from '../../../lib/chart-studio/plotStyle';
interface Props { study: Study; result?: StudyResult; busy: boolean; error: string; context: string; onChange: (s: Study) => void; onRun: () => void; onCode: () => void; onClose: () => void }
export default function IndicatorSettings(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null); const [tab, setTab] = useState('Style');
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const stale = p.result && (p.result.code !== p.study.code || p.result.context !== p.context || JSON.stringify(p.study.params) !== JSON.stringify(p.result.params));
  const patch = (plot: Plot, patch: Partial<PlotStyle>) => p.onChange({ ...p.study, styles: { ...p.study.styles, [plot.id]: { ...p.study.styles?.[plot.id], ...patch } } });
  return <dialog ref={dialog} className="cs-settings-dialog cs-indicator-dialog" aria-labelledby="cs-indicator-title" onCancel={p.onClose} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && index <= 0) { e.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!e.shiftKey && index === nodes.length - 1) { e.preventDefault(); nodes[0]?.focus(); }
  }} onClick={e => { if (e.target === dialog.current) p.onClose(); }}>
    <header><div><h2 id="cs-indicator-title">{p.study.name}</h2><p>Indicator settings · Python study</p></div><button aria-label="Close indicator settings" onClick={p.onClose}><X size={20} /></button></header>
    <div className="cs-indicator-tabs" role="tablist" aria-label="Indicator settings tabs">{['Inputs', 'Style'].map(t => <button role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
    <div className="cs-indicator-content" role="tabpanel" aria-label={tab}>
      {tab === 'Inputs' ? <><label className="cs-setting-row"><span>Indicator name</span><input aria-label="Indicator display name" maxLength={60} value={p.study.name} onChange={e => p.onChange({ ...p.study, name: e.target.value })} /></label><label className="cs-setting-row"><span>Run on candle close</span><input type="checkbox" checked={p.study.auto} onChange={e => p.onChange({ ...p.study, auto: e.target.checked })} /></label>
        {!p.result && <p className="cs-setting-hint">Run this indicator once to discover its inputs and plots.</p>}
        {p.result && !p.result.inputs.length && <p className="cs-setting-hint">This script has no numeric inputs. You can edit its Python source.</p>}
        {p.result?.inputs.map(param => <label className="cs-setting-row" key={param.name}><span>{param.name.replaceAll('_', ' ')}</span><input aria-label={`Input ${param.name}`} type="number" min={param.min} max={param.max} step={param.step} value={p.study.params[param.name] ?? param.value} onChange={e => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) p.onChange({ ...p.study, params: { ...p.study.params, [param.name]: n } }); }} /></label>)}
        <p className="cs-setting-hint">Input changes need Run to recalculate. Style changes appear immediately.</p></> : <>
        <label className="cs-setting-row cs-indicator-visible"><span>Show indicator</span><input type="checkbox" checked={p.study.enabled} onChange={e => p.onChange({ ...p.study, enabled: e.target.checked })} /></label>
        {!p.result && <div className="cs-indicator-empty"><Code2 size={28} /><strong>Run once to see your plots</strong><p>Then customize each line, histogram, marker or zone here.</p></div>}
        {p.result?.plots.map(plot => { const style = resolvePlotStyle(plot, p.study.styles?.[plot.id]); const line = ['line', 'area', 'hline', 'box'].includes(plot.kind); return <section className="cs-plot-style" key={plot.id} data-plot-style={plot.id}>
          <div className="cs-plot-style-heading"><label><input aria-label={`Show plot ${plot.id}`} type="checkbox" checked={style.visible} onChange={e => patch(plot, { visible: e.target.checked })} /><strong>{style.title || plot.id}</strong></label><span>{plot.kind} · {plot.pane}</span><button title="Reset this plot to Python defaults" aria-label={`Reset plot ${plot.id}`} onClick={() => { const styles = { ...p.study.styles }; delete styles[plot.id]; p.onChange({ ...p.study, styles }); }}><RotateCcw size={13} /></button></div>
          <div className="cs-plot-style-controls"><label>Color<span className="cs-color-control"><input aria-label={`Color ${plot.id}`} type="color" value={style.color} onChange={e => patch(plot, { color: e.target.value })} /><code>{style.color.toUpperCase()}</code></span></label>
            {line && <><label>Thickness<select aria-label={`Thickness ${plot.id}`} value={style.width} onChange={e => patch(plot, { width: Number(e.target.value) as PlotStyle['width'] })}>{[1, 2, 3, 4].map(n => <option value={n} key={n}>{n} px</option>)}</select></label><label>Line style<select aria-label={`Line style ${plot.id}`} value={style.dash} onChange={e => patch(plot, { dash: e.target.value as PlotStyle['dash'] })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label></>}
            <label>Opacity<input aria-label={`Opacity ${plot.id}`} type="range" min={0} max={100} value={style.opacity} onChange={e => patch(plot, { opacity: Number(e.target.value) })} /><small>{style.opacity}%</small></label>
          </div>
          <div className="cs-plot-style-options"><label>Label<input aria-label={`Label ${plot.id}`} maxLength={80} value={style.title} onChange={e => patch(plot, { title: e.target.value })} /></label>
            {['line','area'].includes(plot.kind) && <label>Line shape<select aria-label={`Line shape ${plot.id}`} value={style.interpolation} onChange={e => patch(plot, { interpolation: e.target.value as PlotStyle['interpolation'] })}><option value="straight">Straight</option><option value="step">Step line</option></select></label>}
            {['area','box'].includes(plot.kind) && <label>Fill opacity<input aria-label={`Fill opacity ${plot.id}`} type="range" min={0} max={100} value={style.fillOpacity} onChange={e => patch(plot, { fillOpacity: Number(e.target.value) })} /><small>{style.fillOpacity}%</small></label>}
            {plot.kind === 'marker' && <><label>Shape<select aria-label={`Marker shape ${plot.id}`} value={style.markerShape} onChange={e => patch(plot, { markerShape: e.target.value as PlotStyle['markerShape'] })}>{['arrowDown','arrowUp','circle','square'].map(v => <option key={v}>{v}</option>)}</select></label><label>Position<select aria-label={`Marker position ${plot.id}`} value={style.markerPosition} onChange={e => patch(plot, { markerPosition: e.target.value as PlotStyle['markerPosition'] })}>{['aboveBar','belowBar','inBar'].map(v => <option key={v}>{v}</option>)}</select></label><label>Size<input aria-label={`Marker size ${plot.id}`} type="range" min={.5} max={4} step={.5} value={style.markerSize} onChange={e => patch(plot, { markerSize: Number(e.target.value) })} /></label></>}
          </div>
          {!['marker','box'].includes(plot.kind) && <div className="cs-plot-style-flags"><label><input type="checkbox" checked={style.priceLabel} onChange={e => patch(plot, { priceLabel: e.target.checked })} aria-label={`Price label ${plot.id}`} />Price scale label</label><label><input type="checkbox" checked={style.priceLine} onChange={e => patch(plot, { priceLine: e.target.checked })} aria-label={`Price line ${plot.id}`} />Last value line</label></div>}
        </section>; })}
      </>}
    </div>
    <div className="cs-indicator-message" role="status">{p.error || (p.busy ? 'Running Python…' : stale ? 'Inputs or code changed · Run to update values' : 'Style previews instantly · saved automatically')}</div>
    <footer><button onClick={() => p.onChange({ ...p.study, ...(tab === 'Style' ? { styles: {} } : { params: {} }) })}><RotateCcw size={14} />Reset {tab.toLowerCase()}</button><button onClick={p.onCode}><Code2 size={14} />Python</button><button disabled={p.busy} onClick={p.onRun}><Play size={14} />Run indicator</button><button className="cs-primary" onClick={p.onClose}>Done</button></footer>
  </dialog>;
}

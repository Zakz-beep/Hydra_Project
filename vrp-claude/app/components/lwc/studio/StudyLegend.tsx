'use client';
import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import type { Study, StudyResult } from '../../../lib/chart-studio/types';
import { resolvePlotStyle } from '../../../lib/chart-studio/plotStyle';
interface Props { studies: Study[]; results: Record<string, StudyResult>; onSettings: (id: string) => void; onChange: (s: Study) => void; onRemove: (id: string) => void }
export default function StudyLegend(p: Props) {
  if (!p.studies.length) return null;
  return <div className="cs-study-legend" aria-label="Chart indicators">{p.studies.map(s => <div key={s.id} className={!s.enabled ? 'cs-study-muted' : ''}>
    <button className="cs-legend-name" title="Open indicator settings" onClick={() => p.onSettings(s.id)}>{s.name}</button>
    <div className="cs-legend-swatches">{p.results[s.id]?.plots.slice(0, 4).map(plot => { const style = resolvePlotStyle(plot, s.styles?.[plot.id]); return <span key={plot.id} title={style.title} style={{ color: style.color, opacity: style.visible ? 1 : .3 }}><i style={{ background: style.color }} />{style.title}</span>; })}</div>
    <span className="cs-legend-actions"><button title="Indicator settings" aria-label={`Configure ${s.name}`} onClick={() => p.onSettings(s.id)}><Settings2 size={14} /></button><button title={s.enabled ? 'Hide indicator' : 'Show indicator'} aria-label={`Toggle indicator ${s.name}`} onClick={() => p.onChange({ ...s, enabled: !s.enabled })}>{s.enabled ? <Eye size={14} /> : <EyeOff size={14} />}</button><button title="Remove indicator" aria-label={`Delete indicator ${s.name}`} onClick={() => p.onRemove(s.id)}><X size={14} /></button></span>
    {!p.results[s.id] && <small>Run to plot</small>}
  </div>)}</div>;
}

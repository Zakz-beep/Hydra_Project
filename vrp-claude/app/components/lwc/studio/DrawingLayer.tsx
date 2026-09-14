'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, LockKeyhole, UnlockKeyhole, Trash2, X } from 'lucide-react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import { Bar, Drawing, Point, Tool } from '../../../lib/chart-studio/types';

interface Props { chart: IChartApi; series: ISeriesApi<SeriesType>; bars: Bar[]; drawings: Drawing[]; overlays: Drawing[]; tool: Tool; color: string; magnet: boolean; intervalSeconds: number; stayInDrawing: boolean; onChange: (d: Drawing[]) => void; onTool: (t: Tool) => void; revision: number }
type XY = { x: number; y: number };
type Gesture = { start: XY; drawing: Drawing; handle: number | null; edit: boolean; second?: boolean };
export default function DrawingLayer(p: Props) {
  const svg = useRef<SVGSVGElement>(null); const [, invalidate] = useState(0);
  const [draft, setDraftState] = useState<Drawing | null>(null); const draftRef = useRef<Drawing | null>(null);
  const setDraft = (d: Drawing | null) => { draftRef.current = d; setDraftState(d); };
  const [selected, select] = useState(''); const [note, setNote] = useState<Drawing | null>(null);
  const gesture = useRef<Gesture | null>(null); const waiting = useRef(false); const callbacks = useRef(p); callbacks.current = p;
  const active = p.drawings.find(d => d.id === selected && !d.hidden);
  const cancel = () => { gesture.current = null; waiting.current = false; setDraft(null); };
  useEffect(() => {
    let frame = 0;
    const update = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; invalidate(v => v + 1); }); };
    p.chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const element = svg.current?.parentElement;
    const clear = (e: PointerEvent) => { if (!(e.target as Element).closest('[data-drawing-id],.cs-drawing-properties,.cs-note-editor')) select(''); };
    element?.addEventListener('pointermove', update); element?.addEventListener('pointerdown', clear);
    element?.addEventListener('wheel', update, { passive: true });
    const observer = new ResizeObserver(update); if (element) observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); element?.removeEventListener('pointermove', update); element?.removeEventListener('pointerdown', clear); element?.removeEventListener('wheel', update); try { p.chart.timeScale().unsubscribeVisibleLogicalRangeChange(update); } catch {} };
  }, [p.chart]);
  useEffect(() => { cancel(); if (p.tool !== 'cursor') select(''); }, [p.tool]);
  // Prevent price/candle updates and indicator pane resizes from leaving overlays at old coordinates.
  useEffect(() => { const frame = requestAnimationFrame(() => invalidate(v => v + 1)); return () => cancelAnimationFrame(frame); }, [p.bars, p.revision]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable],dialog')) return;
      if (e.key === 'Escape') { cancel(); select(''); setNote(null); callbacks.current.onTool('cursor'); }
      if (['Delete', 'Backspace'].includes(e.key) && selected) { e.preventDefault(); callbacks.current.onChange(callbacks.current.drawings.filter(d => d.id !== selected || d.locked)); select(''); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [selected]);
  const times = useMemo(() => p.bars.map(b => b.time), [p.bars]); const step = p.intervalSeconds;
  const logical = (time: number) => {
    let lo = 0, hi = times.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] === time) return mid; if (times[mid] < time) lo = mid + 1; else hi = mid - 1; }
    if (lo === 0) return (time - times[0]) / step;
    if (lo >= times.length) return times.length - 1 + (time - times[times.length - 1]) / step;
    return lo - 1 + (time - times[lo - 1]) / (times[lo] - times[lo - 1]);
  };
  const timeAt = (index: number) => { const i = Math.floor(index); if (i < 0) return times[0] + index * step; if (i >= times.length - 1) return times[times.length - 1] + (index - times.length + 1) * step; return times[i] + (index - i) * (times[i + 1] - times[i]); };
  const xy = (point: Point): XY => {
    const index = logical(point.time), base = Math.floor(index), scale = p.chart.timeScale();
    const x0 = scale.logicalToCoordinate(base as Logical), x1 = scale.logicalToCoordinate((base + 1) as Logical);
    return { x: x0 != null && x1 != null ? x0 + (index - base) * (x1 - x0) : NaN, y: p.series.priceToCoordinate(point.price) ?? NaN };
  };
  const eventXY = (e: React.PointerEvent): XY => { const r = svg.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pointAt = (pos: XY, snap = true): Point | null => {
    if (!times.length) return null;
    const scale = p.chart.timeScale(); const rawIndex = scale.coordinateToLogical(pos.x); const price = p.series.coordinateToPrice(pos.y);
    if (rawIndex == null || price == null) return null;
    // coordinateToLogical rounds to a candle. Interpolate adjacent public coordinates
    // so free drawings move continuously; the magnet alone opts into OHLC snapping.
    const x0 = scale.logicalToCoordinate(rawIndex), x1 = scale.logicalToCoordinate((Number(rawIndex) + 1) as Logical);
    const idx = x0 != null && x1 != null && x1 !== x0 ? Number(rawIndex) + (pos.x - x0) / (x1 - x0) : Number(rawIndex);
    let point = { time: timeAt(idx), price: Number(price) };
    if (p.magnet && snap) {
      const i = Math.round(Number(idx)); const bar = p.bars[i];
      if (bar) { const candidates = [bar.open, bar.high, bar.low, bar.close].map(price => ({ time: bar.time, price }));
        const nearest = candidates.sort((a,b) => Math.hypot(xy(a).x-pos.x, xy(a).y-pos.y)-Math.hypot(xy(b).x-pos.x, xy(b).y-pos.y))[0];
        if (Math.hypot(xy(nearest).x-pos.x, xy(nearest).y-pos.y) <= 14) point = nearest;
      }
    }
    return Number.isFinite(point.time) && Number.isFinite(point.price) ? point : null;
  };
  const commit = (d: Drawing, editing = false) => {
    p.onChange(editing ? p.drawings.map(old => old.id === d.id ? d : old) : [...p.drawings, d]);
    cancel(); select(d.id); if (!p.stayInDrawing || editing) p.onTool('cursor');
  };
  const down = (event: React.PointerEvent, drawing?: Drawing, handle: number | null = null) => {
    if (event.button !== 0) return; const pos = eventXY(event); const point = pointAt(pos); if (!point) return;
    event.stopPropagation();
    if (p.tool === 'eraser') { if (drawing && !drawing.locked) p.onChange(p.drawings.filter(d => d.id !== drawing.id)); return; }
    if (p.tool === 'cursor') {
      if (!drawing) { select(''); return; } select(drawing.id); if (drawing.locked) return;
      event.preventDefault(); svg.current?.setPointerCapture(event.pointerId);
      gesture.current = { start: pos, drawing, handle, edit: true }; setDraft(drawing); return;
    }
    event.preventDefault(); svg.current?.setPointerCapture(event.pointerId);
    if (waiting.current && draftRef.current) { gesture.current = { start: pos, drawing: draftRef.current, handle: null, edit: false, second: true }; return; }
    const next: Drawing = { id: crypto.randomUUID(), type: p.tool, color: p.color, lineWidth: 2, lineStyle: 'solid', fillOpacity: .12, points: [point, point] };
    if (p.tool === 'text') { setNote({ ...next, points: [point], text: '' }); p.onTool('cursor'); return; }
    gesture.current = { start: pos, drawing: next, handle: null, edit: false }; setDraft(next);
  };
  const move = (event: React.PointerEvent) => {
    const d = draftRef.current; if (!d) return; let pos = eventXY(event); const base = gesture.current;
    if (event.shiftKey && !base?.edit && d.type !== 'brush') { const a = xy(d.points[0]); const dx = pos.x-a.x, dy = pos.y-a.y; const angle = Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4); const length = Math.hypot(dx,dy); pos = { x: a.x+Math.cos(angle)*length, y: a.y+Math.sin(angle)*length }; }
    const point = pointAt(pos); if (!point) return;
    if (base?.edit) {
      if (base.handle != null) {
        let points = base.drawing.points.map(q => ({...q}));
        if (d.type === 'rectangle' && base.handle >= 2) {
          if (base.handle === 2) points = [{time:point.time,price:points[0].price},{time:points[1].time,price:point.price}];
          else points = [{time:points[0].time,price:point.price},{time:point.time,price:points[1].price}];
        } else { points[base.handle] = point;
          if ((d.type === 'long' || d.type === 'short') && base.handle > 0 && points.length === 3) points[base.handle === 1 ? 2 : 1].time = point.time;
        }
        setDraft({ ...d, points });
      } else {
        const dx = pos.x-base.start.x, dy = pos.y-base.start.y;
        setDraft({ ...d, points: base.drawing.points.map(q => { const original = xy(q); return pointAt({x:original.x+dx,y:original.y+dy},false) || q; }) });
      }
    } else if (d.type === 'brush') {
      const last = xy(d.points[d.points.length - 1]);
      if (Math.hypot(last.x-pos.x,last.y-pos.y) > 2 && d.points.length < 1500) setDraft({ ...d, points: [...d.points, point] });
    } else setDraft({ ...d, points: [d.points[0], point] });
  };
  const up = (event: React.PointerEvent) => {
    if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    const d = draftRef.current, base = gesture.current; if (!d || !base) return;
    const pos = eventXY(event); const moved = Math.hypot(pos.x-base.start.x,pos.y-base.start.y) > 4;
    if (base.edit) { if (moved) commit(d,true); else cancel(); return; }
    if (base.second || moved || ['horizontal','vertical','brush'].includes(d.type)) {
      // Store independent target/stop anchors for editable position drawings.
      if ((d.type === 'long' || d.type === 'short') && d.points.length === 2) {
        const entry=d.points[0], target=d.points[1]; const risk=Math.abs(target.price-entry.price)/2;
        const reward=Math.abs(target.price-entry.price);
        commit({...d,points:[entry,{time:target.time,price:entry.price+(d.type==='long'?reward:-reward)},{time:target.time,price:entry.price+(d.type==='long'?-risk:risk)}]});
      } else commit(d);
    } else { waiting.current = true; gesture.current = null; }
  };
  const width = Math.max(0, (svg.current?.parentElement?.clientWidth || 800) - p.chart.priceScale('right').width());
  const height = p.chart.panes()[0]?.getHeight() || 400;
  const render = (d: Drawing, readOnly = false, preview = false) => {
    if (d.hidden || !d.points.length || !times.length) return null;
    const pts=d.points.map(xy), a=pts[0], b=pts[1] || a;
    if (!pts.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y))) return null;
    const left=Math.min(a.x,b.x), top=Math.min(a.y,b.y), w=Math.abs(a.x-b.x), h=Math.abs(a.y-b.y);
    let shape: React.ReactNode; let hit: React.ReactNode;
    let handles= d.points.length > 1 ? [a,b] : [a];
    if (d.type==='rectangle') { shape=<rect x={left} y={top} width={Math.max(w,1)} height={Math.max(h,1)} fill={d.color} fillOpacity={d.fillOpacity ?? .12}/>; hit=<rect x={left} y={top} width={Math.max(w,1)} height={Math.max(h,1)} fill="transparent"/>; handles=[a,b,{x:a.x,y:b.y},{x:b.x,y:a.y}]; }
    else if (d.type==='horizontal') { shape=<line x1={0} y1={a.y} x2={width} y2={a.y}/>; hit=shape; handles=[a]; }
    else if (d.type==='vertical') { shape=<line x1={a.x} y1={0} x2={a.x} y2={height}/>; hit=shape; handles=[a]; }
    else if (d.type==='text') { shape=<text x={a.x} y={a.y} fill={d.color} stroke="none" fontSize="13">{d.text}</text>; hit=<rect x={a.x} y={a.y-16} width={Math.max(40,(d.text?.length||0)*8)} height={24} fill="transparent"/>; handles=[a]; }
    else if (d.type==='fib') { shape=<>{[0,.236,.382,.5,.618,.786,1].map(level=><g key={level}><line x1={left} x2={left+Math.max(w,1)} y1={a.y+(b.y-a.y)*level} y2={a.y+(b.y-a.y)*level}/><text x={left+4} y={a.y+(b.y-a.y)*level-4} fill={d.color} stroke="none" fontSize="11">{level} · {(d.points[0].price+(d.points[1].price-d.points[0].price)*level).toFixed(2)}</text></g>)}</>; hit=<rect x={left} y={top} width={Math.max(w,1)} height={Math.max(h,1)} fill="transparent"/>; }
    else if(d.type==='long'||d.type==='short') {
      const entry=d.points[0],target=d.points[1]; const stop=d.points[2] || {time:target.time,price:entry.price-(target.price-entry.price)/2}; const c=xy(stop);
      const risk=Math.abs(entry.price-stop.price), reward=Math.abs(target.price-entry.price);
      const valid=d.type==='long'?target.price>entry.price&&stop.price<entry.price:target.price<entry.price&&stop.price>entry.price;
      shape=<><rect x={left} y={Math.min(a.y,b.y)} width={Math.max(w,1)} height={Math.abs(a.y-b.y)} fill="#089981" fillOpacity={d.fillOpacity ?? .16} stroke="#089981"/><rect x={left} y={Math.min(a.y,c.y)} width={Math.max(w,1)} height={Math.abs(a.y-c.y)} fill="#f23645" fillOpacity={d.fillOpacity ?? .16} stroke="#f23645"/><line x1={left} x2={left+w} y1={a.y} y2={a.y}/><text x={left+5} y={a.y-6} fill={d.color} stroke="none" fontSize="12">{d.type.toUpperCase()} · {valid&&risk>0?'R:R '+(reward/risk).toFixed(2):'Check target / stop'}</text></>;
      hit=<rect x={left} y={Math.min(a.y,b.y,c.y)} width={Math.max(w,1)} height={Math.max(a.y,b.y,c.y)-Math.min(a.y,b.y,c.y)} fill="transparent"/>; handles=[a,b,c];
    } else if(d.type==='brush') { shape=<polyline points={pts.map(q=>q.x+','+q.y).join(' ')} fill="none" strokeLinejoin="round" strokeLinecap="round"/>; hit=shape; handles=[]; }
    else { const end=d.type==='ray'&&b.x!==a.x?{x:b.x>a.x?width:0,y:a.y+((b.x>a.x?width:0)-a.x)*(b.y-a.y)/(b.x-a.x)}:b;
      shape=<><line x1={a.x} y1={a.y} x2={end.x} y2={end.y}/>{d.type==='measure'&&<text x={left+5} y={top-10} fill={d.color} stroke="none" fontSize="12">{(d.points[1].price-d.points[0].price).toFixed(2)} ({(100*(d.points[1].price/d.points[0].price-1)).toFixed(2)}%) · {Math.round(Math.abs(logical(d.points[1].time)-logical(d.points[0].time)))} bars</text>}</>;
      hit=<line x1={a.x} y1={a.y} x2={end.x} y2={end.y}/>;
    }
    const interactive=!readOnly&&!preview;
    return <g key={d.id} data-drawing-id={d.id} data-selected={selected===d.id} opacity={d.opacity ?? 1} stroke={d.color} strokeWidth={d.lineWidth || 2} style={{pointerEvents:'none'}}>
      <g strokeDasharray={d.lineStyle==='dashed'?'8 5':d.lineStyle==='dotted'?'2 4':undefined}>{shape}</g>
      {interactive&&<g className="cs-drawing-hit" stroke="transparent" strokeWidth={14} style={{pointerEvents:'all',cursor:p.tool==='eraser'?'crosshair':d.locked?'pointer':'move',touchAction:'none'}} onPointerDown={e=>down(e,d)} onDoubleClick={()=>{if(d.type==='text'&&!d.locked)setNote(d)}}>{hit}</g>}
      {selected===d.id&&!d.locked&&!readOnly&&handles.map((q,i)=><circle key={i} data-handle={i} cx={q.x} cy={q.y} r={5} strokeWidth={2} fill="var(--cs-canvas,#131722)" style={{pointerEvents:'all',cursor:'crosshair',touchAction:'none'}} onPointerDown={e=>down(e,d,i)}/>)}
    </g>;
  };
  const patch = (values: Partial<Drawing>) => { if(active)p.onChange(p.drawings.map(d=>d.id===active.id?{...d,...values}:d)); };
  return <><svg ref={svg} className="cs-drawing-layer" fontFamily="Arial, sans-serif" data-tool={p.tool} style={{width,height,pointerEvents:p.tool==='cursor'?'none':'auto',touchAction:'none'}} onPointerDown={e=>down(e)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
    {p.overlays.map(d=>render(d,true))}{p.drawings.filter(d=>d.id!==draft?.id).map(d=>render(d))}{draft&&render(draft,false,true)}
  </svg>
  {active&&!draft&&<div className="cs-drawing-properties" role="toolbar" aria-label="Selected drawing"><strong>{active.name||active.type}</strong><input aria-label="Selected drawing color" type="color" value={active.color} disabled={active.locked} onChange={e=>patch({color:e.target.value})}/><select aria-label="Drawing line width" disabled={active.locked} value={active.lineWidth||2} onChange={e=>patch({lineWidth:Number(e.target.value)})}>{[1,2,3,4].map(v=><option key={v} value={v}>{v} px</option>)}</select><select aria-label="Drawing line style" disabled={active.locked} value={active.lineStyle||'solid'} onChange={e=>patch({lineStyle:e.target.value as Drawing['lineStyle']})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select><button aria-label="Duplicate selected drawing" onClick={()=>{const copy={...active,id:crypto.randomUUID(),locked:false,points:active.points.map(q=>{const pos=xy(q);return pointAt({x:pos.x+20,y:pos.y+20},false)||q})};p.onChange([...p.drawings,copy]);select(copy.id)}}><Copy size={15}/></button><button aria-label={active.locked?'Unlock selected drawing':'Lock selected drawing'} onClick={()=>patch({locked:!active.locked})}>{active.locked?<LockKeyhole size={15}/>:<UnlockKeyhole size={15}/>}</button>{active.type==='text'&&<button disabled={active.locked} onClick={()=>setNote(active)}>Edit text</button>}<button aria-label="Delete selected drawing" disabled={active.locked} onClick={()=>{p.onChange(p.drawings.filter(d=>d.id!==active.id));select('')}}><Trash2 size={15}/></button><button aria-label="Deselect drawing" onClick={()=>select('')}><X size={15}/></button></div>}
  {note&&<form className="cs-note-editor" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setNote(null)}}} onSubmit={e=>{e.preventDefault();if(note.text?.trim()){commit(note,p.drawings.some(d=>d.id===note.id));setNote(null)}}}><label>Chart note<input autoFocus aria-label="Chart note text" value={note.text} maxLength={200} onChange={e=>setNote({...note,text:e.target.value})}/></label><button type="submit" className="cs-primary">Save note</button><button type="button" onClick={()=>setNote(null)}>Cancel</button></form>}
  </>;
}

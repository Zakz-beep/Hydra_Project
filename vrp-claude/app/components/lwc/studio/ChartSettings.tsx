'use client';
import { useEffect, useRef, useState } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { ChartAppearance, appearanceDefaults } from '../../../lib/chart-studio/appearance';
interface Props { value: ChartAppearance; light: boolean; onChange: (v: ChartAppearance) => void; onPreset: (v: ChartAppearance, light: boolean) => void; onClose: () => void }
export default function ChartSettings(p: Props) {
  const dialog = useRef<HTMLDialogElement>(null); const [tab, setTab] = useState('Symbol');
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const set = <K extends keyof ChartAppearance>(key: K, value: ChartAppearance[K]) => p.onChange({ ...p.value, [key]: value });
  const color = (key: keyof ChartAppearance, title: string) => <label className="cs-setting-row" key={key}><span>{title}</span><span className="cs-color-control"><code>{String(p.value[key]).toUpperCase()}</code><input type="color" aria-label={title} value={String(p.value[key])} onChange={e => set(key, e.target.value)} /></span></label>;
  const toggle = (key: 'borders' | 'wicks' | 'volume' | 'watermark', title: string) => <label className="cs-setting-row"><span>{title}</span><input type="checkbox" checked={p.value[key]} onChange={e => set(key, e.target.checked)} /></label>;
  return <dialog ref={dialog} className="cs-settings-dialog" aria-labelledby="cs-settings-title" onCancel={p.onClose} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && index <= 0) { e.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!e.shiftKey && index === nodes.length - 1) { e.preventDefault(); nodes[0]?.focus(); }
  }} onClick={e => { if (e.target === dialog.current) p.onClose(); }}>
    <header><div><h2 id="cs-settings-title">Chart settings</h2><p>Make this chart yours</p></div><button aria-label="Close chart settings" onClick={p.onClose}><X size={20} /></button></header>
    <div className="cs-settings-body"><nav aria-label="Settings sections">{['Symbol', 'Canvas'].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>)}</nav><div className="cs-settings-content">
      {tab === 'Symbol' ? <><h3>Candles</h3>{color('up', 'Bullish body')}{color('down', 'Bearish body')}{toggle('wicks', 'Show wicks')}{color('wickUp', 'Bullish wick')}{color('wickDown', 'Bearish wick')}{toggle('borders', 'Show borders')}{color('borderUp', 'Bullish border')}{color('borderDown', 'Bearish border')}{toggle('volume', 'Show volume')}<p className="cs-setting-hint">Native canvas rendering follows your display resolution. Scroll or pinch to zoom; drag an axis to adjust its scale.</p></> : <><h3>Appearance presets</h3><div className="cs-preset-list">{['Dark', 'Light', 'Midnight'].map((name, i) => <button key={name} onClick={() => p.onPreset({ ...appearanceDefaults(i === 1), ...(i === 2 ? { background: '#080b10', grid: '#151923' } : {}) }, i === 1)}><i style={{ background: ['#131722', '#ffffff', '#080b10'][i] }} />{name}</button>)}</div><h3>Canvas</h3>{color('background', 'Chart background')}{color('text', 'Scale text')}{color('grid', 'Grid color')}{color('crosshair', 'Crosshair color')}<label className="cs-setting-row"><span>Grid lines</span><select aria-label="Grid lines" value={p.value.gridMode} onChange={e => set('gridMode', e.target.value as ChartAppearance['gridMode'])}><option value="both">Horizontal & vertical</option><option value="horizontal">Horizontal only</option><option value="none">Hidden</option></select></label>{toggle('watermark', 'Symbol watermark')}</>}
    </div></div><footer><button onClick={() => p.onChange(appearanceDefaults(p.light))}><RotateCcw size={14} />Reset defaults</button><span>Changes save automatically</span><button className="cs-primary" onClick={p.onClose}>Done</button></footer>
  </dialog>;
}

'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, PencilRuler, Activity, ArrowUpRight, Brush, Camera, ChevronDown, Code2, Crosshair, Eraser, Expand, Hash, Maximize2, Minus, Moon, MousePointer2, MoveUpRight, PanelRight, Pause, Play, Plus, RectangleHorizontal, Redo2, RefreshCw, Ruler, Save, Search, SkipForward, Sun, TrendingDown, TrendingUp, Type, Undo2, Upload } from 'lucide-react';
import StudioChart, { ChartHandle } from './StudioChart';
import SymbolPicker from './SymbolPicker';
import PythonStudio from './PythonStudio';
import Inspector from './Inspector';
import GreeksInputPanel from './GreeksInputPanel';
import ChartSettings from './ChartSettings';
import IndicatorSettings from './IndicatorSettings';
import StudyLegend from './StudyLegend';
import { normalizeAppearance, appearanceDefaults } from '../../../lib/chart-studio/appearance';
import { fetchGreeksInput, GreeksInput } from '../../../lib/chart-studio/greeksInput';
import MarketMicrostructure from './MarketMicrostructure';
import FootprintPanel from './FootprintPanel';
import { VolumeProfile } from '../../../lib/chart-studio/orderflow';
import { Bar, Drawing, Instrument, Interval, INTERVALS, keyOf, seconds, Study, StudyResult, Tool, WATCHLIST, Workspace } from '../../../lib/chart-studio/types';
import { TEMPLATES } from '../../../lib/chart-studio/templates';
import { useMarket } from '../../../lib/chart-studio/useMarket';
import { usePython } from '../../../lib/chart-studio/usePython';
import { diagnosticOf, PythonFailure } from '../../../lib/chart-studio/pythonDiagnostics';
import ExportHDModal from '../../bloomberg/ExportHDModal';
import WatermarkSettingsModal from '../../bloomberg/WatermarkSettingsModal';
import ChartWatermarkOverlay from '../../bloomberg/ChartWatermarkOverlay';
import { WatermarkConfig } from '../../../lib/chartExportEngine';
import './studio.css';

const defaultWatermark: WatermarkConfig = {
  enabled: true,
  userSignature: '@HydraQuant',
  showMetrics: true,
  opacity: 0.12,
  position: 'center',
  theme: 'bloomberg',
};

const STORAGE = 'vrp.chart-studio.v1';
const makeStudy = (name: string, code: string): Study => ({ id: crypto.randomUUID(), name, code, params: {}, enabled: true, auto: false });
const initial: Workspace = { version: 1, name: 'Research workspace', instrument: WATCHLIST[0], interval: '1h', drawings: {}, studies: [{ id: 'ema-initial', name: TEMPLATES[0].name, code: TEMPLATES[0].code, params: {}, enabled: true, auto: false }], watchlist: WATCHLIST, light: false };
const TOOLS: [Tool, string, typeof Crosshair][] = [ ['cursor', 'Select / move', MousePointer2], ['trend', 'Trendline', TrendingUp], ['ray', 'Ray', MoveUpRight], ['horizontal', 'Horizontal line', Minus], ['vertical', 'Vertical line', Plus], ['rectangle', 'Rectangle / zone', RectangleHorizontal], ['fib', 'Fibonacci retracement', Hash], ['brush', 'Freehand brush', Brush], ['text', 'Text note', Type], ['measure', 'Measure', Ruler], ['long', 'Long position', TrendingUp], ['short', 'Short position', TrendingDown], ['eraser', 'Eraser', Eraser] ];
function validWorkspace(value: unknown): value is Workspace {
  const w = value as Workspace;
  return Boolean(w && w.version === 1 && (!w.greeks || typeof w.greeks.enabled === 'boolean' && typeof w.greeks.ticker === 'string' && /^[A-Z0-9.^=-]{0,30}$/.test(w.greeks.ticker)) && ['hyperliquid', 'yahoo'].includes(w.instrument?.provider) && typeof w.instrument?.symbol === 'string' && INTERVALS.includes(w.interval) && Array.isArray(w.studies) && w.studies.length <= 12 && w.studies.every(s => typeof s.code === 'string' && s.code.length <= 100000 && typeof s.id === 'string' && s.params && typeof s.params === 'object') && Array.isArray(w.watchlist) && w.watchlist.length <= 100 && w.watchlist.every(i => typeof i.symbol === 'string' && ['hyperliquid', 'yahoo'].includes(i.provider)) && w.drawings && typeof w.drawings === 'object' && Object.values(w.drawings).every(ds => Array.isArray(ds) && ds.length <= 500 && ds.every(d => typeof d.id === 'string' && /^#[a-f\d]{6}$/i.test(d.color) && TOOLS.some(t => t[0] === d.type) && Array.isArray(d.points) && d.points.length <= 1500 && d.points.every(p => Number.isFinite(p.time) && Number.isFinite(p.price)))));
}
export default function ChartWorkspace({ onLegacy, initialInstrument, onInstrumentChange }: { onLegacy?: () => void; initialInstrument?: Instrument; onInstrumentChange?: (i: Instrument) => void }) {
  const [workspace, setWorkspace] = useState<Workspace>(() => initialInstrument ? { ...initial, instrument: initialInstrument } : initial); const [hydrated, setHydrated] = useState(false);
  const [refresh, setRefresh] = useState(0); const [search, setSearch] = useState(false); const [editor, setEditor] = useState(false); const [inspector, setInspector] = useState(true); const [tab, setTab] = useState('Markets');
  const [settings, setSettings] = useState(false); const [studySettings, setStudySettings] = useState('');
  const settingsStudy = workspace.studies.find(s => s.id === studySettings); const [stayInDrawing, setStayInDrawing] = useState(false);
  const appearance = useMemo(() => normalizeAppearance(workspace.appearance, workspace.light), [workspace.appearance, workspace.light]);
  const [tool, setTool] = useState<Tool>('cursor'); const [color, setColor] = useState('#eab86b'); const [magnet, setMagnet] = useState(false); const [chartType, setChartType] = useState('candles'); const [logScale, setLogScale] = useState(false);
  const [active, setActive] = useState('ema-initial'); const [results, setResults] = useState<Record<string, StudyResult>>({}); const [errors, setErrors] = useState<Record<string, string>>({}); const [checks, setChecks] = useState<Record<string, string>>({}); const [failures, setFailures] = useState<Record<string, PythonFailure>>({}); const [hover, setHover] = useState<Bar | null>(null);
  const [saveStatus, setSaveStatus] = useState('Local autosave'); const [notice, setNotice] = useState('');
  const [greeksInfo, setGreeksInfo] = useState<GreeksInput | null>(null); const [greeksStatus, setGreeksStatus] = useState('');
  const [compare, setCompare] = useState(''); const [compareInterval, setCompareInterval] = useState<Interval>('1d');
  const [showFootprint, setShowFootprint] = useState(false); const [footprintInterval, setFootprintInterval] = useState<Interval>('1m');
  const [showFlow, setShowFlow] = useState(false); const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<VolumeProfile | null>(null); const [visibleRange, setVisibleRange] = useState<{ from: number; to: number } | null>(null);
  const [replayTime, setReplayTime] = useState<number | null>(null); const [playing, setPlaying] = useState(false);
  const [exportHDOpen, setExportHDOpen] = useState(false);
  const [watermarkOpen, setWatermarkOpen] = useState(false);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vrp.watermark.config');
      if (saved) {
        try { return JSON.parse(saved); } catch {}
      }
    }
    return defaultWatermark;
  });
  const handleWatermarkChange = (cfg: WatermarkConfig) => {
    setWatermarkConfig(cfg);
    if (typeof window !== 'undefined') {
      localStorage.setItem('vrp.watermark.config', JSON.stringify(cfg));
    }
  };
  const chart = useRef<ChartHandle>(null); const container = useRef<HTMLDivElement>(null); const importFile = useRef<HTMLInputElement>(null);
  const undo = useRef<Drawing[][]>([]); const redo = useRef<Drawing[][]>([]); const [, historyChanged] = useState(0);
  const python = usePython(); const running = useRef(false); const [preparing, setPreparing] = useState(false); const dataRequest = useRef<AbortController | null>(null); const executionEpoch = useRef(0); const currentContext = useRef('');
  useEffect(() => () => { executionEpoch.current++; dataRequest.current?.abort(); }, []);
  const { data, status, error } = useMarket(workspace.instrument, workspace.interval, refresh);
  const instrumentKey = keyOf(workspace.instrument); const context = `${instrumentKey}:${workspace.interval}:${replayTime ?? 'live'}:greeks:${workspace.greeks?.enabled ? workspace.greeks.ticker : ''}`; currentContext.current = context;
  const bars = useMemo(() => replayTime == null ? data?.bars || [] : (data?.bars || []).filter(b => b.time <= replayTime), [data?.bars, replayTime]);
  const drawings = workspace.drawings[instrumentKey] || []; const currentBar = hover || bars.at(-1);
  useEffect(() => {
    try { const saved = localStorage.getItem(STORAGE); if (saved) { const parsed = JSON.parse(saved); if (validWorkspace(parsed)) { setWorkspace(initialInstrument ? { ...parsed, instrument: initialInstrument } : parsed); setActive(parsed.studies[0]?.id || ''); setChartType(parsed.chartType || 'candles'); setLogScale(Boolean(parsed.logScale)); setCompare(parsed.compare?.key || ''); setCompareInterval(parsed.compare?.interval || '1d'); } else { localStorage.setItem(`${STORAGE}.recovery`, saved); setNotice('Unsupported saved workspace was backed up locally.'); } } } catch { setNotice('Saved workspace could not be read. You can import a backup.'); }
    setHydrated(true);
  }, []);
  useEffect(() => { const mq = window.matchMedia('(max-width: 900px)'); const resize = () => setInspector(!mq.matches); resize(); mq.addEventListener('change', resize); return () => mq.removeEventListener('change', resize); }, []);
  const save = useCallback(() => {
    try { const view = chart.current?.view(); localStorage.setItem(STORAGE, JSON.stringify({ ...workspace, chartType, logScale, compare: { key: compare, interval: compareInterval }, viewport: view ? { ...view, key: `${keyOf(workspace.instrument)}:${workspace.interval}` } : workspace.viewport })); setSaveStatus('Saved locally'); }
    catch { setSaveStatus('Save failed'); setNotice('Browser storage is full or unavailable. Export a workspace backup.'); }
  }, [workspace, chartType, logScale, compare, compareInterval]);
  useEffect(() => { if (!hydrated) return; setSaveStatus('Saving…'); const t = setTimeout(save, 600); return () => clearTimeout(t); }, [workspace, hydrated, save]);
  useEffect(() => { executionEpoch.current++; dataRequest.current?.abort(); setResults({}); setErrors({}); setFailures({}); setHover(null); setGreeksInfo(null); setGreeksStatus(''); python.stop('Ready to run'); setTool('cursor'); }, [context]); // Each run belongs to a symbol, timeframe and replay cursor.
  useEffect(() => { undo.current = []; redo.current = []; historyChanged(v => v + 1); }, [instrumentKey]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(t); }, [notice]);
  const changeDrawings = (next: Drawing[]) => {
    if (next.length > 500) { setNotice('Maximum 500 drawings per instrument. Remove an unused drawing.'); return; }
    undo.current = [...undo.current.slice(-49), drawings]; redo.current = [];
    setWorkspace(w => ({ ...w, drawings: { ...w.drawings, [instrumentKey]: next } }));
  };
  const history = (direction: 'undo' | 'redo') => {
    const source = direction === 'undo' ? undo : redo; const target = direction === 'undo' ? redo : undo; const next = source.current.pop();
    if (next) { target.current.push(drawings); setWorkspace(w => ({ ...w, drawings: { ...w.drawings, [instrumentKey]: next } })); }
  };
  const hotkeys = useRef({ history, save }); hotkeys.current = { history, save };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return; if(e.altKey && !e.ctrlKey && !e.metaKey){const shortcuts: Record<string,Tool>={t:'trend',h:'horizontal',v:'vertical',r:'rectangle'};const next=shortcuts[e.key.toLowerCase()];if(next){e.preventDefault();setTool(next);return;}} if ((e.ctrlKey || e.metaKey) && ['z', 'y', 's'].includes(e.key.toLowerCase())) { e.preventDefault(); if (e.key.toLowerCase() === 's') hotkeys.current.save(); else hotkeys.current.history(e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo'); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (initialInstrument) setWorkspace(w => keyOf(w.instrument) === keyOf(initialInstrument) ? w : { ...w, instrument: initialInstrument }); }, [initialInstrument]);
  function chooseInstrument(i: Instrument) { onInstrumentChange?.(i); setReplayTime(null); setPlaying(false); setWorkspace(w => ({ ...w, instrument: i, watchlist: w.watchlist.some(v => keyOf(v) === keyOf(i)) ? w.watchlist : [...w.watchlist, i] })); }
  function changeStudy(study: Study) { setWorkspace(w => ({ ...w, studies: w.studies.map(s => s.id === study.id ? study : s) })); }
  function addStudy(name: string, code: string) { if (/\bgreeks\b/.test(code)) setWorkspace(w => ({ ...w, greeks: { enabled: true, ticker: w.greeks?.ticker || (w.instrument.provider === 'yahoo' || w.instrument.symbol.includes(':') ? w.instrument.symbol.split(':').at(-1)! : 'SPY') } })); if (workspace.studies.length >= 12) { setNotice('Maximum 12 studies per workspace'); return; } const s = makeStudy(name, code); setWorkspace(w => ({ ...w, studies: [...w.studies, s] })); setActive(s.id); setEditor(true); setTab('Studies'); }
  async function addGreeksTemplate(file: string, name: string) {
    try { const r = await fetch(`/chart-studio/indicators/${file}`); if (!r.ok) throw new Error('Indicator template unavailable'); addStudy(name, await r.text()); } catch (e) { setNotice(String(e)); }
  }
  async function runStudy(study?: Study, closedOnly = false) {
    if (!study || running.current) return; if (!bars.length) { setNotice('Load market candles before running Python'); return; }
    setFailures(old => { const next = { ...old }; delete next[study.id]; return next; });
    const token = context; const epoch = executionEpoch.current; running.current = true; setPreparing(true); setErrors(e => ({ ...e, [study.id]: '' }));
    try {
      dataRequest.current = new AbortController();
      let greeks: GreeksInput | undefined;
      if (/\bgreeks\b/.test(study.code)) {
        if (!workspace.greeks?.enabled || !workspace.greeks.ticker) throw new Error('Enable The Greeks input and choose an options source ticker before Run.');
        setGreeksInfo(null); setGreeksStatus('Loading snapshot and recorded history…');
        greeks = await fetchGreeksInput(workspace.greeks.ticker, replayTime ?? Date.now() / 1000, replayTime != null, dataRequest.current.signal);
        if (currentContext.current !== token || executionEpoch.current !== epoch) return;
        setGreeksInfo(greeks); setGreeksStatus('Data ready · refreshes on Run using backend cache');
      }
      const datasets: Record<string, Bar[]> = { chart: closedOnly && replayTime == null ? bars.slice(0, -1) : bars };
      if (!datasets.chart.length) throw new Error('No completed candle available yet');
      if (compare) {
        const split = compare.indexOf(':'); const params = new URLSearchParams({ provider: compare.slice(0, split), symbol: compare.slice(split + 1), interval: compareInterval });
        dataRequest.current = new AbortController(); const r = await fetch(`/api/chart-studio/bars?${params}`, { signal: dataRequest.current.signal }); const extra = await r.json(); if (!r.ok) throw new Error(extra.error);
        const cutoff = replayTime ?? Math.floor(Date.now() / 1000);
        datasets.compare = extra.bars.map((b: Bar) => ({ ...b, time: b.time + seconds(compareInterval) })).filter((b: Bar) => b.time <= cutoff);
        if (!datasets.compare.length) throw new Error('No confirmed candles in the compare dataset at this replay time');
      }
      if (currentContext.current !== token || executionEpoch.current !== epoch) return;
      setPreparing(false);
      const result = await python.run(study, datasets, token, workspace.instrument.symbol, workspace.interval, replayTime == null ? data?.market : undefined, greeks);
      if (currentContext.current === token && executionEpoch.current === epoch) setResults(old => ({ ...old, [study.id]: result }));
    } catch (e) { if (currentContext.current === token && executionEpoch.current === epoch) { if (/\bgreeks\b/.test(study.code)) setGreeksStatus(e instanceof Error ? e.message : 'Greeks run failed'); setErrors(old => ({ ...old, [study.id]: e instanceof Error ? e.message : 'Python run failed' })); setFailures(old => ({ ...old, [study.id]: { code: study.code, diagnostic: diagnosticOf(e) } })); } }
    finally { running.current = false; setPreparing(false); }
  }
  async function checkStudy() {
    const study = workspace.studies.find(s => s.id === active);
    if (!study || running.current) return;
    const epoch = executionEpoch.current; running.current = true;
    setErrors(old => ({ ...old, [study.id]: '' }));
    setFailures(old => { const next = { ...old }; delete next[study.id]; return next; });
    try { await python.validate(study); if (executionEpoch.current === epoch) setChecks(old => ({ ...old, [study.id]: study.code })); }
    catch (e) { if (executionEpoch.current === epoch) {
      setErrors(old => ({ ...old, [study.id]: e instanceof Error ? e.message : 'Validation failed' }));
      setFailures(old => ({ ...old, [study.id]: { code: study.code, diagnostic: diagnosticOf(e) } }));
    } } finally { running.current = false; }
  }
  const runCurrent = useRef(runStudy); runCurrent.current = runStudy;
  const lastTime = bars.at(-1)?.time; const previousBar = useRef<number>();
  useEffect(() => {
    const prior = previousBar.current; previousBar.current = lastTime;
    if (prior && lastTime && lastTime > prior && !running.current) void (async () => { for (const s of workspace.studies.filter(s => s.auto && s.enabled)) await runCurrent.current(s, true); })();
  }, [lastTime]);
  useEffect(() => { previousBar.current = undefined; }, [instrumentKey, workspace.interval]);
  const stepReplay = useCallback(() => { if (!data || replayTime == null || running.current) return; const next = data.bars.find(b => b.time > replayTime); if (next) setReplayTime(next.time); else setPlaying(false); }, [data, replayTime]);
  useEffect(() => { if (!playing) return; const t = setInterval(stepReplay, 1000); return () => clearInterval(t); }, [playing, stepReplay]);
  const exportWorkspace = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'chart-workspace.json'; a.click(); URL.revokeObjectURL(url); };
  const screenshot = async () => { try { const url = await chart.current?.image(); if (url) { const a = document.createElement('a'); a.href = url; a.download = `${workspace.instrument.symbol}-chart.png`; a.click(); } } catch { setNotice('Chart image export failed. Please retry.'); } };
  const fmt = (v?: number) => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 1 ? 6 : 2 });
  const delta = currentBar ? currentBar.close - currentBar.open : 0;
  return <div className={`chart-studio ${workspace.light ? 'cs-light' : ''} ${showFootprint ? 'cs-footprint-mode' : ''} ${!inspector ? 'cs-no-inspector' : ''}`} ref={container} style={{ '--cs-canvas': appearance.background, '--cs-canvas-text': appearance.text, '--cs-up': appearance.up, '--cs-down': appearance.down } as React.CSSProperties}>
    <header className="cs-header"><div className="cs-brand"><span className="cs-brand-mark"><Activity size={20} /></span><div><strong>CHART STUDIO<span> / </span></strong><input aria-label="Workspace name" value={workspace.name} maxLength={60} onChange={e => setWorkspace(w => ({ ...w, name: e.target.value }))} /></div></div><div className="cs-header-actions"><button className="cs-mobile-inspector" aria-label="Toggle mobile inspector" onClick={() => setInspector(!inspector)}><PanelRight size={15} /></button><span className="cs-save-status">{saveStatus}</span><button onClick={save}><Save size={14} /><span>Save</span></button><button onClick={exportWorkspace} title="Export workspace backup"><ArrowUpRight size={14} /><span>Export</span></button><button onClick={() => importFile.current?.click()} title="Import workspace backup" aria-label="Import workspace"><Upload size={14} /></button>{onLegacy && <button onClick={onLegacy} className="cs-legacy">Paper & macro</button>}<button aria-label="Toggle light theme" onClick={() => setWorkspace(w => ({ ...w, light: !w.light, appearance: appearanceDefaults(!w.light) }))}>{workspace.light ? <Moon size={15} /> : <Sun size={15} />}</button></div></header>
    <div className="cs-command-bar"><button className="cs-symbol-button" onClick={() => setSearch(true)}><Search size={15} /><strong>{workspace.instrument.symbol}</strong><span>{workspace.instrument.provider === 'hyperliquid' ? 'PERP' : 'YF'}</span><ChevronDown size={13} /></button><div className="cs-divider" /><div className="cs-timeframes">{INTERVALS.map(i => <button key={i} className={i === (showFootprint ? footprintInterval : workspace.interval) ? 'active' : ''} onClick={() => { setReplayTime(null); setPlaying(false); if(showFootprint) setFootprintInterval(i); else setWorkspace(w => ({ ...w, interval: i })); }}>{i}</button>)}</div><div className="cs-divider" /><select aria-label="Chart type" value={chartType} onChange={e => setChartType(e.target.value)}><option value="candles">Candles</option><option value="bars">OHLC bars</option><option value="line">Line</option><option value="area">Area</option></select><button className={editor ? 'active' : ''} onClick={() => setEditor(!editor)}><Code2 size={15} /><span>Python</span></button><button disabled={!data?.bars.length} onClick={() => { if (replayTime == null && data?.bars.length) setReplayTime(data.bars[Math.max(0, data.bars.length - 60)].time); else { setReplayTime(null); setPlaying(false); } }} className={replayTime != null ? 'active' : ''}><Play size={13} /><span>Replay</span></button><button aria-pressed={Boolean(workspace.greeks?.enabled)} onClick={() => setWorkspace(w => ({ ...w, greeks: { enabled: !w.greeks?.enabled, ticker: w.greeks?.ticker || (w.instrument.provider === 'yahoo' || w.instrument.symbol.includes(':') ? w.instrument.symbol.split(':').at(-1)! : 'SPY') } }))}><Activity size={14} /><span>The Greeks</span></button><button aria-pressed={showFlow} onClick={() => { setShowFlow(!showFlow); if (!showFlow) setEditor(false); }}><Activity size={14} /><span>Order flow</span></button><button aria-label="Toggle footprint chart" aria-pressed={showFootprint} onClick={() => { setShowFootprint(!showFootprint); if (!showFootprint) { setEditor(false); setShowFlow(false); setShowProfile(false); } }}><Hash size={14}/><span>Footprint</span></button><button aria-pressed={showProfile} onClick={() => setShowProfile(!showProfile)}><Hash size={14} /><span>Volume profile</span></button><div className="cs-command-spacer" /><button title="Chart settings" aria-label="Chart settings" onClick={() => setSettings(true)}><Settings2 size={18} /></button><button title="Refresh market data" aria-label="Refresh market data" onClick={() => setRefresh(v => v + 1)}><RefreshCw size={14} /></button><button title="Watermark Data Settings (WM)" aria-label="Watermark Settings" onClick={() => setWatermarkOpen(true)} className="px-2 py-0.5 text-[10px] font-mono border border-amber-500/40 rounded text-amber-400 hover:bg-amber-500/10 font-bold">WM</button><button title="Export HD Chart & Watermark" aria-label="Export HD Chart" onClick={() => setExportHDOpen(true)} className="px-2 py-0.5 text-[10px] font-mono border border-amber-500/60 rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 font-bold flex items-center gap-1"><Camera size={13} /><span>HD</span></button><button title="Fullscreen chart workspace" aria-label="Fullscreen chart workspace" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void container.current?.requestFullscreen().catch(() => setNotice('Fullscreen is unavailable in this browser')); }}><Maximize2 size={15} /></button><button className={inspector ? 'active' : ''} aria-label="Toggle inspector" onClick={() => setInspector(!inspector)}><PanelRight size={15} /></button></div>
    <div className="cs-main"><nav className="cs-drawing-toolbar" aria-label="Drawing tools">{TOOLS.map(([id, label, Icon], i) => <button key={id} title={label + (({trend:' (Alt T)',horizontal:' (Alt H)',vertical:' (Alt V)',rectangle:' (Alt R)'} as Record<string,string>)[id] || '')} aria-label={label} aria-pressed={tool === id} className={`${tool === id ? 'active' : ''} ${i === 6 || i === 10 ? 'cs-tool-separated' : ''}`} onClick={() => setTool(id)}><Icon size={19} /></button>)}<div className="cs-tool-separated"><input type="color" aria-label="Drawing color" value={color} onChange={e => setColor(e.target.value)} /></div><button className={magnet ? 'active' : ''} title="Snap to OHLC" aria-label="Snap to OHLC" aria-pressed={magnet} onClick={() => setMagnet(!magnet)}><Crosshair size={18} /></button><button aria-label="Stay in drawing mode" aria-pressed={stayInDrawing} title="Stay in drawing mode" onClick={() => setStayInDrawing(!stayInDrawing)}><PencilRuler size={18} /></button><button disabled={!undo.current.length} title="Undo (Ctrl Z)" aria-label="Undo drawing" onClick={() => history('undo')}><Undo2 size={17} /></button><button disabled={!redo.current.length} title="Redo (Ctrl Shift Z)" aria-label="Redo drawing" onClick={() => history('redo')}><Redo2 size={17} /></button></nav>
      <main className="cs-center"><div className="cs-chart-header"><div><h1>{workspace.instrument.symbol}<span> / {data?.currency || 'USD'}</span><small>{workspace.interval} · {workspace.instrument.provider === 'hyperliquid' ? 'Hyperliquid' : 'Yahoo Finance'}</small></h1><div className="cs-ohlc">{(['open', 'high', 'low', 'close'] as const).map(k => <span key={k}><small>{k[0].toUpperCase()}</small><b className={delta >= 0 ? 'cs-positive' : 'cs-negative'}>{fmt(currentBar?.[k])}</b></span>)}<span className={delta >= 0 ? 'cs-positive' : 'cs-negative'}>{delta >= 0 ? '+' : ''}{fmt(delta)} {currentBar?.open ? `(${(100 * delta / currentBar.open).toFixed(2)}%)` : ''}</span></div></div><span className={`cs-feed-status ${error ? 'cs-error' : ''}`}><span className="cs-status-dot" />{replayTime != null ? 'REPLAY' : status}</span></div>
      <StudyLegend studies={workspace.studies} results={results} onSettings={setStudySettings} onChange={changeStudy} onRemove={id => setWorkspace(w => ({...w,studies:w.studies.filter(s => s.id !== id)}))} />{showFootprint && <FootprintPanel interval={seconds(footprintInterval)} onIntervalChange={n => setFootprintInterval(INTERVALS.find(i => seconds(i) === n) || '1m')} key={instrumentKey} instrument={workspace.instrument} light={workspace.light} replay={replayTime != null} />}<div className="cs-chart-stage" style={{display:showFootprint?"none":undefined}}><StudioChart appearance={appearance} intervalSeconds={seconds(workspace.interval)} stayInDrawing={stayInDrawing} ref={chart} profile={showProfile ? profile : null} onVisibleRange={setVisibleRange} viewport={workspace.viewport} bars={bars} instrumentKey={`${instrumentKey}:${workspace.interval}`} light={workspace.light} chartType={chartType} logScale={logScale} studies={workspace.studies} results={results} drawings={drawings} tool={tool} color={color} magnet={magnet} onDrawings={changeDrawings} onTool={setTool} onCrosshair={setHover} />{!bars.length && <div className="cs-chart-empty"><Activity size={28} /><h2>{error ? 'Market data unavailable' : 'Connecting your market'}</h2><p>{error || 'Loading candles and preparing your workspace…'}</p>{error && <button onClick={() => setRefresh(v => v + 1)}>Retry connection</button>}</div>}<ChartWatermarkOverlay ticker={workspace.instrument.symbol} interval={workspace.interval} provider={workspace.instrument.provider} config={watermarkConfig} /></div>
      {replayTime != null && <div className="cs-replay"><button onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button><button onClick={stepReplay} aria-label="Next replay candle"><SkipForward size={14} /></button><span>REPLAY</span><input aria-label="Replay position" type="range" min={0} max={Math.max(0, (data?.bars.length || 1) - 1)} value={Math.max(0, data?.bars.findIndex(b => b.time === replayTime) || 0)} onChange={e => { setPlaying(false); const b = data?.bars[Number(e.target.value)]; if (b) setReplayTime(b.time); }} /><time>{new Date(replayTime * 1000).toLocaleString()}</time><button onClick={() => { setReplayTime(null); setPlaying(false); }}>Exit</button></div>}
      <div className="cs-chart-footer"><span>{bars.length.toLocaleString()} bars</span><span>{data?.timezone || 'UTC'}</span><span className="cs-footer-note">{tool === 'cursor' ? 'Scroll to zoom · drag to pan' : `${TOOLS.find(t => t[0] === tool)?.[1]} · click twice or drag · Shift to constrain · Esc to cancel`}</span><button className={logScale ? 'active' : ''} onClick={() => setLogScale(!logScale)}>log</button><button onClick={() => chart.current?.reset()}>auto</button><button aria-label="Fit chart to data" onClick={() => chart.current?.fit()}><Expand size={13} /></button></div>
      {(showFlow || showProfile) && <MarketMicrostructure intervalSeconds={seconds(workspace.interval)} key={instrumentKey} instrument={workspace.instrument} bars={bars} flow={showFlow} profile={showProfile} replay={replayTime != null} range={visibleRange} onProfile={setProfile} />}
      {workspace.greeks?.enabled && <GreeksInputPanel ticker={workspace.greeks.ticker} instrument={workspace.instrument} data={greeksInfo} status={greeksStatus} onTicker={ticker => setWorkspace(w => ({ ...w, greeks: { enabled: true, ticker } }))} onChart={() => chooseInstrument({ provider: 'yahoo', symbol: workspace.greeks!.ticker, name: workspace.greeks!.ticker })} onTemplate={addGreeksTemplate} onClose={() => setWorkspace(w => ({ ...w, greeks: { enabled: false, ticker: w.greeks!.ticker } }))} />}
      {editor ? <PythonStudio checkedCode={checks[active]} failure={failures[active]} onCheck={() => void checkStudy()} studies={workspace.studies} active={active} onActive={setActive} onChange={changeStudy} onAdd={addStudy} onRun={() => void runStudy(workspace.studies.find(s => s.id === active))} onStop={() => { executionEpoch.current++; dataRequest.current?.abort(); python.stop(); }} busy={python.busy || preparing} status={preparing ? 'Preparing data snapshot…' : python.status} result={results[active]} error={errors[active] || ''} onSave={save} onClose={() => setEditor(false)} /> : <button className="cs-open-editor" onClick={() => setEditor(true)}><Code2 size={14} />Open Python Studio<ChevronDown size={14} /></button>}
      </main>{inspector && <Inspector onSettings={setStudySettings} tab={tab} onTab={setTab} watchlist={workspace.watchlist} instrument={workspace.instrument} onInstrument={chooseInstrument} onSearch={() => setSearch(true)} onWatchlist={watchlist => setWorkspace(w => ({ ...w, watchlist }))} studies={workspace.studies} results={results} onStudy={changeStudy} onRemove={id => { setWorkspace(w => ({ ...w, studies: w.studies.filter(s => s.id !== id) })); if (active === id) setActive(workspace.studies.find(s => s.id !== id)?.id || ''); }} onEdit={id => { setActive(id); setEditor(true); }} drawings={drawings} onDrawings={changeDrawings} data={data} bars={bars} compare={compare} compareInterval={compareInterval} onCompare={(v, i) => { setCompare(v); setCompareInterval(i); }} context={context} />}</div>
    {notice && <div className="cs-toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {settingsStudy && <IndicatorSettings study={settingsStudy} result={results[settingsStudy.id]} context={context} error={errors[settingsStudy.id] || ''} busy={python.busy || preparing} onChange={changeStudy} onRun={() => { setActive(settingsStudy.id); void runStudy(settingsStudy); }} onCode={() => { setActive(settingsStudy.id); setEditor(true); setStudySettings(''); }} onClose={() => setStudySettings('')} />}
    {settings && <ChartSettings value={appearance} light={workspace.light} onChange={appearance => setWorkspace(w => ({ ...w, appearance }))} onPreset={(appearance, light) => setWorkspace(w => ({ ...w, appearance, light }))} onClose={() => setSettings(false)} />}
    {search && <SymbolPicker current={workspace.instrument} onSelect={chooseInstrument} onClose={() => setSearch(false)} />}
    <ExportHDModal isOpen={exportHDOpen} onClose={() => setExportHDOpen(false)} getChartCanvas={() => chart.current?.getCanvas?.() || null} getDrawingSvg={() => chart.current?.getSvg?.() || null} metadata={{ ticker: workspace.instrument.symbol, interval: workspace.interval, provider: workspace.instrument.provider, lastPrice: currentBar ? fmt(currentBar.close) : undefined, priceChangePercent: currentBar && currentBar.open ? ((100 * delta) / currentBar.open).toFixed(2) : undefined, open: currentBar ? fmt(currentBar.open) : undefined, high: currentBar ? fmt(currentBar.high) : undefined, low: currentBar ? fmt(currentBar.low) : undefined, volume: bars.length ? bars.length.toString() : undefined }} watermark={watermarkConfig} />
    <WatermarkSettingsModal isOpen={watermarkOpen} onClose={() => setWatermarkOpen(false)} config={watermarkConfig} onChange={handleWatermarkChange} />
    <input type="file" accept=".json" hidden ref={importFile} onChange={async e => { const f = e.target.files?.[0]; if (f) { try { if (f.size > 5000000) throw new Error('Workspace exceeds 5 MB'); const w = JSON.parse(await f.text()); if (!validWorkspace(w)) throw new Error('Invalid workspace format'); localStorage.setItem(`${STORAGE}.backup`, JSON.stringify(workspace)); setWorkspace(w); setChartType(w.chartType || 'candles'); setLogScale(Boolean(w.logScale)); setCompare(w.compare?.key || ''); setCompareInterval(w.compare?.interval || '1d'); setActive(w.studies[0]?.id || ''); setResults({}); setReplayTime(null); setNotice('Workspace imported. Previous workspace backed up locally.'); } catch (e) { setNotice(e instanceof Error ? e.message : 'Import failed'); } } e.target.value = ''; }} />
  </div>;
}

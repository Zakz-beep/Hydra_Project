'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { THEMES, THEME_IDS, getTheme, getSavedThemeId, saveThemeId } from '../components/lwc/core/TerminalThemes';
import CanvasTerminalChart from '../components/lwc/engine/CanvasTerminalChart';
import type { ChartType } from '../components/lwc/engine/types';
import TerminalSidebar, { DrawingTool } from '../components/lwc/core/TerminalSidebar';
import TerminalDrawingOverlay, { TerminalDrawingOverlayHandle, Drawing } from '../components/lwc/core/TerminalDrawingOverlay';
import TickerSearchDropdown from '../components/lwc/core/TickerSearchDropdown';
import DrawingObjectTree from '../components/lwc/core/DrawingObjectTree';
import IndicatorManager from '../components/lwc/indicators/IndicatorManager';
import { calcICTSndProfile, type ICTStats } from '../lib/indicators/ict_snd';
import { calcSessionsProfile } from '../lib/indicators/sessions';
import type { ChartData } from '../components/lwc/core/TerminalChart';
import type { IndicatorConfig, ICTSeekAndDestroyConfig, SessionsConfig, GexLevelsConfig } from '../types/indicators';

// Dynamic import — avoids SSR crash from window/canvas usage in LWC
const TerminalChart = dynamic(
  () => import('../components/lwc/core/TerminalChart'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0d0d0d', flexDirection: 'column', gap: 12,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '2px solid #f97316', borderTopColor: 'transparent',
          animation: 'ld-spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes ld-spin{to{transform:rotate(360deg)}}`}</style>
        <span style={{ color: '#3f3f46', fontSize: 10, fontFamily: 'monospace', letterSpacing: 1 }}>
          LOADING CHART...
        </span>
      </div>
    ),
  }
);

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Timeframe = typeof TIMEFRAMES[number];

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)    return p.toFixed(2);
  return p.toFixed(6);
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TerminalPage() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const [themeId, setThemeId]           = useState(() => getSavedThemeId());
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const theme = getTheme(themeId);

  // ── Ticker / Timeframe ─────────────────────────────────────────────────────
  const [ticker, setTicker]           = useState('AAPL');
  const [timeframe, setTimeframe]     = useState<Timeframe>('1m');

  // ── Live price tracking ────────────────────────────────────────────────────
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const openPriceRef = useRef<number | null>(null);           // first price after load
  const [change, setChange]             = useState<number | null>(null);
  const [changePct, setChangePct]       = useState<number | null>(null);
  const [chartData, setChartData]       = useState<ChartData[]>([]);

  // ── Engine Toggle State ────────────────────────────────────────────────────
  const [chartEngine, setChartEngine]   = useState<'canvas' | 'lwc'>('canvas');
  const [chartType, setChartType]       = useState<ChartType>('candlestick');
  const [rangeSize, setRangeSize]       = useState(1.0);
  const [renkoBrickSize, setRenkoBrickSize] = useState(0.5);
  const [isHeikinAshi, setIsHeikinAshi] = useState(false);

  // ── Drawing tools ──────────────────────────────────────────────────────────
  const [activeTool, setActiveTool]  = useState<DrawingTool>('cursor');
  const drawingOverlayRef            = useRef<TerminalDrawingOverlayHandle>(null);
  // Lifted drawing state — persistent across re-renders
  const [drawings, setDrawings]      = useState<Drawing[]>([]);
  const [showObjectTree, setShowObjectTree] = useState(false);
  const [selectedId, setSelectedId]  = useState<string | null>(null);

  // Load drawings from localStorage when ticker changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = `vrp-pro-drawings-${ticker}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        setDrawings(JSON.parse(saved));
      } else {
        setDrawings([]);
      }
    } catch (e) {
      console.error('Failed to load drawings', e);
      setDrawings([]);
    }
  }, [ticker]);

  // Callback to update drawings and persist to localStorage
  const handleDrawingsChange = useCallback((newDrawings: Drawing[]) => {
    setDrawings(newDrawings);
    if (typeof window === 'undefined') return;
    try {
      const key = `vrp-pro-drawings-${ticker}`;
      if (newDrawings.length > 0) {
        localStorage.setItem(key, JSON.stringify(newDrawings));
      } else {
        localStorage.removeItem(key);
      }
    } catch (e) {
      console.error('Failed to save drawings', e);
    }
  }, [ticker]);

  // ── Chart API refs for drawing overlay ────────────────────────────────────
  const [chartApi, setChartApi]         = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries]     = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [chartDims, setChartDims]       = useState({ width: 0, height: 0 });
  const chartAreaRef                    = useRef<HTMLDivElement>(null);

  // Wrapper to reset selection when active tool changes
  const handleToolChange = useCallback((tool: DrawingTool) => {
    setActiveTool(tool);
    setSelectedId(null);
  }, []);

  // Calculate pixel coordinates for floating quick-edit toolbar
  const getSelectedDrawingPos = () => {
    if (!selectedId || !chartApi || !mainSeries || drawings.length === 0) return null;
    const d = drawings.find(x => x.id === selectedId);
    if (!d) return null;

    try {
      const p1 = chartApi.timeScale().timeToCoordinate(d.startTime as any);
      const p2 = chartApi.timeScale().timeToCoordinate(d.endTime as any);
      const py1 = mainSeries.priceToCoordinate(d.startPrice);
      const py2 = mainSeries.priceToCoordinate(d.endPrice);

      if (p1 === null || p2 === null || py1 === null || py2 === null) return null;

      const cx = (p1 + p2) / 2;
      const cy = Math.max(10, Math.min(py1, py2) - 45); // Clamp Y to min 10px from top
      return { x: cx, y: cy };
    } catch {
      return null;
    }
  };

  const toolbarPos = getSelectedDrawingPos();

  // ── Indicators ─────────────────────────────────────────────────────
  const INDICATORS_KEY = 'vrp-pro-indicators-global';
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem(INDICATORS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const handleIndicatorsChange = useCallback((next: IndicatorConfig[]) => {
    setIndicators(next);
    if (typeof window === 'undefined') return;
    try {
      if (next.length > 0) {
        localStorage.setItem(INDICATORS_KEY, JSON.stringify(next));
      } else {
        localStorage.removeItem(INDICATORS_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const [gexDrawings, setGexDrawings] = useState<Drawing[]>([]);

  useEffect(() => {
      const gexConfigs = indicators.filter(i => i.type === 'gex_levels' && i.enabled) as GexLevelsConfig[];
      if (gexConfigs.length === 0) {
          setGexDrawings([]);
          return;
      }
      
      const config = gexConfigs[0];
      
      const fetchGexLevels = async () => {
          try {
              const res = await fetch(`/api/greeks/gex?ticker=${encodeURIComponent(ticker)}`);
              if (!res.ok) throw new Error("Gagal fetch GEX data");
              const data = await res.json();
              
              const buckets = ['0', '1', '7', '14', '30'];
              const newDrawings: Drawing[] = [];
              let idCounter = 1;
              const now = Math.floor(Date.now() / 1000);
              
              for (const b of buckets) {
                  const bData = data.per_bucket?.[b];
                  if (bData && bData.largest_gex_strike) {
                      const isCallWall = bData.largest_gex_value > 0;
                      const color = isCallWall ? config.colorCall : config.colorPut;
                      
                      newDrawings.push({
                          id: `gex_level_${b}_${idCounter++}`,
                          type: 'horizontal_line',
                          startTime: now - 86400 * 30, // arbitrary past
                          startPrice: bData.largest_gex_strike,
                          endTime: now + 86400 * 30,   // arbitrary future
                          endPrice: bData.largest_gex_strike,
                          color: color,
                          label: `${b}DTE Wall: $${bData.largest_gex_strike}`,
                          lineWidth: 2,
                          textPosition: 'left'
                      });
                  }
              }
              setGexDrawings(newDrawings);
          } catch (err) {
              console.error("Error fetching GEX levels for overlay:", err);
          }
      };
      
      fetchGexLevels();
      const interval = setInterval(fetchGexLevels, 60000);
      return () => clearInterval(interval);
  }, [indicators, ticker]);

  const { indicatorDrawings, ictStats, activeIctConfig } = React.useMemo(() => {
    let drawings: Drawing[] = [];
    let stats: ICTStats | null = null;
    let activeCfg: ICTSeekAndDestroyConfig | null = null;

    // 1. Calculate ICT Seek & Destroy drawings
    const ictConfigs = indicators.filter(i => i.type === 'ict_snd' && i.enabled) as ICTSeekAndDestroyConfig[];
    if (ictConfigs.length > 0) {
      activeCfg = ictConfigs[0];
      const res = calcICTSndProfile(chartData, activeCfg);
      drawings = [...drawings, ...res.drawings];
      stats = res.stats;
    }

    // 2. Calculate Custom Sessions drawings
    const sessionsConfigs = indicators.filter(i => i.type === 'sessions' && i.enabled) as SessionsConfig[];
    if (sessionsConfigs.length > 0) {
      const activeSes = sessionsConfigs[0];
      const resSes = calcSessionsProfile(chartData, activeSes);
      drawings = [...drawings, ...resSes];
    }

    // 3. Add GEX Drawings
    if (gexDrawings.length > 0) {
      drawings = [...drawings, ...gexDrawings];
    }

    return { indicatorDrawings: drawings, ictStats: stats, activeIctConfig: activeCfg };
  }, [indicators, chartData, gexDrawings]);

  // ── Indicator toggles (legacy SMA/VWAP) ─────────────────────────────
  const [showSma, setShowSma]   = useState(false);
  const [showVwap, setShowVwap] = useState(false);

  // ── Clock ──────────────────────────────────────────────────────────────────
  const [utcClock, setUtcClock]   = useState('');
  const [latencyMs, setLatencyMs] = useState(12);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      setUtcClock(`${hh}:${mm}:${ss}`);
      setLatencyMs(Math.floor(Math.random() * 14) + 7); // 7-20ms
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Chart container resize observer ───────────────────────────────────────
  useEffect(() => {
    if (!chartAreaRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setChartDims({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    ro.observe(chartAreaRef.current);
    return () => ro.disconnect();
  }, []);

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const handleChartReady = useCallback((api: IChartApi, series: ISeriesApi<'Candlestick'>) => {
    setChartApi(api);
    setMainSeries(series);
  }, []);

  const handlePriceUpdate = useCallback((price: number) => {
    setCurrentPrice(price);
    if (openPriceRef.current === null) {
      openPriceRef.current = price;
    }
    const open = openPriceRef.current;
    const diff = price - open;
    const pct  = open !== 0 ? (diff / open) * 100 : 0;
    setChange(diff);
    setChangePct(pct);
  }, []);

  // Reset on ticker/timeframe change
  useEffect(() => {
    setCurrentPrice(null);
    setChange(null);
    setChangePct(null);
    openPriceRef.current = null;
  }, [ticker, timeframe]);

  const handleTickerChange = (newTicker: string) => {
    const t = newTicker.trim().toUpperCase();
    if (t) {
      setTicker(t);
    }
  };

  const handleThemeChange = (id: string) => {
    setThemeId(id);
    saveThemeId(id);
    setShowThemeMenu(false);
  };

  const isUp = change === null || change >= 0;

  const currentDrawing = selectedId ? drawings.find(x => x.id === selectedId) : null;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: theme.background,
        overflow: 'hidden',
        fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
        color: theme.panelText,
      }}
    >
      {/* ══ TOP BAR ════════════════════════════════════════════════════════ */}
      <div
        style={{
          height: 42,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          paddingRight: 12,
          borderBottom: `1px solid ${theme.panelBorder}`,
          background: theme.panelBg,
          userSelect: 'none',
        }}
      >
        {/* Source badge */}
        <span style={{
          background: theme.accentDim,
          color: theme.accent,
          fontSize: 9,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 3,
          letterSpacing: 1.2,
          flexShrink: 0,
        }}>
          YAHOO.F
        </span>

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />

        {/* Ticker input */}
        <TickerSearchDropdown
          value={ticker}
          onChange={handleTickerChange}
          theme={theme}
        />

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />

        {/* Timeframe pills */}
        <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                fontWeight: timeframe === tf ? 700 : 400,
                background: timeframe === tf ? theme.accentDim : 'transparent',
                color: timeframe === tf ? theme.accent : theme.panelTextDim,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart Type selector */}
        <>
          <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {(chartEngine === 'canvas' ? ['candlestick', 'range', 'renko', 'line', 'bars'] : ['candlestick', 'renko']).map(ct => (
              <button
                key={ct}
                onClick={() => setChartType(ct as ChartType)}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  fontWeight: 700,
                  background: chartType === ct ? '#22c55e' : 'transparent',
                  color: chartType === ct ? '#fff' : theme.panelTextDim,
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  transition: 'all 0.12s',
                }}
              >
                {ct === 'candlestick' ? '🕯️' : ct === 'range' ? '📊' : ct === 'renko' ? '🧱' : ct === 'line' ? '📈' : '▐'}
                {' '}{ct}
              </button>
            ))}
          </div>

          {/* Range / Renko Size inputs */}
          {chartType === 'range' && chartEngine === 'canvas' && (
            <>
              <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: theme.panelTextDim }}>Range $</span>
                <input
                  type="number"
                  value={rangeSize}
                  onChange={e => setRangeSize(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  step="0.1"
                  min="0.01"
                  style={{
                    width: 50,
                    padding: '2px 4px',
                    background: theme.background,
                    border: `1px solid ${theme.panelBorder}`,
                    color: theme.panelText,
                    fontFamily: 'inherit',
                    fontSize: 10,
                    borderRadius: 3,
                    outline: 'none',
                  }}
                />
              </div>
            </>
          )}

          {chartType === 'renko' && (
            <>
              <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: theme.panelTextDim }}>Brick $</span>
                <input
                  type="number"
                  value={renkoBrickSize}
                  onChange={e => setRenkoBrickSize(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  step="0.1"
                  min="0.01"
                  style={{
                    width: 50,
                    padding: '2px 4px',
                    background: theme.background,
                    border: `1px solid ${theme.panelBorder}`,
                    color: theme.panelText,
                    fontFamily: 'inherit',
                    fontSize: 10,
                    borderRadius: 3,
                    outline: 'none',
                  }}
                />
              </div>
            </>
          )}
        </>

        {/* Heikin Ashi toggle (LWC engine only) */}
        {chartEngine === 'lwc' && (
          <>
            <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />
            <button
              onClick={() => setIsHeikinAshi(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 700,
                background: isHeikinAshi ? '#22c55e' : 'transparent',
                color: isHeikinAshi ? '#fff' : theme.panelTextDim,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textTransform: 'uppercase',
                transition: 'all 0.12s',
              }}
              title="Toggle Heikin Ashi Candlesticks"
            >
              <span style={{ filter: isHeikinAshi ? 'brightness(1.5)' : 'grayscale(1)' }}>🕯️</span>
              HA
            </button>
          </>
        )}

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />

        {/* ── INDICATOR MANAGER ── */}
        <IndicatorManager
          indicators={indicators}
          onChange={handleIndicatorsChange}
          theme={theme}
        />

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />

        {/* Legacy indicator toggles (SMA built-in / VWAP built-in) */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {[
            { key: 'sma',  label: 'SMA', active: showSma,  toggle: () => setShowSma(v => !v),  color: theme.smaColor  },
            { key: 'vwap', label: 'VWAP', active: showVwap, toggle: () => setShowVwap(v => !v), color: theme.vwapColor },
          ].map(ind => (
            <button
              key={ind.key}
              onClick={ind.toggle}
              style={{
                padding: '2px 7px',
                fontSize: 10,
                background: ind.active ? `${ind.color}18` : 'transparent',
                color: ind.active ? ind.color : theme.panelTextDim,
                border: `1px solid ${ind.active ? `${ind.color}50` : theme.panelBorder}`,
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}
            >
              {ind.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: theme.panelBorder, flexShrink: 0 }} />

        {/* Live price + change */}
        {currentPrice !== null ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: theme.panelText, letterSpacing: 0.3 }}>
              {fmtPrice(currentPrice)}
            </span>
            {changePct !== null && (
              <span style={{ fontSize: 11, fontWeight: 600, color: isUp ? theme.priceUp : theme.priceDown }}>
                {isUp ? '+' : ''}{changePct.toFixed(2)}%
              </span>
            )}
            {change !== null && (
              <span style={{ fontSize: 10, color: isUp ? theme.priceUp : theme.priceDown, opacity: 0.8 }}>
                ({isUp ? '+' : ''}{change.toFixed(2)})
              </span>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: theme.panelTextDim, opacity: 0.5 }}>—</span>
        )}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Engine Toggle */}
        <button
          onClick={() => setChartEngine(chartEngine === 'canvas' ? 'lwc' : 'canvas')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            background: chartEngine === 'canvas' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
            border: '1px solid ' + (chartEngine === 'canvas' ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.4)'),
            borderRadius: 4,
            color: chartEngine === 'canvas' ? '#22c55e' : '#6366f1',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.2s',
          }}
          title={chartEngine === 'canvas' ? 'Click to switch to Lightweight Charts' : 'Click to switch to Custom Canvas Engine'}
        >
          <span className="relative flex h-2 w-2">
            <span className={
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 " + 
              (chartEngine === 'canvas' ? 'bg-green-400' : 'bg-indigo-400')
            }></span>
            <span className={
              "relative inline-flex rounded-full h-2 w-2 " + 
              (chartEngine === 'canvas' ? 'bg-green-500' : 'bg-indigo-500')
            }></span>
          </span>
          {chartEngine === 'canvas' ? '⚡ CANVAS' : '📦 LWC'}
        </button>

        {/* Theme switcher */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setShowThemeMenu(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 9px',
              background: 'transparent',
              border: `1px solid ${theme.panelBorder}`,
              borderRadius: 4,
              color: theme.panelTextDim,
              fontSize: 10,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'border-color 0.12s',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: theme.accent, display: 'inline-block', flexShrink: 0 }} />
            {theme.label || theme.name}
            <span style={{ opacity: 0.4, fontSize: 8, marginLeft: 2 }}>▾</span>
          </button>

          {showThemeMenu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowThemeMenu(false)} />
              <div style={{
                position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 50,
                background: theme.panelBg,
                border: `1px solid ${theme.panelBorder}`,
                borderRadius: 6, overflow: 'hidden', minWidth: 155,
                boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
              }}>
                {THEME_IDS.map(id => {
                  const t = THEMES[id];
                  const active = id === themeId;
                  return (
                    <button
                      key={id}
                      onClick={() => handleThemeChange(id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', padding: '8px 12px',
                        background: active ? t.accentDim : 'transparent',
                        color: active ? t.accent : theme.panelTextDim,
                        border: 'none', cursor: 'pointer',
                        fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                        transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = `${t.accent}10`; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.accent, display: 'inline-block', flexShrink: 0 }} />
                      {t.label || t.name}
                      {active && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{ marginLeft: 'auto' }}>
                          <path d="M20 6L9 17L4 12" stroke={t.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ══ MIDDLE: SIDEBAR + CHART ════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left drawing toolbar */}
        <TerminalSidebar
          activeTool={activeTool}
          onToolChange={handleToolChange}
          onClearAll={() => drawingOverlayRef.current?.clearAll()}
          onToggleObjectTree={() => setShowObjectTree(v => !v)}
          showObjectTree={showObjectTree}
          drawingCount={drawings.length}
          theme={theme}
        />

        {/* Chart fills remaining space */}
        <div
          ref={chartAreaRef}
          style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}
        >
          {chartEngine === 'canvas' ? (
            <CanvasTerminalChart
              ticker={ticker}
              interval={timeframe}
              themeId={themeId}
              showSma={showSma}
              showVwap={showVwap}
              indicators={indicators}
              activePosition={null}
              onPriceUpdate={handlePriceUpdate}
              chartType={chartType}
              rangeSize={rangeSize}
              renkoBrickSize={renkoBrickSize}
            />
          ) : (
            <>
              <TerminalChart
                ticker={ticker}
                interval={timeframe}
                themeId={themeId}
                showSma={showSma}
                showVwap={showVwap}
                isHeikinAshi={isHeikinAshi}
                chartType={chartType}
                renkoBrickSize={renkoBrickSize}
                indicators={indicators}
                activePosition={null}
                onPriceUpdate={handlePriceUpdate}
                onChartReady={handleChartReady}
                onDataLoaded={setChartData}
              />

              <TerminalDrawingOverlay
                ref={drawingOverlayRef}
                activeTool={activeTool}
                chartApi={chartApi}
                mainSeries={mainSeries}
                theme={theme}
                width={chartDims.width}
                height={chartDims.height}
                drawings={drawings}
                indicatorDrawings={indicatorDrawings}
                onDrawingsChange={handleDrawingsChange}
                selectedId={selectedId}
                onSelectId={setSelectedId}
                timeframe={timeframe}
                chartData={chartData}
              />
            </>
          )}

            {/* ICT Stats Table Overlay */}
            {activeIctConfig && activeIctConfig.showStatTable && ictStats && (
              <div style={{
                position: 'absolute',
                zIndex: 30,
                padding: '8px 12px',
                background: activeIctConfig.tableBg || 'rgba(10, 10, 14, 0.9)',
                border: `1px solid ${activeIctConfig.tableBorder || '#333'}`,
                borderRadius: 6,
                color: activeIctConfig.tableText || '#fff',
                fontFamily: 'monospace',
                fontSize: 10,
                pointerEvents: 'none',
                ...(activeIctConfig.tablePosition === 'Top Left' ? { top: 10, left: 10 } : {}),
                ...(activeIctConfig.tablePosition === 'Top Right' ? { top: 10, right: 60 } : {}),
                ...(activeIctConfig.tablePosition === 'Bottom Left' ? { bottom: 25, left: 10 } : {}),
                ...(activeIctConfig.tablePosition === 'Bottom Right' ? { bottom: 25, right: 60 } : {}),
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
                  ICT S&D Profile [TFO]
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px' }}>
                  <span style={{ opacity: 0.7 }}>Total Days</span>
                  <span style={{ textAlign: 'right', fontWeight: 'bold' }}>{ictStats.totalDays}</span>
                  <span style={{ opacity: 0.7 }}>S&D Days</span>
                  <span style={{ textAlign: 'right', fontWeight: 'bold' }}>{ictStats.sndDays}</span>
                  <span style={{ opacity: 0.7 }}>Hit Rate</span>
                  <span style={{ textAlign: 'right', fontWeight: 'bold' }}>
                    {ictStats.totalDays > 0 ? ((ictStats.sndDays / ictStats.totalDays) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              </div>
            )}


          {/* Object Tree Panel — slides in from right side of chart area */}
          {showObjectTree && (
            <DrawingObjectTree
              drawings={drawings}
              theme={theme}
              onUpdate={handleDrawingsChange}
              onClose={() => setShowObjectTree(false)}
            />
          )}

          {/* ══ FLOATING QUICK-EDIT TOOLBAR ════════════════════════════════════ */}
          {selectedId && toolbarPos && (
            <div
              style={{
                position: 'absolute',
                left: `calc(48px + ${toolbarPos.x}px)`, // Offset 48px from left sidebar
                top: `calc(42px + ${toolbarPos.y}px)`,  // Offset 42px from top bar
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                background: 'rgba(15, 15, 15, 0.85)',
                backdropFilter: 'blur(8px)',
                border: `1px solid ${theme.panelBorder}`,
                borderRadius: 6,
                zIndex: 40,
                boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                userSelect: 'none',
                pointerEvents: 'all',
              }}
            >
              {/* Object Type Label */}
              <span style={{ fontSize: 9, color: theme.panelTextDim, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {drawings.find(x => x.id === selectedId)?.type.replace('_', ' ') || 'OBJECT'}
              </span>

              <div style={{ width: 1, height: 14, background: theme.panelBorder }} />

              {/* Preset Colors */}
              <div style={{ display: 'flex', gap: 4 }}>
                {['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#ffffff'].map(color => {
                  const currentDrawing = drawings.find(x => x.id === selectedId);
                  const isCurrent = currentDrawing?.color === color || (!currentDrawing?.color && color === '#f97316');
                  return (
                    <button
                      key={color}
                      onClick={() => {
                        handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, color } : d));
                      }}
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: color,
                        border: isCurrent ? `2.5px solid ${theme.panelText}` : '1px solid rgba(255,255,255,0.15)',
                        cursor: 'pointer',
                        padding: 0,
                        transition: 'transform 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                      onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                    />
                  );
                })}
              </div>

              {/* Text Label & Position Inputs for all persistent drawing tools */}
              {['trendline', 'rectangle', 'horizontal_line', 'fibonacci', 'long_position', 'short_position'].includes(currentDrawing?.type || '') && (
                <>
                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <input
                    type="text"
                    placeholder="Label..."
                    value={currentDrawing?.label || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleDrawingsChange(
                        drawings.map((d) =>
                          d.id === selectedId ? { ...d, label: val || undefined } : d
                        )
                      );
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: `1px solid ${theme.panelBorder}`,
                      borderRadius: 4,
                      color: theme.panelText,
                      fontSize: 10,
                      fontFamily: 'inherit',
                      padding: '2px 6px',
                      width: 80,
                      outline: 'none',
                      transition: 'all 0.15s',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.width = '120px';
                      e.currentTarget.style.borderColor = theme.accent;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.width = '80px';
                      e.currentTarget.style.borderColor = theme.panelBorder;
                    }}
                  />
                  {['trendline', 'rectangle', 'horizontal_line', 'fibonacci'].includes(currentDrawing?.type || '') && (
                    <select
                      value={currentDrawing?.textPosition || (['trendline', 'horizontal_line', 'fibonacci'].includes(currentDrawing?.type || '') ? 'left' : 'top_left')}
                      onChange={(e) => {
                        const pos = e.target.value;
                        handleDrawingsChange(
                          drawings.map((d) =>
                            d.id === selectedId ? { ...d, textPosition: pos } : d
                          )
                        );
                      }}
                      style={{
                        background: 'rgba(15, 15, 15, 0.95)',
                        border: `1px solid ${theme.panelBorder}`,
                        borderRadius: 4,
                        color: theme.panelTextDim,
                        fontSize: 9,
                        fontFamily: 'inherit',
                        padding: '2px 4px',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {['trendline', 'horizontal_line', 'fibonacci'].includes(currentDrawing?.type || '') ? (
                        <>
                          <option value="left" style={{ background: theme.panelBg }}>Left</option>
                          <option value="center" style={{ background: theme.panelBg }}>Center</option>
                          <option value="right" style={{ background: theme.panelBg }}>Right</option>
                        </>
                      ) : (
                        <>
                          <option value="top_left" style={{ background: theme.panelBg }}>Top Left</option>
                          <option value="top_center" style={{ background: theme.panelBg }}>Top Center</option>
                          <option value="top_right" style={{ background: theme.panelBg }}>Top Right</option>
                          <option value="center" style={{ background: theme.panelBg }}>Center</option>
                          <option value="bottom_left" style={{ background: theme.panelBg }}>Bottom Left</option>
                          <option value="bottom_center" style={{ background: theme.panelBg }}>Bottom Center</option>
                          <option value="bottom_right" style={{ background: theme.panelBg }}>Bottom Right</option>
                        </>
                      )}
                    </select>
                  )}
                </>
              )}

              {/* Anchored Volume Profile specific settings */}
              {currentDrawing?.type === 'anchored_volume_profile' && (
                <>
                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <span style={{ fontSize: 9, color: theme.panelTextDim }}>Plc:</span>
                  <select
                    value={currentDrawing?.avpPlacement || 'Right'}
                    onChange={(e) => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpPlacement: e.target.value as 'Left' | 'Right' } : d))}
                    style={{ background: 'rgba(15, 15, 15, 0.95)', border: `1px solid ${theme.panelBorder}`, borderRadius: 4, color: theme.panelText, fontSize: 9, padding: '2px 4px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="Right" style={{ background: theme.panelBg }}>Right</option>
                    <option value="Left" style={{ background: theme.panelBg }}>Left</option>
                  </select>

                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <span style={{ fontSize: 9, color: theme.panelTextDim }}>W%:</span>
                  <input
                    type="number"
                    value={currentDrawing?.avpWidth || 30}
                    onChange={(e) => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpWidth: parseInt(e.target.value, 10) || 30 } : d))}
                    style={{ background: 'rgba(15, 15, 15, 0.95)', border: `1px solid ${theme.panelBorder}`, borderRadius: 4, color: theme.panelText, fontSize: 9, padding: '2px 4px', outline: 'none', width: 36 }}
                  />

                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <span style={{ fontSize: 9, color: theme.panelTextDim }}>Rows:</span>
                  <select
                    value={currentDrawing?.avpRows || 24}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpRows: val } : d));
                    }}
                    style={{ background: 'rgba(15, 15, 15, 0.95)', border: `1px solid ${theme.panelBorder}`, borderRadius: 4, color: theme.panelText, fontSize: 9, padding: '2px 4px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="24" style={{ background: theme.panelBg }}>24</option>
                    <option value="50" style={{ background: theme.panelBg }}>50</option>
                    <option value="100" style={{ background: theme.panelBg }}>100</option>
                    <option value="200" style={{ background: theme.panelBg }}>200</option>
                  </select>
                  
                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <span style={{ fontSize: 9, color: theme.panelTextDim }}>VA%:</span>
                  <select
                    value={currentDrawing?.avpValueAreaPct || 70}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpValueAreaPct: val } : d));
                    }}
                    style={{ background: 'rgba(15, 15, 15, 0.95)', border: `1px solid ${theme.panelBorder}`, borderRadius: 4, color: theme.panelText, fontSize: 9, padding: '2px 4px', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="68" style={{ background: theme.panelBg }}>68</option>
                    <option value="70" style={{ background: theme.panelBg }}>70</option>
                    <option value="80" style={{ background: theme.panelBg }}>80</option>
                  </select>

                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: theme.panelTextDim, cursor: 'pointer' }}>
                    <input type="checkbox" checked={currentDrawing?.avpShowVAH || false} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpShowVAH: e.target.checked } : d))} style={{ margin: 0 }} />
                    VAH
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: theme.panelTextDim, cursor: 'pointer' }}>
                    <input type="checkbox" checked={currentDrawing?.avpShowVAL || false} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpShowVAL: e.target.checked } : d))} style={{ margin: 0 }} />
                    VAL
                  </label>

                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center' }} title="Up/Down Colors">
                    <input type="color" value={currentDrawing?.avpUpColor || '#0d9488'} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpUpColor: e.target.value } : d))} style={{ width: 16, height: 16, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                    <input type="color" value={currentDrawing?.avpDownColor || '#be123c'} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpDownColor: e.target.value } : d))} style={{ width: 16, height: 16, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'center' }} title="VA Up/Down Colors">
                    <input type="color" value={currentDrawing?.avpVaUpColor || '#2dd4bf'} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpVaUpColor: e.target.value } : d))} style={{ width: 16, height: 16, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                    <input type="color" value={currentDrawing?.avpVaDownColor || '#fb7185'} onChange={e => handleDrawingsChange(drawings.map(d => d.id === selectedId ? { ...d, avpVaDownColor: e.target.value } : d))} style={{ width: 16, height: 16, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </>
              )}

              {/* Line/Border Thickness for all persistent drawing tools */}
              {['trendline', 'rectangle', 'horizontal_line', 'fibonacci', 'long_position', 'short_position'].includes(currentDrawing?.type || '') && (
                <>
                  <div style={{ width: 1, height: 14, background: theme.panelBorder }} />
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {[1.5, 2.5, 4, 6].map((w, idx) => {
                      const isCurrent = (currentDrawing?.lineWidth || 1.5) === w;
                      return (
                        <button
                          key={w}
                          onClick={() => {
                            handleDrawingsChange(
                              drawings.map((d) =>
                                d.id === selectedId ? { ...d, lineWidth: w } : d
                              )
                            );
                          }}
                          style={{
                            background: isCurrent ? theme.accent : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${isCurrent ? theme.accent : theme.panelBorder}`,
                            borderRadius: 4,
                            color: isCurrent ? '#000000' : theme.panelTextDim,
                            fontSize: 9,
                            padding: '2px 4px',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontFamily: 'monospace',
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all 0.1s',
                          }}
                          title={`Line Thickness: ${idx + 1}px`}
                        >
                          {idx + 1}px
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div style={{ width: 1, height: 14, background: theme.panelBorder }} />

              {/* Delete Button */}
              <button
                onClick={() => {
                  handleDrawingsChange(drawings.filter(d => d.id !== selectedId));
                  setSelectedId(null);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.panelTextDim,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                  borderRadius: 3,
                  transition: 'color 0.12s, background 0.12s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = theme.priceDown;
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = theme.panelTextDim;
                  e.currentTarget.style.background = 'transparent';
                }}
                title="Delete Object"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>

              {/* Close Button */}
              <button
                onClick={() => setSelectedId(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.panelTextDim,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                  borderRadius: 3,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = theme.panelText)}
                onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══ BOTTOM STATUS BAR ══════════════════════════════════════════════ */}
      <div
        style={{
          height: 27,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 10,
          paddingRight: 14,
          borderTop: `1px solid ${theme.panelBorder}`,
          background: theme.panelBg,
          userSelect: 'none',
        }}
      >
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a
            href="/"
            style={{
              color: theme.panelTextDim,
              fontSize: 10,
              textDecoration: 'none',
              opacity: 0.65,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.65')}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Dashboard
          </a>

          <span style={{ color: theme.panelBorder }}>│</span>

          <span style={{ color: theme.panelTextDim, fontSize: 10, opacity: 0.4 }}>
            Yahoo Finance · WS Real-time
          </span>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: theme.panelTextDim, fontSize: 10, opacity: 0.5, letterSpacing: 0.5 }}>
            UTC {utcClock}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: theme.priceUp,
              display: 'inline-block',
              animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
            <span style={{ color: theme.panelTextDim, fontSize: 10 }}>{latencyMs}ms</span>
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

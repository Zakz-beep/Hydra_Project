'use client';

import type { Instrument } from '../../../lib/chart-studio/types';
import React, { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import TerminalChart from '../core/TerminalChart';
import CanvasTerminalChart from '../engine/CanvasTerminalChart';
import type { ChartType } from '../engine/types';
import TerminalSidebar, { DrawingTool } from '../core/TerminalSidebar';
import TerminalDrawingOverlay, { TerminalDrawingOverlayHandle, Drawing } from '../core/TerminalDrawingOverlay';
import { THEMES, THEME_IDS, getTheme, getSavedThemeId, saveThemeId, TerminalTheme } from '../core/TerminalThemes';
import MarketOverview from '../market/MarketOverview';
import GEXComponent from '../alternative-data/GEXComponent';
import YieldSpreadChart from '../macro/YieldSpreadChart';
import RealYieldChart from '../macro/RealYieldChart';
import RiskCalculator from '../tools/RiskCalculator';
import LegatruuDashboard from '../macro/LegatruuDashboard';
import NetLiquidityChart from '../macro/NetLiquidityChart';
import TransactionHistoryPanel from '../panels/TransactionHistoryPanel';
import PerformanceMetricsPanel from '../panels/PerformanceMetricsPanel';
import COTDashboard from '../alternative-data/COTDashboard';
import VIXTermStructure from '../market/VIXTermStructure';
import VVIXRatioAlert from '../market/VVIXRatioAlert';
import HRPSizer from '../tools/HRPSizer';
import NewsDashboard from '../market/NewsDashboard';
import AssetMetricsPanel from '../panels/AssetMetricsPanel';

const playOrderSound = () => {
    if (typeof window !== 'undefined') {
        const audio = new Audio('/sound/order_filled.wav');
        audio.play().catch(e => console.error("Audio play failed:", e));
    }
};

const ChartStudio = dynamic(() => import('../studio/ChartWorkspace'), { ssr: false });
export default function LightweightChartDashboard({ initialInstrument, onInstrumentChange }: { initialInstrument?: Instrument; onInstrumentChange?: (i: Instrument) => void }) {
  const [legacy, setLegacy] = useState(false);
  return legacy ? <><button onClick={() => setLegacy(false)} className="mb-3 rounded border border-teal-500/30 px-4 py-2 text-xs text-teal-300">← Back to Chart Studio</button><LegacyLightweightChartDashboard /></> : <ChartStudio onLegacy={() => setLegacy(true)} initialInstrument={initialInstrument} onInstrumentChange={onInstrumentChange} />;
}

function LegacyLightweightChartDashboard() {
  // â”€â”€â”€ Theme State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [themeId, setThemeId] = useState(() => getSavedThemeId());
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const theme = getTheme(themeId);

  const handleThemeChange = (id: string) => {
    setThemeId(id);
    saveThemeId(id);
    setShowThemeMenu(false);
  };

  // â”€â”€â”€ Drawing Tools State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const drawingOverlayRef = useRef<TerminalDrawingOverlayHandle>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const canvasClearDrawingsRef = useRef<(() => void) | null>(null);

  // â”€â”€â”€ Chart API refs for drawing overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [mainSeries, setMainSeries] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [chartDimensions, setChartDimensions] = useState({ width: 0, height: 0 });
  const chartAreaRef = useRef<HTMLDivElement>(null);

  const handleChartReady = useCallback((api: IChartApi, series: ISeriesApi<'Candlestick'>) => {
    setChartApi(api);
    setMainSeries(series);
  }, []);

  // â”€â”€â”€ Sidebar panel toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showPanel, setShowPanel] = useState(true);

  // Navigation State
  const [chartView, setChartView] = useState<'price' | 'macro' | 'news'>('price');

  // Market State
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [activeTicker, setActiveTicker] = useState('AAPL');
  const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const [activeInterval, setActiveInterval] = useState('1m');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  // Engine Toggle State
  const [chartEngine, setChartEngine] = useState<'canvas' | 'lwc'>('canvas');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [rangeSize, setRangeSize] = useState(1.0);
  const [renkoBrickSize, setRenkoBrickSize] = useState(0.5);
  const [isHeikinAshi, setIsHeikinAshi] = useState(false);

  // Indicators State
  const [showSma, setShowSma] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showGex, setShowGex] = useState(false);
  const [showGexLevels, setShowGexLevels] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [showAssetMetrics, setShowAssetMetrics] = useState(true);
  
  const [indicatorDrawings, setIndicatorDrawings] = useState<Drawing[]>([]);

  // Paper Trading State
  interface PaperPosition { id: string; ticker: string; mode: 'long' | 'short'; entry_price: number; tp_price?: number; sl_price?: number; margin: number; leverage: number; qty: number; created_at: string; }
  interface PaperHistory { id: string; ticker: string; mode: 'long' | 'short'; entry_price: number; close_price: number; close_reason: string; pnl: number; margin: number; leverage: number; qty: number; opened_at: string; closed_at: string; }

  const [balance, setBalance] = useState(10000);
  const [leverage, setLeverage] = useState(1);
  const [marginInput, setMarginInput] = useState(1000);
  const [tpPerc, setTpPerc] = useState<number>(0);
  const [slPerc, setSlPerc] = useState<number>(0);
  
  const [isEditingBalance, setIsEditingBalance] = useState(false);
  const [balanceInputValue, setBalanceInputValue] = useState("");
  
  const [activePositions, setActivePositions] = useState<PaperPosition[]>([]);
  const [tradeHistory, setTradeHistory] = useState<PaperHistory[]>([]);
  const [marketPrices, setMarketPrices] = useState<Record<string, number>>({});

  // â”€â”€â”€ Track chart container dimensions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  React.useEffect(() => {
    if (!chartAreaRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setChartDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(chartAreaRef.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
      fetch('/api/paper/state')
        .then(res => res.json())
        .then(data => {
            if (data.balance !== undefined) {
                setBalance(data.balance);
                setActivePositions(data.positions || []);
                setTradeHistory(data.history || []);
            }
        })
        .catch(console.error);
  }, []);

  React.useEffect(() => {
      const fetchPrices = async () => {
          if (activePositions.length === 0) return;
          const symbols = Array.from(new Set(activePositions.map(p => p.ticker)));
          try {
              const promises = symbols.map(async (sym) => {
                  if (sym === activeTicker && currentPrice) return { symbol: sym, price: currentPrice };
                  const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(sym)}&interval=1d&range=1d`);
                  const json = await res.json();
                  const closeArr = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null);
                  if (closeArr && closeArr.length > 0) {
                      return { symbol: sym, price: closeArr[closeArr.length - 1] };
                  }
                  return null;
              });
              const results = await Promise.all(promises);
              const newPrices: Record<string, number> = {};
              results.forEach(r => {
                  if (r) newPrices[r.symbol] = r.price;
              });
              setMarketPrices(prev => ({ ...prev, ...newPrices }));
          } catch (e) {
              console.error(e);
          }
      };
      
      fetchPrices();
      const interval = setInterval(fetchPrices, 15000);
      return () => clearInterval(interval);
  }, [activePositions, activeTicker, currentPrice]);

  // â”€â”€â”€ Fetch GEX Levels for Chart Overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  React.useEffect(() => {
      if (!showGexLevels) {
          setIndicatorDrawings([]);
          return;
      }
      
      const fetchGexLevels = async () => {
          try {
              const res = await fetch(`/api/greeks/gex?ticker=${encodeURIComponent(activeTicker)}`);
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
                      // Determine color based on GEX value: Emerald for Positive (Call), Red for Negative (Put)
                      const color = isCallWall ? '#34d399' : '#f87171';
                      
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
              
              setIndicatorDrawings(newDrawings);
          } catch (err) {
              console.error("Error fetching GEX levels for overlay:", err);
          }
      };
      
      fetchGexLevels();
      const interval = setInterval(fetchGexLevels, 60000); // refresh every minute
      return () => clearInterval(interval);
  }, [showGexLevels, activeTicker]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      setActiveTicker(tickerInput.trim().toUpperCase());
    }
  };

  const handleTrade = async (mode: 'long' | 'short') => {
      if (!currentPrice) return alert("Waiting for price data...");
      if (marginInput > balance) return alert("Insufficient balance.");
      if (marginInput <= 0) return alert("Margin must be greater than 0.");

      const qty = (marginInput * leverage) / currentPrice;

      let tpPrice = undefined;
      let slPrice = undefined;
      if (mode === 'long') {
          if (tpPerc > 0) tpPrice = currentPrice * (1 + tpPerc / 100);
          if (slPerc > 0) slPrice = currentPrice * (1 - slPerc / 100);
      } else {
          if (tpPerc > 0) tpPrice = currentPrice * (1 - tpPerc / 100);
          if (slPerc > 0) slPrice = currentPrice * (1 + slPerc / 100);
      }

      try {
          const res = await fetch('/api/paper/trade', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  ticker: activeTicker,
                  mode,
                  entry_price: currentPrice,
                  tp_price: tpPrice,
                  sl_price: slPrice,
                  margin: marginInput,
                  leverage,
                  qty
              })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          
          setBalance(data.new_balance);
          setActivePositions(prev => [data.position, ...prev]);
          playOrderSound();
      } catch (e: any) {
          alert("Trade failed: " + e.message);
      }
  };

  // Auto Close Logic for TP/SL
  React.useEffect(() => {
      if (activePositions.length > 0 && currentPrice) {
          activePositions.forEach(async pos => {
              if (pos.ticker !== activeTicker) return; 
              
              let shouldClose = false;
              let closeReason = '';

              if (pos.mode === 'long') {
                  if (pos.tp_price && currentPrice >= pos.tp_price) { shouldClose = true; closeReason = 'TP'; }
                  if (pos.sl_price && currentPrice <= pos.sl_price) { shouldClose = true; closeReason = 'SL'; }
              } else {
                  if (pos.tp_price && currentPrice <= pos.tp_price) { shouldClose = true; closeReason = 'TP'; }
                  if (pos.sl_price && currentPrice >= pos.sl_price) { shouldClose = true; closeReason = 'SL'; }
              }

              if (shouldClose) {
                  try {
                      const res = await fetch('/api/paper/close', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: pos.id, close_price: currentPrice, close_reason: closeReason })
                      });
                      const data = await res.json();
                      if (data.error) throw new Error(data.error);
                      
                      setBalance(data.new_balance);
                      setActivePositions(prev => prev.filter(p => p.id !== pos.id));
                      fetch('/api/paper/state').then(r => r.json()).then(d => setTradeHistory(d.history || []));
                      
                      playOrderSound();
                      setTimeout(() => alert(`${pos.ticker} ${pos.mode.toUpperCase()} closed due to ${closeReason}!`), 100);
                  } catch (e) {
                      console.error("Auto close failed", e);
                  }
              }
          });
      }
  }, [currentPrice, activePositions, activeTicker]);

  const closePosition = async (pos: PaperPosition) => {
      if (!currentPrice && pos.ticker === activeTicker) return;
      if (pos.ticker !== activeTicker) {
          alert(`Please switch the chart to ${pos.ticker} to close this position manually.`);
          return;
      }
      
      try {
          const res = await fetch('/api/paper/close', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: pos.id, close_price: currentPrice, close_reason: 'MANUAL' })
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          
          setBalance(data.new_balance);
          setActivePositions(prev => prev.filter(p => p.id !== pos.id));
          fetch('/api/paper/state').then(r => r.json()).then(d => setTradeHistory(d.history || []));
          playOrderSound();
      } catch (e: any) {
          alert("Close failed: " + e.message);
      }
  };

  const calculatePnl = (pos: PaperPosition) => {
      const price = pos.ticker === activeTicker ? currentPrice : marketPrices[pos.ticker];
      if (!price) return null;
      const priceDiff = price - pos.entry_price;
      const rawPnl = pos.qty * priceDiff;
      return pos.mode === 'long' ? rawPnl : -rawPnl;
  };
  
  const currentTickerPosition = activePositions.find(p => p.ticker === activeTicker);
  const mappedPosition = currentTickerPosition ? {
      entryPrice: currentTickerPosition.entry_price,
      tpPrice: currentTickerPosition.tp_price,
      slPrice: currentTickerPosition.sl_price,
      mode: currentTickerPosition.mode
  } : null;

  // â”€â”€â”€ View Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const viewButtons = [
    { id: 'price' as const, label: 'PRICE', color: theme.accent },
    { id: 'macro' as const, label: 'MACRO', color: '#f59e0b' },
    { id: 'news' as const, label: 'NEWS', color: '#10b981' },
  ];

  return (
    <div className="space-y-4" style={{ color: theme.panelText }}>
      <MarketOverview onSelectTicker={(symbol) => {
          setTickerInput(symbol);
          setActiveTicker(symbol);
      }} />

      {/* â”€â”€â”€ Top Header Bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Logo */}
            <h2 className="text-sm font-mono font-bold flex items-center gap-2" style={{ color: theme.panelText }}>
              <span style={{ color: theme.accent }}>VRP</span>
              <span
                className="text-[10px] px-2 py-0.5 rounded uppercase tracking-wider"
                style={{ backgroundColor: theme.accentDim, color: theme.accent }}
              >
                Pro Terminal
              </span>
            </h2>

            {/* View Switcher */}
            <div className="flex overflow-hidden rounded-lg" style={{ border: `1px solid ${theme.panelBorder}`, background: theme.panelBg }}>
              {viewButtons.map(btn => (
                <button
                  key={btn.id}
                  onClick={() => setChartView(btn.id)}
                  className="px-3 py-1.5 text-[11px] font-mono font-bold transition-colors"
                  style={{
                    backgroundColor: chartView === btn.id ? btn.color : 'transparent',
                    color: chartView === btn.id ? '#fff' : theme.panelTextDim,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Engine Toggle */}
            <button
              onClick={() => setChartEngine(chartEngine === 'canvas' ? 'lwc' : 'canvas')}
              className="px-2.5 py-1.5 rounded-lg font-mono text-[10px] font-bold uppercase transition-all duration-200 shadow-sm flex items-center gap-1.5 active:scale-95 hover:opacity-90 cursor-pointer"
              style={{
                backgroundColor: chartEngine === 'canvas' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                color: chartEngine === 'canvas' ? '#22c55e' : '#6366f1',
                border: '1px solid ' + (chartEngine === 'canvas' ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.4)'),
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
              {chartEngine === 'canvas' ? 'âš¡ CANVAS' : 'ðŸ“¦ LWC'}
            </button>

            {/* Theme Switcher Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowThemeMenu(!showThemeMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-colors"
                style={{
                  background: theme.panelBg,
                  border: `1px solid ${theme.panelBorder}`,
                  color: theme.panelTextDim,
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: theme.accent }}
                />
                {theme.label || theme.name}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="ml-0.5 opacity-50">
                  <path d="M2 3.5L5 7L8 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                </svg>
              </button>

              {showThemeMenu && (
                <>
                  {/* Backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowThemeMenu(false)} />
                  <div
                    className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-2xl overflow-hidden"
                    style={{
                      background: theme.panelBg,
                      border: `1px solid ${theme.panelBorder}`,
                      minWidth: 160,
                    }}
                  >
                    {THEME_IDS.map(id => {
                      const t = THEMES[id];
                      const isActive = id === themeId;
                      return (
                        <button
                          key={id}
                          onClick={() => handleThemeChange(id)}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors"
                          style={{
                            background: isActive ? t.accentDim : 'transparent',
                            color: isActive ? t.accent : theme.panelTextDim,
                          }}
                          onMouseEnter={e => {
                            if (!isActive) e.currentTarget.style.background = `${t.accent}12`;
                          }}
                          onMouseLeave={e => {
                            if (!isActive) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: t.accent }}
                          />
                          <span className="font-mono text-[11px] font-bold">
                            {t.label || t.name}
                          </span>
                          {isActive && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="ml-auto">
                              <path d="M20 6L9 17L4 12" stroke={t.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Panel Toggle */}
            {chartView === 'price' && (
              <button
                onClick={() => setShowPanel(!showPanel)}
                className="px-2 py-1.5 rounded-lg text-[11px] font-mono font-bold transition-colors"
                style={{
                  background: showPanel ? theme.accentDim : theme.panelBg,
                  border: `1px solid ${theme.panelBorder}`,
                  color: showPanel ? theme.accent : theme.panelTextDim,
                }}
                title={showPanel ? 'Hide Trading Panel' : 'Show Trading Panel'}
              >
                {showPanel ? 'âŸ©' : 'âŸ¨'} Panel
              </button>
            )}

            {/* Ticker form */}
            <form onSubmit={handleSubmit} className="flex items-center gap-2 p-1 rounded-lg" style={{ background: theme.panelBg, border: `1px solid ${theme.panelBorder}` }}>
               <input 
                 type="text" 
                 value={tickerInput}
                 onChange={(e) => setTickerInput(e.target.value)}
                 placeholder="Ticker..."
                 className="bg-transparent border-none text-sm font-mono px-2 py-1 focus:outline-none rounded w-20 sm:w-28 uppercase"
                 style={{ color: theme.panelText }}
               />
               <button 
                 type="submit"
                 className="font-mono text-xs px-3 py-1.5 rounded transition-colors shadow-sm"
                 style={{ backgroundColor: theme.accent, color: '#fff' }}
               >
                 Go
               </button>
            </form>
          </div>
        </div>

        {/* Row 2: Interval selector + Chart type + Engine toggle */}
        <div className="-mx-3 md:mx-0 overflow-x-auto">
          <div className="flex gap-2 items-center flex-wrap p-1.5 rounded-lg w-max min-w-full sm:min-w-0 mx-3 md:mx-0" style={{ background: theme.panelBg, border: `1px solid ${theme.panelBorder}` }}>
             {/* Interval buttons */}
             {intervals.map((intv) => (
                 <button
                     key={intv}
                     onClick={() => setActiveInterval(intv)}
                     className="px-3 py-1.5 rounded font-mono text-xs transition-colors flex-1 sm:flex-none"
                     style={{
                       backgroundColor: activeInterval === intv ? theme.accent : 'transparent',
                       color: activeInterval === intv ? '#fff' : theme.panelTextDim,
                     }}
                 >
                     {intv}
                 </button>
             ))}

             {/* Separator */}
             <div style={{ width: 1, height: 20, background: theme.panelBorder }} />

             {/* Chart Type selector */}
             <div className="flex items-center gap-1">
                 {(chartEngine === 'canvas' ? ['candlestick', 'range', 'renko', 'line', 'bars'] : ['candlestick', 'renko']).map(ct => (
                   <button
                     key={ct}
                     onClick={() => setChartType(ct as ChartType)}
                     className="px-2 py-1.5 rounded font-mono text-[10px] font-bold uppercase transition-colors"
                     style={{
                       backgroundColor: chartType === ct ? '#22c55e' : 'transparent',
                       color: chartType === ct ? '#fff' : theme.panelTextDim,
                     }}
                   >
                     {ct === 'candlestick' ? 'ðŸ•¯ï¸' : ct === 'range' ? 'ðŸ“Š' : ct === 'renko' ? 'ðŸ§±' : ct === 'line' ? 'ðŸ“ˆ' : 'â–'}
                     {' '}{ct}
                   </button>
                 ))}

                 {/* Range size input (canvas only) */}
                 {chartType === 'range' && chartEngine === 'canvas' && (
                   <div className="flex items-center gap-1">
                     <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>Range $</span>
                     <input
                       type="number"
                       value={rangeSize}
                       onChange={e => setRangeSize(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                       step="0.1"
                       min="0.01"
                       className="w-16 px-1.5 py-1 rounded font-mono text-[11px] focus:outline-none"
                       style={{ background: theme.background, border: `1px solid ${theme.panelBorder}`, color: theme.panelText }}
                     />
                   </div>
                 )}

                 {/* Renko brick size input */}
                 {chartType === 'renko' && (
                   <div className="flex items-center gap-1">
                     <span className="font-mono text-[10px]" style={{ color: theme.panelTextDim }}>Brick $</span>
                     <input
                       type="number"
                       value={renkoBrickSize}
                       onChange={e => setRenkoBrickSize(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                       step="0.1"
                       min="0.01"
                       className="w-16 px-1.5 py-1 rounded font-mono text-[11px] focus:outline-none"
                       style={{ background: theme.background, border: `1px solid ${theme.panelBorder}`, color: theme.panelText }}
                     />
                   </div>
                 )}
             </div>

             {/* Heikin Ashi toggle (LWC engine only) */}
             {chartEngine === 'lwc' && (
                <button
                  onClick={() => setIsHeikinAshi(!isHeikinAshi)}
                  className="px-2 py-1.5 rounded font-mono text-[10px] font-bold uppercase transition-colors flex items-center gap-1.5"
                  style={{
                    backgroundColor: isHeikinAshi ? '#22c55e' : 'transparent',
                    color: isHeikinAshi ? '#fff' : theme.panelTextDim,
                  }}
                  title="Toggle Heikin Ashi Candlesticks"
                >
                  <span style={{ filter: isHeikinAshi ? 'brightness(1.5)' : 'grayscale(1)' }}>ðŸ•¯ï¸</span>
                  HA
                </button>
             )}
          </div>
        </div>

        {/* Row 3: Powered by */}
        <p className="text-[10px] font-mono hidden sm:block" style={{ color: theme.panelTextDim }}>
           {chartEngine === 'canvas' ? 'Powered by Custom Canvas Engine' : 'Powered by Lightweight Chartsâ„¢'} & Yahoo Finance & FRED
        </p>
      </div>

      {/* â”€â”€â”€ Main Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-col lg:grid lg:grid-cols-4 gap-4 lg:gap-6">
          {/* LEFT: CHART AREA */}
          <div className={`space-y-4 ${chartView === 'price' && showPanel ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
              {chartView === 'price' && (
                  <div className="overflow-x-auto">
                    <div className="flex items-center gap-2 p-2 px-4 rounded-xl w-max" style={{ background: `${theme.panelBg}88`, border: `1px solid ${theme.panelBorder}` }}>
                        <span className="text-xs font-mono uppercase tracking-wider mr-2" style={{ color: theme.panelTextDim }}>Indicators:</span>
                        {[
                          { key: 'sma', label: 'SMA 20', active: showSma, toggle: () => setShowSma(!showSma), color: theme.smaColor },
                          { key: 'vwap', label: 'VWAP', active: showVwap, toggle: () => setShowVwap(!showVwap), color: theme.vwapColor },
                          { key: 'gex', label: 'GREEKS', active: showGex, toggle: () => setShowGex(!showGex), color: '#8b5cf6' },
                          { key: 'gex_levels', label: 'GEX LEVELS', active: showGexLevels, toggle: () => setShowGexLevels(!showGexLevels), color: '#f59e0b' },
                          { key: 'hist', label: 'HISTORY', active: showHistory, toggle: () => setShowHistory(!showHistory), color: theme.priceUp },
                          { key: 'metrics', label: 'ASSET METRICS', active: showAssetMetrics, toggle: () => setShowAssetMetrics(!showAssetMetrics), color: theme.accent },
                        ].map(ind => (
                          <button
                            key={ind.key}
                            onClick={ind.toggle}
                            className="px-3 py-1.5 rounded font-mono text-xs transition-colors shadow-sm"
                            style={{
                              background: ind.active ? `${ind.color}18` : theme.panelBg,
                              color: ind.active ? ind.color : theme.panelTextDim,
                              border: `1px solid ${ind.active ? `${ind.color}50` : theme.panelBorder}`,
                            }}
                          >
                            {ind.label}
                          </button>
                        ))}
                    </div>
                  </div>
              )}

        <div className="lg:col-span-8 flex flex-col gap-4">
            {chartView === 'price' ? (
                <>
                    {/* â”€â”€ Pro Terminal: Sidebar + Chart + Drawing Overlay â”€â”€â”€ */}
                    <div className="flex rounded-xl overflow-hidden" style={{ border: `1px solid ${theme.panelBorder}`, background: theme.background }}>
                      {/* Sidebar */}
                      <TerminalSidebar
                        activeTool={activeTool}
                        onToolChange={setActiveTool}
                        onClearAll={() => {
                            if (chartEngine === 'canvas') {
                                canvasClearDrawingsRef.current?.();
                            } else {
                                drawingOverlayRef.current?.clearAll();
                            }
                        }}
                        onToggleObjectTree={() => {}}
                        showObjectTree={false}
                        drawingCount={drawings.length}
                        theme={theme}
                      />

                      {/* Chart + Drawing Overlay Container */}
                      <div className="flex-1 relative" ref={chartAreaRef} style={{ height: 560 }}>
                        {chartEngine === 'canvas' ? (
                          <CanvasTerminalChart
                            ticker={activeTicker}
                            interval={activeInterval}
                            themeId={themeId}
                            showSma={showSma}
                            showVwap={showVwap}
                            activePosition={mappedPosition}
                            onPriceUpdate={setCurrentPrice}
                            chartType={chartType}
                            rangeSize={rangeSize}
                            renkoBrickSize={renkoBrickSize}
                            drawingTool={activeTool}
                            onClearDrawings={(fn) => { canvasClearDrawingsRef.current = fn; }}
                          />
                        ) : (
                          <TerminalChart
                            ticker={activeTicker}
                            interval={activeInterval}
                            themeId={themeId}
                            showSma={showSma}
                            showVwap={showVwap}
                            isHeikinAshi={isHeikinAshi}
                            chartType={chartType}
                            renkoBrickSize={renkoBrickSize}
                            activePosition={mappedPosition}
                            onPriceUpdate={setCurrentPrice}
                            onChartReady={handleChartReady}
                          />
                        )}

                        {/* Drawing Overlay (SVG on top of chart â€” LWC only for now) */}
                        {chartEngine === 'lwc' && (
                          <TerminalDrawingOverlay
                            ref={drawingOverlayRef}
                            activeTool={activeTool}
                            chartApi={chartApi}
                            mainSeries={mainSeries}
                            theme={theme}
                            width={chartDimensions.width}
                            height={chartDimensions.height}
                            drawings={drawings}
                            indicatorDrawings={indicatorDrawings}
                            onDrawingsChange={setDrawings}
                          />
                        )}
                      </div>
                    </div>

                    <VVIXRatioAlert />
                    <VIXTermStructure />
                    <HRPSizer balance={balance} />

                    {showGex && (
                        <GEXComponent ticker={activeTicker} />
                    )}
                </>
            ) : chartView === 'macro' ? (
                <div className="flex flex-col gap-6">
                    <COTDashboard />
                    <YieldSpreadChart />
                    <RealYieldChart />
                    <LegatruuDashboard />
                    <NetLiquidityChart />
                </div>
            ) : chartView === 'news' ? (
                <NewsDashboard ticker={activeTicker} />
            ) : null}

            {chartView === 'price' && showHistory && (
                <>
                    <PerformanceMetricsPanel history={tradeHistory} currentBalance={balance} />
                    <TransactionHistoryPanel history={tradeHistory} />
                </>
            )}

            {chartView === 'price' && showAssetMetrics && (
                <AssetMetricsPanel 
                    ticker={activeTicker}
                    interval={activeInterval}
                    currentPrice={currentPrice}
                />
            )}
        </div>
          </div>

          {/* RIGHT: TRADING PANEL (Collapsible) */}
          {chartView === 'price' && showPanel && (
              <div className="lg:col-span-1 space-y-4 flex flex-col">
                  {/* Account Balance Card */}
              <div className="rounded-xl p-5 shadow-xl relative overflow-hidden group" style={{ background: theme.panelBg, border: `1px solid ${theme.panelBorder}` }}>
                  <div className="absolute top-0 left-0 w-full h-1" style={{ background: `linear-gradient(to right, ${theme.accent}, ${theme.priceUp})` }}></div>
                  <div className="flex justify-between items-center mb-1">
                      <h3 className="text-xs font-mono uppercase tracking-wider" style={{ color: theme.panelTextDim }}>Available Balance</h3>
                      {!isEditingBalance && (
                          <button 
                              onClick={() => {
                                  setBalanceInputValue(balance.toString());
                                  setIsEditingBalance(true);
                              }}
                              className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 rounded"
                              style={{ color: theme.accent, border: `1px solid ${theme.accent}50`, background: theme.accentDim }}
                          >
                              EDIT
                          </button>
                      )}
                  </div>
                  {isEditingBalance ? (
                      <div className="flex items-center gap-2 mt-1">
                          <div className="relative flex-1">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-lg" style={{ color: theme.panelTextDim }}>$</span>
                              <input 
                                  type="number"
                                  value={balanceInputValue}
                                  onChange={e => setBalanceInputValue(e.target.value)}
                                  className="w-full font-mono text-xl rounded py-1 pl-6 pr-2 focus:outline-none"
                                  style={{ background: theme.background, border: `1px solid ${theme.accent}80`, color: theme.panelText }}
                                  autoFocus
                                  onKeyDown={e => {
                                      if (e.key === 'Escape') setIsEditingBalance(false);
                                      if (e.key === 'Enter') {
                                          const parsed = parseFloat(balanceInputValue);
                                          if (!isNaN(parsed) && parsed >= 0) {
                                              fetch('/api/paper/balance', {
                                                  method: 'POST',
                                                  headers: { 'Content-Type': 'application/json' },
                                                  body: JSON.stringify({ balance: parsed })
                                              }).then(res => res.json()).then(data => {
                                                  if (data.status === 'success') {
                                                      setBalance(data.new_balance);
                                                      setIsEditingBalance(false);
                                                  } else {
                                                      alert("Failed to update balance: " + (data.detail || data.error));
                                                  }
                                              }).catch(err => alert("Error: " + err.message));
                                          } else {
                                              alert("Invalid balance amount");
                                          }
                                      }
                                  }}
                              />
                          </div>
                          <button 
                              onClick={() => {
                                  const parsed = parseFloat(balanceInputValue);
                                  if (!isNaN(parsed) && parsed >= 0) {
                                      fetch('/api/paper/balance', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ balance: parsed })
                                      }).then(res => res.json()).then(data => {
                                          if (data.status === 'success') {
                                              setBalance(data.new_balance);
                                              setIsEditingBalance(false);
                                          } else {
                                              alert("Failed to update balance: " + (data.detail || data.error));
                                          }
                                      }).catch(e => alert("Error: " + e.message));
                                  } else {
                                      alert("Invalid balance amount");
                                  }
                              }}
                              className="p-1 rounded transition-colors"
                              style={{ background: theme.priceUp, color: '#fff' }}
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          </button>
                          <button 
                              onClick={() => setIsEditingBalance(false)}
                              className="p-1 rounded transition-colors"
                              style={{ background: theme.panelBorder, color: theme.panelTextDim }}
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                      </div>
                  ) : (
                      <div className="text-3xl font-mono font-bold" style={{ color: theme.panelText }}>
                          ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                  )}
              </div>

              <RiskCalculator
                balance={balance}
                currentPrice={currentPrice}
                onApply={(settings) => {
                  setMarginInput(settings.margin);
                  setLeverage(settings.leverage);
                  setTpPerc(settings.tpPerc);
                  setSlPerc(settings.slPerc);
                }}
              />

              {/* Order Box */}
              <div className="rounded-xl p-5 shadow-xl flex-1 flex flex-col" style={{ background: theme.panelBg, border: `1px solid ${theme.panelBorder}` }}>
                  <h3 className="text-sm font-mono uppercase tracking-wider mb-4 pb-2" style={{ color: theme.panelText, borderBottom: `1px solid ${theme.panelBorder}` }}>Place Order</h3>
                  
                  <div className="space-y-5 flex-1">
                      {/* Margin Input */}
                      <div className="space-y-2">
                          <label className="flex justify-between text-xs font-mono uppercase" style={{ color: theme.panelTextDim }}>
                              <span>Margin (USD)</span>
                              <span className="cursor-pointer" style={{ color: theme.accent }} onClick={() => setMarginInput(balance)}>Max</span>
                          </label>
                          <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono" style={{ color: theme.panelTextDim }}>$</span>
                              <input 
                                  type="number" 
                                  value={marginInput}
                                  onChange={e => setMarginInput(Number(e.target.value))}
                                  className="w-full font-mono text-lg rounded-lg py-2 pl-8 pr-3 focus:outline-none transition-all"
                                  style={{ background: theme.background, border: `1px solid ${theme.panelBorder}`, color: theme.panelText }}
                              />
                          </div>
                      </div>

                      {/* Leverage Slider */}
                      <div className="space-y-2">
                          <label className="flex justify-between text-xs font-mono uppercase" style={{ color: theme.panelTextDim }}>
                              <span>Leverage</span>
                              <span style={{ color: theme.priceUp }}>{leverage}x</span>
                          </label>
                          <input 
                              type="range" 
                              min="1" max="100" step="1"
                              value={leverage}
                              onChange={e => setLeverage(Number(e.target.value))}
                              className="w-full"
                              style={{ accentColor: theme.accent }}
                          />
                          <div className="flex justify-between text-[10px] font-mono" style={{ color: theme.panelTextDim }}>
                              <span>1x</span>
                              <span>50x</span>
                              <span>100x</span>
                          </div>
                      </div>

                      {/* TP / SL Inputs */}
                      <div className="flex gap-4">
                          <div className="space-y-1 flex-1">
                              <label className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>TP %</label>
                              <input 
                                  type="number" step="0.1" min="0"
                                  value={tpPerc}
                                  onChange={e => setTpPerc(Number(e.target.value))}
                                  placeholder="0"
                                  className="w-full font-mono text-sm rounded py-1.5 px-3 focus:outline-none"
                                  style={{ background: theme.background, border: `1px solid ${theme.panelBorder}`, color: theme.priceUp }}
                              />
                          </div>
                          <div className="space-y-1 flex-1">
                              <label className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>SL %</label>
                              <input 
                                  type="number" step="0.1" min="0"
                                  value={slPerc}
                                  onChange={e => setSlPerc(Number(e.target.value))}
                                  placeholder="0"
                                  className="w-full font-mono text-sm rounded py-1.5 px-3 focus:outline-none"
                                  style={{ background: theme.background, border: `1px solid ${theme.panelBorder}`, color: theme.priceDown }}
                              />
                          </div>
                      </div>

                      {/* Summary Data */}
                      <div className="rounded-lg p-3 space-y-2" style={{ background: `${theme.background}88`, border: `1px solid ${theme.panelBorder}50` }}>
                          <div className="flex justify-between text-xs font-mono">
                              <span style={{ color: theme.panelTextDim }}>Position Size</span>
                              <span style={{ color: theme.panelText }}>${(marginInput * leverage).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs font-mono">
                              <span style={{ color: theme.panelTextDim }}>Current Price</span>
                              <span style={{ color: theme.panelText }}>{currentPrice ? `$${currentPrice.toFixed(2)}` : '--'}</span>
                          </div>
                      </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-3 mt-6">
                      <button 
                          onClick={() => handleTrade('long')}
                          disabled={!currentPrice}
                          className="disabled:opacity-50 disabled:cursor-not-allowed font-mono font-bold py-3 rounded-lg transition-colors shadow-lg"
                          style={{ backgroundColor: theme.priceUp, color: '#fff' }}
                      >
                          LONG
                      </button>
                      <button 
                          onClick={() => handleTrade('short')}
                          disabled={!currentPrice}
                          className="disabled:opacity-50 disabled:cursor-not-allowed font-mono font-bold py-3 rounded-lg transition-colors shadow-lg"
                          style={{ backgroundColor: theme.priceDown, color: '#fff' }}
                      >
                          SHORT
                      </button>
                  </div>
              </div>

              {/* GEX Component */}
              {showGex && <GEXComponent ticker={activeTicker} />}

              {/* Active Positions Panel */}
              {activePositions.length > 0 && (
                  <div className="space-y-3">
                      <h3 className="text-sm font-mono uppercase tracking-wider" style={{ color: theme.panelText }}>Active Positions</h3>
                      {activePositions.map(pos => {
                          const pnl = calculatePnl(pos);
                          const roi = pnl !== null ? (pnl / pos.margin) * 100 : null;
                          const isViewingPosition = pos.ticker === activeTicker;
                          const markPrice = isViewingPosition ? currentPrice : marketPrices[pos.ticker];
                          
                          return (
                              <div key={pos.id} className="rounded-xl p-4 shadow-xl relative overflow-hidden" style={{ background: theme.panelBg, border: `1px solid ${theme.accent}50` }}>
                                  <div className="absolute top-0 left-0 w-full h-1" style={{ background: pos.mode === 'long' ? theme.priceUp : theme.priceDown }}></div>
                                  
                                  <div className="flex justify-between items-start mb-3">
                                      <div>
                                          <div className="flex items-center gap-2">
                                              <h3 className="text-lg font-mono font-bold" style={{ color: theme.panelText }}>{pos.ticker}</h3>
                                              <span
                                                className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase"
                                                style={{
                                                  background: pos.mode === 'long' ? `${theme.priceUp}30` : `${theme.priceDown}30`,
                                                  color: pos.mode === 'long' ? theme.priceUp : theme.priceDown,
                                                }}
                                              >
                                                  {pos.mode} {pos.leverage}x
                                              </span>
                                          </div>
                                          <p className="text-[10px] font-mono mt-1" style={{ color: theme.panelTextDim }}>
                                              Size: {pos.qty.toFixed(4)}
                                          </p>
                                      </div>
                                      
                                      <div className="text-right">
                                          <p className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>Unrealized PNL</p>
                                          <p className="text-xl font-mono font-bold" style={{ color: pnl !== null ? (pnl >= 0 ? theme.priceUp : theme.priceDown) : theme.panelTextDim }}>
                                              {pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '---'}
                                          </p>
                                          <p className="text-xs font-mono" style={{ color: pnl !== null ? (pnl >= 0 ? theme.priceUp : theme.priceDown) : theme.panelTextDim }}>
                                              {roi !== null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%` : '---'}
                                          </p>
                                      </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-3 p-2 rounded-lg" style={{ background: `${theme.background}88`, border: `1px solid ${theme.panelBorder}50` }}>
                                      <div>
                                          <p className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>Entry Price</p>
                                          <p className="text-sm font-mono" style={{ color: theme.panelText }}>${pos.entry_price.toFixed(2)}</p>
                                      </div>
                                      <div className="text-right">
                                          <p className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>Mark Price</p>
                                          <p className="text-sm font-mono" style={{ color: theme.panelText }}>{markPrice ? `$${markPrice.toFixed(2)}` : '--'}</p>
                                      </div>
                                      
                                      <div className="pt-2" style={{ borderTop: `1px solid ${theme.panelBorder}50` }}>
                                          <p className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>Take Profit</p>
                                          <p className="text-sm font-mono" style={{ color: theme.priceUp }}>
                                              {pos.tp_price ? `$${pos.tp_price.toFixed(2)}` : 'None'}
                                          </p>
                                      </div>
                                      <div className="pt-2 text-right" style={{ borderTop: `1px solid ${theme.panelBorder}50` }}>
                                          <p className="text-[10px] font-mono uppercase" style={{ color: theme.panelTextDim }}>Stop Loss</p>
                                          <p className="text-sm font-mono" style={{ color: theme.priceDown }}>
                                              {pos.sl_price ? `$${pos.sl_price.toFixed(2)}` : 'None'}
                                          </p>
                                      </div>
                                  </div>

                                  <button 
                                      onClick={() => closePosition(pos)}
                                      className="w-full font-mono text-xs py-2 rounded-lg transition-colors"
                                      style={{ background: theme.panelBorder, color: theme.panelText, border: `1px solid ${theme.panelBorder}` }}
                                  >
                                      Close Position
                                  </button>
                              </div>
                          );
                      })}
                  </div>
              )}
          </div>
          )}
      </div>
    </div>
  );
}

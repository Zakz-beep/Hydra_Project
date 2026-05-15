import React, { useState } from 'react';
import TradingChart from '../core/TradingChart';
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
import AISMapDashboard from '../alternative-data/AISMapDashboard';

const playOrderSound = () => {
    if (typeof window !== 'undefined') {
        const audio = new Audio('/sound/order_filled.wav');
        audio.play().catch(e => console.error("Audio play failed:", e));
    }
};

export default function LightweightChartDashboard() {
  // Navigation State
  const [chartView, setChartView] = useState<'price' | 'macro' | 'ais'>('price');

  // Market State
  const [tickerInput, setTickerInput] = useState('AAPL');
  const [activeTicker, setActiveTicker] = useState('AAPL');
  const intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
  const [activeInterval, setActiveInterval] = useState('1m'); // default to 1m for paper trading feel
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  // Indicators State
  const [showSma, setShowSma] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showGex, setShowGex] = useState(false);
  const [showHistory, setShowHistory] = useState(true);

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

  return (
    <div className="space-y-6">
      <MarketOverview onSelectTicker={(symbol) => {
          // Update both the input box and the active chart ticker
          setTickerInput(symbol);
          setActiveTicker(symbol);
      }} />
      {/* Top controls — stack on mobile, row on sm+ */}
      <div className="flex flex-col gap-3">

        {/* Row 1: Title + View Switch */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
              <span className="text-indigo-400">VRP</span>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded uppercase tracking-wider">Terminal</span>
            </h2>

            <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                <button
                    onClick={() => setChartView('price')}
                    className={`px-3 py-1.5 text-[11px] font-mono font-bold transition-colors ${
                        chartView === 'price'
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                    PRICE
                </button>
                <button
                    onClick={() => setChartView('macro')}
                    className={`px-3 py-1.5 text-[11px] font-mono font-bold transition-colors ${
                        chartView === 'macro'
                        ? 'bg-amber-600 text-white'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                    MACRO
                </button>
                <button
                    onClick={() => setChartView('ais')}
                    className={`px-3 py-1.5 text-[11px] font-mono font-bold transition-colors ${
                        chartView === 'ais'
                        ? 'bg-teal-600 text-white'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                    }`}
                >
                    🌊 AIS
                </button>
            </div>
          </div>

          {/* Ticker form */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800">
             <input 
               type="text" 
               value={tickerInput}
               onChange={(e) => setTickerInput(e.target.value)}
               placeholder="Ticker..."
               className="bg-transparent border-none text-sm font-mono text-zinc-200 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 rounded w-20 sm:w-28 uppercase"
             />
             <button 
               type="submit"
               className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs px-3 py-1.5 rounded transition-colors shadow-sm"
             >
               Go
             </button>
          </form>
        </div>

        {/* Row 2: Interval selector (scrollable on mobile) */}
        <div className="-mx-3 md:mx-0 overflow-x-auto">
          <div className="flex gap-1 bg-zinc-900/80 p-1.5 rounded-lg border border-zinc-800 w-max min-w-full sm:min-w-0 mx-3 md:mx-0">
             {intervals.map((intv) => (
                 <button
                     key={intv}
                     onClick={() => setActiveInterval(intv)}
                     className={`px-3 py-1.5 rounded font-mono text-xs transition-colors flex-1 sm:flex-none ${
                         activeInterval === intv 
                         ? 'bg-indigo-600 text-white shadow-sm' 
                         : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                     }`}
                 >
                     {intv}
                 </button>
             ))}
          </div>
        </div>

        {/* Row 3: Powered by (desktop only) */}
        <p className="text-[10px] font-mono text-zinc-600 hidden sm:block">
           Powered by Lightweight Charts™ &amp; Yahoo Finance &amp; FRED
        </p>
      </div>

      {/* Main grid: on mobile stacks vertically, on lg side-by-side */}
      <div className="flex flex-col lg:grid lg:grid-cols-4 gap-4 lg:gap-6">
          {/* LEFT: CHART AREA */}
          <div className={`space-y-4 ${chartView === 'price' ? 'lg:col-span-3' : 'lg:col-span-4'}`}>
              {chartView === 'price' && (
                  <div className="overflow-x-auto">
                    <div className="flex items-center gap-2 bg-zinc-900/40 p-2 px-4 rounded-xl border border-zinc-800 w-max">
                        <span className="text-xs font-mono text-zinc-500 uppercase tracking-wider mr-2">Indicators:</span>
                        <button
                          onClick={() => setShowSma(!showSma)}
                          className={`px-3 py-1.5 rounded font-mono text-xs transition-colors shadow-sm border ${
                              showSma ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-zinc-900/80 text-zinc-500 border-zinc-800 hover:bg-zinc-800'
                          }`}
                        >
                          SMA 20
                        </button>
                        <button
                          onClick={() => setShowVwap(!showVwap)}
                          className={`px-3 py-1.5 rounded font-mono text-xs transition-colors shadow-sm border ${
                              showVwap ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-zinc-900/80 text-zinc-500 border-zinc-800 hover:bg-zinc-800'
                          }`}
                        >
                          VWAP
                        </button>
                        <button
                          onClick={() => setShowGex(!showGex)}
                          className={`px-3 py-1.5 rounded font-mono text-xs transition-colors shadow-sm border ${
                              showGex ? 'bg-violet-500/10 text-violet-400 border-violet-500/30' : 'bg-zinc-900/80 text-zinc-500 border-zinc-800 hover:bg-zinc-800'
                          }`}
                        >
                          GREEKS
                        </button>
                        <button
                          onClick={() => setShowHistory(!showHistory)}
                          className={`px-3 py-1.5 rounded font-mono text-xs transition-colors shadow-sm border ${
                              showHistory ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-zinc-900/80 text-zinc-500 border-zinc-800 hover:bg-zinc-800'
                          }`}
                        >
                          HISTORY
                        </button>
                    </div>
                  </div>
              )}

        <div className="lg:col-span-8 flex flex-col gap-4">
            {chartView === 'price' ? (
                <>
                    <TradingChart 
                        ticker={activeTicker}
                        interval={activeInterval}
                        showSma={showSma}
                        showVwap={showVwap}
                        activePosition={mappedPosition}
                        onPriceUpdate={setCurrentPrice}
                    />

                    <VVIXRatioAlert />
                    <VIXTermStructure />
                    
                    {/* HRP MST Graph Component (Full Width) */}
                    <HRPSizer balance={balance} />

                    {/* Component GEX/Vanna/Charm, hanya tampil jika showGex true */}
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
            ) : chartView === 'ais' ? (
                <AISMapDashboard />
            ) : null}

            {chartView === 'price' && showHistory && (
                <>
                    <PerformanceMetricsPanel history={tradeHistory} currentBalance={balance} />
                    <TransactionHistoryPanel history={tradeHistory} />
                </>
            )}
        </div>
          </div>

          {/* RIGHT: TRADING PANEL (Only in Price View, stacks below chart on mobile) */}
          {chartView === 'price' && (
              <div className="lg:col-span-1 space-y-4 flex flex-col">
                  {/* Account Balance Card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-500"></div>
                  <div className="flex justify-between items-center mb-1">
                      <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider">Available Balance</h3>
                      {!isEditingBalance && (
                          <button 
                              onClick={() => {
                                  setBalanceInputValue(balance.toString());
                                  setIsEditingBalance(true);
                              }}
                              className="text-[10px] font-mono text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-300 border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded"
                          >
                              EDIT
                          </button>
                      )}
                  </div>
                  {isEditingBalance ? (
                      <div className="flex items-center gap-2 mt-1">
                          <div className="relative flex-1">
                              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 font-mono text-lg">$</span>
                              <input 
                                  type="number"
                                  value={balanceInputValue}
                                  onChange={e => setBalanceInputValue(e.target.value)}
                                  className="w-full bg-zinc-900 border border-indigo-500/50 text-zinc-100 font-mono text-xl rounded py-1 pl-6 pr-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                              className="bg-emerald-600 hover:bg-emerald-500 text-white p-1 rounded transition-colors"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          </button>
                          <button 
                              onClick={() => setIsEditingBalance(false)}
                              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 p-1 rounded transition-colors"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                      </div>
                  ) : (
                      <div className="text-3xl font-mono text-zinc-100 font-bold">
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
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl flex-1 flex flex-col">
                  <h3 className="text-sm font-mono text-zinc-100 uppercase tracking-wider mb-4 border-b border-zinc-800 pb-2">Place Order</h3>
                  
                  <div className="space-y-5 flex-1">
                      {/* Margin Input */}
                      <div className="space-y-2">
                          <label className="flex justify-between text-xs font-mono text-zinc-400 uppercase">
                              <span>Margin (USD)</span>
                              <span className="text-indigo-400 cursor-pointer" onClick={() => setMarginInput(balance)}>Max</span>
                          </label>
                          <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-mono">$</span>
                              <input 
                                  type="number" 
                                  value={marginInput}
                                  onChange={e => setMarginInput(Number(e.target.value))}
                                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-lg rounded-lg py-2 pl-8 pr-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                              />
                          </div>
                      </div>

                      {/* Leverage Slider */}
                      <div className="space-y-2">
                          <label className="flex justify-between text-xs font-mono text-zinc-400 uppercase">
                              <span>Leverage</span>
                              <span className="text-emerald-400">{leverage}x</span>
                          </label>
                          <input 
                              type="range" 
                              min="1" max="100" step="1"
                              value={leverage}
                              onChange={e => setLeverage(Number(e.target.value))}
                              className="w-full accent-indigo-500"
                          />
                          <div className="flex justify-between text-[10px] font-mono text-zinc-600">
                              <span>1x</span>
                              <span>50x</span>
                              <span>100x</span>
                          </div>
                      </div>

                      {/* TP / SL Inputs */}
                      <div className="flex gap-4">
                          <div className="space-y-1 flex-1">
                              <label className="text-[10px] font-mono text-zinc-500 uppercase">TP %</label>
                              <div className="relative">
                                  <input 
                                      type="number" step="0.1" min="0"
                                      value={tpPerc}
                                      onChange={e => setTpPerc(Number(e.target.value))}
                                      placeholder="0"
                                      className="w-full bg-zinc-900 border border-zinc-700 text-emerald-400 font-mono text-sm rounded py-1.5 px-3 focus:outline-none focus:border-emerald-500"
                                  />
                              </div>
                          </div>
                          <div className="space-y-1 flex-1">
                              <label className="text-[10px] font-mono text-zinc-500 uppercase">SL %</label>
                              <div className="relative">
                                  <input 
                                      type="number" step="0.1" min="0"
                                      value={slPerc}
                                      onChange={e => setSlPerc(Number(e.target.value))}
                                      placeholder="0"
                                      className="w-full bg-zinc-900 border border-zinc-700 text-red-400 font-mono text-sm rounded py-1.5 px-3 focus:outline-none focus:border-red-500"
                                  />
                              </div>
                          </div>
                      </div>

                      {/* Summary Data */}
                      <div className="bg-zinc-900/50 rounded-lg p-3 space-y-2 border border-zinc-800/50">
                          <div className="flex justify-between text-xs font-mono">
                              <span className="text-zinc-500">Position Size</span>
                              <span className="text-zinc-300">${(marginInput * leverage).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs font-mono">
                              <span className="text-zinc-500">Current Price</span>
                              <span className="text-zinc-300">{currentPrice ? `$${currentPrice.toFixed(2)}` : '--'}</span>
                          </div>
                      </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-2 gap-3 mt-6">
                      <button 
                          onClick={() => handleTrade('long')}
                          disabled={!currentPrice}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono font-bold py-3 rounded-lg transition-colors shadow-lg shadow-emerald-900/20"
                      >
                          LONG
                      </button>
                      <button 
                          onClick={() => handleTrade('short')}
                          disabled={!currentPrice}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono font-bold py-3 rounded-lg transition-colors shadow-lg shadow-red-900/20"
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
                      <h3 className="text-sm font-mono text-zinc-100 uppercase tracking-wider">Active Positions</h3>
                      {activePositions.map(pos => {
                          const pnl = calculatePnl(pos);
                          const roi = pnl !== null ? (pnl / pos.margin) * 100 : null;
                          const isViewingPosition = pos.ticker === activeTicker;
                          const markPrice = isViewingPosition ? currentPrice : marketPrices[pos.ticker];
                          
                          return (
                              <div key={pos.id} className="bg-zinc-950 border border-indigo-500/30 rounded-xl p-4 shadow-xl relative overflow-hidden ring-1 ring-indigo-500/20">
                                  <div className={`absolute top-0 left-0 w-full h-1 ${pos.mode === 'long' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                                  
                                  <div className="flex justify-between items-start mb-3">
                                      <div>
                                          <div className="flex items-center gap-2">
                                              <h3 className="text-lg font-mono font-bold text-zinc-100">{pos.ticker}</h3>
                                              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase ${pos.mode === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                                  {pos.mode} {pos.leverage}x
                                              </span>
                                          </div>
                                          <p className="text-[10px] font-mono text-zinc-500 mt-1">
                                              Size: {pos.qty.toFixed(4)}
                                          </p>
                                      </div>
                                      
                                      <div className="text-right">
                                          <p className="text-[10px] font-mono text-zinc-500 uppercase">Unrealized PNL</p>
                                          <p className={`text-xl font-mono font-bold ${pnl !== null ? (pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-zinc-500'}`}>
                                              {pnl !== null ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '---'}
                                          </p>
                                          <p className={`text-xs font-mono ${pnl !== null ? (pnl >= 0 ? 'text-emerald-500' : 'text-red-500') : 'text-zinc-600'}`}>
                                              {roi !== null ? `${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%` : '---'}
                                          </p>
                                      </div>
                                  </div>

                                  <div className="grid grid-cols-2 gap-y-2 gap-x-4 mb-3 bg-zinc-900/50 p-2 rounded-lg border border-zinc-800/50">
                                      <div>
                                          <p className="text-[10px] font-mono text-zinc-500 uppercase">Entry Price</p>
                                          <p className="text-sm font-mono text-zinc-300">${pos.entry_price.toFixed(2)}</p>
                                      </div>
                                      <div className="text-right">
                                          <p className="text-[10px] font-mono text-zinc-500 uppercase">Mark Price</p>
                                          <p className="text-sm font-mono text-zinc-300">{markPrice ? `$${markPrice.toFixed(2)}` : '--'}</p>
                                      </div>
                                      
                                      <div className="pt-2 border-t border-zinc-800/50">
                                          <p className="text-[10px] font-mono text-zinc-500 uppercase">Take Profit</p>
                                          <p className="text-sm font-mono text-emerald-400">
                                              {pos.tp_price ? `$${pos.tp_price.toFixed(2)}` : 'None'}
                                          </p>
                                      </div>
                                      <div className="pt-2 border-t border-zinc-800/50 text-right">
                                          <p className="text-[10px] font-mono text-zinc-500 uppercase">Stop Loss</p>
                                          <p className="text-sm font-mono text-red-400">
                                              {pos.sl_price ? `$${pos.sl_price.toFixed(2)}` : 'None'}
                                          </p>
                                      </div>
                                  </div>

                                  <button 
                                      onClick={() => closePosition(pos)}
                                      className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs py-2 rounded-lg border border-zinc-700 transition-colors"
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

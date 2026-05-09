import React, { useState } from 'react';
import TradingChart from './TradingChart';
import MarketOverview from './MarketOverview';
import GEXComponent from './GEXComponent';
import YieldSpreadChart from './YieldSpreadChart';
import RealYieldChart from './RealYieldChart';
import RiskCalculator from './RiskCalculator';
import LegatruuDashboard from './LegatruuDashboard';
import NetLiquidityChart from './NetLiquidityChart';

export default function LightweightChartDashboard() {
  // Navigation State
  const [chartView, setChartView] = useState<'price' | 'macro'>('price');

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

  // Paper Trading State
  const [balance, setBalance] = useState(10000);
  const [leverage, setLeverage] = useState(1);
  const [marginInput, setMarginInput] = useState(1000);
  const [tpPerc, setTpPerc] = useState<number>(0);
  const [slPerc, setSlPerc] = useState<number>(0);
  
  const [activePosition, setActivePosition] = useState<{
    ticker: string;
    mode: 'long' | 'short';
    entryPrice: number;
    tpPrice?: number;
    slPrice?: number;
    margin: number;
    leverage: number;
    qty: number;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tickerInput.trim()) {
      setActiveTicker(tickerInput.trim().toUpperCase());
    }
  };

  const handleTrade = (mode: 'long' | 'short') => {
      if (!currentPrice) return alert("Waiting for price data...");
      if (activePosition) return alert("You already have an active position. Close it first.");
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

      setBalance(b => b - marginInput); 
      setActivePosition({
          ticker: activeTicker,
          mode,
          entryPrice: currentPrice,
          tpPrice,
          slPrice,
          margin: marginInput,
          leverage,
          qty
      });
  };

  // Auto Close Logic for TP/SL
  React.useEffect(() => {
     if (activePosition && currentPrice && activePosition.ticker === activeTicker) {
         let shouldClose = false;
         let closeReason = '';

         if (activePosition.mode === 'long') {
             if (activePosition.tpPrice && currentPrice >= activePosition.tpPrice) { shouldClose = true; closeReason = 'TP'; }
             if (activePosition.slPrice && currentPrice <= activePosition.slPrice) { shouldClose = true; closeReason = 'SL'; }
         } else {
             if (activePosition.tpPrice && currentPrice <= activePosition.tpPrice) { shouldClose = true; closeReason = 'TP'; }
             if (activePosition.slPrice && currentPrice >= activePosition.slPrice) { shouldClose = true; closeReason = 'SL'; }
         }

         if (shouldClose) {
             const priceDiff = currentPrice - activePosition.entryPrice;
             const rawPnl = activePosition.qty * priceDiff;
             const finalPnl = activePosition.mode === 'long' ? rawPnl : -rawPnl;
             
             setBalance(b => b + activePosition.margin + finalPnl);
             setActivePosition(null);
             
             // Timeout to not block React render cycle with alert
             setTimeout(() => alert(`Position automatically closed due to ${closeReason}!`), 100);
         }
     }
  }, [currentPrice, activePosition, activeTicker]);

  const closePosition = () => {
      if (!activePosition || !currentPrice) return;
      const pnl = calculatePnl();
      setBalance(b => b + activePosition.margin + pnl);
      setActivePosition(null);
  };

  const calculatePnl = () => {
      if (!activePosition || !currentPrice) return 0;
      
      // If the chart is currently on a different ticker than the position,
      // we can't calculate live PNL reliably with just currentPrice.
      // For this prototype, we'll just show $0 if tickers don't match.
      if (activePosition.ticker !== activeTicker) return 0;

      const priceDiff = currentPrice - activePosition.entryPrice;
      const rawPnl = activePosition.qty * priceDiff;
      return activePosition.mode === 'long' ? rawPnl : -rawPnl;
  };

  const pnl = calculatePnl();
  const roi = activePosition ? (pnl / activePosition.margin) * 100 : 0;
  
  // Is the current chart showing the active position?
  const isViewingPosition = activePosition?.ticker === activeTicker;

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
                        activePosition={isViewingPosition ? activePosition : null}
                        onPriceUpdate={setCurrentPrice}
                    />

                    {/* Component GEX/Vanna/Charm, hanya tampil jika showGex true */}
                    {showGex && (
                        <GEXComponent ticker={activeTicker} />
                    )}
                </>
            ) : chartView === 'macro' ? (
                <div className="flex flex-col gap-6">
                    <YieldSpreadChart />
                    <RealYieldChart />
                    <LegatruuDashboard />
                    <NetLiquidityChart />
                </div>
            ) : null}
        </div>
          </div>

          {/* RIGHT: TRADING PANEL (Only in Price View, stacks below chart on mobile) */}
          {chartView === 'price' && (
              <div className="lg:col-span-1 space-y-4 flex flex-col">
                  {/* Account Balance Card */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-emerald-500"></div>
                  <h3 className="text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1">Available Balance</h3>
                  <div className="text-3xl font-mono text-zinc-100 font-bold">
                      ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
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
                          disabled={!!activePosition || !currentPrice}
                          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono font-bold py-3 rounded-lg transition-colors shadow-lg shadow-emerald-900/20"
                      >
                          LONG
                      </button>
                      <button 
                          onClick={() => handleTrade('short')}
                          disabled={!!activePosition || !currentPrice}
                          className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono font-bold py-3 rounded-lg transition-colors shadow-lg shadow-red-900/20"
                      >
                          SHORT
                      </button>
                  </div>
              </div>

              {/* GEX Component */}
              {showGex && <GEXComponent ticker={activeTicker} />}

              {/* Active Position Panel */}
              {activePosition && (
                  <div className="bg-zinc-950 border border-indigo-500/30 rounded-xl p-5 shadow-xl relative overflow-hidden ring-1 ring-indigo-500/20">
                      <div className={`absolute top-0 left-0 w-full h-1 ${activePosition.mode === 'long' ? 'bg-emerald-500' : 'bg-red-500'}`}></div>
                      
                      <div className="flex justify-between items-start mb-4">
                          <div>
                              <div className="flex items-center gap-2">
                                  <h3 className="text-lg font-mono font-bold text-zinc-100">{activePosition.ticker}</h3>
                                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase ${activePosition.mode === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                      {activePosition.mode} {activePosition.leverage}x
                                  </span>
                              </div>
                              <p className="text-[10px] font-mono text-zinc-500 mt-1">
                                  Size: {activePosition.qty.toFixed(4)}
                              </p>
                          </div>
                          
                          <div className="text-right">
                              <p className="text-[10px] font-mono text-zinc-500 uppercase">Unrealized PNL</p>
                              <p className={`text-xl font-mono font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                              </p>
                              <p className={`text-xs font-mono ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                  {pnl >= 0 ? '+' : ''}{roi.toFixed(2)}%
                              </p>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-y-3 gap-x-4 mb-4 bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/50">
                          <div>
                              <p className="text-[10px] font-mono text-zinc-500 uppercase">Entry Price</p>
                              <p className="text-sm font-mono text-zinc-300">${activePosition.entryPrice.toFixed(2)}</p>
                          </div>
                          <div className="text-right">
                              <p className="text-[10px] font-mono text-zinc-500 uppercase">Mark Price</p>
                              <p className="text-sm font-mono text-zinc-300">{isViewingPosition ? `$${currentPrice?.toFixed(2)}` : '--'}</p>
                          </div>
                          
                          <div className="pt-2 border-t border-zinc-800/50">
                              <p className="text-[10px] font-mono text-zinc-500 uppercase">Take Profit</p>
                              <p className="text-sm font-mono text-emerald-400">
                                  {activePosition.tpPrice ? `$${activePosition.tpPrice.toFixed(2)}` : 'None'}
                              </p>
                          </div>
                          <div className="pt-2 border-t border-zinc-800/50 text-right">
                              <p className="text-[10px] font-mono text-zinc-500 uppercase">Stop Loss</p>
                              <p className="text-sm font-mono text-red-400">
                                  {activePosition.slPrice ? `$${activePosition.slPrice.toFixed(2)}` : 'None'}
                              </p>
                          </div>
                      </div>

                      <button 
                          onClick={closePosition}
                          className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-sm py-2.5 rounded-lg border border-zinc-700 transition-colors"
                      >
                          Close Position
                      </button>
                  </div>
              )}
          </div>
          )}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';

interface RiskCalculatorProps {
  balance: number;
  currentPrice: number | null;
  onApply: (settings: {
    margin: number;
    leverage: number;
    tpPerc: number;
    slPerc: number;
  }) => void;
}

export default function RiskCalculator({ balance, currentPrice, onApply }: RiskCalculatorProps) {
  const [entryPrice, setEntryPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slInputMode, setSlInputMode] = useState<'price' | 'percent'>('percent');
  const [tpInputMode, setTpInputMode] = useState<'price' | 'percent'>('percent');
  const [riskPerc, setRiskPerc] = useState<number>(1);
  const [leverage, setLeverage] = useState<number>(10);
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // Sync entry price to current price when ticker changes
  useEffect(() => {
    if (currentPrice && currentPrice > 0) {
      setEntryPrice(currentPrice.toFixed(2));
    }
  }, [currentPrice]);

  const entry = parseFloat(entryPrice);
  const slRaw = parseFloat(slPrice);
  const tpRaw = parseFloat(tpPrice);

  // Resolve actual SL/TP prices based on input mode
  let slActual = 0;
  let tpActual = 0;

  if (entry > 0) {
    if (slInputMode === 'price') {
      slActual = slRaw;
    } else {
      // percent from entry
      slActual = direction === 'long'
        ? entry * (1 - slRaw / 100)
        : entry * (1 + slRaw / 100);
    }

    if (tpRaw > 0) {
      if (tpInputMode === 'price') {
        tpActual = tpRaw;
      } else {
        tpActual = direction === 'long'
          ? entry * (1 + tpRaw / 100)
          : entry * (1 - tpRaw / 100);
      }
    }
  }

  // Calculate metrics
  let calc = null;
  if (entry > 0 && slActual > 0 && riskPerc > 0 && leverage > 0) {
    const slDistance = Math.abs(entry - slActual);
    const slPerc = (slDistance / entry) * 100;
    const riskAmount = balance * (riskPerc / 100);
    const positionValue = riskAmount / (slPerc / 100);
    const margin = positionValue / leverage;
    const qty = positionValue / entry;

    let rr = 0;
    if (tpActual > 0) {
      const tpDistance = Math.abs(tpActual - entry);
      rr = tpDistance / slDistance;
    }

    // Validation: SL must be below entry for long, above for short
    const isValid = direction === 'long' ? slActual < entry : slActual > entry;
    const isTpValid = tpActual > 0
      ? (direction === 'long' ? tpActual > entry : tpActual < entry)
      : true;

    if (isValid && isTpValid) {
      calc = {
        slPerc,
        tpPerc: tpActual > 0 ? (Math.abs(tpActual - entry) / entry) * 100 : 0,
        riskAmount,
        positionValue,
        margin,
        qty,
        rr,
      };
    }
  }

  const handleApply = () => {
    if (!calc) return;
    onApply({
      margin: Math.max(1, Math.round(calc.margin)),
      leverage,
      tpPerc: calc.tpPerc,
      slPerc: calc.slPerc,
    });
  };

  const formatNum = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl">
      <button
        onClick={() => setIsExpanded((e) => !e)}
        className="w-full flex items-center justify-between text-sm font-mono text-zinc-100 uppercase tracking-wider border-b border-zinc-800 pb-2 cursor-pointer"
      >
        <span>Position Sizer</span>
        <span className="text-zinc-500 text-xs">{isExpanded ? '▾' : '▸'}</span>
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Direction Toggle */}
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setDirection('long')}
              className={`flex-1 py-1.5 text-xs font-mono font-bold transition-colors ${
                direction === 'long'
                  ? 'bg-emerald-600/20 text-emerald-400 border-b-2 border-emerald-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              LONG
            </button>
            <button
              onClick={() => setDirection('short')}
              className={`flex-1 py-1.5 text-xs font-mono font-bold transition-colors ${
                direction === 'short'
                  ? 'bg-red-600/20 text-red-400 border-b-2 border-red-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              SHORT
            </button>
          </div>

          {/* Entry Price */}
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-zinc-500 uppercase">Entry Price</label>
            <input
              type="number"
              step="0.01"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-sm rounded-lg py-2 px-3 focus:outline-none focus:border-indigo-500 transition-all"
            />
          </div>

          {/* Stop Loss */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-mono text-zinc-500 uppercase">Stop Loss</label>
              <div className="flex bg-zinc-900 rounded border border-zinc-800 overflow-hidden">
                <button
                  onClick={() => setSlInputMode('percent')}
                  className={`px-2 py-0.5 text-[10px] font-mono ${slInputMode === 'percent' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`}
                >
                  %
                </button>
                <button
                  onClick={() => setSlInputMode('price')}
                  className={`px-2 py-0.5 text-[10px] font-mono ${slInputMode === 'price' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`}
                >
                  $
                </button>
              </div>
            </div>
            <input
              type="number"
              step={slInputMode === 'percent' ? '0.1' : '0.01'}
              value={slPrice}
              onChange={(e) => setSlPrice(e.target.value)}
              placeholder={slInputMode === 'percent' ? 'e.g. 1.5' : 'e.g. 185.50'}
              className="w-full bg-zinc-900 border border-zinc-700 text-red-400 font-mono text-sm rounded-lg py-2 px-3 focus:outline-none focus:border-red-500 transition-all"
            />
          </div>

          {/* Take Profit */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-mono text-zinc-500 uppercase">Take Profit</label>
              <div className="flex bg-zinc-900 rounded border border-zinc-800 overflow-hidden">
                <button
                  onClick={() => setTpInputMode('percent')}
                  className={`px-2 py-0.5 text-[10px] font-mono ${tpInputMode === 'percent' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`}
                >
                  %
                </button>
                <button
                  onClick={() => setTpInputMode('price')}
                  className={`px-2 py-0.5 text-[10px] font-mono ${tpInputMode === 'price' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500'}`}
                >
                  $
                </button>
              </div>
            </div>
            <input
              type="number"
              step={tpInputMode === 'percent' ? '0.1' : '0.01'}
              value={tpPrice}
              onChange={(e) => setTpPrice(e.target.value)}
              placeholder={tpInputMode === 'percent' ? 'e.g. 3.0' : 'e.g. 195.00'}
              className="w-full bg-zinc-900 border border-zinc-700 text-emerald-400 font-mono text-sm rounded-lg py-2 px-3 focus:outline-none focus:border-emerald-500 transition-all"
            />
          </div>

          {/* Sliders */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 uppercase">
              <span>Account Risk</span>
              <span className="text-indigo-400">{riskPerc}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={riskPerc}
              onChange={(e) => setRiskPerc(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[9px] font-mono text-zinc-600">
              <span>0.1%</span>
              <span>5%</span>
              <span>10%</span>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400 uppercase">
              <span>Leverage</span>
              <span className="text-indigo-400">{leverage}x</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[9px] font-mono text-zinc-600">
              <span>1x</span>
              <span>50x</span>
              <span>100x</span>
            </div>
          </div>

          {/* Results */}
          <div className={`bg-zinc-900/50 rounded-lg p-3 border space-y-2 ${calc ? 'border-zinc-800/50' : 'border-red-900/30'}`}>
            {calc ? (
              <>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-zinc-500">Risk Amount</span>
                  <span className="text-red-400">-${formatNum(calc.riskAmount)}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-zinc-500">Position Size</span>
                  <span className="text-zinc-300">${formatNum(calc.positionValue)}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-zinc-500">Quantity</span>
                  <span className="text-zinc-300">{calc.qty.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-zinc-500">Required Margin</span>
                  <span className="text-indigo-400">${formatNum(calc.margin)}</span>
                </div>
                <div className="flex justify-between text-xs font-mono border-t border-zinc-800/50 pt-2 mt-1">
                  <span className="text-zinc-500">R:R</span>
                  <span className={calc.rr >= 2 ? 'text-emerald-400 font-bold' : calc.rr >= 1 ? 'text-amber-400' : 'text-zinc-400'}>
                    1:{calc.rr.toFixed(2)}
                  </span>
                </div>
                {calc.margin > balance && (
                  <p className="text-[9px] font-mono text-red-400 mt-1">
                    ⚠ Margin exceeds available balance!
                  </p>
                )}
              </>
            ) : (
              <p className="text-[11px] font-mono text-zinc-500 text-center py-1">
                {entry > 0 && slActual > 0
                  ? (direction === 'long' ? 'SL must be below entry' : 'SL must be above entry')
                  : 'Fill entry & stop loss to calculate'}
              </p>
            )}
          </div>

          {/* Apply Button */}
          <button
            onClick={handleApply}
            disabled={!calc}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-mono text-xs font-bold py-2.5 rounded-lg transition-colors shadow-lg shadow-indigo-900/20"
          >
            {calc ? 'Apply to Order →' : 'Invalid Setup'}
          </button>
        </div>
      )}
    </div>
  );
}

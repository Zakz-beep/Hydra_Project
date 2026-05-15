import React, { useEffect, useState, useRef } from 'react';

interface TickerConfig {
  symbol: string;
  name: string;
}

interface TickerData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  prevPrice?: number;
}

const DEFAULT_TICKERS: TickerConfig[] = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: 'QQQ', name: 'QQQ' },
  { symbol: '^DJI', name: 'Dow 30' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'ETH-USD', name: 'Ethereum' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'CL=F', name: 'Crude Oil' },
];

export default function MarketOverview({ onSelectTicker }: { onSelectTicker?: (symbol: string) => void }) {
  const [tickers, setTickers] = useState<TickerConfig[]>([]);
  const [tickersLoaded, setTickersLoaded] = useState(false);
  const [data, setData] = useState<TickerData[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const [newTicker, setNewTicker] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  useEffect(() => {
    // Load tickers from API on mount
    fetch('/api/tickers')
      .then(res => res.json())
      .then(json => {
        if (json.tickers && json.tickers.length > 0) {
          setTickers(json.tickers);
        } else {
          setTickers(DEFAULT_TICKERS);
        }
        setTickersLoaded(true);
      })
      .catch(err => {
        console.error("Failed to load tickers", err);
        setTickers(DEFAULT_TICKERS);
        setTickersLoaded(true);
      });
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    const fetchTickers = async () => {
      if (!tickersLoaded) return;
      if (tickers.length === 0) {
        if (isMounted) {
            setData([]);
            setLoading(false);
        }
        return;
      }
      
      try {
        const promises = tickers.map(async (t) => {
          try {
            const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(t.symbol)}&interval=1d&range=5d`);
            const json = await res.json();
            if (json.error || !json.chart?.result?.[0]) return null;
            
            const result = json.chart.result[0];
            const indicators = result?.indicators?.quote?.[0];
            if (!indicators || !indicators.close) return null;
            
            const closeArr = indicators.close.filter((c: any) => c !== null);
            
            if (closeArr.length < 2) return null;
            
            const currentPrice = closeArr[closeArr.length - 1];
            const prevPrice = closeArr[closeArr.length - 2];
            const change = currentPrice - prevPrice;
            const changePercent = (change / prevPrice) * 100;
            
            return { symbol: t.symbol, name: t.name, price: currentPrice, change, changePercent, prevPrice };
          } catch (e) {
            console.error(`Failed to fetch ${t.symbol}`, e);
            return null;
          }
        });
        
        const results = await Promise.all(promises);
        if (isMounted) {
          setData(results.filter(r => r !== null) as TickerData[]);
          setLoading(false);
        }
      } catch (err) {
        console.error("Market overview fetch error", err);
        if (isMounted) setLoading(false);
      }
    };

    fetchTickers();
    const interval = setInterval(fetchTickers, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, [tickers, tickersLoaded]);

  const saveTickers = async (newTickers: TickerConfig[]) => {
      setTickers(newTickers);
      try {
          await fetch('/api/tickers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tickers: newTickers })
          });
      } catch (err) {
          console.error("Failed to save tickers", err);
      }
  };

  const handleAddTicker = (e: React.FormEvent) => {
      e.preventDefault();
      if (!newTicker.trim()) {
          setIsAdding(false);
          return;
      }
      
      const symbol = newTicker.trim().toUpperCase();
      if (!tickers.find(t => t.symbol === symbol)) {
          saveTickers([...tickers, { symbol, name: symbol }]);
      }
      setNewTicker('');
      setIsAdding(false);
  };
  
  const handleRemoveTicker = (symbolToRemove: string) => {
      saveTickers(tickers.filter(t => t.symbol !== symbolToRemove));
  };

  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleDragEnter = (idx: number) => {
    if (draggedIdx === null || draggedIdx === idx) return;

    // Reorder data optimistically
    const newData = [...data];
    const draggedData = newData[draggedIdx];
    newData.splice(draggedIdx, 1);
    newData.splice(idx, 0, draggedData);
    setData(newData);

    // Reorder tickers
    const newTickers = [...tickers];
    const draggedTicker = newTickers[draggedIdx];
    newTickers.splice(draggedIdx, 1);
    newTickers.splice(idx, 0, draggedTicker);
    setTickers(newTickers);

    setDraggedIdx(idx);
  };

  const handleDragEnd = () => {
    if (draggedIdx !== null) {
      saveTickers(tickers);
      setDraggedIdx(null);
    }
  };

  if (loading && data.length === 0) {
    return (
      <div className="w-full h-[52px] flex items-center justify-center bg-zinc-900/50 border-b border-zinc-800/60">
         <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            <span className="text-[11px] text-zinc-500 font-mono">Loading markets...</span>
         </div>
      </div>
    );
  }

  return (
    <div className="w-full border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-sm flex items-center">
      <div ref={scrollRef} className="flex flex-1 items-stretch overflow-x-auto scrollbar-hide">
        {data.map((item, idx) => (
          <TickerNode 
            key={item.symbol}
            item={item}
            idx={idx}
            isDragging={draggedIdx === idx}
            onRemove={handleRemoveTicker}
            onDragStart={handleDragStart}
            onDragEnter={handleDragEnter}
            onDragEnd={handleDragEnd}
            onSelect={onSelectTicker}
          />
        ))}
        
        {/* Add Ticker Button / Input */}
        <div className="flex items-center px-4 shrink-0">
            {isAdding ? (
                <form onSubmit={handleAddTicker} className="flex items-center gap-2">
                    <input 
                        type="text" 
                        autoFocus
                        value={newTicker}
                        onChange={(e) => setNewTicker(e.target.value)}
                        onBlur={() => {
                            if (!newTicker.trim()) setIsAdding(false);
                        }}
                        placeholder="TICKER" 
                        className="bg-zinc-900 border border-zinc-700 text-[11px] font-mono text-zinc-100 px-2 py-1 rounded w-20 uppercase focus:outline-none focus:border-indigo-500"
                    />
                    <button type="submit" className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300 px-2 py-1 bg-indigo-500/10 rounded">Add</button>
                </form>
            ) : (
                <button 
                    onClick={() => setIsAdding(true)}
                    className="flex items-center justify-center w-7 h-7 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                    title="Add Ticker"
                >
                    +
                </button>
            )}
        </div>
      </div>
    </div>
  );
}

function TickerNode({ item, idx, isDragging, onRemove, onDragStart, onDragEnter, onDragEnd, onSelect }: any) {
  const isUp = item.change >= 0;
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef(item.price);

  useEffect(() => {
    if (item.price !== prevPriceRef.current) {
      const isHigher = item.price > prevPriceRef.current;
      setFlash(isHigher ? 'up' : 'down');
      prevPriceRef.current = item.price;
      
      const timer = setTimeout(() => setFlash(null), 800);
      return () => clearTimeout(timer);
    }
  }, [item.price]);

  return (
    <div 
      draggable
      onClick={() => {
         if (onSelect) onSelect(item.symbol);
      }}
      onDragStart={(e) => {
        if (e.dataTransfer) {
            e.dataTransfer.setData('text/plain', item.symbol);
            e.dataTransfer.effectAllowed = 'move';
        }
        onDragStart(idx);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter(idx);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-3 px-5 py-2.5 border-r border-zinc-800/40 transition-colors duration-300 cursor-grab active:cursor-grabbing shrink-0 
        ${idx === 0 ? 'pl-4' : ''}
        ${isDragging ? 'opacity-30 bg-zinc-800/50' : ''}
        ${flash === 'up' ? 'bg-emerald-500/20' : flash === 'down' ? 'bg-red-500/20' : 'hover:bg-zinc-900/60'}
      `}
    >
       <button 
          onClick={(e) => {
              e.stopPropagation();
              onRemove(item.symbol);
          }}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/20 text-red-400 hover:bg-red-500/40 rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
          title="Remove Ticker"
       >
          ✕
       </button>
       
       <div className="flex flex-col">
          <span className="text-[10px] font-mono text-zinc-500 leading-tight">{item.name}</span>
          <span className={`text-[13px] font-mono font-semibold tabular-nums leading-tight transition-colors duration-300 ${flash === 'up' ? 'text-emerald-400' : flash === 'down' ? 'text-red-400' : 'text-zinc-100'}`}>
            {item.price < 100 ? item.price.toFixed(2) : item.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </span>
       </div>
       <div className={`flex flex-col items-end`}>
          <span className={`text-[10px] font-mono tabular-nums leading-tight transition-colors duration-300 ${flash === 'up' ? 'text-emerald-400' : flash === 'down' ? 'text-red-400' : isUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {isUp ? '+' : ''}{item.change.toFixed(2)}
          </span>
          <span className={`text-[11px] font-mono font-bold tabular-nums leading-tight px-1.5 py-0.5 rounded transition-colors duration-300 ${flash === 'up' ? 'bg-emerald-500/30 text-emerald-300' : flash === 'down' ? 'bg-red-500/30 text-red-300' : isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(item.changePercent).toFixed(2)}%
          </span>
       </div>
    </div>
  );
}

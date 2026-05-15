"use client";

import React, { useEffect, useState } from 'react';

export default function VVIXRatioAlert() {
  const [vvix, setVvix] = useState<number | null>(null);
  const [vix, setVix] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVolatilityData = async () => {
      try {
        const [resVVIX, resVIX] = await Promise.all([
          fetch('/api/yahoo?ticker=^VVIX&interval=1d&range=1d'),
          fetch('/api/yahoo?ticker=^VIX&interval=1d&range=1d')
        ]);

        const dataVVIX = await resVVIX.json();
        const dataVIX = await resVIX.json();

        const closeVVIX = dataVVIX.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null);
        const latestVVIX = closeVVIX && closeVVIX.length > 0 ? closeVVIX[closeVVIX.length - 1] : null;

        const closeVIX = dataVIX.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null);
        const latestVIX = closeVIX && closeVIX.length > 0 ? closeVIX[closeVIX.length - 1] : null;

        if (latestVVIX) setVvix(latestVVIX);
        if (latestVIX) setVix(latestVIX);
      } catch (e) {
        console.error("Failed to fetch VVIX/VIX data", e);
      } finally {
        setLoading(false);
      }
    };

    fetchVolatilityData();
    const interval = setInterval(fetchVolatilityData, 60000); // refresh every 1 min
    return () => clearInterval(interval);
  }, []);

  if (loading || !vvix || !vix) {
    return (
       <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-xl flex items-center justify-center h-[76px] animate-pulse">
           <span className="text-xs font-mono text-zinc-600">Loading Volatility Data...</span>
       </div>
    );
  }

  const ratio = vvix / vix;
  const isHighRisk = ratio > 5.5;

  return (
    <div className={`rounded-xl p-4 shadow-xl border relative overflow-hidden ${
        isHighRisk 
        ? 'bg-zinc-950 border-amber-500/50 ring-1 ring-amber-500/20' 
        : 'bg-zinc-950 border-zinc-800'
    }`}>
      {isHighRisk && <div className="absolute top-0 left-0 w-full h-1 bg-amber-500"></div>}
      
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-3 w-3">
            {isHighRisk && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>}
            <span className={`relative inline-flex rounded-full h-3 w-3 ${isHighRisk ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
               VVIX / VIX Ratio Alert
               <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider ${
                   isHighRisk ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
               }`}>
                   {ratio.toFixed(2)}
               </span>
            </h3>
            <div className="flex gap-3 text-[10px] font-mono text-zinc-500 mt-1">
              <span>VVIX: <span className="text-zinc-300">{vvix.toFixed(2)}</span></span>
              <span>VIX: <span className="text-zinc-300">{vix.toFixed(2)}</span></span>
            </div>
          </div>
        </div>
        
        <div className="text-right">
          {isHighRisk ? (
            <div className="flex flex-col items-end">
                <span className="text-[11px] font-mono font-bold text-amber-400">🚨 HIGH VOLATILITY CLUSTERING</span>
                <span className="text-[10px] font-mono text-amber-500/80 max-w-[250px]">
                    Market expected to move big. Direction uncertain. Consider holding or reducing position size.
                </span>
            </div>
          ) : (
            <div className="flex flex-col items-end">
                <span className="text-[11px] font-mono font-bold text-emerald-400">✅ NORMAL VOLATILITY</span>
                <span className="text-[10px] font-mono text-zinc-500">
                    No extreme volatility clustering detected.
                </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

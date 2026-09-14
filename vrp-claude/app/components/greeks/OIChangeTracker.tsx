"use client";

import React, { useEffect, useState } from "react";
import { fetchOIChange, OIChangeResponse, OIChangeItem, GreeksSnapshot } from "../../lib/greeks";
import { ArrowUpRight, ArrowDownRight, Activity, Target } from "lucide-react";

interface OIChangeTrackerProps {
  ticker: string;
  spot?: number;
  greeksData?: GreeksSnapshot;
}

interface StrikeGroup {
  strike: number;
  dte: number;
  call: OIChangeItem | null;
  put: OIChangeItem | null;
}

export default function OIChangeTracker({ ticker, spot, greeksData }: OIChangeTrackerProps) {
  const [data, setData] = useState<OIChangeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"chain" | "delta" | "oi">("chain");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchOIChange(ticker)
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || "Failed to fetch OI Change");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 animate-pulse h-64 flex items-center justify-center">
        <span className="text-zinc-500 font-mono text-xs">Loading OI Change...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 text-center text-red-500 font-mono text-xs">
        {error}
      </div>
    );
  }

  if (!data || data.oi_changes.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 text-center text-zinc-500 font-mono text-xs flex flex-col items-center gap-2">
        <Activity size={16} />
        <p>No historical OI data available for comparison yet.</p>
        <p className="text-[10px]">Data is collected automatically every 24h.</p>
      </div>
    );
  }

  // Pre-calculate current option prices from greeksData
  const priceMap = new Map<string, number>();
  if (greeksData?.by_expiry) {
    Object.values(greeksData.by_expiry).forEach((bucket) => {
      bucket.strikes?.forEach((s) => {
        const exp = s.expiry ? s.expiry.substring(0, 10) : "";
        const key = `${s.option_type.toUpperCase()}-${s.strike}-${exp}`;
        priceMap.set(key, s.mid_price);
      });
    });
  }

  // Filter out zero changes and group by dte_bucket -> strike
  const groupedByBucketAndStrike: Record<number, Record<number, StrikeGroup>> = {};
  
  data.oi_changes
    .filter((item) => item.delta_oi !== 0)
    .forEach((item) => {
      if (!groupedByBucketAndStrike[item.dte_bucket]) {
        groupedByBucketAndStrike[item.dte_bucket] = {};
      }
      
      const bucketGroups = groupedByBucketAndStrike[item.dte_bucket];
      if (!bucketGroups[item.strike]) {
        bucketGroups[item.strike] = {
          strike: item.strike,
          dte: item.dte,
          call: null,
          put: null
        };
      }
      
      if (item.option_type === "call") {
        bucketGroups[item.strike].call = item;
      } else {
        bucketGroups[item.strike].put = item;
      }
    });

  // Sort groups by bucket key
  const sortedBuckets = Object.keys(groupedByBucketAndStrike)
    .map(Number)
    .sort((a, b) => a - b);

  const formatDelta = (val: number) => {
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toLocaleString()}`;
  };

  const getTopStrikes = (bucket: number) => {
    const strikes = Object.values(groupedByBucketAndStrike[bucket]);
    
    if (sortMode === "delta") {
      return strikes
        .sort((a, b) => {
          const maxA = Math.max(Math.abs(a.call?.delta_oi || 0), Math.abs(a.put?.delta_oi || 0));
          const maxB = Math.max(Math.abs(b.call?.delta_oi || 0), Math.abs(b.put?.delta_oi || 0));
          return maxB - maxA;
        })
        .slice(0, 20);
    }
    
    if (sortMode === "oi") {
      return strikes
        .sort((a, b) => {
          const maxA = Math.max(a.call?.oi_new || 0, a.put?.oi_new || 0);
          const maxB = Math.max(b.call?.oi_new || 0, b.put?.oi_new || 0);
          return maxB - maxA;
        })
        .slice(0, 20);
    }
    
    // Default: chain view
    // Get top 20 by magnitude of OI change first, then sort sequentially
    const topStrikes = strikes
      .sort((a, b) => {
        const maxA = Math.max(Math.abs(a.call?.delta_oi || 0), Math.abs(a.put?.delta_oi || 0));
        const maxB = Math.max(Math.abs(b.call?.delta_oi || 0), Math.abs(b.put?.delta_oi || 0));
        return maxB - maxA;
      })
      .slice(0, 20);
      
    // Sort sequentially like an options chain
    return topStrikes.sort((a, b) => a.strike - b.strike);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex flex-col h-full max-h-[600px]">
      <div className="flex justify-between items-start mb-4 flex-shrink-0">
        <div>
          <h2 className="text-sm font-mono text-zinc-300 font-bold flex items-center gap-2">
            <Activity size={14} className="text-amber-500" />
            OI Change Tracker (24h)
          </h2>
          <p className="text-[10px] text-zinc-500 font-mono mt-1">
            {spot ? `Spot: $${spot.toFixed(2)} | ` : ''}Shows Calls vs Puts activity side-by-side.
          </p>
        </div>
        
        {/* View Toggles */}
        <div className="flex bg-zinc-950 border border-zinc-800 rounded p-0.5 ml-2">
          <button
            onClick={() => setSortMode("chain")}
            className={`px-2 py-1 text-[10px] font-mono rounded ${
              sortMode === "chain" ? "bg-zinc-800 text-amber-500 font-bold" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Chain
          </button>
          <button
            onClick={() => setSortMode("delta")}
            className={`px-2 py-1 text-[10px] font-mono rounded ${
              sortMode === "delta" ? "bg-zinc-800 text-amber-500 font-bold" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Top Δ
          </button>
          <button
            onClick={() => setSortMode("oi")}
            className={`px-2 py-1 text-[10px] font-mono rounded ${
              sortMode === "oi" ? "bg-zinc-800 text-amber-500 font-bold" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Top OI
          </button>
        </div>
      </div>

      <div className="overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar flex-grow">
        {sortedBuckets.length === 0 ? (
          <div className="py-4 text-center text-[10px] text-zinc-500 font-mono">
            No significant OI changes detected.
          </div>
        ) : (
          <div className="space-y-6">
            {sortedBuckets.map((bucket) => {
              const groups = getTopStrikes(bucket);
              
              // Find true ATM strike for this bucket
              let atmStrike = 0;
              if (spot) {
                let minDiff = Infinity;
                Object.values(groupedByBucketAndStrike[bucket]).forEach(g => {
                  const diff = Math.abs(g.strike - spot);
                  if (diff < minDiff) {
                    minDiff = diff;
                    atmStrike = g.strike;
                  }
                });
              }

              return (
                <div key={bucket} className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-[10px] font-bold text-zinc-300 font-mono uppercase bg-zinc-800 px-2 py-1 rounded w-max border border-zinc-700">
                      {bucket} DTE Bucket
                    </div>
                    <div className="h-px bg-zinc-800 flex-grow"></div>
                  </div>
                  
                  <div className="flex flex-col gap-2 font-mono">
                    {groups.map((group) => {
                      const isCallMassive = group.call && Math.abs(group.call.delta_oi) > 5000;
                      const isPutMassive = group.put && Math.abs(group.put.delta_oi) > 5000;
                      
                      const isATM = spot && group.strike === atmStrike;
                      const callState = spot ? (group.strike < spot ? "ITM" : "OTM") : "";
                      const putState = spot ? (group.strike > spot ? "ITM" : "OTM") : "";

                      const callKey = group.call && group.call.expiry ? `CALL-${group.strike}-${group.call.expiry.substring(0, 10)}` : "";
                      const putKey = group.put && group.put.expiry ? `PUT-${group.strike}-${group.put.expiry.substring(0, 10)}` : "";
                      
                      const callPrice = callKey ? priceMap.get(callKey) : undefined;
                      const putPrice = putKey ? priceMap.get(putKey) : undefined;

                      return (
                        <div
                          key={`${group.strike}-${group.dte}`}
                          className={`grid grid-cols-[1fr_auto_1fr] items-stretch bg-zinc-950/50 border ${isATM ? 'border-blue-500/40' : 'border-zinc-800/80'} rounded-md hover:bg-zinc-800/40 hover:border-zinc-700 transition-colors`}
                        >
                          {/* Calls (Left) */}
                          <div className={`flex flex-col items-start p-2.5 rounded-l-md ${callState === 'ITM' ? 'bg-amber-500/5' : ''}`}>
                            <div className="flex justify-between w-full items-center mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded uppercase">Call</span>
                                {callState && (
                                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${callState === 'ITM' ? 'bg-amber-500/20 text-amber-500' : 'bg-zinc-800/80 text-zinc-500'}`}>
                                    {callState}
                                  </span>
                                )}
                              </div>
                              {group.call && (
                                group.call.delta_oi > 0 ? (
                                  <ArrowUpRight size={12} className="text-emerald-400" />
                                ) : (
                                  <ArrowDownRight size={12} className="text-rose-400" />
                                )
                              )}
                            </div>
                            {group.call ? (
                              <div className="flex flex-col w-full">
                                <div className="flex justify-between items-baseline w-full">
                                  <span
                                    className={`text-[13px] font-bold ${
                                      group.call.delta_oi > 0 ? "text-emerald-400" : "text-rose-400"
                                    } ${isCallMassive ? "drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" : ""}`}
                                  >
                                    {formatDelta(group.call.delta_oi)}
                                  </span>
                                  {callPrice !== undefined && (
                                    <span className="text-[10px] text-zinc-300 ml-2 font-mono">${callPrice.toFixed(2)}</span>
                                  )}
                                </div>
                                <span className="text-[9px] text-zinc-500 mt-0.5">
                                  OI: <span className="text-zinc-400">{group.call.oi_new.toLocaleString()}</span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col h-full justify-center">
                                <span className="text-xs text-zinc-700 font-bold">-</span>
                              </div>
                            )}
                          </div>

                          {/* Strike (Center) */}
                          <div className={`flex flex-col items-center justify-center border-x ${isATM ? 'border-blue-500/40 bg-blue-900/20' : 'border-zinc-800/80 bg-zinc-900/30'} px-4`}>
                            {isATM ? (
                              <div className="flex items-center gap-1 mb-0.5">
                                <Target size={10} className="text-blue-400" />
                                <span className="text-[9px] text-blue-400 font-bold uppercase">ATM</span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-zinc-500 mb-0.5">STRIKE</span>
                            )}
                            <span className="text-base font-bold text-zinc-100">${group.strike}</span>
                            <span className="text-[9px] text-amber-500/80 mt-0.5 font-medium">{group.dte} DTE</span>
                          </div>

                          {/* Puts (Right) */}
                          <div className={`flex flex-col items-end p-2.5 rounded-r-md ${putState === 'ITM' ? 'bg-amber-500/5' : ''}`}>
                            <div className="flex justify-between w-full items-center mb-1.5 flex-row-reverse">
                              <div className="flex items-center gap-1.5 flex-row-reverse">
                                <span className="text-[9px] text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded uppercase">Put</span>
                                {putState && (
                                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold ${putState === 'ITM' ? 'bg-amber-500/20 text-amber-500' : 'bg-zinc-800/80 text-zinc-500'}`}>
                                    {putState}
                                  </span>
                                )}
                              </div>
                              {group.put && (
                                group.put.delta_oi > 0 ? (
                                  <ArrowUpRight size={12} className="text-emerald-400" />
                                ) : (
                                  <ArrowDownRight size={12} className="text-rose-400" />
                                )
                              )}
                            </div>
                            {group.put ? (
                              <div className="flex flex-col items-end w-full">
                                <div className="flex justify-between items-baseline w-full flex-row-reverse">
                                  <span
                                    className={`text-[13px] font-bold ${
                                      group.put.delta_oi > 0 ? "text-emerald-400" : "text-rose-400"
                                    } ${isPutMassive ? "drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" : ""}`}
                                  >
                                    {formatDelta(group.put.delta_oi)}
                                  </span>
                                  {putPrice !== undefined && (
                                    <span className="text-[10px] text-zinc-300 mr-2 font-mono">${putPrice.toFixed(2)}</span>
                                  )}
                                </div>
                                <span className="text-[9px] text-zinc-500 mt-0.5">
                                  OI: <span className="text-zinc-400">{group.put.oi_new.toLocaleString()}</span>
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col h-full justify-center">
                                <span className="text-xs text-zinc-700 font-bold">-</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


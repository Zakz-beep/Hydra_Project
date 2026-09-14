"use client";

import React, { useEffect, useState } from "react";
import { fetchVVIXReplication, VVIXReplicationResult } from "../../lib/greeks";
import { Activity, Zap, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";

export default function VVIXReplicator() {
  const [data, setData] = useState<VVIXReplicationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchVVIXReplication()
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || "Failed to fetch VVIX replication data");
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 animate-pulse h-32 flex flex-col items-center justify-center space-y-3">
        <Activity className="text-zinc-500 animate-spin" size={20} />
        <span className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Replicating VVIX via Options Chain...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-center text-red-500 font-mono text-xs flex flex-col items-center gap-2">
        <AlertCircle size={20} className="text-red-500/80" />
        <p>Model Error: {error || "No data returned"}</p>
        <p className="text-[10px] text-zinc-500 max-w-sm mt-1">
          The Alpaca equity/ETF adapter does not provide the VIX index-option chain required here. No ETF substitute or synthetic VVIX is shown.
        </p>
      </div>
    );
  }

  const isHighlyAccurate = data.accuracy_pct >= 90 && !data.is_fallback;
  const isModerate = (data.accuracy_pct >= 80 && data.accuracy_pct < 90) || data.is_fallback;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 relative overflow-hidden group">
      {/* Background glow based on accuracy */}
      <div className={`absolute -right-20 -top-20 w-48 h-48 rounded-full blur-3xl opacity-[0.03] transition-all duration-700 ${
        isHighlyAccurate ? "bg-emerald-500" : isModerate ? "bg-amber-500" : "bg-rose-500"
      }`} />

      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-sm font-mono text-zinc-300 font-bold flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            VVIX Synthetic Replication Engine
          </h2>
          <p className="text-[10px] text-zinc-500 font-mono mt-1 max-w-sm">
            Replicates VVIX index using the CBOE variance swap formula via VIX options. Validates structural pricing integrity.
          </p>
          {data.is_fallback && (
            <p className="text-[9px] text-amber-500 font-mono mt-1 flex items-center gap-1">
              <AlertTriangle size={10} />
              <span>Statistical Estimation Active: Options chain sparse or rate-limited.</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase ${
            data.is_fallback
              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
              : isHighlyAccurate 
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          }`}>
            {data.is_fallback ? <Activity size={12} className="animate-pulse" /> : isHighlyAccurate ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {data.is_fallback ? "Statistical Estimate" : `${data.accuracy_pct.toFixed(1)}% Accuracy`}
          </div>
          {data.is_fallback && (
            <span className="text-[9px] text-zinc-500 font-mono">{data.accuracy_pct.toFixed(1)}% model match</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono uppercase mb-1">Synthetic VVIX</div>
          <div className="text-xl font-bold text-zinc-200 font-mono">{data.replicated_vvix.toFixed(2)}</div>
        </div>

        {/* Metric 2 */}
        <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono uppercase mb-1">Actual VVIX (Live)</div>
          <div className="text-xl font-bold text-blue-400 font-mono">{data.actual_vvix.toFixed(2)}</div>
        </div>

        {/* Metric 3 */}
        <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono uppercase mb-1">Pricing Deviation</div>
          <div className="text-xl font-bold text-zinc-300 font-mono">
            {data.deviation > 0 ? "+" : ""}{data.deviation.toFixed(2)} pts
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3">
          <div className="text-[10px] text-zinc-500 font-mono uppercase mb-1">Options Term (T1/T2)</div>
          <div className="text-sm font-bold text-zinc-400 font-mono mt-1">
            {data.t1_days}d / {data.t2_days}d
          </div>
          <div className="text-[9px] text-zinc-600 mt-0.5">
            {data.is_fallback ? "Statistical projection" : "Interpolating 30D variance"}
          </div>
        </div>
      </div>
    </div>
  );
}

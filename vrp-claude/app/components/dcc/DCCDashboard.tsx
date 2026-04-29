"use client";

import React, { useState, useEffect } from "react";
import { runDCCModel, DCCRunResponse } from "../../lib/dcc";
import DCCMetrics from "./DCCMetrics";
import DCCChart from "./DCCChart";
import CopulaDashboard from "./CopulaDashboard";
import HMMDashboard from "./HMMDashboard";

type TabId = "dcc" | "copula" | "hmm";

const TABS: { id: TabId; label: string; icon: string; desc: string }[] = [
  { id: "dcc", label: "DCC-GARCH", icon: "◈", desc: "Dynamic Conditional Correlation & Portfolio Backtest" },
  { id: "copula", label: "Copula Scanner", icon: "⚡", desc: "Tail Dependence & Black Swan Risk Detector" },
  { id: "hmm", label: "HMM Regime", icon: "🔴", desc: "Hidden Markov Model — Market Regime Detection" },
];

export default function DCCDashboard() {
  const [tickers, setTickers] = useState("BBRI.JK, BBCA.JK, GLD, UNVR.JK");
  const [mode, setMode] = useState("4");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DCCRunResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("dcc");

  useEffect(() => {
    const handler = setTimeout(() => {
      handleRun();
    }, 1000);
    return () => clearTimeout(handler);
  }, [tickers, mode]);

  useEffect(() => {
    if (!data || !data.market_status) return;
    const allClosed = Object.values(data.market_status).every(s => s === "closed");
    if (allClosed) return;
    const interval = setInterval(() => {
      handleRun(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [data?.market_status, tickers, mode]);

  const handleRun = async (isBackground = false) => {
    const tickerList = tickers.split(",").map(t => t.trim()).filter(Boolean);
    if (tickerList.length < 2) {
      if (!isBackground) setError("Please enter at least 2 tickers");
      return;
    }
    if (!isBackground) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await runDCCModel({ tickers: tickerList, mode });
      setData(res);
    } catch (e: any) {
      if (!isBackground) setError(e.message || "An error occurred");
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* ── Control Panel ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
          <div className="sm:col-span-6 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Tickers (Comma Separated)</label>
            <input
              type="text"
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors w-full"
              placeholder="e.g. AAPL, MSFT, GOOGL"
            />
          </div>

          <div className="sm:col-span-4 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Trading Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60 transition-colors w-full"
            >
              <option value="1">Scalper (5m, 7d)</option>
              <option value="2">Day Trade (15m, 14d)</option>
              <option value="3">Swing (1h, 30d)</option>
              <option value="4">Core (1d, 3y)</option>
            </select>
          </div>

          <div className="sm:col-span-2 flex items-end">
            {loading && (
               <div className="w-full flex items-center justify-center bg-indigo-500/10 text-indigo-400 font-mono text-sm px-4 py-2.5 rounded-md border border-indigo-500/20">
                 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                 </svg>
                 Syncing...
               </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Error Display ─────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* ── Market Status Banner ──────────────────────────────────── */}
      {data && data.market_status && (
        <div className="space-y-2">
          {Object.values(data.market_status).every(s => s === "closed") ? (
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Semua aset tutup. Realtime dimatikan.
            </div>
          ) : Object.values(data.market_status).some(s => s === "closed") ? (
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm font-mono text-amber-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Market tutup untuk: {Object.entries(data.market_status).filter(([_, s]) => s === "closed").map(([t]) => t).join(", ")}. Realtime lanjut untuk aset yang buka.
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 px-4 py-3 text-sm font-mono text-emerald-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Semua market buka. Mode Realtime aktif.
            </div>
          )}
        </div>
      )}

      {/* ── Loading Skeleton ──────────────────────────────────────── */}
      {loading && !data && (
         <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-xl bg-zinc-800/40 animate-pulse" />)}
            </div>
            <div className="h-48 rounded-xl bg-zinc-800/40 animate-pulse mt-4" />
         </div>
      )}

      {/* ── Results Dashboard ─────────────────────────────────────── */}
      {data && !loading && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <DCCMetrics summary={data.summary} tickers={data.tickers} />

          {/* ── Tab Navigation ─────────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-1.5 flex gap-1.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-mono transition-all duration-200
                  ${activeTab === tab.id
                    ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-lg shadow-indigo-500/10"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent"
                  }`}
              >
                <span>{tab.icon}</span>
                <span className="font-semibold">{tab.label}</span>
                <span className={`hidden sm:inline text-[10px] uppercase tracking-wider opacity-70`}>
                  — {tab.desc}
                </span>
              </button>
            ))}
          </div>

          {/* ── Tab Content ────────────────────────────────────────── */}
          {activeTab === "dcc" && (
            <DCCChart data={data.timeseries} />
          )}

          {activeTab === "copula" && data.copula_details && (
            <CopulaDashboard copula={data.copula_details} timeseries={data.timeseries} />
          )}

          {activeTab === "hmm" && (
            data.hmm && !data.hmm.error
              ? <HMMDashboard hmm={data.hmm} />
              : <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-6 text-sm font-mono text-amber-400">
                  ⚠ HMM model tidak tersedia untuk session ini. Pastikan library <code className="text-amber-200">hmmlearn</code> sudah terinstall di backend.
                </div>
          )}
        </div>
      )}

    </div>
  );
}

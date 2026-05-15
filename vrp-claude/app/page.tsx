"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  VRPResult, SignalType, SIGNAL_META, fmtPct, fmtZ,
  BacktestResult, SignalLogResponse,
  fetchBacktest, fetchSignalLog, fetchDBStats, DBStats,
} from "./lib/vrp";
import MetricCard    from "./components/MetricCard";
import SignalBadge   from "./components/SignalBadge";
import TickerInput   from "./components/TickerInput";
import VRPChart      from "./components/VRPChart";
import VRPGauge      from "./components/VRPGauge";
import Pipeline      from "./components/Pipeline";
import RVBreakdown   from "./components/RVBreakdown";
import BacktestPanel from "./components/BacktestPanel";
import SignalLog     from "./components/SignalLog";

// ── Greeks Imports ───────────────────────────────────────────
import {
  GreeksSnapshot, GreeksHistoryResponse, GreeksBacktestResponse, GreeksSignalLogResponse,
  fetchGreeks, fetchGreeksHistory, fetchGreeksBacktest, fetchGreeksSignalLog
} from "./lib/greeks";
import GreeksOverview from "./components/greeks/GreeksOverview";
import GreeksHistoryTable from "./components/greeks/GreeksHistoryTable";
import GreeksBacktestPanel from "./components/greeks/GreeksBacktestPanel";
import GreeksSignalLogComponent from "./components/greeks/GreeksSignalLog";
import GreeksChart from "./components/greeks/GreeksChart";

// ── Risk Pipeline Imports ────────────────────────────────────
import RiskDashboardLayout from "./components/risk/RiskDashboardLayout";

// ── DCC Correlation Imports ──────────────────────────────────
import DCCDashboard from "./components/dcc/DCCDashboard";

// ── Volatility Engine Imports ─────────────────────────────────
import VolatilityDashboard from "./components/volatility/VolatilityDashboard";

// ── GRU Regime Imports ───────────────────────────────────
import RegimeDashboard from "./components/regime/RegimeDashboard";

// ── Lightweight Charts Imports ───────────────────────────────
import LightweightChartDashboard from "./components/lwc/core/LightweightChartDashboard";

// ── Dispersion Imports ────────────────────────────────────────
import DispersionDashboard from "./components/dispersion/DispersionDashboard";

const POLL_INTERVAL = 15_000; // 15 detik

export default function Dashboard() {
  const [ticker,    setTicker]  = useState("^GSPC");
  const [data,      setData]    = useState<VRPResult | null>(null);
  const [loading,   setLoading] = useState(false);
  const [error,     setError]   = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(POLL_INTERVAL / 1000);
  
  // ── Mode & Tab State ──────────────────────────────────────────
  const [appMode, setAppMode] = useState<"vrp" | "greeks" | "risk" | "dcc" | "volatility" | "regime" | "lwc" | "dispersion">("vrp");
  const [tab, setTab] = useState<"overview" | "rv_engine" | "history" | "backtest" | "signals" | "dashboard" | "metrics" | "stresstest" | "propfirm">("overview");
  
  // ── VRP Data State ────────────────────────────────────────────
  const [backtest,    setBacktest]    = useState<BacktestResult | null>(null);
  const [signalLog,   setSignalLog]   = useState<SignalLogResponse | null>(null);
  const [dbStats,     setDBStats]     = useState<DBStats | null>(null);
  const [btLoading,   setBtLoading]   = useState(false);

  // ── Greeks Data State ─────────────────────────────────────────
  const [greeksData, setGreeksData] = useState<GreeksSnapshot | null>(null);
  const [greeksHistory, setGreeksHistory] = useState<GreeksHistoryResponse | null>(null);
  const [greeksBacktest, setGreeksBacktest] = useState<GreeksBacktestResponse | null>(null);
  const [greeksSignalLog, setGreeksSignalLog] = useState<GreeksSignalLogResponse | null>(null);
  const [greeksLoading, setGreeksLoading] = useState(false);

  // ── Risk Pipeline State ───────────────────────────────────────
  const [riskTicker, setRiskTicker]       = useState("NQ=F");

  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch (VRP/Greeks) ────────────────────────────────────────
  const fetchData = useCallback(async (t: string) => {
    setLoading(true);
    setError(null);
    try {
      if (appMode === "vrp") {
         const res = await fetch(`/api/vrp?ticker=${encodeURIComponent(t)}`);
         if (!res.ok) {
           const err = await res.json().catch(() => ({ detail: res.statusText }));
           throw new Error(err.detail ?? "VRP Fetch failed");
         }
         const json: VRPResult = await res.json();
         setData(json);
      } else if (appMode === "greeks") {
         const json = await fetchGreeks(t);
         setGreeksData(json);
      }
      setLastFetch(new Date());
      setCountdown(POLL_INTERVAL / 1000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [appMode]);

  // ── Auto-refresh (VRP/Greeks only) ─────────────────────────────
  useEffect(() => {
    if (appMode === "risk" || appMode === "regime" || appMode === "lwc" || appMode === "dispersion") return;
    fetchData(ticker);
  }, [ticker, fetchData, appMode]);

  useEffect(() => {
    if (intervalRef.current)  clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (autoRefresh && appMode !== "risk" && appMode !== "regime" && appMode !== "lwc" && appMode !== "dispersion") {
      intervalRef.current = setInterval(() => fetchData(ticker), POLL_INTERVAL);
      countdownRef.current = setInterval(() =>
        setCountdown((c) => (c <= 1 ? POLL_INTERVAL / 1000 : c - 1)), 1000
      );
    }
    return () => {
      if (intervalRef.current)  clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, ticker, fetchData, appMode]);

  // Fetch extra data based on app mode and tab
  useEffect(() => {
    if (appMode === "vrp") {
      if (tab === "backtest" || tab === "signals") {
        setBtLoading(true);
        Promise.all([
          fetchBacktest(ticker).then(setBacktest).catch(() => {}),
          fetchSignalLog(ticker, 50).then(setSignalLog).catch(() => {}),
          fetchDBStats().then(setDBStats).catch(() => {}),
        ]).finally(() => setBtLoading(false));
      }
    } else if (appMode === "greeks") {
      if (tab === "history" || tab === "backtest" || tab === "signals") {
         setGreeksLoading(true);
         Promise.all([
            fetchGreeksHistory(ticker, 50).then(setGreeksHistory).catch(() => {}),
            fetchGreeksBacktest(ticker).then(setGreeksBacktest).catch(() => {}),
            fetchGreeksSignalLog(ticker, 50).then(setGreeksSignalLog).catch(() => {}),
         ]).finally(() => setGreeksLoading(false));
      }
    }
  }, [tab, ticker, appMode]);

  // ── Risk Pipeline State Polling ──────────────────────────────────
  // Removed legacy polling logic, now relying purely on interactive module 1-3 calls via the new UI component.

  const handleTickerChange = (t: string) => {
    setTicker(t);
    // Clear ALL stale data immediately so old ticker's data never flashes
    setData(null);
    setBacktest(null);
    setSignalLog(null);
    setGreeksData(null);
    setGreeksHistory(null);
    setGreeksBacktest(null);
    setGreeksSignalLog(null);
  };

  const rv = data?.rv_engine;

  // ── Signal color helper ────────────────────────────────────────
  const signalHighlight = (signal?: SignalType) => {
    if (!signal) return "neutral" as const;
    if (signal.includes("SHORT")) return "green" as const;
    if (signal.includes("LONG"))  return "red"   as const;
    return "neutral" as const;
  };

  // ── Risk tab helpers ────────────────────────────────────────────
  // Deprecated risk tabs

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-3 py-4 md:px-8 md:py-6">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-xl font-mono font-bold tracking-tight text-zinc-100 leading-tight">
              Options Quant
              <span className="hidden sm:inline"> Dashboard</span>
            </h1>
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5 hidden sm:block">
               {appMode === "vrp" 
                 ? "VRP · IV vs RV · HAR-RV · BSM"
                 : appMode === "greeks"
                 ? "Greeks · GEX · Vanna · Charm"
                 : appMode === "risk"
                 ? "Monte Carlo · GARCH · VaR/CVaR"
                 : appMode === "volatility"
                 ? "HAR-RV · HMM · Realized Vol"
                 : appMode === "dcc"
                 ? "DCC-GARCH · Systemic Risk"
                 : appMode === "lwc"
                 ? "Charts · Paper Trading · Macro"
                 : "GRU Market Regime Detection"
               }
            </p>
          </div>

          {/* Auto-refresh Controls (VRP/Greeks) */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500 shrink-0">
            {appMode !== "risk" && appMode !== "dcc" && appMode !== "volatility" && appMode !== "regime" && appMode !== "lwc" && (
              <>
                {lastFetch && (
                  <span className="hidden sm:inline">
                    {lastFetch.toLocaleTimeString()}
                    {autoRefresh && ` · ${countdown}s`}
                  </span>
                )}
                <button
                  onClick={() => setAutoRefresh((a) => !a)}
                  className={`px-2 py-1 rounded border text-[10px] cursor-pointer transition-colors
                    ${autoRefresh
                      ? "border-emerald-700 text-emerald-400 bg-emerald-950/30"
                      : "border-zinc-700 text-zinc-500"}`}
                >
                  {autoRefresh ? "● AUTO" : "○"}
                </button>
                <button
                  onClick={() => fetchData(ticker)}
                  disabled={loading}
                  className="px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {loading ? "..." : "↺"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Mode Navigation (Scrollable Pill Bar) ──────────── */}
        <div className="-mx-3 md:mx-0 overflow-x-auto">
          <div className="flex gap-1 px-3 md:px-0 pb-1 min-w-max">
            {([
              { mode: "vrp",         label: "VRP Engine",    accent: "zinc" },
              { mode: "greeks",      label: "Greeks",         accent: "zinc" },
              { mode: "risk",        label: "Risk Pipeline",  accent: "indigo" },
              { mode: "dcc",         label: "Correlation",    accent: "zinc" },
              { mode: "volatility",  label: "Vol Engine",     accent: "cyan" },
              { mode: "regime",      label: "GRU Regime",     accent: "violet" },
              { mode: "lwc",         label: "LWC Chart",      accent: "emerald" },
              { mode: "dispersion",  label: "Dispersion",     accent: "amber" },
            ] as const).map(({ mode, label, accent }) => {
              const isActive = appMode === mode;
              const accentClasses: Record<string, string> = {
                zinc:    isActive ? "bg-zinc-700 text-zinc-100 border-zinc-600"    : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
                indigo:  isActive ? "bg-indigo-900/80 text-indigo-200 border-indigo-700" : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
                cyan:    isActive ? "bg-cyan-900/60 text-cyan-200 border-cyan-700"  : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
                violet:  isActive ? "bg-violet-900/60 text-violet-200 border-violet-700" : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
                emerald: isActive ? "bg-emerald-900/60 text-emerald-200 border-emerald-700" : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
                amber:   isActive ? "bg-amber-900/60 text-amber-200 border-amber-700" : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700",
              };
              return (
                <button
                  key={mode}
                  onClick={() => { setAppMode(mode); setTab(mode === "risk" ? "dashboard" : "overview"); }}
                  className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-full border transition-all whitespace-nowrap ${
                    accentClasses[accent]
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Ticker Input (VRP/Greeks) ────────────────────────── */}
        {appMode !== "risk" && appMode !== "dcc" && appMode !== "volatility" && appMode !== "regime" && appMode !== "lwc" && appMode !== "dispersion" && (
          <TickerInput value={ticker} onChange={handleTickerChange} loading={loading} />
        )}

        {/* ── Risk Pipeline Controls ──────────────────────────── */}
        {appMode === "risk" && (
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-4 space-y-3">
             <div className="flex items-center gap-2">
                <label className="text-[10px] font-mono text-zinc-500 uppercase">Ticker</label>
                <input
                  type="text"
                  value={riskTicker}
                  onChange={(e) => setRiskTicker(e.target.value.toUpperCase())}
                  className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-200 w-28
                    focus:outline-none focus:border-indigo-500/60 transition-colors"
                  placeholder="NQ=F"
                />
              </div>
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────── */}
        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
            ⚠ {error}
          </div>
        )}

        {/* ── Loading skeleton (VRP/Greeks) ─────────────────── */}
        {loading && (!data && !greeksData) && appMode !== "risk" && appMode !== "dcc" && appMode !== "volatility" && appMode !== "regime" && appMode !== "dispersion" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
        )}

        {/* ── Loading skeleton (Risk) ──────────────────────── */}
        {/* Deprecated loading skeleton */}

        {/* ═══════════════════════════════════════════════════════
            VRP + GREEKS CONTENT (existing)
           ═══════════════════════════════════════════════════════ */}
        {(data || greeksData) && appMode !== "risk" && appMode !== "dcc" && appMode !== "volatility" && appMode !== "regime" && appMode !== "dispersion" && (
          <>
            {/* ── Signal Hero (VRP Only) ─────────────────────────────────── */}
            {appMode === "vrp" && data && (
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-4
                flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="space-y-2">
                  <SignalBadge signal={data.signal} size="lg" desc={data.signal_desc} />
                  <div className="flex gap-4 text-xs font-mono text-zinc-500">
                    <span>{data.ticker}</span>
                    <span>spot <span className="text-zinc-300">${data.spot.toLocaleString()}</span></span>
                    <span className={data.data_source === "live" ? "text-emerald-500" : "text-amber-500"}>
                      {data.data_source}
                    </span>
                    {rv?.is_market_open !== undefined && (
                      <span className={rv.is_market_open ? "text-emerald-400" : "text-zinc-600"}>
                        {rv.is_market_open ? "● market open" : "○ market closed"}
                      </span>
                    )}
                  </div>
                </div>
                <VRPGauge vrpZ={data.vrp_z} vrpPct={data.vrp_raw_pct} />
              </div>
            )}
            
            {/* ── Signal Hero (Greeks Only) ─────────────────────────────────── */}
            {appMode === "greeks" && greeksData && (
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-4
                flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                     <span className={`px-2 py-1 text-sm font-bold font-mono rounded-md border
                         ${greeksData.gex_regime === "POSITIVE_GAMMA" ? "bg-emerald-950/60 text-emerald-400 border-emerald-500/40" 
                         : greeksData.gex_regime === "NEGATIVE_GAMMA" ? "bg-red-950/60 text-red-400 border-red-500/40"
                         : "bg-zinc-900/40 text-zinc-400 border-zinc-700/30"}`}>
                        {greeksData.gex_regime.replace(/_/g, " ")}
                     </span>
                  </div>
                  <div className="flex gap-4 text-xs font-mono text-zinc-500">
                    <span>{greeksData.ticker}</span>
                    <span>spot <span className="text-zinc-300">${greeksData.spot.toLocaleString()}</span></span>
                    <span className={greeksData.data_source === "live" ? "text-emerald-500" : "text-amber-500"}>
                      {greeksData.data_source}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Pipeline (VRP Only) ────────────────────────────────────── */}
            {appMode === "vrp" && data && <Pipeline data={data} />}

            {/* ── Tabs ────────────────────────────────────────── */}
            <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
              {(appMode === "vrp" 
                 ? ["overview", "rv_engine", "history", "backtest", "signals"] 
                 : ["overview", "history", "backtest", "signals"]
               ).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t as typeof tab)}
                  className={`px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider cursor-pointer
                    border-b-2 -mb-px transition-colors whitespace-nowrap
                    ${tab === t
                      ? "border-zinc-400 text-zinc-200"
                      : "border-transparent text-zinc-600 hover:text-zinc-400"}`}
                >
                  {t === "rv_engine" ? "RV Engine"
                   : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* ── Mode: VRP ───────────────────────────────────── */}
            {appMode === "vrp" && data && (
               <>
                  {/* ── Tab: Overview ───────────────────────────────── */}
                  {tab === "overview" && (
              <div className="space-y-4">
                {/* Volatility grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <MetricCard
                    label="IV"
                    value={fmtPct(data.iv_pct)}
                    sub="VIX proxy"
                    highlight="neutral"
                    tooltip="Implied Volatility dari ^VIX"
                  />
                  <MetricCard
                    label="RV (blended)"
                    value={fmtPct(rv?.rv_blended_pct ?? data.rv_pct)}
                    sub={rv ? `w=${rv.blend_weight.toFixed(2)} intraday` : "realized vol"}
                    highlight="neutral"
                    tooltip="Approach 2: partial intraday + yesterday blend"
                  />
                  <MetricCard
                    label="HAR-RV"
                    value={fmtPct(rv?.rv_har_updated_pct ?? data.rv_har_pct)}
                    sub={rv ? "OLS + intraday" : "forecast"}
                    highlight="neutral"
                    tooltip="Approach 3: HAR forecast di-update dengan intraday"
                  />
                  <MetricCard
                    label="HV20"
                    value={fmtPct(rv?.hv20_pct ?? data.hv20_pct)}
                    sub="20-day baseline"
                    highlight="neutral"
                    tooltip="Historical Volatility 20 hari"
                  />
                </div>

                {/* VRP metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <MetricCard
                    label="VRP Raw"
                    value={`${data.vrp_raw_pct >= 0 ? "+" : ""}${fmtPct(data.vrp_raw_pct)}`}
                    sub="IV − RV"
                    highlight={data.vrp_raw_pct > 0 ? "green" : "red"}
                    size="lg"
                  />
                  <MetricCard
                    label="VRP Z-Score"
                    value={fmtZ(data.vrp_z)}
                    sub="rolling 60-day"
                    highlight={
                      data.vrp_z > 1 ? "green" :
                      data.vrp_z < -1 ? "red" : "neutral"
                    }
                    size="lg"
                  />
                  <MetricCard
                    label="VRP vs HAR"
                    value={`${data.vrp_vs_har >= 0 ? "+" : ""}${fmtPct(data.vrp_vs_har * 100)}`}
                    sub="IV − RV_HAR"
                    highlight={data.vrp_vs_har > 0 ? "green" : "red"}
                    size="lg"
                  />
                </div>

                {/* RV 15m display if rv_engine present */}
                {rv && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard
                      label="RV Intraday (5m)"
                      value={fmtPct(rv.rv_intraday_raw_pct)}
                      sub={`${rv.n_candles_5m} candles`}
                      highlight="neutral"
                    />
                    <MetricCard
                      label="RV Display (15m)"
                      value={fmtPct(rv.rv_display_15m_pct)}
                      sub={`${rv.n_candles_15m} candles`}
                      highlight="neutral"
                    />
                    <MetricCard
                      label="RV Yesterday"
                      value={fmtPct(rv.rv_yesterday_pct)}
                      sub="r² × 252 proxy"
                      highlight="neutral"
                    />
                    <MetricCard
                      label="Session"
                      value={`${(rv.session_elapsed_pct * 100).toFixed(0)}%`}
                      sub={rv.is_market_open ? "market open" : "closed"}
                      highlight={rv.is_market_open ? "green" : "neutral"}
                    />
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: RV Engine ──────────────────────────────── */}
            {tab === "rv_engine" && (
              rv ? (
                <RVBreakdown rv={rv} />
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
                  <p className="text-zinc-500 font-mono text-sm">
                    rv_engine data not available.
                  </p>
                  <p className="text-zinc-600 font-mono text-xs mt-1">
                    Pastikan rv_engine.py sudah diintegrasikan ke vrp_api.py
                  </p>
                </div>
              )
            )}

            {/* ── Tab: History ────────────────────────────────── */}
            {tab === "history" && (
              <div className="space-y-4">
                <VRPChart history={data.history} />

                {/* History table */}
                {data.history.length > 0 && (
                  <div className="rounded-xl border border-zinc-800/60 overflow-hidden overflow-x-auto">
                    <table className="w-full text-[11px] font-mono min-w-[400px]">
                      <thead>
                        <tr className="border-b border-zinc-800 bg-zinc-900/80">
                          {["Time", "IV", "RV", "VRP", "Signal"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-zinc-500 uppercase tracking-wider font-normal">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.history].reverse().map((snap, i) => {
                          const meta = SIGNAL_META[snap.signal];
                          return (
                            <tr
                              key={i}
                              className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors"
                            >
                              <td className="px-3 py-1.5 text-zinc-400">{snap.time}</td>
                              <td className="px-3 py-1.5 text-indigo-400">{snap.iv.toFixed(2)}%</td>
                              <td className="px-3 py-1.5 text-orange-400">{snap.rv.toFixed(2)}%</td>
                              <td className={`px-3 py-1.5 ${snap.vrp >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {snap.vrp >= 0 ? "+" : ""}{snap.vrp.toFixed(2)}%
                              </td>
                              <td className={`px-3 py-1.5 ${meta.color}`}>
                                {meta.icon} {meta.label}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {/* ── Tab: Backtest ──────────────────────────────── */}
            {tab === "backtest" && (
              <div className="space-y-4">
                {/* DB stats bar */}
                {dbStats && (
                  <div className="flex flex-wrap gap-3">
                    {[
                      { label: "Snapshots",  val: dbStats.vrp_snapshots },
                      { label: "HAR Records", val: dbStats.har_daily_rv },
                      { label: "Signals",    val: dbStats.signal_log },
                      { label: "Outcomes",   val: dbStats.signal_outcomes },
                      { label: "DB Size",    val: `${dbStats.db_size_kb} KB` },
                    ].map(({ label, val }) => (
                      <div key={label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2 text-center">
                        <div className="text-xs font-mono font-semibold text-zinc-200">{val}</div>
                        <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                )}
                {backtest ? (
                  <BacktestPanel data={backtest} loading={btLoading} />
                ) : btLoading ? (
                  <div className="h-40 rounded-xl bg-zinc-800/30 animate-pulse" />
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
                    <p className="text-zinc-500 font-mono text-sm">Belum ada data backtest</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Signals ────────────────────────────────── */}
            {tab === "signals" && (
              <div>
                {signalLog ? (
                  <SignalLog signals={signalLog.signals} />
                ) : btLoading ? (
                  <div className="h-40 rounded-xl bg-zinc-800/30 animate-pulse" />
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
                    <p className="text-zinc-500 font-mono text-sm">Belum ada signal log</p>
                  </div>
                )}
              </div>
            )}
            </>
          )}

          {/* ── Mode: Greeks ───────────────────────────────── */}
          {appMode === "greeks" && greeksData && (
             <>
                {tab === "overview" && <GreeksOverview data={greeksData} ticker={ticker} />}
                
                {tab === "history" && (
                   <div className="space-y-4">
                     {greeksLoading ? <div className="h-40 bg-zinc-800/30 animate-pulse rounded-xl" /> 
                      : greeksHistory ? (
                         <>
                           <GreeksChart history={greeksHistory.history} />
                           <GreeksHistoryTable history={greeksHistory.history} /> 
                         </>
                      ) 
                      : <div className="p-4 border border-zinc-800 text-center text-zinc-500 rounded-xl font-mono text-sm">History tidak tersedia</div>}
                   </div>
                )}

                {tab === "backtest" && (
                   <div className="space-y-4">
                      <GreeksBacktestPanel data={greeksBacktest} loading={greeksLoading} />
                   </div>
                )}

                {tab === "signals" && (
                  <div className="space-y-4">
                     {greeksLoading ? <div className="h-40 bg-zinc-800/30 animate-pulse rounded-xl" />
                      : greeksSignalLog ? <GreeksSignalLogComponent signals={greeksSignalLog.signals} />
                      : <div className="p-4 border border-zinc-800 text-center text-zinc-500 rounded-xl font-mono text-sm">Signals tidak tersedia</div>}
                  </div>
                )}
             </>
          )}
          </>
        )}

        {/* ═══════════════════════════════════════════════════════
            RISK PIPELINE CONTENT (new)
           ═══════════════════════════════════════════════════════ */}
        {appMode === "risk" && (
           <RiskDashboardLayout ticker={riskTicker} />
        )}

        {/* ═══════════════════════════════════════════════════════
            DCC CORRELATION CONTENT (new)
           ═══════════════════════════════════════════════════════ */}
        {appMode === "dcc" && (
           <DCCDashboard />
        )}

        {/* ═══════════════════════════════════════════════════════
            VOLATILITY ENGINE CONTENT (new)
           ═══════════════════════════════════════════════════════ */}
        {appMode === "volatility" && (
           <VolatilityDashboard />
        )}

        {/* ═══════════════════════════════════════════════════════
            GRU REGIME CONTENT
           ═══════════════════════════════════════════════════════ */}
        {appMode === "regime" && (
           <div className="space-y-6">
             <RegimeDashboard />
             
           </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            LIGHTWEIGHT CHARTS CONTENT
           ═══════════════════════════════════════════════════════ */}
        {appMode === "lwc" && (
           <div className="space-y-6">
             <LightweightChartDashboard />
           </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            DISPERSION TRADING CONTENT
           ═══════════════════════════════════════════════════════ */}
        {appMode === "dispersion" && (
           <DispersionDashboard />
        )}

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="text-center text-[10px] font-mono text-zinc-700 pt-4">
          VRP Signal Engine v1.2 · FastAPI + Next.js ·{" "}
          {appMode === "risk"
            ? `risk gateway`
            : autoRefresh ? `auto-refresh ${POLL_INTERVAL / 1000}s` : "manual mode"
          }
        </div>
      </div>
    </main>
  );
}

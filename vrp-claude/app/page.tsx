"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  VRPResult, SignalType, SIGNAL_META, fmtPct, fmtZ,
  BacktestResult, SignalLogResponse,
  fetchBacktest, fetchSignalLog, fetchDBStats, DBStats,
} from "./lib/vrp";
import MetricCard    from "./components/MetricCard";
import SignalBadge   from "./components/SignalBadge";
import VRPChart      from "./components/VRPChart";
import VRPGauge      from "./components/VRPGauge";
import Pipeline      from "./components/Pipeline";
import RVBreakdown   from "./components/RVBreakdown";
import BacktestPanel from "./components/BacktestPanel";
import SignalLog     from "./components/SignalLog";

// ── Bloomberg Terminal Components ───────────────────────────
import BloombergHeader from "./components/bloomberg/BloombergHeader";
import BloombergHelpModal from "./components/bloomberg/BloombergHelpModal";
import WatermarkSettingsModal from "./components/bloomberg/WatermarkSettingsModal";
import ExportHDModal from "./components/bloomberg/ExportHDModal";
import {
  WatermarkConfig,
  getStoredWatermarkConfig,
  saveStoredWatermarkConfig,
} from "./lib/chartExportEngine";
import { useTerminalNavigation, COMMAND_REGISTRY } from "./lib/useTerminalNavigation";

// ── Quant Data Page Components ──────────────────────────────
const RiskDashboardLayout = dynamic(() => import("./components/risk/RiskDashboardLayout"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const DCCDashboard = dynamic(() => import("./components/dcc/DCCDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const VolatilityDashboard = dynamic(() => import("./components/volatility/VolatilityDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const RegimeDashboard = dynamic(() => import("./components/regime/RegimeDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const TerminalChartPage = dynamic(() => import("./components/bloomberg/TerminalChartPage"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const DispersionDashboard = dynamic(() => import("./components/dispersion/DispersionDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const DecisionTreeDashboard = dynamic(() => import("./components/DecisionTreeDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const AgentHubDashboard = dynamic(() => import("./components/agent/AgentHubDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const AgentCenter = dynamic(() => import("./components/agent-center/AgentCenter"), { loading: () => <div role="status" className="p-8 text-slate-400">Opening Agent Center…</div> });
const BetaDashboard = dynamic(() => import("./components/beta/BetaDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const PropFirmDashboard = dynamic(() => import("./components/propfirm/PropFirmDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const CryptoDashboard = dynamic(() => import("./components/crypto/CryptoDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const GreeksWorkspace = dynamic(() => import("./components/greeks/GreeksWorkspace"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const COTDashboard = dynamic(() => import("./components/lwc/alternative-data/COTDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const OnChainDashboard = dynamic(() => import("./components/crypto/OnChainDashboard"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });
const HRPSizer = dynamic(() => import("./components/lwc/tools/HRPSizer"), { loading: () => <div role="status" className="rounded-lg border border-slate-800 p-8 text-sm text-slate-400">Opening workspace…</div> });

const MacroDashboard = dynamic(() => import("./components/macro/MacroDashboard"), { loading: () => <div role="status" className="p-8 text-slate-400">Opening Macro Research…</div> });
const POLL_INTERVAL = 15_000; // 15 detik

export default function Dashboard() {
  // ── Bloomberg Navigation Controller ───────────────────────────
  const nav = useTerminalNavigation("vrp", "SPY");

  // ── VRP Data State ────────────────────────────────────────────
  const [data, setData] = useState<VRPResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false); // Default false for on-demand performance
  const [countdown, setCountdown] = useState(POLL_INTERVAL / 1000);

  // VRP Sub-tabs
  const [vrpTab, setVrpTab] = useState<"overview" | "rv_engine" | "history" | "backtest" | "signals">("overview");

  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [signalLog, setSignalLog] = useState<SignalLogResponse | null>(null);
  const [dbStats, setDBStats] = useState<DBStats | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(getStoredWatermarkConfig);
  const [isWatermarkModalOpen, setIsWatermarkModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleWatermarkChange = (newConfig: WatermarkConfig) => {
    setWatermarkConfig(newConfig);
    saveStoredWatermarkConfig(newConfig);
  };

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const vrpRequest = useRef<AbortController | null>(null);

  // ── Fetch VRP Data (Triggered only when commanded) ────────────
  const fetchVRPData = useCallback(async (t: string) => {
    vrpRequest.current?.abort();
    const request = new AbortController(); vrpRequest.current = request;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vrp?ticker=${encodeURIComponent(t)}`, { signal: request.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "VRP Fetch failed");
      }
      const json: VRPResult = await res.json();
      if (request.signal.aborted) return;
      setData(json);
      setLastFetch(new Date());
      setCountdown(POLL_INTERVAL / 1000);
    } catch (e: unknown) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, []);

  // Performance Optimization: Only fetch VRP when activePage is 'vrp' and commanded
  useEffect(() => {
    setData(null); setLastFetch(null); setError(null);
    if (nav.ready && nav.activePage === "vrp") {
      fetchVRPData(nav.activeTicker);
    }
    return () => vrpRequest.current?.abort();
  }, [nav.ready, nav.activePage, nav.activeTicker, nav.executionTimestamp, fetchVRPData]);

  // VRP Extra data (backtest / signals)
  useEffect(() => {
    let cancelled = false; setBacktest(null); setSignalLog(null);
    if (nav.activePage === "vrp") {
      if (vrpTab === "backtest" || vrpTab === "signals") {
        setBtLoading(true);
        Promise.all([
          fetchBacktest(nav.activeTicker).then(x => { if (!cancelled) setBacktest(x); }).catch(() => {}),
          fetchSignalLog(nav.activeTicker, 50).then(x => { if (!cancelled) setSignalLog(x); }).catch(() => {}),
          fetchDBStats().then(x => { if (!cancelled) setDBStats(x); }).catch(() => {}),
        ]).finally(() => { if (!cancelled) setBtLoading(false); });
      }
    }
    return () => { cancelled = true; };
  }, [vrpTab, nav.activeTicker, nav.activePage, nav.executionTimestamp]);

  // Auto-refresh timer (VRP only, optional)
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (autoRefresh && nav.activePage === "vrp") {
      intervalRef.current = setInterval(() => fetchVRPData(nav.activeTicker), POLL_INTERVAL);
      countdownRef.current = setInterval(() =>
        setCountdown((c) => (c <= 1 ? POLL_INTERVAL / 1000 : c - 1)), 1000
      );
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, nav.activePage, nav.activeTicker, fetchVRPData]);

  const rv = data?.rv_engine;

  const signalHighlight = (signal?: SignalType) => {
    if (!signal) return "neutral" as const;
    if (signal.includes("SHORT")) return "green" as const;
    if (signal.includes("LONG"))  return "red"   as const;
    return "neutral" as const;
  };

  const currentCmdDef = COMMAND_REGISTRY.find(c => c.page === nav.activePage);

  return (
    <main className="min-h-screen bg-[#070a0e] text-zinc-100 flex flex-col font-mono">
      {/* ── Bloomberg Top Omnibar & Navigation Controller ─────── */}
      <BloombergHeader
        activePage={nav.activePage}
        activeTicker={nav.activeTicker}
        inputCommand={nav.inputCommand}
        setInputCommand={nav.setInputCommand}
        onExecute={nav.executeCommand}
        onGoBack={nav.goBack}
        onGoForward={nav.goForward}
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        onOpenHelp={() => nav.setIsHelpOpen(true)}
        onOpenWatermark={() => setIsWatermarkModalOpen(true)}
        onOpenExport={nav.activePage === "vrp" ? () => setIsExportModalOpen(true) : undefined}
        historyIndex={nav.historyIndex}
        historyTotal={nav.historyTotal}
        commandError={nav.commandError} recentCommands={nav.recentCommands} favorites={nav.favorites}
        currentCommand={nav.currentCommand} onToggleFavorite={nav.toggleFavorite} onClearRecent={nav.clearRecent} onRefresh={nav.refresh}
      />

      <div className="flex-1 max-w-7xl w-full mx-auto p-3 md:p-6 space-y-3">
        {nav.activePage === "vrp" && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <nav aria-label="VRP sections" className="flex max-w-full gap-1 overflow-x-auto text-xs">
            {(["overview", "rv_engine", "history", "backtest", "signals"] as const).map(t => <button key={t} onClick={() => setVrpTab(t)} aria-current={vrpTab === t ? "page" : undefined} className={`whitespace-nowrap rounded-md px-3 py-2 transition-colors ${vrpTab === t ? "bg-slate-700/50 text-amber-200" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}>{t === "rv_engine" ? "RV Engine" : t[0].toUpperCase() + t.slice(1)}</button>)}
          </nav>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span role="status">{loading ? "Loading data…" : error ? "Data unavailable" : lastFetch ? `Updated ${lastFetch.toLocaleTimeString()}` : "Ready"}</span>
            <button onClick={() => setAutoRefresh(v => !v)} aria-pressed={autoRefresh} className="rounded-md border border-slate-700 px-3 py-2">{autoRefresh ? `Auto · ${countdown}s` : "Auto refresh off"}</button>
            <button onClick={() => fetchVRPData(nav.activeTicker)} disabled={loading} className="rounded-md border border-slate-700 px-3 py-2 disabled:opacity-40">Refresh</button>
          </div>
        </div>}

        {/* ═══════════════════════════════════════════════════════
            DATA PAGES (COMMAND-GATED & LAZY MOUNTED)
           ═══════════════════════════════════════════════════════ */}

        {nav.ready && <>
        {nav.activePage === "macro" && <MacroDashboard key={`macro-${nav.executionTimestamp}`} />}
        {nav.activePage === "agent-center" && <AgentCenter key={`agent-center-${nav.executionTimestamp}`} />}
        {/* 1. VRP CORE PAGE */}
        {nav.activePage === "vrp" && (
          <div className="space-y-3">
            {error && (
              <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
                ⚠ {error}
              </div>
            )}

            {loading && !data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-zinc-900/40 animate-pulse border border-zinc-800/40" />
                ))}
              </div>
            )}

            {data && (
              <>
                {/* ── Tab Content: OVERVIEW (Unified Cockpit) ───── */}
                {vrpTab === "overview" && (
                  <div className="space-y-3">
                    {/* Unified Quant Cockpit (Signal Hero + Gauge + Pipeline) */}
                    <div className="rounded-xl border border-zinc-800/80 bg-[#080c14] p-4 shadow-xl">
                      {/* Top Cockpit: Signal Hero on Left, Gauge on Right */}
                      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
                        <div className="space-y-2">
                          <SignalBadge signal={data.signal} size="lg" desc={data.signal_desc} />
                          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400">
                            <span className="font-bold text-amber-400">{data.ticker}</span>
                            <span>SPOT <strong className="text-white">${data.spot.toLocaleString()}</strong></span>
                            <span className={data.data_source === "live" ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                              ● {data.data_source.toUpperCase()}
                            </span>
                            {rv?.is_market_open !== undefined && (
                              <span className={rv.is_market_open ? "text-emerald-400" : "text-zinc-500"}>
                                {rv.is_market_open ? "● MARKET OPEN" : "○ MARKET CLOSED"}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <VRPGauge vrpZ={data.vrp_z} vrpPct={data.vrp_raw_pct} />
                        </div>
                      </div>

                      {/* Bottom Cockpit: Integrated Execution Pipeline */}
                      <div className="pt-3">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 font-bold flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          QUANTITATIVE COMPUTATION PIPELINE
                        </div>
                        <Pipeline data={data} />
                      </div>
                    </div>

                    {/* Unified 7-Metric Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                      <MetricCard label="IV" value={fmtPct(data.iv_pct)} sub="VIX proxy" highlight="neutral" tooltip="Implied Volatility dari ^VIX" />
                      <MetricCard label="RV (BLENDED)" value={fmtPct(rv?.rv_blended_pct ?? data.rv_pct)} sub={rv ? `w=${rv.blend_weight.toFixed(2)}` : "realized"} highlight="neutral" tooltip="Approach 2: partial intraday + yesterday blend" />
                      <MetricCard label="HAR-RV" value={fmtPct(rv?.rv_har_updated_pct ?? data.rv_har_pct)} sub="OLS forecast" highlight="neutral" tooltip="Approach 3: HAR forecast di-update dengan intraday" />
                      <MetricCard label="HV20" value={fmtPct(rv?.hv20_pct ?? data.hv20_pct)} sub="20D baseline" highlight="neutral" tooltip="Historical Volatility 20 hari" />
                      <MetricCard label="VRP RAW" value={fmtPct(data.vrp_raw_pct)} sub="IV − RV" highlight={signalHighlight(data.signal)} tooltip="Spread absolut IV minus RV" />
                      <MetricCard label="VRP HAR" value={fmtPct(data.vrp_vs_har)} sub="IV − HAR" highlight={signalHighlight(data.signal)} tooltip="Spread IV minus HAR-RV forecast" />
                      <MetricCard label="Z-SCORE" value={fmtZ(data.vrp_z)} sub="Historical" highlight={signalHighlight(data.signal)} tooltip="Standarisasi deviasi dari rata-rata historis" />
                    </div>

                    {/* Primary Bloomberg Chart Studio */}
                    <VRPChart
                      history={data.history}
                      ticker={data.ticker || nav.activeTicker}
                      spot={data.spot}
                      iv={data.iv_pct}
                      rv={rv?.rv_blended_pct ?? data.rv_pct}
                      vrp={data.vrp_raw_pct}
                      vrpZ={data.vrp_z}
                    />
                  </div>
                )}

                {vrpTab === "rv_engine" && rv && (
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
                    <RVBreakdown rv={rv} />
                  </div>
                )}

                {vrpTab === "history" && (
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-400 mb-4 font-bold">VRP Time-Series Chart</h2>
                    <VRPChart
                      history={data.history}
                      ticker={data.ticker || nav.activeTicker}
                      spot={data.spot}
                      iv={data.iv_pct}
                      rv={rv?.rv_blended_pct ?? data.rv_pct}
                      vrp={data.vrp_raw_pct}
                      vrpZ={data.vrp_z}
                    />
                  </div>
                )}

                {vrpTab === "backtest" && (
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
                    {backtest ? <BacktestPanel data={backtest} loading={btLoading} /> : <div className="text-zinc-500 text-xs">No backtest data available</div>}
                  </div>
                )}

                {vrpTab === "signals" && (
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
                    {signalLog ? <SignalLog signals={signalLog.signals} /> : <div className="text-zinc-500 text-xs">No signal history available</div>}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 2. CHART STUDIO / PRO TERMINAL (LIGHTWEIGHT CHARTS + WATERMARK + HD EXPORT) */}
        {nav.activePage === "gp" && (
          <div className="space-y-4">
            <TerminalChartPage key={nav.executionTimestamp} ticker={nav.activeTicker} onTickerChange={nav.setTicker} />
          </div>
        )}

        {/* 3. THE GREEKS & OPTIONS INVENTORY */}
        {nav.activePage === "gex" && (
          <div className="space-y-4">
            <GreeksWorkspace
              key={`${nav.activeTicker}-${nav.executionTimestamp}`}
              ticker={nav.activeTicker}
              onTickerChange={nav.setTicker}
            />
          </div>
        )}

        {/* 4. RISK PIPELINE & MONTE CARLO */}
        {nav.activePage === "risk" && (
          <div className="space-y-4">
            <RiskDashboardLayout
              key={`${nav.activeTicker}-${nav.executionTimestamp}`}
              ticker={nav.activeTicker}
            />
          </div>
        )}

        {/* 5. VOLATILITY ENGINE & SVI */}
        {nav.activePage === "vol" && (
          <div className="space-y-4">
            <VolatilityDashboard key={`${nav.activeTicker}-${nav.executionTimestamp}`} initialTicker={nav.activeTicker} onTickerChange={nav.setTicker} />
          </div>
        )}

        {/* 6. DYNAMIC CONDITIONAL CORRELATION */}
        {nav.activePage === "dcc" && (
          <div className="space-y-4">
            <DCCDashboard key={nav.executionTimestamp} />
          </div>
        )}

        {/* 7. COMMITMENT OF TRADERS (COT) */}
        {nav.activePage === "cot" && (
          <div className="rounded-xl border border-zinc-800 bg-[#0c1017] p-5 shadow-xl">
            <COTDashboard />
          </div>
        )}

        {/* 8. DISPERSION TRADING */}
        {nav.activePage === "disp" && (
          <div className="space-y-4">
            <DispersionDashboard key={nav.executionTimestamp} />
          </div>
        )}

        {/* 9. HIERARCHICAL RISK PARITY (HRP) */}
        {nav.activePage === "hrp" && (
          <div className="rounded-xl border border-zinc-800 bg-[#0c1017] p-5 shadow-xl">
            <HRPSizer />
          </div>
        )}

        {/* 10. BETA MARKET */}
        {nav.activePage === "beta" && (
          <div className="space-y-4">
            <BetaDashboard key={nav.executionTimestamp} />
          </div>
        )}

        {/* 11. CRYPTO QUANT SUITE (OI, VOLUME & LIQUIDATIONS) */}
        {nav.activePage === "crypto" && (
          <div className="space-y-4">
            <CryptoDashboard key={nav.executionTimestamp} />
          </div>
        )}

        {/* 12. ON-CHAIN RADAR & ETHEREUM ANALYTICS */}
        {nav.activePage === "onchain" && (
          <div className="rounded-xl border border-zinc-800 bg-[#0c1017] p-5 shadow-xl">
            <OnChainDashboard />
          </div>
        )}

        {/* 13. PROP FIRM CAPITAL PRESERVATION */}
        {nav.activePage === "propfirm" && (
          <div className="space-y-4">
            <PropFirmDashboard key={nav.executionTimestamp} />
          </div>
        )}

        {/* 14. AI QUANT AGENT HUB */}
        {nav.activePage === "agent" && (
          <div className="space-y-4">
            <AgentHubDashboard
              key={`${nav.activeTicker}-${nav.executionTimestamp}`}
              ticker={nav.activeTicker}
            />
          </div>
        )}

        {nav.activePage === "regime" && <RegimeDashboard key={nav.executionTimestamp} />}

        {/* 15. DECISION TREE ENGINE */}
        {nav.activePage === "decision" && (
          <div className="space-y-4">
            <DecisionTreeDashboard key={nav.executionTimestamp} />
          </div>
        )}
        </>}
      </div>

      {/* ── Bloomberg Terminal Bottom Statusline & Function Keys ─ */}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-6 py-4 text-[11px] text-slate-500">
        <span>VRP Terminal <span className="mx-2">/</span> {currentCmdDef?.label} <span className="mx-2">/</span> {currentCmdDef?.ticker === "global" ? nav.activeTicker : "Page-managed instruments"}</span>
        <a href="/terminal/agents.md" download className="text-slate-400 hover:text-amber-200">Build a new command · AI guide ↗</a>
      </footer>

      {/* ── Bloomberg Modals (Help, Watermark, HD Export) ─────── */}
      <BloombergHelpModal
        isOpen={nav.isHelpOpen}
        onClose={() => nav.setIsHelpOpen(false)}
        onSelectCommand={(cmd) => nav.executeCommand(cmd)}
      />

      {/* Watermark Settings Modal */}
      <WatermarkSettingsModal
        isOpen={isWatermarkModalOpen}
        onClose={() => setIsWatermarkModalOpen(false)}
        config={watermarkConfig}
        onChange={handleWatermarkChange}
      />

      {/* HD Export Studio Modal */}
      <ExportHDModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        getChartCanvas={() => {
          // Look for lightweight chart canvas or fallback canvas
          const canvas = document.querySelector("canvas");
          return canvas as HTMLCanvasElement | null;
        }}
        metadata={{
          ticker: nav.activeTicker,
          interval: "1D",
          provider: "VRP Terminal",
          timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
          quantMetrics: [
            { label: "SECURITY", value: nav.activeTicker },
            { label: "MODULE", value: currentCmdDef?.code || nav.activePage.toUpperCase() },
            { label: "STATUS", value: loading ? "LOADING" : error ? "ERROR" : data?.data_source || "NO DATA" }
          ]
        }}
        watermark={watermarkConfig}
      />
    </main>
  );
}

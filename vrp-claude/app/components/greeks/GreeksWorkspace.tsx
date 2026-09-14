"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Activity, ArrowUpRight, Pause, Play, RefreshCw } from "lucide-react";
import TickerInput from "../TickerInput";
import GreeksOverview from "./GreeksOverview";
import OptionsDataSource from "./OptionsDataSource";
import { useGreeksSnapshot } from "./useGreeksSnapshot";
import { GreeksResearchPanel } from "./GreeksResearchPanel";
import WatermarkSettingsModal from "../bloomberg/WatermarkSettingsModal";
import ExportHDModal from "../bloomberg/ExportHDModal";
import {
  WatermarkConfig,
  getStoredWatermarkConfig,
  saveStoredWatermarkConfig,
} from "../../lib/chartExportEngine";

const loading = () => <div role="status" className="rounded-xl border border-zinc-800 p-8 text-sm text-zinc-400">Memuat panel…</div>;
const Surfaces = dynamic(() => import("./GreeksSurfaces"), { ssr: false, loading });
const Chain = dynamic(() => import("./GreeksChainExplorer"), { loading });
const ContractDesk = dynamic(() => import("./ContractWorkspace"), { ssr: false, loading });
const Simulator = dynamic(() => import("./SimulatorHub"), { ssr: false, loading });
const Unusual = dynamic(() => import("./UnusualOptions"), { loading });
const AI = dynamic(() => import("./GreeksAIAnalysis"), { loading });
const Chat = dynamic(() => import("./GreeksAgentChat"), { loading });
const OITimeline = dynamic(() => import("./OIExpiryTimeline"), { loading });
const OIChange = dynamic(() => import("./OIChangeTracker"), { loading });
const ExpectedMove = dynamic(() => import("./ExpectedMove"), { loading });
const Bounce = dynamic(() => import("./GammaBounceScore"), { loading });
const VVIX = dynamic(() => import("./VVIXReplicator"), { loading });
const DependencyGraph = dynamic(() => import("./GreeksDependencyGraph"), { ssr: false, loading });

const EtfConstituents = dynamic(() => import("./EtfConstituentPanel"), { loading });
const RvVix = dynamic(() => import("./RvVixPanel"), { ssr: false, loading });

const tabs = ["Overview", "Strikes", "Contracts", "Surfaces", "Open interest", "Scenarios", "Unusual flow", "ETF constituents", "RV vs VIX", "History", "Backtest", "Signals", "AI research"] as const;
type Tab = typeof tabs[number];
const presets = ["SPY", "QQQ", "IWM", "AAPL", "NVDA", "TSLA", "DIA", "AMD"];
const descriptions: Record<Tab, string> = {
  "ETF constituents": "Compare ETF holdings, return relationships and independent options exposure.",
  "RV vs VIX": "S&P 500 realized and implied volatility with explicit 30-calendar-day horizons.",
  Overview: "Model exposure from the eligible options sample; not observed dealer positions.",
  Strikes: "Explore individual contracts and export your filtered chain.",
  Contracts: "Inspect one contract: historical candles, quotes, Greeks and selected-contract streaming.",
  Surfaces: "Explore how volatility and exposure vary across strikes and expiries.",
  "Open interest": "Follow expiry concentrations and changes in positioning.",
  Scenarios: "Explore model sensitivity to price, volatility and time.",
  "Unusual flow": "Investigate unusual activity across the options chain.",
  History: "Review stored snapshots independently of the current data feed.",
  Backtest: "Evaluate historical signals against subsequent outcomes.",
  Signals: "Track changes in the model's exposure signals over time.",
  "AI research": "Investigate the snapshot with your research tools.",
};

export default function GreeksWorkspace({ ticker, onTickerChange }: { ticker: string; onTickerChange: (value: string) => void }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const researchView = tab === "History" || tab === "Backtest" || tab === "Signals" ? tab : null;
  const independentView = tab === "ETF constituents" || tab === "RV vs VIX";
  const { data, error, loading: busy, autoRefresh, setAutoRefresh, lastChecked, refresh } = useGreeksSnapshot(ticker);
  const regime = data ? (data.total_net_gex > 0 ? "Positive gamma" : data.total_net_gex < 0 ? "Negative gamma" : "Neutral gamma") : "Awaiting snapshot";

  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(getStoredWatermarkConfig);
  const [isWatermarkModalOpen, setIsWatermarkModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleWatermarkChange = (newConfig: WatermarkConfig) => {
    setWatermarkConfig(newConfig);
    saveStoredWatermarkConfig(newConfig);
  };

  return <section aria-label="Greeks workspace" className="min-w-0 space-y-4 font-mono">
    <div className="overflow-hidden rounded-xl border border-zinc-800 border-t-cyan-700 bg-zinc-900/40 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><p className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-400"><Activity size={13} /> Options intelligence <span className="text-zinc-500">/</span> Research desk</p><h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">The Greeks<span className="text-cyan-400">.</span></h2><p className="mt-2 text-xs text-zinc-400">Read the positioning. Explore the exposure.</p></div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
          <button
            onClick={() => setIsWatermarkModalOpen(true)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors cursor-pointer ${
              watermarkConfig.enabled
                ? "border-amber-500/70 bg-amber-500/15 text-amber-300"
                : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Configure Chart Watermark"
          >
            <span>💧</span>
            <span>WM</span>
            <span className={`w-1.5 h-1.5 rounded-full ${watermarkConfig.enabled ? "bg-amber-400" : "bg-zinc-600"}`} />
          </button>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-zinc-900 px-3 py-2 text-amber-300 hover:border-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
            title="Export High-Definition Chart (HD Image)"
          >
            <span>📷</span>
            <span>HD Export</span>
          </button>
          <button aria-pressed={autoRefresh} onClick={() => setAutoRefresh(!autoRefresh)} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-zinc-300 focus-visible:outline focus-visible:outline-cyan-400 cursor-pointer">{autoRefresh ? <Pause size={13} /> : <Play size={13} />}Auto {autoRefresh ? "on · 15s" : "off"}</button>
          <button onClick={() => void refresh(true)} disabled={busy} className="flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 font-semibold text-zinc-950 hover:bg-cyan-200 disabled:opacity-50 focus-visible:outline focus-visible:outline-white cursor-pointer"><RefreshCw size={13} className={busy ? "animate-spin" : ""} />{busy ? "Loading…" : "Refresh source"}</button>
        </div>
      </div>
      <TickerInput value={ticker} onChange={onTickerChange} presets={presets} />
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-800 pt-3 font-mono text-xs">
        <span className="flex items-center gap-3 text-base text-zinc-100"><span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm">{ticker}</span><span className="text-xl font-semibold">{data ? `$${data.spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span></span>
        <span className={data && data.total_net_gex > 0 ? "text-emerald-400" : data && data.total_net_gex < 0 ? "text-red-400" : "text-zinc-400"}>{regime}</span>
        {data && <span className={data.data_source === "live" ? "text-zinc-300" : "text-amber-400"}>{data.data_source === "live" ? data.provenance ? `Alpaca · ${data.provenance.feed}` : "Legacy provider data" : data.data_source === "mixed" ? "Mixed provider + synthetic" : "Synthetic demo data"}</span>}
      </div>
      {data && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-zinc-400">
        <span>Snapshot: {data.timestamp.replace("T", " ").slice(0, 19)} (server time)</span>
        <span>Cache: {data.cache ? data.cache.stale ? "stale" : "fresh" : "unknown"}{data.cache?.refreshing ? " · refreshing" : ""}</span>
        {lastChecked && <span>Checked: {lastChecked.toLocaleTimeString()}</span>}
      </div>}
    </div>
    {!independentView && <OptionsDataSource provenance={data?.provenance} />}
    {!independentView && (error || data?.cache?.refresh_error || data?.persistence_warning) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800 bg-amber-950/20 p-4 text-sm text-amber-200">
      <span>{error || data?.cache?.refresh_error || data?.persistence_warning}{data ? " Data terakhir tetap ditampilkan." : " Pastikan backend Greeks tersedia."}</span>
      <button onClick={() => void refresh(true)} disabled={busy} className="underline disabled:opacity-50">Coba lagi</button>
    </div>}
    {!independentView && data && data.data_source !== "live" && <p role="status" className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">Sebagian atau seluruh chain menggunakan data simulasi karena sumber opsi tidak tersedia. Snapshot ini tidak ditambahkan ke histori sinyal.</p>}
    <div role="tablist" aria-label="Greeks views" className="flex gap-1 overflow-x-auto border-b border-zinc-800 pb-1">
      {tabs.map(name => <button key={name} id={`greeks-tab-${name.replaceAll(" ", "-")}`} role="tab" aria-selected={tab === name} aria-controls="greeks-panel" onClick={() => setTab(name)} onKeyDown={e => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (tabs.indexOf(name) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        setTab(tabs[next]); document.getElementById(`greeks-tab-${tabs[next].replaceAll(" ", "-")}`)?.focus();
      }} tabIndex={tab === name ? 0 : -1} className={`shrink-0 rounded-t-lg px-3 py-3 text-xs font-mono focus-visible:outline focus-visible:outline-cyan-400 ${tab === name ? "border-b-2 border-cyan-400 bg-zinc-900 text-cyan-300" : "text-zinc-400 hover:text-zinc-100"}`}>{name}</button>)}
    </div>
    <div className="flex items-center justify-between gap-3 px-1"><div><h3 className="text-sm font-semibold">{tab}</h3><p className="mt-1 text-xs leading-relaxed text-zinc-400">{descriptions[tab]}</p></div><ArrowUpRight size={18} className="shrink-0 text-zinc-500" aria-hidden="true" /></div>
    <div role="tabpanel" id="greeks-panel" aria-labelledby={`greeks-tab-${tab.replaceAll(" ", "-")}`} className="min-w-0" key={ticker}>
      {tab === "ETF constituents" && <EtfConstituents initialTicker={ticker} />}
      {tab === "RV vs VIX" && <RvVix />}
      {researchView && <GreeksResearchPanel ticker={ticker} view={researchView} />}
      {!researchView && !independentView && !data && busy && <div role="status" aria-label="Loading Greeks snapshot" className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-900" />)}<p className="col-span-full text-sm text-zinc-400">Mengambil chain opsi dan menghitung exposure…</p></div>}
      {!researchView && !independentView && !data && !busy && <p className="rounded-xl border border-zinc-800 p-8 text-center text-zinc-400">Snapshot belum tersedia. Pilih ticker atau coba lagi.</p>}
      {data && <>
        {tab === "Overview" && <GreeksOverview data={data} ticker={ticker} />}
        {tab === "Strikes" && <Chain data={data} onOpenContract={symbol => { setSelectedContract(symbol); setTab('Contracts'); }} />}
        {tab === "Contracts" && <ContractDesk key={`${ticker}-${selectedContract || ''}`} data={data} initialSymbol={selectedContract} />}
        {tab === "Surfaces" && <Surfaces data={data} />}
        {tab === "Open interest" && <div className="space-y-4"><OITimeline data={data} /><OIChange ticker={ticker} spot={data.spot} greeksData={data} /></div>}
        {tab === "Scenarios" && <div className="space-y-4"><Simulator ticker={ticker} greeksData={data} /><ExpectedMove ticker={ticker} /><Bounce ticker={ticker} /><VVIX /></div>}
        {tab === "Unusual flow" && <Unusual ticker={ticker} />}
        {tab === "AI research" && <div className="space-y-4"><AI greeksData={data} ticker={ticker} /><Chat ticker={ticker} /><DependencyGraph /></div>}
      </>}
    </div>

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
        const canvas = document.querySelector("canvas");
        return canvas as HTMLCanvasElement | null;
      }}
      metadata={{
        ticker,
        interval: "OPTIONS",
        provider: `ALPACA / ${data?.provenance?.feed?.toUpperCase() || 'NO SNAPSHOT'} / MODEL EXPOSURE`,
        lastPrice: data ? `$${data.spot.toFixed(2)}` : undefined,
        timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
        quantMetrics: data ? [
          { label: "GEX / 1% MOVE", value: `$${(data.total_net_gex * 1e7 / 1e6).toFixed(1)}M` },
          { label: "REGIME", value: regime.toUpperCase() },
          { label: "GAMMA FLIP", value: data.gamma_flip ? `$${data.gamma_flip.toFixed(1)}` : "N/A" }
        ] : []
      }}
      watermark={watermarkConfig}
    />
  </section>;
}


"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity, TrendingUp, BarChart3, Layers, PieChart } from "lucide-react";
import {
  fetchSVI, fetchDispersionCorrelation, fetchDispersionSignal, fetchDispersionScan, fetchWeights,
  SVIResponse, CorrelationResponse, DispersionSignalResponse, DispersionScanResponse, WeightsResponse,
  getSignalColor, getSignalLabel, getMethodBadge, fmtCorr, fmtSpread,
} from "../../lib/dispersion";
import SVIChart from "./SVIChart";
import CorrelationSpreadChart from "./CorrelationSpreadChart";
import DispersionSignalPanel from "./DispersionSignalPanel";
import MarketCapBreakdown from "./MarketCapBreakdown";

type SubTab = "signal" | "svi" | "correlation" | "scan" | "weights";
type SupportedIndex = "SPY" | "QQQ" | "IWM";

const INDEX_OPTIONS: SupportedIndex[] = ["SPY", "QQQ", "IWM"];
const DTE_OPTIONS = [7, 14, 30, 45, 60];

export default function DispersionDashboard() {
  const [activeTab, setActiveTab] = useState<SubTab>("signal");
  const [activeIndex, setActiveIndex] = useState<SupportedIndex>("SPY");
  const [dte, setDte] = useState(30);
  const [window, setWindow] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sviData, setSviData] = useState<SVIResponse | null>(null);
  const [corrData, setCorrData] = useState<CorrelationResponse | null>(null);
  const [signalData, setSignalData] = useState<DispersionSignalResponse | null>(null);
  const [scanData, setScanData] = useState<DispersionScanResponse | null>(null);
  const [weightsData, setWeightsData] = useState<WeightsResponse | null>(null);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === "svi") {
        const d = await fetchSVI(activeIndex, dte, force);
        setSviData(d);
      } else if (activeTab === "correlation") {
        const d = await fetchDispersionCorrelation(activeIndex, dte, window, force);
        setCorrData(d);
      } else if (activeTab === "signal") {
        const d = await fetchDispersionSignal(activeIndex, dte, window, force);
        setSignalData(d);
      } else if (activeTab === "scan") {
        const d = await fetchDispersionScan(dte, window, force);
        setScanData(d);
      } else if (activeTab === "weights") {
        const d = await fetchWeights(activeIndex, force);
        setWeightsData(d);
      }
    } catch (e: any) {
      setError(e.message || "Fetch gagal");
    } finally {
      setLoading(false);
    }
  }, [activeTab, activeIndex, dte, window]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const tabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: "signal",      label: "Dispersion Signal", icon: <Activity size={12} /> },
    { id: "weights",     label: "Market Cap",         icon: <PieChart size={12} /> },
    { id: "svi",         label: "SVI Surface",        icon: <BarChart3 size={12} /> },
    { id: "correlation", label: "Correlation",        icon: <TrendingUp size={12} /> },
    { id: "scan",        label: "Multi-Index Scan",   icon: <Layers size={12} /> },
  ];

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-5 py-4">
        <div>
          <h2 className="text-sm font-mono font-bold text-zinc-100 uppercase tracking-wider flex items-center gap-2">
            <Activity size={14} className="text-indigo-400" />
            Dispersion Trading & SVI Engine
          </h2>
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
            Implied vs Realized Correlation Arbitrage · SVI Surface Fitting
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Index Selector (hidden for scan tab) */}
          {activeTab !== "scan" && (
            <div className="flex gap-1">
              {INDEX_OPTIONS.map(idx => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                    activeIndex === idx
                      ? "bg-indigo-900/60 text-indigo-300 border border-indigo-700/50"
                      : "bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800"
                  }`}
                >
                  {idx}
                </button>
              ))}
            </div>
          )}

          {/* Dynamic Weights Method Badge */}
          {(signalData?.weights_method || corrData?.weights_method) && activeTab !== "weights" && (() => {
            const method = signalData?.weights_method || corrData?.weights_method || "";
            const badge = getMethodBadge(method);
            return (
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${badge.color}`}>
                {badge.label}
              </span>
            );
          })()}

          {/* DTE Selector */}
          <select
            value={dte}
            onChange={e => setDte(Number(e.target.value))}
            className="bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-xs font-mono text-zinc-300"
          >
            {DTE_OPTIONS.map(d => (
              <option key={d} value={d}>{d}DTE</option>
            ))}
          </select>

          {/* Refresh */}
          <button
            onClick={() => loadData(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:text-indigo-400 hover:border-indigo-700/50 transition-all"
          >
            <RefreshCw size={11} className={loading ? "animate-spin text-indigo-400" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase rounded-lg whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "bg-zinc-800 text-indigo-400 border border-zinc-700/50"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-mono text-red-400">
          {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-10 text-center text-zinc-500 text-xs font-mono">
          Menghitung {activeTab === "svi" ? "SVI fitting" : activeTab === "scan" ? "multi-index scan" : "correlation"}...
          <br />
          <span className="text-[10px] text-zinc-600">(Fetch opsi dari yfinance, biasanya 5–15 detik)</span>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4">

          {/* SIGNAL TAB */}
          {activeTab === "signal" && signalData && (
            <DispersionSignalPanel data={signalData} />
          )}

          {/* WEIGHTS / MARKET CAP TAB */}
          {activeTab === "weights" && (
            <MarketCapBreakdown index={activeIndex} />
          )}

          {/* SVI TAB */}
          {activeTab === "svi" && sviData && (
            <SVIChart data={sviData} />
          )}

          {/* CORRELATION TAB */}
          {activeTab === "correlation" && corrData && (
            <CorrelationSpreadChart data={corrData} />
          )}

          {/* SCAN TAB */}
          {activeTab === "scan" && scanData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
                  Multi-Index Dispersion Scan — {scanData.dte}DTE / {scanData.window_days}d Realized
                </h3>
                <span className="text-[10px] font-mono text-zinc-600">
                  {new Date(scanData.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800/60">
                      <th className="text-left py-2 pr-4">Index</th>
                      <th className="text-right py-2 pr-4">ATM IV</th>
                      <th className="text-right py-2 pr-4">ρ Implied</th>
                      <th className="text-right py-2 pr-4">ρ Realized</th>
                      <th className="text-right py-2 pr-4">Spread</th>
                      <th className="text-center py-2 pr-4">Strength</th>
                      <th className="text-left py-2">Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanData.scan_results.map((row: any) => {
                      const sColor = getSignalColor(row.signal);
                      const sLabel = getSignalLabel(row.signal);
                      return (
                        <tr key={row.index} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                          <td className="py-3 pr-4 font-bold text-zinc-100">{row.index}</td>
                          <td className="text-right py-3 pr-4 text-orange-400">
                            {row.index_atm_iv !== null ? `${row.index_atm_iv.toFixed(1)}%` : "--"}
                          </td>
                          <td className="text-right py-3 pr-4 text-blue-400">
                            {fmtCorr(row.implied_correlation)}
                          </td>
                          <td className="text-right py-3 pr-4 text-orange-400">
                            {fmtCorr(row.realized_correlation)}
                          </td>
                          <td className={`text-right py-3 pr-4 font-bold ${sColor}`}>
                            {fmtSpread(row.spread)}
                          </td>
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${row.signal_strength}%`,
                                    backgroundColor:
                                      row.signal === "SHORT_DISPERSION" ? "#34d399" :
                                      row.signal === "LONG_DISPERSION"  ? "#f87171" : "#52525b",
                                  }}
                                />
                              </div>
                              <span className="text-zinc-400 w-7 text-right">{row.signal_strength}</span>
                            </div>
                          </td>
                          <td className="py-3">
                            <span className={`font-bold ${sColor}`}>{sLabel}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!sviData && !corrData && !signalData && !scanData && !weightsData && !loading && (
            <div className="text-center py-8 text-zinc-500 text-xs font-mono">
              Klik Refresh untuk memuat data.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useState, useCallback, useEffect } from "react";
import { fetchVolCombined, CombinedResult, STATE_COLORS, STATE_ICONS } from "../../lib/volatility";
import HARChart from "./HARChart";
import HMMRegimeChart from "./HMMRegimeChart";
import MSARChart from "./MSARChart";
import HARCJChart from "./HAR_CJChart";
import KalmanHARCJChart from "./KalmanHARCJChart";
import HybridArbChart from "./HybridArbChart";

type TabId = "meta" | "har" | "hmm" | "msar" | "har_cj" | "kalman" | "monte_carlo" | "hybrid";

const TABS: { id: TabId; label: string; icon: string; desc: string }[] = [
  { id: "meta",  label: "Overview",    icon: "⬡", desc: "Pipeline Meta & Key Signals" },
  { id: "har",   label: "HAR-RV",      icon: "📈", desc: "Heterogeneous Autoregressive Volatility" },
  { id: "hmm",   label: "HMM Regime",  icon: "🔴", desc: "Hidden Markov Market Regime Detection" },
  { id: "msar",  label: "MSAR Logic",  icon: "🧬", desc: "Markov-Switching Autoregressive Risk" },
  { id: "har_cj", label: "HAR-CJ",     icon: "📉", desc: "Jump-Continuous Volatility Decomposition" },
  { id: "kalman", label: "Kalman",      icon: "🔬", desc: "Adaptive State-Space Volatility Engine" },
  { id: "monte_carlo", label: "Monte Carlo", icon: "🎲", desc: "Regime-Switching Simulation" },
  { id: "hybrid", label: "Hybrid Arb", icon: "⚖️", desc: "Hybrid Arbitrage Strategy" },
];

const PERIOD_OPTIONS = [
  { value: "6mo", label: "6 Months" },
  { value: "1y",  label: "1 Year" },
  { value: "2y",  label: "2 Years" },
  { value: "5y",  label: "5 Years" },
];

function MetaPanel({ result }: { result: CombinedResult }) {
  const { meta, har_rv, hmm } = result;
  const regime = hmm.current_regime;
  const col = STATE_COLORS[regime];

  return (
    <div className="space-y-5">
      {/* Hero summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Current regime */}
        <div className={`rounded-xl border ${col.border} ${col.bg} px-5 py-4 col-span-1`}>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">HMM Current Regime</p>
          <p className={`text-xl font-mono font-bold mt-2 ${col.text}`}>
            {STATE_ICONS[regime]} {meta.hmm_current_regime}
          </p>
          <p className="text-[10px] font-mono text-zinc-500 mt-1">
            {hmm.n_features}D feature space · LL: {hmm.log_likelihood}
          </p>
          <div className="mt-3 space-y-1">
            {hmm.transition_probs.map((tp, i) => {
              const sid = ["Bearish / High-Vol", "Sideways / Neutral", "Bullish / Low-Vol"].indexOf(tp.to_state);
              const c = STATE_COLORS[sid >= 0 ? sid : 1];
              return (
                <div key={i} className="flex justify-between text-[10px] font-mono">
                  <span className={c.text}>{tp.to_state.split(" / ")[0]}</span>
                  <span className="text-zinc-300">{(tp.probability * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* HAR-RV forecast */}
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 px-5 py-4 col-span-1">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">HAR-RV Forecast</p>
          <p className="text-xl font-mono font-bold mt-2 text-cyan-300">
            {(meta.har_next_forecast * 100).toFixed(4)}%
          </p>
          <p className="text-[10px] font-mono text-zinc-500 mt-1">Next-bar RV forecast (OLS)</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div>
              <span className="text-zinc-600">R²</span>
              <span className="ml-1 text-zinc-300">{har_rv.rsquared.toFixed(4)}</span>
            </div>
            <div>
              <span className="text-zinc-600">β Daily</span>
              <span className="ml-1 text-indigo-400">{har_rv.params.RV_Daily.toFixed(3)}</span>
            </div>
            <div>
              <span className="text-zinc-600">β Weekly</span>
              <span className="ml-1 text-orange-400">{har_rv.params.RV_Weekly.toFixed(3)}</span>
            </div>
            <div>
              <span className="text-zinc-600">β Monthly</span>
              <span className="ml-1 text-purple-400">{har_rv.params.RV_Monthly.toFixed(3)}</span>
            </div>
          </div>
        </div>

        {/* Pipeline info */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4 col-span-1">
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Pipeline Config</p>
          <div className="mt-3 space-y-2 text-[11px] font-mono">
            <div className="flex justify-between">
              <span className="text-zinc-600">Tickers</span>
              <span className="text-zinc-300">{result.tickers.join(", ")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">RV Ticker</span>
              <span className="text-zinc-300">{result.rv_ticker}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">HAR→HMM</span>
              <span className={meta.use_har_in_hmm ? "text-emerald-400" : "text-zinc-500"}>
                {meta.use_har_in_hmm ? "✓ Enabled (4D)" : "Disabled (3D)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">HMM States</span>
              <span className="text-zinc-300">{hmm.n_states}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-600">Stay Prob</span>
              <span className={col.text}>{(hmm.stay_probability * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* State distribution bar */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Historical Regime Distribution
        </p>
        <div className="flex h-6 rounded-full overflow-hidden gap-0.5">
          {hmm.state_summary.map(s => (
            <div
              key={s.state_id}
              className={`h-full transition-all ${STATE_COLORS[s.state_id].bg.replace("/40", "/70")}`}
              style={{ width: `${s.pct_history}%` }}
              title={`${s.name}: ${s.pct_history}%`}
            />
          ))}
        </div>
        <div className="flex gap-4 mt-2">
          {hmm.state_summary.map(s => (
            <div key={s.state_id} className="flex items-center gap-1.5 text-[10px] font-mono">
              <div className={`w-2 h-2 rounded-full ${STATE_COLORS[s.state_id].bg.replace("/40", "")}`} />
              <span className={STATE_COLORS[s.state_id].text}>{s.name.split(" / ")[0]}</span>
              <span className="text-zinc-600">{s.pct_history}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Posterior gauge ring */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
        <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
          Current Regime Posterior Confidence
        </p>
        <div className="flex flex-wrap gap-4">
          {Object.entries(hmm.current_posteriors).map(([name, prob]) => {
            const sid = ["Bearish / High-Vol", "Sideways / Neutral", "Bullish / Low-Vol"].indexOf(name);
            const c = STATE_COLORS[sid >= 0 ? sid : 1];
            const pct = (prob * 100).toFixed(1);
            return (
              <div key={name} className="flex-1 min-w-[140px]">
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className={c.text}>{name.split(" / ")[0]}</span>
                  <span className="text-zinc-300 font-bold">{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-zinc-800">
                  <div className={`h-full rounded-full ${c.bg.replace("/40", "")} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Component ───────────────────────────────────────────────────
export default function VolatilityDashboard() {
  const [tickersInput, setTickersInput] = useState("BBRI.JK");
  const [period, setPeriod] = useState("2y");
  const [useHar, setUseHar] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CombinedResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("meta");

  const handleRun = useCallback(async () => {
    const ticker = tickersInput.trim();
    if (!ticker) {
      setError("Enter a ticker.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const combinedRes = await fetchVolCombined([ticker], period, useHar);
      setData(combinedRes);
      setActiveTab("meta");
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [tickersInput, period, useHar]);

  // Debounced auto-run
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleRun();
    }, 800);
    return () => clearTimeout(timeoutId);
  }, [handleRun]);


  return (
    <div className="space-y-6">

      {/* ── Control Panel ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-10 gap-4 items-end">

          {/* Ticker */}
          <div className="sm:col-span-4 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              Ticker
            </label>
            <input
              type="text"
              value={tickersInput}
              onChange={e => setTickersInput(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2.5 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-indigo-500/60 transition-colors w-full"
              placeholder="e.g. BBRI.JK"
            />
          </div>

          {/* Period */}
          <div className="sm:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              History Period
            </label>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2.5 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-indigo-500/60 transition-colors w-full"
            >
              {PERIOD_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* HAR toggle */}
          <div className="sm:col-span-3 flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              HAR→HMM (4D)
            </label>
            <button
              onClick={() => setUseHar(v => !v)}
              className={`px-3 py-2.5 rounded-md border text-sm font-mono transition-colors
                ${useHar
                  ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                  : "bg-zinc-900 border-zinc-700 text-zinc-500"}`}
            >
              {useHar ? "✓ Enabled" : "○ Disabled"}
            </button>
          </div>
        </div>

        {/* Description */}
        <p className="text-[10px] font-mono text-zinc-600">
          Pipeline: HAR-RV (OLS regression on daily/weekly/monthly RV) → HMM (3-state Gaussian regime detection)
          {useHar ? " · HAR-RV injected as 4th feature into HMM feature space" : " · 3D feature space (return | vol | corr)"}
        </p>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* ── Loading skeleton ───────────────────────────────────────────── */}
      {loading && !data && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
          <div className="h-56 rounded-xl bg-zinc-800/40 animate-pulse" />
          <div className="h-40 rounded-xl bg-zinc-800/40 animate-pulse" />
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────────── */}
      {data && !loading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* ── Tab Navigation ────────────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-1.5 flex gap-1.5 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-mono transition-all duration-200 whitespace-nowrap
                  ${activeTab === tab.id
                    ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 shadow-lg shadow-indigo-500/10"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent"
                  }`}
              >
                <span>{tab.icon}</span>
                <span className="font-semibold">{tab.label}</span>
                <span className="hidden sm:inline text-[10px] uppercase tracking-wider opacity-70">
                  — {tab.desc}
                </span>
              </button>
            ))}
          </div>

          {/* ── Tab Content ───────────────────────────────────────────── */}
          {activeTab === "meta" && <MetaPanel result={data} />}
          {activeTab === "har"  && <HARChart har={data.har_rv} ticker={data.rv_ticker} />}
          {activeTab === "hmm"  && <HMMRegimeChart hmm={data.hmm} />}
          {activeTab === "msar" && <MSARChart initialTicker={data.tickers[0] || tickersInput} />}
          {activeTab === "har_cj" && <HARCJChart initialTicker={data.tickers[0] || tickersInput} />}
          {activeTab === "kalman" && <KalmanHARCJChart initialTicker={data.tickers[0] || tickersInput} />}
          {activeTab === "hybrid" && <HybridArbChart initialTicker={data.tickers[0] || tickersInput} />}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────── */}
      {!data && !loading && !error && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 px-6 py-12 text-center">
          <p className="text-4xl mb-4">📊</p>
          <p className="text-zinc-400 font-mono text-sm">Enter a ticker to start</p>
          <p className="text-zinc-600 font-mono text-[11px] mt-2">
            HAR-RV model akan fit OLS regression pada historical RV, kemudian HMM akan detect market regime dari 4-dimensional feature space
          </p>
        </div>
      )}
    </div>
  );
}

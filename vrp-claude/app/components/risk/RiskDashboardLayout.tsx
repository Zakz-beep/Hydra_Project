"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RiskStatus,
  RegimeInfo,
  DailyBrief,
  AccountState,
  BehavioralProfile,
  MetricsCompare,
  fetchRiskStatus,
  fetchRiskRegime,
  fetchDailyBrief,
  fetchAccountState,
  fetchBehavioralProfile,
  fetchMetricsCompare,
  fmtMoney,
} from "../../lib/risk";

import PipelineControl    from "./PipelineControl";
import RegimePanel        from "./RegimePanel";
import PreTradeGate       from "./PreTradeGate";
import PostTradeEval      from "./PostTradeEval";
import MonteCarloMetrics  from "./MonteCarloMetrics";

interface Props {
  ticker: string;
}

type RiskTab = "pipeline" | "pretrade" | "posttrade" | "metrics";

export default function RiskDashboardLayout({ ticker }: Props) {
  const [tab, setTab] = useState<RiskTab>("pipeline");
  const [status, setStatus] = useState<RiskStatus | null>(null);
  const [regime, setRegime] = useState<RegimeInfo | null>(null);
  const [dailyBrief, setDailyBrief] = useState<DailyBrief | null>(null);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [profile, setProfile] = useState<BehavioralProfile | null>(null);
  const [metrics, setMetrics] = useState<MetricsCompare | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Initial data load
  const loadCoreData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [s, brief, acc, prof] = await Promise.allSettled([
        fetchRiskStatus(),
        fetchDailyBrief(),
        fetchAccountState(),
        fetchBehavioralProfile(),
      ]);
      if (s.status === "fulfilled")     setStatus(s.value);
      if (brief.status === "fulfilled") setDailyBrief(brief.value);
      if (acc.status === "fulfilled")   setAccount(acc.value);
      if (prof.status === "fulfilled")  setProfile(prof.value);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData]);

  // Fetch regime + metrics when pipeline completes
  const handleStatusChange = useCallback(async (s: RiskStatus) => {
    setStatus(s);
    if (!s.is_running && s.last_run) {
      // Pipeline just completed — fetch results
      try {
        const [r, m] = await Promise.allSettled([
          fetchRiskRegime(),
          fetchMetricsCompare(),
        ]);
        if (r.status === "fulfilled") setRegime(r.value);
        if (m.status === "fulfilled") setMetrics(m.value);
      } catch {}
    }
  }, []);

  // Refresh behavioral profile after post-trade eval
  const refreshProfile = useCallback(async () => {
    try {
      const p = await fetchBehavioralProfile();
      setProfile(p);
    } catch {}
  }, []);

  const pipelineReady = status?.phases_complete?.phase2 ?? false;

  const tabs: { key: RiskTab; label: string; icon: string }[] = [
    { key: "pipeline", label: "Pipeline", icon: "⚙" },
    { key: "pretrade", label: "Pre-Trade", icon: "🎯" },
    { key: "posttrade", label: "Post-Trade", icon: "📝" },
    { key: "metrics", label: "Metrics", icon: "📊" },
  ];

  return (
    <div className="space-y-4">
      {/* Account header bar */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-5 py-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-5">
          {account ? (
            <>
              <div>
                <span className="text-[9px] font-mono text-zinc-600 uppercase block">Balance</span>
                <span className="text-sm font-mono font-semibold text-zinc-200">{fmtMoney(account.balance)}</span>
              </div>
              <div className="w-px h-6 bg-zinc-800" />
              <div>
                <span className="text-[9px] font-mono text-zinc-600 uppercase block">Equity</span>
                <span className="text-sm font-mono font-semibold text-zinc-200">{fmtMoney(account.equity)}</span>
              </div>
              <div className="w-px h-6 bg-zinc-800" />
              <div>
                <span className="text-[9px] font-mono text-zinc-600 uppercase block">Daily Limit</span>
                <span className="text-sm font-mono font-semibold text-amber-400">
                  {(account.daily_loss_limit * 100).toFixed(1)}%
                </span>
              </div>
              <div className="w-px h-6 bg-zinc-800" />
              <div>
                <span className="text-[9px] font-mono text-zinc-600 uppercase block">Max DD</span>
                <span className="text-sm font-mono font-semibold text-red-400">
                  {(account.max_trailing_dd * 100).toFixed(1)}%
                </span>
              </div>
            </>
          ) : (
            <div className="text-zinc-600 text-xs font-mono">Loading account...</div>
          )}
        </div>

        {/* Behavior score mini */}
        {profile && (
          <div className="flex items-center gap-2">
            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  profile.score >= 80 ? "bg-emerald-500" :
                  profile.score >= 50 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${profile.score}%` }}
              />
            </div>
            <span className={`text-xs font-mono font-semibold ${
              profile.score >= 80 ? "text-emerald-400" :
              profile.score >= 50 ? "text-amber-400" : "text-red-400"
            }`}>
              🧠 {profile.score.toFixed(0)}
            </span>
          </div>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-[11px] font-mono uppercase tracking-wider cursor-pointer
              border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5
              ${tab === key
                ? "border-indigo-500 text-indigo-300"
                : "border-transparent text-zinc-600 hover:text-zinc-400"
              }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "pipeline" && (
        <div className="space-y-4">
          <PipelineControl
            ticker={ticker}
            status={status}
            onStatusChange={handleStatusChange}
          />
          <RegimePanel
            regime={regime}
            loading={loadingData && !regime}
          />
        </div>
      )}

      {tab === "pretrade" && (
        <PreTradeGate
          ticker={ticker}
          dailyBrief={dailyBrief}
          pipelineReady={pipelineReady}
        />
      )}

      {tab === "posttrade" && (
        <PostTradeEval
          ticker={ticker}
          profile={profile}
          onProfileUpdate={refreshProfile}
        />
      )}

      {tab === "metrics" && (
        <MonteCarloMetrics
          metrics={metrics}
          loading={loadingData && !metrics}
        />
      )}
    </div>
  );
}

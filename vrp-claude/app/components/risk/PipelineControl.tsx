"use client";

import { useState, useEffect, useRef } from "react";
import {
  RiskStatus,
  runRiskPipeline,
  fetchRiskStatus,
} from "../../lib/risk";

interface Props {
  ticker: string;
  status: RiskStatus | null;
  onStatusChange: (s: RiskStatus) => void;
}

export default function PipelineControl({ ticker, status, onStatusChange }: Props) {
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll while running
  useEffect(() => {
    if (status?.is_running) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await fetchRiskStatus();
          onStatusChange(s);
          if (!s.is_running) {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {}
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status?.is_running, onStatusChange]);

  const handleRun = async () => {
    setLaunching(true);
    setError(null);
    try {
      await runRiskPipeline(ticker);
      // Immediately poll status
      const s = await fetchRiskStatus();
      onStatusChange(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start pipeline");
    } finally {
      setLaunching(false);
    }
  };

  const isRunning = status?.is_running ?? false;
  const phases = status?.phases_complete;

  const phaseLabels = [
    { key: "phase2", label: "Regime Detection", icon: "🔬" },
    { key: "phase3", label: "Monte Carlo Sim", icon: "🎲" },
    { key: "phase4", label: "Risk Metrics", icon: "📊" },
    { key: "phase5", label: "Stress Testing", icon: "⚡" },
    { key: "phase6", label: "Decision Engine", icon: "🎯" },
  ] as const;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-800/40">
        <div>
          <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span className="text-indigo-400">⚙</span> Pipeline Control
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            Phase 2→6 · {ticker}
            {status?.last_run && (
              <span className="ml-2 text-zinc-500">
                last: {new Date(status.last_run).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={handleRun}
          disabled={isRunning || launching}
          className={`px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all duration-300 cursor-pointer
            ${isRunning || launching
              ? "bg-indigo-950/60 text-indigo-400/60 border border-indigo-700/30 cursor-not-allowed"
              : "bg-indigo-600 text-white border border-indigo-500 hover:bg-indigo-500 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
            }`}
        >
          {isRunning ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-indigo-400/60 border-t-indigo-400 rounded-full animate-spin" />
              RUNNING...
            </span>
          ) : launching ? (
            "LAUNCHING..."
          ) : (
            "▶ RUN PIPELINE"
          )}
        </button>
      </div>

      {/* Phase progress */}
      <div className="px-5 py-3">
        <div className="flex items-center gap-1">
          {phaseLabels.map(({ key, label, icon }, i) => {
            const done = phases?.[key] ?? false;
            const isActive = isRunning && !done && (i === 0 || phases?.[phaseLabels[i - 1].key]);
            return (
              <div key={key} className="flex items-center gap-1 flex-1">
                <div
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-mono w-full transition-all duration-500
                    ${done
                      ? "bg-emerald-950/40 text-emerald-400 border border-emerald-700/30"
                      : isActive
                      ? "bg-indigo-950/40 text-indigo-300 border border-indigo-600/40 animate-pulse"
                      : "bg-zinc-900/60 text-zinc-600 border border-zinc-800/30"
                    }`}
                >
                  <span>{done ? "✓" : icon}</span>
                  <span className="hidden sm:inline truncate">{label}</span>
                </div>
                {i < phaseLabels.length - 1 && (
                  <span className={`text-[8px] ${done ? "text-emerald-600" : "text-zinc-700"}`}>→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {(error || status?.error) && (
        <div className="mx-5 mb-3 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[11px] font-mono text-red-400">
          ⚠ {error || status?.error}
        </div>
      )}

      {/* Models available */}
      {status?.available_models && status.available_models.length > 0 && (
        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-mono text-zinc-600 uppercase">Models:</span>
          {status.available_models.map((m) => (
            <span
              key={m}
              className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-zinc-800/60 text-zinc-400 border border-zinc-700/40"
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

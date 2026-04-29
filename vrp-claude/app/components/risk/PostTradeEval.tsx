"use client";

import { useState } from "react";
import {
  BehavioralProfile,
  PostTradeRequest,
  PostTradeResponse,
  postTradeEvaluation,
  fmtMoney,
} from "../../lib/risk";

interface Props {
  ticker: string;
  profile: BehavioralProfile | null;
  onProfileUpdate: () => void;
}

export default function PostTradeEval({ ticker, profile, onProfileUpdate }: Props) {
  const [direction, setDirection] = useState<"Long" | "Short">("Long");
  const [pnl, setPnl] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [exitTime, setExitTime] = useState("");
  const [hitSl, setHitSl] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PostTradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEvaluate = async () => {
    if (!pnl || !entryTime || !exitTime) return;
    setLoading(true);
    setError(null);
    try {
      const req: PostTradeRequest = {
        ticker,
        direction,
        pnl: parseFloat(pnl),
        entry_time: entryTime,
        exit_time: exitTime,
        hit_sl: hitSl,
      };
      const res = await postTradeEvaluation(req);
      setResult(res);
      onProfileUpdate(); // refresh behavioral profile
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post-trade eval failed");
    } finally {
      setLoading(false);
    }
  };

  const score = profile?.score ?? 100;
  const scoreColor =
    score >= 80 ? "text-emerald-400" :
    score >= 50 ? "text-amber-400" :
    "text-red-400";
  const scoreBarColor =
    score >= 80 ? "bg-emerald-500" :
    score >= 50 ? "bg-amber-500" :
    "bg-red-500";

  return (
    <div className="space-y-4">
      {/* Behavioral Score Panel */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/40">
          <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span className="text-violet-400">🧠</span> Behavioral Score
            <span className="text-[10px] text-zinc-600 font-normal">Module 3 · Pattern Tracker</span>
          </h3>
        </div>
        <div className="px-5 py-4">
          {profile ? (
            <div className="space-y-3">
              {/* Score gauge */}
              <div className="flex items-center gap-4">
                <div className={`text-3xl font-mono font-bold ${scoreColor} tabular-nums`}>
                  {score.toFixed(0)}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                    <span>Discipline Score</span>
                    <span>/100</span>
                  </div>
                  <div className="w-full h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ease-out ${scoreBarColor}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Pattern counters */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "Revenge", count: profile.revenge_count, icon: "😤", color: "red" },
                  { label: "Overtrade", count: profile.overtrade_count, icon: "🔄", color: "amber" },
                  { label: "FOMO", count: profile.fomo_count, icon: "🏃", color: "orange" },
                ].map(({ label, count, icon, color }) => (
                  <div
                    key={label}
                    className={`rounded-lg border px-3 py-2 text-center
                      ${count > 0
                        ? `bg-${color}-950/20 border-${color}-800/30`
                        : "bg-zinc-900/60 border-zinc-800/30"
                      }`}
                  >
                    <div className="text-sm">{icon}</div>
                    <div className={`text-lg font-mono font-bold ${count > 0 ? `text-${color}-400` : "text-zinc-600"}`}>
                      {count}
                    </div>
                    <div className="text-[9px] font-mono text-zinc-600 uppercase">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-zinc-600 font-mono text-xs">Loading behavioral profile...</p>
          )}
        </div>
      </div>

      {/* Post-Trade Evaluation Form */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/40">
          <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span className="text-orange-400">📝</span> Post-Trade Evaluation
            <span className="text-[10px] text-zinc-600 font-normal">Log &amp; analyze closed trades</span>
          </h3>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Ticker</label>
              <input
                type="text"
                value={ticker}
                readOnly
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-400"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Direction</label>
              <div className="flex rounded-md overflow-hidden border border-zinc-700">
                <button
                  onClick={() => setDirection("Long")}
                  className={`flex-1 py-1.5 text-xs font-mono cursor-pointer transition-colors
                    ${direction === "Long"
                      ? "bg-emerald-950/60 text-emerald-400"
                      : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                  LONG
                </button>
                <button
                  onClick={() => setDirection("Short")}
                  className={`flex-1 py-1.5 text-xs font-mono cursor-pointer transition-colors
                    ${direction === "Short"
                      ? "bg-red-950/60 text-red-400"
                      : "bg-zinc-950 text-zinc-500 hover:text-zinc-300"
                    }`}
                >
                  SHORT
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">PnL ($)</label>
              <input
                type="number"
                step="0.01"
                value={pnl}
                onChange={(e) => setPnl(e.target.value)}
                placeholder="-250"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-200
                  focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Entry Time</label>
              <input
                type="datetime-local"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200
                  focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Exit Time</label>
              <input
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200
                  focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hitSl}
                onChange={(e) => setHitSl(e.target.checked)}
                className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-red-500 focus:ring-0 cursor-pointer accent-red-500"
              />
              <span className="text-[11px] font-mono text-zinc-400">Hit Stop Loss</span>
            </label>
          </div>

          <button
            onClick={handleEvaluate}
            disabled={loading || !pnl || !entryTime || !exitTime}
            className={`w-full py-2.5 rounded-lg text-xs font-mono font-semibold transition-all duration-200 cursor-pointer
              ${loading
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : !pnl || !entryTime || !exitTime
                ? "bg-zinc-800/60 text-zinc-600 cursor-not-allowed border border-zinc-700/30"
                : "bg-orange-600/80 text-white border border-orange-500/60 hover:bg-orange-500 hover:shadow-lg hover:shadow-orange-500/20 active:scale-[0.98]"
              }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
                EVALUATING...
              </span>
            ) : (
              "📊 EVALUATE TRADE"
            )}
          </button>

          {error && (
            <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[11px] font-mono text-red-400">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="border-t border-zinc-800/40 px-5 py-4 space-y-4">
            {/* Score change */}
            <div className="flex items-center justify-center gap-4 px-4 py-3 rounded-lg bg-zinc-900/80 border border-zinc-800/40">
              <div className="text-center">
                <div className="text-[9px] font-mono text-zinc-600 uppercase">Before</div>
                <div className="text-xl font-mono font-bold text-zinc-400">{result.old_score.toFixed(0)}</div>
              </div>
              <div className="text-zinc-600">→</div>
              <div className="text-center">
                <div className="text-[9px] font-mono text-zinc-600 uppercase">After</div>
                <div className={`text-xl font-mono font-bold ${
                  result.new_score >= result.old_score ? "text-emerald-400" : "text-red-400"
                }`}>
                  {result.new_score.toFixed(0)}
                </div>
              </div>
              {result.deductions > 0 && (
                <div className="ml-4 px-2 py-1 rounded bg-red-950/30 border border-red-800/30">
                  <span className="text-[10px] font-mono text-red-400">-{result.deductions.toFixed(0)} pts</span>
                </div>
              )}
            </div>

            {/* PnL */}
            <div className={`text-center py-2 rounded-lg border ${
              result.pnl >= 0
                ? "bg-emerald-950/20 border-emerald-800/30 text-emerald-400"
                : "bg-red-950/20 border-red-800/30 text-red-400"
            }`}>
              <span className="text-lg font-mono font-bold">
                {result.pnl >= 0 ? "+" : ""}{fmtMoney(result.pnl)}
              </span>
            </div>

            {/* Behavioral flags */}
            <div className="space-y-1.5">
              {result.behavioral_flags.map((flag, i) => {
                const isPositive = flag.includes("Positive");
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-[11px] font-mono
                      ${isPositive
                        ? "bg-emerald-950/20 border-emerald-800/20 text-emerald-400"
                        : "bg-red-950/20 border-red-800/20 text-red-400"
                      }`}
                  >
                    <span className="mt-0.5">{isPositive ? "✅" : "🚨"}</span>
                    {flag}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

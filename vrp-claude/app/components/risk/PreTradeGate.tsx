"use client";

import { useState } from "react";
import {
  DailyBrief,
  PreTradeRequest,
  PreTradeResponse,
  preTradeCheck,
  fmtMoney,
} from "../../lib/risk";

interface Props {
  ticker: string;
  dailyBrief: DailyBrief | null;
  pipelineReady: boolean;
}

export default function PreTradeGate({ ticker, dailyBrief, pipelineReady }: Props) {
  const [direction, setDirection] = useState<"Long" | "Short">("Long");
  const [lotSize, setLotSize] = useState("1");
  const [entryPrice, setEntryPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreTradeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    if (!entryPrice || !lotSize) return;
    setLoading(true);
    setError(null);
    try {
      const req: PreTradeRequest = {
        ticker,
        direction,
        lot_size: parseFloat(lotSize),
        entry_price: parseFloat(entryPrice),
      };
      const res = await preTradeCheck(req);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pre-trade check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Daily Brief - Module 1 */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center justify-between">
          <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span className="text-amber-400">📰</span> Daily Brief
            <span className="text-[10px] text-zinc-600 font-normal">Module 1 · News Gate</span>
          </h3>
          {dailyBrief?.date && (
            <span className="text-[10px] font-mono text-zinc-600">{dailyBrief.date}</span>
          )}
        </div>
        <div className="px-5 py-3">
          {!dailyBrief || dailyBrief.status ? (
            <p className="text-zinc-600 font-mono text-xs">{dailyBrief?.status || "Loading news data..."}</p>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-4 text-[11px] font-mono">
                <span className="text-zinc-500">Events today: <span className="text-zinc-300">{dailyBrief.total_events_today}</span></span>
                <span className={`${dailyBrief.high_impact_count > 0 ? "text-red-400" : "text-emerald-400"}`}>
                  High impact: {dailyBrief.high_impact_count}
                </span>
              </div>
              {dailyBrief.high_impact_events.length > 0 ? (
                <div className="rounded-lg border border-zinc-800/40 overflow-hidden">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80">
                        {["Time", "Country", "Event", "Forecast", "Previous"].map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left text-zinc-600 uppercase font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dailyBrief.high_impact_events.map((ev, i) => (
                        <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-2 py-1.5 text-amber-400">{ev.time}</td>
                          <td className="px-2 py-1.5 text-zinc-400">{ev.country}</td>
                          <td className="px-2 py-1.5 text-zinc-200">{ev.title}</td>
                          <td className="px-2 py-1.5 text-zinc-400">{ev.forecast || "—"}</td>
                          <td className="px-2 py-1.5 text-zinc-500">{ev.previous || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-950/20 border border-emerald-800/30">
                  <span className="text-emerald-400 text-xs">✓</span>
                  <span className="text-emerald-400 text-[11px] font-mono">No high-impact news today</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pre-Trade Form - Module 1+2 */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/40">
          <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
            <span className="text-cyan-400">🎯</span> Pre-Trade Gate
            <span className="text-[10px] text-zinc-600 font-normal">Module 1+2 · Simulation</span>
          </h3>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Input form */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                      ? "bg-emerald-950/60 text-emerald-400 border-r border-emerald-700/40"
                      : "bg-zinc-950 text-zinc-500 border-r border-zinc-700 hover:text-zinc-300"
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
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Lot Size</label>
              <input
                type="number"
                step="0.01"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-200
                  focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-zinc-600 uppercase block mb-1">Entry Price</label>
              <input
                type="number"
                step="0.01"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="e.g. 21500"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm font-mono text-zinc-200
                  focus:outline-none focus:border-indigo-500/60 transition-colors"
              />
            </div>
          </div>

          <button
            onClick={handleCheck}
            disabled={loading || !pipelineReady || !entryPrice}
            className={`w-full py-2.5 rounded-lg text-xs font-mono font-semibold transition-all duration-200 cursor-pointer
              ${loading
                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                : !pipelineReady
                ? "bg-zinc-800/60 text-zinc-600 cursor-not-allowed border border-zinc-700/30"
                : "bg-cyan-600/80 text-white border border-cyan-500/60 hover:bg-cyan-500 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-[0.98]"
              }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
                CHECKING...
              </span>
            ) : !pipelineReady ? (
              "RUN PIPELINE FIRST"
            ) : (
              "⚡ CHECK TRADE"
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
            {/* Gate status */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border
              ${result.gate_status === "CLEAR"
                ? "bg-emerald-950/30 border-emerald-700/30"
                : "bg-amber-950/30 border-amber-700/30"
              }`}
            >
              <span className={`text-2xl ${result.gate_status === "CLEAR" ? "text-emerald-400" : "text-amber-400"}`}>
                {result.gate_status === "CLEAR" ? "✅" : "⚠️"}
              </span>
              <div>
                <div className={`text-sm font-mono font-bold ${result.gate_status === "CLEAR" ? "text-emerald-400" : "text-amber-400"}`}>
                  Gate: {result.gate_status}
                </div>
                <div className="text-[11px] font-mono text-zinc-400">{result.gate_details}</div>
              </div>
              <div className="ml-auto px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-700/40">
                <span className="text-[10px] font-mono text-zinc-500">Regime: </span>
                <span className="text-[10px] font-mono text-indigo-400">{result.regime_context}</span>
              </div>
            </div>

            {/* News warnings */}
            {result.news_warnings.length > 0 && (
              <div className="space-y-1">
                {result.news_warnings.map((nw, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-950/20 border border-amber-800/20 text-[10px] font-mono text-amber-400">
                    <span>📌</span> {nw.time} · {nw.country} · {nw.title} ({nw.impact})
                  </div>
                ))}
              </div>
            )}

            {/* SL Options */}
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(result.simulation.sl_options).map(([label, price]) => (
                <div key={label} className="rounded-lg border border-zinc-800/40 bg-zinc-900/60 px-3 py-2 text-center">
                  <div className="text-[9px] font-mono text-zinc-600 uppercase">{label} SL</div>
                  <div className="text-sm font-mono text-zinc-200 font-semibold">{(price as number).toFixed(2)}</div>
                </div>
              ))}
            </div>

            {/* TP Target */}
            <div className="rounded-lg border border-indigo-800/30 bg-indigo-950/20 px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-500 uppercase">TP Target</span>
              <span className="text-sm font-mono text-indigo-400 font-semibold">{result.simulation.tp_target.toFixed(2)}</span>
            </div>

            {/* Scenarios comparison */}
            <div className="grid grid-cols-2 gap-3">
              {(["user", "recommended"] as const).map((key) => {
                const sc = result.simulation.scenarios[key];
                const isUser = key === "user";
                return (
                  <div
                    key={key}
                    className={`rounded-lg border px-4 py-3 space-y-2
                      ${sc.is_rejected
                        ? "border-red-700/30 bg-red-950/20"
                        : isUser
                        ? "border-zinc-700/40 bg-zinc-900/60"
                        : "border-emerald-700/30 bg-emerald-950/20"
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-mono uppercase font-semibold ${isUser ? "text-zinc-400" : "text-emerald-400"}`}>
                        {isUser ? "👤 Your Plan" : "🤖 Recommended"}
                      </span>
                      {sc.is_rejected && (
                        <span className="px-1.5 py-0.5 text-[9px] font-mono bg-red-900/40 text-red-400 rounded border border-red-700/30">
                          REJECTED
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
                      <span className="text-zinc-600">Lot Size</span>
                      <span className="text-zinc-300 text-right">{sc.lot_size}</span>
                      <span className="text-zinc-600">Risk $</span>
                      <span className={`text-right ${sc.is_rejected ? "text-red-400" : "text-zinc-300"}`}>
                        {fmtMoney(sc.risk_dollars)}
                      </span>
                      {sc.percent_of_daily_budget !== undefined && (
                        <>
                          <span className="text-zinc-600">% Budget</span>
                          <span className={`text-right ${(sc.percent_of_daily_budget ?? 0) > 100 ? "text-red-400" : "text-zinc-300"}`}>
                            {sc.percent_of_daily_budget?.toFixed(1)}%
                          </span>
                        </>
                      )}
                      {sc.target_risk_pct !== undefined && (
                        <>
                          <span className="text-zinc-600">Risk %</span>
                          <span className="text-zinc-300 text-right">{sc.target_risk_pct?.toFixed(2)}%</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Correlation warnings */}
            {result.simulation.correlation_warnings.length > 0 && (
              <div className="space-y-1">
                {result.simulation.correlation_warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/20 border border-amber-800/20 text-[10px] font-mono text-amber-400">
                    <span className="mt-0.5">⚠</span> {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

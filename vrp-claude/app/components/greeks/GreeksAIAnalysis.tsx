"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { GreeksSnapshot, GBSResponse, ExpectedMoveResponse, fetchGBS, fetchExpectedMove } from "../../lib/greeks";
import { Brain, Sparkles, ChevronDown, RefreshCw, Copy, Check, AlertTriangle, Zap, Search, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ModelInfo { id: string; label: string; tier: string; ctx: number; isFree: boolean; }
interface AIResult { analysis: string; model_used: string; usage: { total_tokens?: number }; ticker: string; }
interface Props { greeksData: GreeksSnapshot; ticker: string; }

const TIER_STYLE: Record<string, { badge: string; glow: string; dot: string }> = {
  FREE:  { badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",  glow: "shadow-emerald-500/20",  dot: "bg-emerald-400" },
  ECON:  { badge: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",           glow: "shadow-cyan-500/20",     dot: "bg-cyan-400"   },
  FAST:  { badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",           glow: "shadow-blue-500/20",     dot: "bg-blue-400"   },
  SMART: { badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",     glow: "shadow-violet-500/20",   dot: "bg-violet-400" },
  BEST:  { badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",        glow: "shadow-amber-500/20",    dot: "bg-amber-400"  },
};

// ─── Markdown renderer ────────────────────────────────────────────────────────
function AnalysisText({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed text-zinc-300 font-mono">
      {text.split("\n").map((line, i) => {
        if (line.startsWith("## ")) return <p key={i} className="text-sm font-bold text-white mt-4 mb-1 pb-1 border-b border-white/10">{line.slice(3)}</p>;
        if (line.startsWith("### ")) return <p key={i} className="text-xs font-bold text-violet-300 mt-3 mb-0.5">› {line.slice(4)}</p>;
        if (line.startsWith("#### ")) return <p key={i} className="text-xs font-semibold text-zinc-200 mt-2">{line.slice(5)}</p>;
        if (line.trim() === "---") return <hr key={i} className="border-white/10 my-3" />;
        if (line.trim() === "") return <div key={i} className="h-1" />;
        if (/^\d+\./.test(line)) {
          const num = line.match(/^(\d+)\./)?.[1];
          return <div key={i} className="flex gap-2 items-start"><span className="text-amber-400 font-bold shrink-0 min-w-[1.2rem]">{num}.</span><span>{line.replace(/^\d+\.\s*/, "").replace(/\*\*(.*?)\*\*/g, "$1")}</span></div>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return <div key={i} className="flex gap-2 items-start pl-1"><span className="text-violet-400 shrink-0 mt-0.5">▸</span><span>{line.replace(/^[-•] /, "").replace(/\*\*(.*?)\*\*/g, "$1")}</span></div>;
        }
        if (line.includes("**")) {
          const parts = line.split(/\*\*(.*?)\*\*/g);
          return <p key={i}>{parts.map((p, j) => j % 2 === 1 ? <span key={j} className="font-bold text-white">{p}</span> : p)}</p>;
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

// ─── Decision badges ──────────────────────────────────────────────────────────
function DecisionBadges({ text }: { text: string }) {
  const bias   = text.match(/\*\*Bias:\*\*\s*\[?([A-Z]+)\]?/i)?.[1]?.toUpperCase() ?? text.match(/Bias:\s*\[?([A-Z]+)\]?/i)?.[1]?.toUpperCase();
  const action = text.match(/\*\*Action:\*\*\s*\[?([A-Z/]+)\]?/i)?.[1]?.toUpperCase() ?? text.match(/Action:\s*\[?([A-Z/]+)\]?/i)?.[1]?.toUpperCase();
  const conv   = text.match(/\*\*Conviction:\*\*\s*\[?([A-Z]+)\]?/i)?.[1]?.toUpperCase() ?? text.match(/Conviction:\s*\[?([A-Z]+)\]?/i)?.[1]?.toUpperCase();
  if (!bias && !action) return null;
  const biasColor  = bias === "BULLISH" ? "from-emerald-500/30 to-emerald-600/20 border-emerald-500/50 text-emerald-200 shadow-emerald-500/20" : bias === "BEARISH" ? "from-red-500/30 to-red-600/20 border-red-500/50 text-red-200 shadow-red-500/20" : "from-zinc-700/30 to-zinc-800/20 border-zinc-600/50 text-zinc-300";
  const actColor   = action?.includes("LONG") ? "from-emerald-500/30 to-emerald-600/20 border-emerald-500/50 text-emerald-200 shadow-emerald-500/20" : action?.includes("SHORT") ? "from-red-500/30 to-red-600/20 border-red-500/50 text-red-200 shadow-red-500/20" : action?.includes("HEDGE") ? "from-amber-500/30 to-amber-600/20 border-amber-500/50 text-amber-200 shadow-amber-500/20" : "from-zinc-700/30 to-zinc-800/20 border-zinc-600/50 text-zinc-300";
  const convColor  = conv === "HIGH" ? "from-violet-500/30 to-violet-600/20 border-violet-500/50 text-violet-200 shadow-violet-500/20" : conv === "MEDIUM" ? "from-blue-500/30 to-blue-600/20 border-blue-500/50 text-blue-200 shadow-blue-500/20" : "from-zinc-700/30 to-zinc-800/20 border-zinc-600/50 text-zinc-300";
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {bias   && <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border bg-gradient-to-br backdrop-blur-sm shadow-lg text-xs font-mono font-bold ${biasColor}`}><span className="text-[10px] opacity-60 font-normal">BIAS</span>{bias === "BULLISH" ? "↑" : bias === "BEARISH" ? "↓" : "→"} {bias}</div>}
      {action && <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border bg-gradient-to-br backdrop-blur-sm shadow-lg text-xs font-mono font-bold ${actColor}`}><span className="text-[10px] opacity-60 font-normal">ACTION</span>{action}</div>}
      {conv   && <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border bg-gradient-to-br backdrop-blur-sm shadow-lg text-xs font-mono font-bold ${convColor}`}><span className="text-[10px] opacity-60 font-normal">CONVICTION</span>{conv}</div>}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function GreeksAIAnalysis({ greeksData, ticker }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Fetch models on mount ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/greeks/ai-models");
        const data = await res.json();
        if (data.models?.length) {
          setModels(data.models);
          setSelectedModel(data.models[0]);
        }
      } catch { /* silent */ } finally { setModelsLoading(false); }
    })();
  }, []);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setModelOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredModels = models.filter(m =>
    m.label.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase()) ||
    m.tier.toLowerCase().includes(search.toLowerCase())
  );

  // ── Run analysis ──────────────────────────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    if (loading || !selectedModel) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const [gbsRes, emRes] = await Promise.allSettled([fetchGBS(ticker), fetchExpectedMove(ticker)]);
      const gbs = gbsRes.status === "fulfilled" ? gbsRes.value : null;
      const em  = emRes.status  === "fulfilled" ? emRes.value  : null;
      const res = await fetch("/api/greeks/ai-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, model: selectedModel.id, greeksData, gbsData: gbs, expectedMoveData: em }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error ?? "AI failed"); }
      setResult(await res.json());
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }, [ticker, greeksData, selectedModel, loading]);

  const tierStyle = selectedModel ? (TIER_STYLE[selectedModel.tier] ?? TIER_STYLE.FAST) : TIER_STYLE.FREE;

  return (
    <div className="relative rounded-2xl overflow-hidden">
      {/* Liquid glass background layers */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/40 via-indigo-950/30 to-zinc-900/60" />
      <div className="absolute inset-0 backdrop-blur-xl" />
      <div className="absolute inset-0 border border-white/[0.08] rounded-2xl" />
      {/* Glow blobs */}
      <div className="absolute -top-20 -right-20 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500/30 to-indigo-500/20 border border-violet-500/30 shadow-lg shadow-violet-500/10">
              <Brain size={15} className="text-violet-300" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">AI Greeks Analysis</h3>
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">OpenRouter · {modelsLoading ? "Loading models..." : `${models.length} models available`}</p>
            </div>
          </div>
          {result && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-600">
              {result.usage.total_tokens && <span className="px-2 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40">{result.usage.total_tokens.toLocaleString()} tokens</span>}
            </div>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* ── Model selector + Run button ──────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Dropdown */}
            <div className="relative flex-1" ref={dropdownRef}>
              <button
                onClick={() => setModelOpen(o => !o)}
                disabled={modelsLoading}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.08] hover:border-violet-500/40 backdrop-blur-sm transition-all text-sm font-mono text-zinc-200 group"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {selectedModel ? (
                    <>
                      <div className={`w-2 h-2 rounded-full shrink-0 ${TIER_STYLE[selectedModel.tier]?.dot ?? "bg-zinc-500"}`} />
                      <span className="truncate text-xs">{selectedModel.label}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-md border shrink-0 ${TIER_STYLE[selectedModel.tier]?.badge}`}>{selectedModel.tier}</span>
                      {selectedModel.isFree && <span className="text-[9px] text-emerald-400 shrink-0">FREE</span>}
                    </>
                  ) : (
                    <span className="text-zinc-500 text-xs">{modelsLoading ? "Loading models..." : "Select a model"}</span>
                  )}
                </div>
                <ChevronDown size={13} className={`text-zinc-500 shrink-0 transition-transform group-hover:text-zinc-300 ${modelOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Dropdown panel */}
              {modelOpen && (
                <div className="absolute z-50 top-full mt-2 w-full rounded-xl bg-zinc-950/95 backdrop-blur-2xl border border-white/[0.08] shadow-2xl shadow-black/50 overflow-hidden">
                  {/* Search */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06]">
                    <Search size={11} className="text-zinc-500 shrink-0" />
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search models..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="flex-1 bg-transparent text-[11px] font-mono text-zinc-300 placeholder-zinc-600 outline-none"
                    />
                    {search && <button onClick={() => setSearch("")}><X size={10} className="text-zinc-600 hover:text-zinc-400" /></button>}
                  </div>

                  {/* Tier groups */}
                  <div className="max-h-72 overflow-y-auto">
                    {["FREE", "ECON", "FAST", "SMART", "BEST"].map(tier => {
                      const group = filteredModels.filter(m => m.tier === tier);
                      if (!group.length) return null;
                      return (
                        <div key={tier}>
                          <div className="px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-600 bg-zinc-900/40 flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${TIER_STYLE[tier]?.dot}`} />
                            {tier} · {group.length} models
                          </div>
                          {group.map(m => (
                            <button
                              key={m.id}
                              onClick={() => { setSelectedModel(m); setModelOpen(false); setSearch(""); }}
                              className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-xs font-mono hover:bg-white/[0.05] transition-colors ${selectedModel?.id === m.id ? "bg-violet-500/10 text-violet-200" : "text-zinc-400"}`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${TIER_STYLE[tier]?.dot}`} />
                                <span className="truncate">{m.label}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {m.isFree && <span className="text-[9px] text-emerald-400">$0</span>}
                                {m.ctx > 0 && <span className="text-[9px] text-zinc-600">{(m.ctx / 1000).toFixed(0)}K</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                    {filteredModels.length === 0 && <p className="text-center text-xs font-mono text-zinc-600 py-6">No models found</p>}
                  </div>
                </div>
              )}
            </div>

            {/* Run button */}
            <button
              onClick={runAnalysis}
              disabled={loading || !selectedModel}
              className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold transition-all shrink-0 ${
                loading
                  ? "bg-violet-800/20 border border-violet-700/20 text-violet-500 cursor-not-allowed"
                  : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 border border-violet-500/50 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 active:scale-95"
              }`}
            >
              {loading ? <><RefreshCw size={12} className="animate-spin" />Analyzing...</> : <><Zap size={12} />Analyze</>}
            </button>
          </div>

          {/* ── Loading ───────────────────────────────────────────────────── */}
          {loading && (
            <div className="rounded-2xl border border-violet-500/20 bg-violet-950/20 backdrop-blur-sm px-6 py-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="relative w-14 h-14">
                  <div className="absolute inset-0 rounded-full border-2 border-violet-500/20 border-t-violet-400 animate-spin" />
                  <div className="absolute inset-2 rounded-full border border-indigo-500/20 border-t-indigo-400 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
                  <Brain size={16} className="absolute inset-0 m-auto text-violet-300" />
                </div>
              </div>
              <div>
                <p className="text-sm font-mono text-violet-300 font-semibold">Analyzing {ticker} Greeks...</p>
                <p className="text-[10px] font-mono text-zinc-600 mt-1">GBS + Expected Move → prompt → {selectedModel?.label}</p>
              </div>
              {/* Animated shimmer bars */}
              <div className="space-y-2 max-w-xs mx-auto">
                {[70, 90, 55, 80].map((w, i) => (
                  <div key={i} className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-600/60 to-indigo-600/60 rounded-full animate-pulse" style={{ width: `${w}%`, animationDelay: `${i * 200}ms` }} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────────── */}
          {error && !loading && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 backdrop-blur-sm px-4 py-3 flex items-start gap-3">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-mono font-bold text-red-300">Error</p>
                <p className="text-[11px] font-mono text-red-400/80 mt-0.5 break-all">{error}</p>
              </div>
            </div>
          )}

          {/* ── Result ────────────────────────────────────────────────────── */}
          {result && !loading && (
            <div className="space-y-4" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
              {/* Decision row */}
              <DecisionBadges text={result.analysis} />

              {/* Analysis glass card */}
              <div className="relative rounded-2xl overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent" />
                <div className="absolute inset-0 border border-white/[0.07] rounded-2xl" />
                <div className="relative z-10 p-5">
                  {/* Copy button */}
                  <button
                    onClick={() => { navigator.clipboard.writeText(result.analysis); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="absolute top-4 right-4 p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-500 hover:text-zinc-300 transition-all opacity-0 group-hover:opacity-100"
                    title="Copy"
                  >
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  </button>
                  <AnalysisText text={result.analysis} />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600 px-1">
                <div className="flex items-center gap-2">
                  <Sparkles size={9} className="text-violet-500" />
                  <span>{result.model_used.split("/")[1] ?? result.model_used}</span>
                </div>
                <span>{new Date().toLocaleTimeString("id-ID")}</span>
              </div>
            </div>
          )}

          {/* ── Idle ──────────────────────────────────────────────────────── */}
          {!result && !loading && !error && (
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-5 py-6 text-center space-y-3">
              <div className="flex justify-center">
                <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 border border-violet-500/20">
                  <Sparkles size={18} className="text-violet-400" />
                </div>
              </div>
              <p className="text-sm font-mono text-zinc-400">Pilih model → klik <span className="text-violet-300 font-bold">Analyze</span></p>
              <p className="text-[10px] font-mono text-zinc-700">GEX · Vanna · Charm · DGCI · GBS · Expected Move · Expiry Buckets</p>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

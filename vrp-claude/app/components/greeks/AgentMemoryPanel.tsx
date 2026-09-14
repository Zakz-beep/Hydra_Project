"use client";

import { useState } from "react";
import { Brain, ChevronDown, ChevronUp, Trash2, Tag, Clock } from "lucide-react";
import { AgentMemory, clearMemory, MemoryCategory } from "../../lib/agentMemory";

interface Props {
  memory: AgentMemory;
  onMemoryChange: (mem: AgentMemory) => void;
}

const CATEGORY_CONFIG: Record<MemoryCategory, { label: string; color: string; bg: string }> = {
  preference: { label: "Preferensi", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  opinion:    { label: "Opini",      color: "text-sky-400",    bg: "bg-sky-500/10 border-sky-500/20" },
  plan:       { label: "Plan",       color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  context:    { label: "Konteks",   color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20" },
  observation:{ label: "Observasi", color: "text-zinc-400",   bg: "bg-zinc-500/10 border-zinc-700/40" },
};

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}h lalu`;
  if (hours > 0) return `${hours}j lalu`;
  if (minutes > 0) return `${minutes}m lalu`;
  return "baru saja";
}

export default function AgentMemoryPanel({ memory, onMemoryChange }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const factCount = memory.facts.length;
  const summaryCount = memory.recentSummaries.length;
  const totalCount = factCount + summaryCount;

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    onMemoryChange(clearMemory());
    setConfirmClear(false);
    setOpen(false);
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-all select-none ${
          totalCount > 0
            ? "bg-violet-500/10 border-violet-500/25 text-violet-300 hover:bg-violet-500/20"
            : "bg-zinc-800/40 border-zinc-700/40 text-zinc-500 hover:bg-zinc-800/60"
        }`}
      >
        <Brain size={11} className={totalCount > 0 ? "text-violet-400" : "text-zinc-600"} />
        <span>
          {totalCount > 0 ? `${totalCount} memories` : "No memory"}
        </span>
        {totalCount > 0 && (
          open ? <ChevronUp size={9} /> : <ChevronDown size={9} />
        )}
      </button>

      {/* Dropdown Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border border-white/[0.07] bg-zinc-950/90 backdrop-blur-2xl shadow-2xl shadow-black/40 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <Brain size={12} className="text-violet-400" />
              <span className="text-[11px] font-mono font-bold text-zinc-200">Agent Memory</span>
              <span className="text-[9px] font-mono text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded-full">
                {factCount} facts · {summaryCount} summaries
              </span>
            </div>
            <button
              onClick={handleClear}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-mono transition-all ${
                confirmClear
                  ? "bg-rose-500/30 border border-rose-500/40 text-rose-300 animate-pulse"
                  : "text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10"
              }`}
            >
              <Trash2 size={9} />
              {confirmClear ? "Yakin hapus?" : "Clear"}
            </button>
          </div>

          {/* Content */}
          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {/* Session Summaries */}
            {memory.recentSummaries.length > 0 && (
              <div className="px-3 py-2 border-b border-white/[0.04]">
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">Sesi Terakhir</p>
                <div className="space-y-1.5">
                  {memory.recentSummaries.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.04]">
                      <div className="shrink-0 mt-0.5">
                        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${
                          s.signal === "BULLISH" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                          s.signal === "BEARISH" ? "text-rose-400 bg-rose-500/10 border-rose-500/20" :
                          "text-amber-400 bg-amber-500/10 border-amber-500/20"
                        }`}>
                          {s.ticker}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-mono text-zinc-300 leading-relaxed line-clamp-2">{s.summary}</p>
                        <p className="text-[8px] font-mono text-zinc-600 mt-0.5">{s.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Facts */}
            {memory.facts.length > 0 && (
              <div className="px-3 py-2">
                <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider mb-1.5">Ingatan</p>
                <div className="space-y-1.5">
                  {memory.facts.map((fact) => {
                    const cfg = CATEGORY_CONFIG[fact.category];
                    return (
                      <div key={fact.id} className={`flex items-start gap-2 p-2 rounded-lg border ${cfg.bg}`}>
                        <Tag size={9} className={`${cfg.color} shrink-0 mt-1`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[8px] font-mono font-semibold ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            {fact.ticker && (
                              <span className="text-[8px] font-mono text-zinc-600 bg-zinc-800/60 px-1 rounded">
                                {fact.ticker}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-zinc-300 leading-relaxed">{fact.content}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Clock size={8} className="text-zinc-700" />
                            <span className="text-[8px] font-mono text-zinc-700">
                              {formatRelativeTime(fact.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {totalCount === 0 && (
              <div className="flex flex-col items-center justify-center py-6 text-center px-4">
                <Brain size={20} className="text-zinc-700 mb-2" />
                <p className="text-[10px] font-mono text-zinc-600">
                  Belum ada memory tersimpan.
                </p>
                <p className="text-[9px] font-mono text-zinc-700 mt-1">
                  Agent akan otomatis mengingat preferensi dan insights dari percakapan.
                </p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-white/[0.05] bg-white/[0.01]">
            <p className="text-[8px] font-mono text-zinc-700 text-center">
              Memory tersimpan di browser · Otomatis diingat di sesi berikutnya
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

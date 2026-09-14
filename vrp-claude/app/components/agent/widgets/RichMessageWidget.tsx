import React from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Sparkles, 
  Compass, 
  ArrowUpRight, 
  Clock, 
  Flame, 
  Gauge, 
  Activity 
} from 'lucide-react';

export interface MetricItem {
  label: string;
  value: string;
  change?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
}

export interface SuggestionItem {
  label: string;
  prompt: string;
}

export interface RichMessageWidgetProps {
  greeting?: string;
  time?: string;
  status?: string;
  metrics?: MetricItem[];
  question?: string;
  suggestions?: SuggestionItem[];
  onSelectSuggestion?: (prompt: string) => void;
}

export default function RichMessageWidget({
  greeting = "Yoooo Alvi! 👋",
  time,
  status,
  metrics = [],
  question,
  suggestions = [],
  onSelectSuggestion
}: RichMessageWidgetProps) {
  
  // Format current time if time prop is not provided
  const displayTime = time || new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="my-3 w-full max-w-2xl border border-white/[0.08] bg-zinc-950/70 backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 hover:border-violet-500/20 hover:shadow-violet-500/5">
      {/* Top bar with time and status indicators */}
      <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] font-mono font-bold tracking-widest text-emerald-400 uppercase">Live Quant Intelligence</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] font-mono">
          <Clock size={11} className="text-zinc-400" />
          <span>{displayTime}</span>
        </div>
      </div>

      {/* Main card body */}
      <div className="p-5 space-y-4">
        {/* Greeting Section */}
        {greeting && (
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 font-mono text-[11px] font-bold tracking-tight">
              AGENT DIRECTIVE
            </span>
            <h3 className="text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
              {greeting}
            </h3>
          </div>
        )}

        {/* Status Paragraph */}
        {status && (
          <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.01] text-zinc-300 font-sans text-xs leading-relaxed relative overflow-hidden group">
            {/* Subtle background glow */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-violet-600/10 to-indigo-600/5 rounded-full blur-xl opacity-50 pointer-events-none" />
            <p className="relative z-10">{status}</p>
          </div>
        )}

        {/* Real-time Metrics Grid */}
        {metrics && metrics.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {metrics.map((m, idx) => {
              const isBullish = m.sentiment === 'bullish';
              const isBearish = m.sentiment === 'bearish';
              const badgeBg = isBullish ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                              isBearish ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                                          'bg-zinc-500/10 border-zinc-500/20 text-zinc-400';
              const TrendIcon = isBullish ? TrendingUp : isBearish ? TrendingDown : Activity;

              return (
                <div 
                  key={idx} 
                  className="p-3 rounded-xl border border-white/[0.05] bg-zinc-900/40 hover:border-white/[0.09] transition-all hover:bg-zinc-900/60 flex flex-col justify-between space-y-2 group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold text-zinc-400 group-hover:text-zinc-300 transition-colors uppercase tracking-wider">{m.label}</span>
                    <TrendIcon size={12} className={isBullish ? 'text-emerald-400' : isBearish ? 'text-rose-400' : 'text-zinc-500'} />
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-sm font-mono font-bold text-white">{m.value}</span>
                    {m.change && (
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${badgeBg}`}>
                        {m.change}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Question Prompt */}
        {question && (
          <div className="flex gap-2.5 items-start bg-indigo-950/20 border border-indigo-500/10 rounded-xl p-3.5">
            <span className="text-lg shrink-0 mt-0.5 animate-bounce">🔥</span>
            <div className="space-y-1">
              <span className="text-[9px] font-mono font-bold text-indigo-400 uppercase tracking-widest block">Core Query</span>
              <p className="text-xs text-indigo-100 font-medium leading-relaxed">{question}</p>
            </div>
          </div>
        )}
      </div>

      {/* Suggested Actions Interactive Footer */}
      {suggestions && suggestions.length > 0 && (
        <div className="px-5 py-4 bg-white/[0.01] border-t border-white/[0.05] space-y-2.5">
          <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold tracking-widest text-zinc-500 uppercase">
            <Sparkles size={11} className="text-violet-400" />
            <span>Interactive Suggestions</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => onSelectSuggestion && onSelectSuggestion(s.prompt)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/[0.05] bg-zinc-900/60 hover:bg-violet-600/15 hover:border-violet-500/30 text-zinc-300 hover:text-white transition-all text-xs font-mono font-medium cursor-pointer shadow-md group"
              >
                <span>{s.label}</span>
                <ArrowUpRight size={11} className="text-zinc-500 group-hover:text-violet-400 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

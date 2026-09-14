"use client";

import { useState } from "react";
import {
  BarChart2, Activity, TrendingUp, Zap, DollarSign,
  Search, Globe, Brain, Check, X, Loader2, ChevronDown, ChevronUp,
  ShieldAlert,
} from "lucide-react";

export interface PendingTool {
  id: string;          // tool_call id from LLM
  callIndex: number;   // sequential index for visual numbering
  name: string;
  args: Record<string, unknown>;
  description: string;
  status: "pending" | "approved" | "denied" | "running" | "done" | "error";
  result?: unknown;
  errorMsg?: string;
}

interface ToolApprovalCardProps {
  tool: PendingTool;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

const TOOL_META: Record<string, { icon: any; color: string; bgColor: string; borderColor: string; label: string }> = {
  get_greeks:          { icon: BarChart2,  color: "text-violet-400",  bgColor: "bg-violet-500/10",  borderColor: "border-violet-500/30",  label: "Greeks Data" },
  get_greeks_by_expiry:{ icon: BarChart2,  color: "text-violet-400",  bgColor: "bg-violet-500/10",  borderColor: "border-violet-500/30",  label: "Greeks Expiry" },
  get_regime:          { icon: Activity,   color: "text-blue-400",    bgColor: "bg-blue-500/10",    borderColor: "border-blue-500/30",    label: "Market Regime" },
  get_vrp:             { icon: TrendingUp, color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30", label: "VRP Engine" },
  get_vol_forecast:    { icon: Zap,        color: "text-amber-400",   bgColor: "bg-amber-500/10",   borderColor: "border-amber-500/30",   label: "Vol Forecast" },
  execute_paper_trade: { icon: DollarSign, color: "text-rose-400",    bgColor: "bg-rose-500/10",    borderColor: "border-rose-500/30",    label: "Paper Trade" },
  web_search:          { icon: Search,     color: "text-sky-400",     bgColor: "bg-sky-500/10",     borderColor: "border-sky-500/30",     label: "Web Search" },
  fetch_webpage:       { icon: Globe,      color: "text-teal-400",    bgColor: "bg-teal-500/10",    borderColor: "border-teal-500/30",    label: "Read Webpage" },
  save_memory:         { icon: Brain,      color: "text-indigo-400",  bgColor: "bg-indigo-500/10",  borderColor: "border-indigo-500/30",  label: "Save Memory" },
};

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
}

export default function ToolApprovalCard({ tool, onApprove, onDeny }: ToolApprovalCardProps) {
  const [argsOpen, setArgsOpen] = useState(false);
  const meta = TOOL_META[tool.name] ?? {
    icon: Activity,
    color: "text-zinc-400",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/30",
    label: tool.name,
  };
  const Icon = meta.icon;

  const isPending   = tool.status === "pending";
  const isRunning   = tool.status === "running";
  const isDone      = tool.status === "done";
  const isDenied    = tool.status === "denied";
  const isError     = tool.status === "error";

  return (
    <div
      className={`
        relative rounded-xl border transition-all duration-300 overflow-hidden
        ${meta.bgColor} ${meta.borderColor}
        ${isPending ? "animate-[pulse_2s_ease-in-out_infinite]" : ""}
        ${isDone    ? "opacity-80 border-emerald-500/30 bg-emerald-500/5" : ""}
        ${isDenied  ? "opacity-50 border-zinc-700/30 bg-zinc-900/20" : ""}
        ${isError   ? "border-rose-500/30 bg-rose-500/5" : ""}
      `}
    >
      {/* Status bar at top */}
      <div className={`h-[2px] w-full ${
        isPending ? `${meta.bgColor} animate-pulse` :
        isRunning ? "bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 animate-pulse" :
        isDone    ? "bg-emerald-400" :
        isDenied  ? "bg-zinc-700" :
        isError   ? "bg-rose-400" : "bg-transparent"
      }`} />

      <div className="p-3 space-y-2">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Index badge */}
            <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-black/40 text-[8px] font-mono font-bold text-zinc-400 border border-white/[0.05]">
              {tool.callIndex + 1}
            </span>
            <div className={`shrink-0 p-1.5 rounded-lg border ${meta.bgColor} ${meta.borderColor}`}>
              <Icon size={10} className={meta.color} />
            </div>
            <div className="min-w-0">
              <span className={`text-[9px] font-mono font-bold uppercase tracking-wider ${meta.color}`}>
                {meta.label}
              </span>
              <p className="text-[8px] font-mono text-zinc-500 truncate">{tool.name}</p>
            </div>
          </div>

          {/* Status badge */}
          <div className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-mono font-bold border ${
            isPending ? `text-amber-400 bg-amber-500/10 border-amber-500/20` :
            isRunning ? `text-yellow-400 bg-yellow-500/10 border-yellow-500/20` :
            isDone    ? `text-emerald-400 bg-emerald-500/10 border-emerald-500/20` :
            isDenied  ? `text-zinc-500 bg-zinc-800/60 border-zinc-700/20` :
            isError   ? `text-rose-400 bg-rose-500/10 border-rose-500/20` :
                        `text-zinc-500 bg-zinc-800/30 border-zinc-700/20`
          }`}>
            {isRunning && <Loader2 size={8} className="animate-spin" />}
            {isDone && <Check size={8} />}
            {isDenied && <X size={8} />}
            {isError && <ShieldAlert size={8} />}
            <span>
              {isPending ? "AWAITING APPROVAL" :
               isRunning ? "EXECUTING..." :
               isDone    ? "EXECUTED" :
               isDenied  ? "DENIED" :
               isError   ? "ERROR" : "UNKNOWN"}
            </span>
          </div>
        </div>

        {/* Args preview toggle */}
        <button
          onClick={() => setArgsOpen(o => !o)}
          className="flex items-center gap-1.5 text-[8px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
        >
          {argsOpen ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          <span>Parameters {argsOpen ? "▲" : "▼"}</span>
        </button>

        {argsOpen && (
          <div className="rounded-lg bg-black/40 border border-white/[0.04] p-2">
            <pre className="text-[9px] font-mono text-zinc-300 whitespace-pre-wrap break-all leading-relaxed">
              {formatArgs(tool.args)}
            </pre>
          </div>
        )}

        {/* Error message */}
        {isError && tool.errorMsg && (
          <p className="text-[9px] font-mono text-rose-400 bg-rose-500/5 rounded p-1.5 border border-rose-500/10">
            {tool.errorMsg}
          </p>
        )}

        {/* Action buttons — only when pending */}
        {isPending && (
          <div className="flex gap-2 pt-0.5">
            <button
              onClick={() => onApprove(tool.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all text-[9px] font-mono font-bold cursor-pointer active:scale-95"
            >
              <Check size={10} />
              APPROVE & RUN
            </button>
            <button
              onClick={() => onDeny(tool.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all text-[9px] font-mono font-bold cursor-pointer active:scale-95"
            >
              <X size={10} />
              DENY
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  User, Cpu, Database, Brain, Play, HelpCircle, Activity,
  Zap, Settings, Eye, CheckCircle2, XCircle, AlertCircle,
  ChevronDown, ChevronUp, Sparkles, FileCode, Clock
} from "lucide-react";

// ─── Interfaces ──────────────────────────────────────────────────────────────
export interface LiveStepNode {
  id: string;
  type: "user_input" | "thought" | "tool_call" | "observation" | "final_answer";
  label: string;
  sub?: string;
  status: "pending" | "running" | "success" | "failed" | "denied";
  details?: string;
  timestamp: Date;
}

export type AgentStatus = "idle" | "thinking" | "waiting_approval" | "executing_tool" | "done" | "error";

interface SystemBlueprintProps {
  dagNodes?: LiveStepNode[];
  agentStatus?: AgentStatus;
  ticker?: string;
}

// ─── Constants & Configurations ──────────────────────────────────────────────
const NODE_TYPE_CONFIG: Record<
  LiveStepNode["type"],
  { icon: any; color: string; bg: string; border: string; glow: string }
> = {
  user_input: {
    icon: User,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    glow: "shadow-[0_0_15px_rgba(59,130,246,0.15)]",
  },
  thought: {
    icon: Cpu,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    glow: "shadow-[0_0_15px_rgba(139,92,246,0.15)]",
  },
  tool_call: {
    icon: Settings,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    glow: "shadow-[0_0_15px_rgba(245,158,11,0.15)]",
  },
  observation: {
    icon: Eye,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
    glow: "shadow-[0_0_15px_rgba(14,165,233,0.15)]",
  },
  final_answer: {
    icon: Sparkles,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    glow: "shadow-[0_0_15px_rgba(16,185,129,0.15)]",
  },
};

const STATUS_ICONS: Record<LiveStepNode["status"], { icon: any; color: string }> = {
  pending: { icon: Clock, color: "text-zinc-500" },
  running: { icon: Activity, color: "text-indigo-400 animate-pulse" },
  success: { icon: CheckCircle2, color: "text-emerald-400" },
  failed: { icon: XCircle, color: "text-rose-400" },
  denied: { icon: AlertCircle, color: "text-rose-400" },
};

// ─── BlueprintNode (Static Blueprint Node) ───────────────────────────────────
interface StaticNodeProps {
  icon: any;
  label: string;
  sub: string;
  status: "idle" | "active" | "success";
  isActive: boolean;
  color: string;
  onClick?: () => void;
}

function BlueprintNode({ icon: Icon, label, sub, status, isActive, color, onClick }: StaticNodeProps) {
  return (
    <div
      onClick={onClick}
      className={`group relative rounded-xl border p-3 flex items-center gap-3 backdrop-blur-md cursor-pointer transition-all duration-500 select-none
        ${isActive 
          ? "bg-zinc-900/90 shadow-2xl border-indigo-500/50 scale-[1.03]" 
          : "bg-zinc-950/40 hover:bg-zinc-900/50 border-white/[0.04] hover:border-white/[0.08]"
        }`}
      style={{
        boxShadow: isActive ? `0 0 25px rgba(99, 102, 241, 0.15)` : "none"
      }}
    >
      <div className="absolute top-2 right-2 flex h-2 w-2">
        {status === "active" && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${
          status === "active" ? "bg-indigo-500" : status === "success" ? "bg-emerald-500" : "bg-zinc-700"
        }`} />
      </div>

      <div className={`p-2.5 rounded-lg border transition-all duration-500
        ${isActive 
          ? `bg-indigo-500/10 border-indigo-500/30 text-${color}-400` 
          : "bg-white/[0.03] border-white/[0.06] text-zinc-500 group-hover:text-zinc-300"
        }`}
      >
        <Icon size={16} className={isActive ? "text-indigo-400 animate-pulse" : "text-zinc-400"} />
      </div>

      <div className="flex-1 min-w-0">
        <h5 className="text-[11px] font-mono font-bold text-zinc-200 tracking-tight leading-none group-hover:text-white transition-colors">{label}</h5>
        <span className="text-[9px] font-mono text-zinc-500 mt-1 block leading-tight">{sub}</span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function SystemBlueprint({ dagNodes = [], agentStatus = "idle", ticker = "SPY" }: SystemBlueprintProps) {
  // Static flowchart cycle state
  const [activeStep, setActiveStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  // Live DAG expanded nodes tracker
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // Auto cycling static flow animation
  useEffect(() => {
    if (!isPlaying || dagNodes.length > 0) return;
    const interval = setInterval(() => {
      setActiveStep(curr => (curr + 1) % 5);
    }, 3000);
    return () => clearInterval(interval);
  }, [isPlaying, dagNodes.length]);

  const toggleNodeExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const staticSteps = [
    { label: "USER INGESTION", sub: "User inputs prompt or mentions tools", icon: User, color: "indigo" },
    { label: "LLM REASONER", sub: "Decomposes intent & designs thought chain", icon: Cpu, color: "violet" },
    { label: "TOOLS SUITE", sub: "Retrieves Greeks, VRP forecasts or trades", icon: Activity, color: "amber" },
    { label: "SQLITE DATABASE", sub: "Stores logs, snapshots, & parameters", icon: Database, color: "emerald" },
    { label: "MEMORY VAULT", sub: "Syncs facts & plans to local storage", icon: Brain, color: "rose" },
  ];

  // Helper to safely format details block (JSON payload or raw text)
  const renderDetails = (details?: string) => {
    if (!details) return null;
    try {
      // If it is JSON-like string, pretty format it
      if ((details.startsWith("{") && details.endsWith("}")) || (details.startsWith("[") && details.endsWith("]"))) {
        const parsed = JSON.parse(details);
        return JSON.stringify(parsed, null, 2);
      }
      return details;
    } catch {
      return details;
    }
  };

  const getStatusBadge = () => {
    switch (agentStatus) {
      case "thinking":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[8px] font-mono font-bold tracking-wider">THINKING</span>
          </div>
        );
      case "waiting_approval":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            <span className="text-[8px] font-mono font-bold tracking-wider">WAITING APPROVAL</span>
          </div>
        );
      case "executing_tool":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
            <Settings size={8} className="animate-spin text-indigo-400" />
            <span className="text-[8px] font-mono font-bold tracking-wider">RUNNING TOOL</span>
          </div>
        );
      case "done":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[8px] font-mono font-bold tracking-wider">RESOLVED</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-400 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span className="text-[8px] font-mono font-bold tracking-wider">ERROR</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <span className="text-[8px] font-mono font-bold tracking-wider">IDLE</span>
          </div>
        );
    }
  };

  // ─── RENDER LIVE REACT DAG ─────────────────────────────────────────────────
  if (dagNodes && dagNodes.length > 0) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/30 backdrop-blur-xl p-4 relative overflow-hidden flex flex-col h-full justify-between">
        
        {/* Inject Premium Dash Dash Animation CSS safely */}
        <style>{`
          @keyframes flow-dash {
            to {
              stroke-dashoffset: -20;
            }
          }
          .animate-flow-dash {
            stroke-dasharray: 6, 4;
            animation: flow-dash 1.2s linear infinite;
          }
        `}</style>

        <div className="absolute -top-16 -right-16 w-36 h-36 bg-indigo-600/5 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-violet-600/5 rounded-full blur-2xl pointer-events-none" />

        {/* Dynamic DAG Header */}
        <div className="relative z-10 flex items-center justify-between pb-3 border-b border-white/[0.04] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base leading-none animate-pulse">🧠</span>
            <div>
              <h4 className="text-[11px] font-mono text-white font-bold tracking-wider uppercase">Live ReAct Trace</h4>
              <p className="text-[8px] font-mono text-zinc-500 uppercase mt-0.5">Active Cognition Pathway for {ticker}</p>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Live Scrollable DAG List */}
        <div className="relative z-10 flex-1 overflow-y-auto my-3 pr-1 space-y-0.5 custom-scrollbar min-h-[420px]">
          {dagNodes.map((node, i) => {
            const cfg = NODE_TYPE_CONFIG[node.type] ?? NODE_TYPE_CONFIG.thought;
            const Icon = cfg.icon;
            const statusCfg = STATUS_ICONS[node.status] ?? STATUS_ICONS.pending;
            const StatusIcon = statusCfg.icon;
            const isExpanded = expandedNodes.has(node.id);

            return (
              <div key={node.id} className="relative flex flex-col items-stretch">
                
                {/* Flow dash connector line linking steps */}
                {i > 0 && (
                  <div className="relative h-6 left-7 w-[2px]">
                    <svg className="absolute top-[-4px] left-[-4px] w-[10px] h-[32px] overflow-visible">
                      <line
                        x1="5" y1="0" x2="5" y2="30"
                        stroke="#4f46e5"
                        strokeWidth="1.5"
                        className={node.status === "running" ? "animate-flow-dash opacity-100" : "opacity-30"}
                      />
                    </svg>
                  </div>
                )}

                {/* Node Card */}
                <div
                  className={`group relative rounded-xl border p-2.5 flex flex-col gap-2 backdrop-blur-md transition-all duration-300 select-none border-white/[0.03] hover:border-white/[0.08] ${cfg.bg} ${cfg.glow}`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    
                    {/* Icon + Label Group */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`p-1.5 rounded-lg border bg-black/40 border-white/[0.04] ${cfg.color}`}>
                        <Icon size={12} className={node.status === "running" ? "animate-pulse" : ""} />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest leading-none">{node.type.replace("_", " ")}</span>
                        <h5 className="text-[10px] font-mono font-bold text-zinc-200 tracking-tight leading-normal mt-0.5 truncate">{node.label}</h5>
                      </div>
                    </div>

                    {/* Status Pill & Expand Trigger */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[8.5px] font-mono font-semibold ${statusCfg.color} bg-black/35 px-1.5 py-0.5 rounded-md border border-white/[0.03] flex items-center gap-1`}>
                        <StatusIcon size={9} />
                        <span>{node.status}</span>
                      </span>
                      {node.details && (
                        <button
                          onClick={() => toggleNodeExpansion(node.id)}
                          className="p-1 rounded bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                          title="Toggle data panel"
                        >
                          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dynamic expanded payload panel */}
                  {node.details && isExpanded && (
                    <div className="mt-1 border-t border-white/[0.04] pt-2 animate-fadeIn">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[7.5px] font-mono text-zinc-500 flex items-center gap-1">
                          <FileCode size={9} />
                          <span>PAYLOAD METADATA</span>
                        </span>
                        <span className="text-[7px] font-mono text-zinc-600">
                          {node.timestamp.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      </div>
                      <pre className="w-full overflow-x-auto bg-black/50 border border-white/[0.03] rounded-lg p-2 font-mono text-[9px] text-indigo-300 leading-normal custom-scrollbar max-h-36 whitespace-pre-wrap select-text">
                        {renderDetails(node.details)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live DAG Footer stats */}
        <div className="relative z-10 p-2 border-t border-white/[0.04] bg-white/[0.005] mt-1 shrink-0 flex items-center justify-between text-[8px] font-mono text-zinc-500">
          <div className="flex items-center gap-1">
            <Activity size={10} className="text-zinc-600 animate-pulse" />
            <span>STEPS STACK: {dagNodes.length} NODES</span>
          </div>
          <span>PERSISTENT CORE REASONING TRACE</span>
        </div>
      </div>
    );
  }

  // ─── RENDER STATIC BACKUP BLUEPRINT ────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/30 backdrop-blur-xl p-4 relative overflow-hidden flex flex-col h-full justify-between">
      <div className="absolute -top-12 -left-12 w-48 h-48 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Panel */}
      <div className="relative z-10 flex items-center justify-between pb-3 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">🔮</span>
          <div>
            <h4 className="text-[11px] font-mono text-white font-bold tracking-wider uppercase">Cognitive Blueprint</h4>
            <p className="text-[8px] font-mono text-zinc-500 uppercase mt-0.5">Real-time architecture schema visualizer</p>
          </div>
        </div>

        {/* Flow Controller Toggle */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-mono border transition-all select-none cursor-pointer
            ${isPlaying 
              ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400" 
              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
        >
          <Play size={8} className={isPlaying ? "animate-spin text-indigo-400" : ""} />
          <span>{isPlaying ? "FLOW ACTIVE" : "FLOW PAUSED"}</span>
        </button>
      </div>

      {/* Static Flow schematic cards */}
      <div className="relative z-10 my-4 flex-1 flex flex-col justify-center gap-4 py-2 overflow-y-auto custom-scrollbar">
        {staticSteps.map((st, i) => {
          const isActive = activeStep === i;
          return (
            <div key={st.label} className="relative flex flex-col items-stretch">
              
              {/* Vertical link connector */}
              {i > 0 && (
                <div className="absolute -top-4 left-7 h-4 w-[2px] bg-zinc-800">
                  {activeStep === i && isPlaying && (
                    <span className="absolute left-[-1.5px] top-0 w-[5px] h-[5px] bg-indigo-400 rounded-full animate-bounce" 
                          style={{ boxShadow: "0 0 8px #818cf8" }} />
                  )}
                </div>
              )}

              <BlueprintNode
                icon={st.icon}
                label={st.label}
                sub={st.sub}
                isActive={isActive}
                status={isActive ? "active" : activeStep > i ? "success" : "idle"}
                color={st.color}
                onClick={() => { setActiveStep(i); setIsPlaying(false); }}
              />
            </div>
          );
        })}
      </div>

      {/* Static Footer blueprint info */}
      <div className="relative z-10 p-2.5 rounded-xl border border-white/[0.04] bg-white/[0.01] shrink-0">
        <div className="flex gap-2 items-start">
          <HelpCircle size={12} className="text-zinc-600 shrink-0 mt-0.5" />
          <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
            <strong className="text-zinc-400">Cara Kerja:</strong> Ketika Anda bertanya, agen mendekomposisi instruksi melalui <span className="text-indigo-400">LLM REASONER</span>, memilih <span className="text-amber-400">TOOLS</span> yang sesuai, mencatat log ke <span className="text-emerald-400">DATABASE</span>, dan menyimpan memori ke <span className="text-rose-400">MEMORY VAULT</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

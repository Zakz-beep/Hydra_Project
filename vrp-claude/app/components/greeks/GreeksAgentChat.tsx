"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, User, Zap, RefreshCw, Trash2, ChevronDown,
  TrendingUp, BarChart2, Activity, DollarSign, AlertCircle,
  Sparkles, GitGraph, Search, Globe, Square, Settings,
} from "lucide-react";
import AgentDecisionTree from "./AgentDecisionTree";
import AgentMemoryPanel from "./AgentMemoryPanel";
import PersonaSelector from "./PersonaSelector";
import { extractDecisionTree, DecisionTree } from "../../lib/decisionTree";
import {
  loadMemory,
  saveMemory,
  applyAgentMemoryUpdate,
  formatMemoryForPrompt,
  AgentMemory,
  MemoryCategory,
} from "../../lib/agentMemory";
import {
  PERSONAS, PersonaId, TOOL_MENTIONS, ToolMention,
} from "../../lib/personas";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  timestamp: Date;
}

interface Props {
  ticker: string;
  model?: string;
}

// ─── Quick action chips ───────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: TrendingUp,  label: "Analisis posisi sekarang",        color: "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10" },
  { icon: BarChart2,   label: "Cek regime & VRP",               color: "text-blue-400 border-blue-500/30 hover:bg-blue-500/10" },
  { icon: Activity,    label: "Forecast volatilitas 5 hari",     color: "text-violet-400 border-violet-500/30 hover:bg-violet-500/10" },
  { icon: DollarSign,  label: "Berikan trade setup spesifik",    color: "text-amber-400 border-amber-500/30 hover:bg-amber-500/10" },
];

// ─── Tool call indicator ──────────────────────────────────────────────────────
const TOOL_ICONS: Record<string, { icon: typeof BarChart2; color: string; label: string }> = {
  get_greeks:          { icon: BarChart2,  color: "text-violet-400", label: "Fetching Greeks" },
  get_greeks_by_expiry:{ icon: BarChart2,  color: "text-violet-400", label: "Greeks Breakdown" },
  get_regime:          { icon: Activity,   color: "text-blue-400",   label: "Checking Regime" },
  get_vrp:             { icon: TrendingUp, color: "text-emerald-400",label: "Fetching VRP" },
  get_vol_forecast:    { icon: Zap,        color: "text-amber-400",  label: "Vol Forecast" },
  execute_paper_trade: { icon: DollarSign, color: "text-rose-400",    label: "Executing Trade" },
  web_search:          { icon: Search,     color: "text-sky-400",    label: "Searching Web" },
  fetch_webpage:       { icon: Globe,      color: "text-teal-400",   label: "Reading Webpage" },
};

function ToolCallBubble({ toolName, onDelete, id }: { toolName: string; onDelete?: () => void; id?: string }) {
  const info = TOOL_ICONS[toolName] ?? { icon: Zap, color: "text-zinc-400", label: toolName };
  const Icon = info.icon;
  return (
    <div className="flex items-center gap-2 group relative w-fit my-1">
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-700/40">
        <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: info.color.replace("text-", "") }} />
        <Icon size={11} className={info.color} />
        <span className={`text-[10px] font-mono ${info.color}`}>{info.label}...</span>
      </div>
      {onDelete && id && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 rounded-lg bg-zinc-900/60 hover:bg-rose-500/20 border border-zinc-800 hover:border-rose-500/30 text-zinc-500 hover:text-rose-400 backdrop-blur-sm shrink-0"
          title="Hapus status tool"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ─── Message renderer ─────────────────────────────────────────────────────────
function MessageBubble({ message, onDelete }: { message: Message; onDelete: (id: string) => void }) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool) {
    return <ToolCallBubble toolName={message.toolName ?? "tool"} onDelete={() => onDelete(message.id)} id={message.id} />;
  }

  return (
    <div className={`flex gap-3 group relative items-start ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-xl shrink-0 flex items-center justify-center mt-0.5 ${isUser ? "bg-violet-600/30 border border-violet-500/40" : "bg-zinc-800 border border-zinc-700/60"}`}>
        {isUser ? <User size={12} className="text-violet-300" /> : <Bot size={12} className="text-zinc-300" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-[12px] font-mono leading-relaxed ${
        isUser
          ? "bg-violet-600/25 border border-violet-500/30 text-violet-100 rounded-tr-sm"
          : "bg-zinc-900/70 border border-zinc-700/50 text-zinc-200 rounded-tl-sm"
      }`}>
        {message.isStreaming ? (
          <div>
            <span className="whitespace-pre-wrap">{message.content}</span>
            <span className="inline-block w-1.5 h-4 bg-violet-400 ml-0.5 animate-pulse rounded-sm" />
          </div>
        ) : (
          <MarkdownText text={message.content} />
        )}
        <div className={`text-[9px] mt-1.5 ${isUser ? "text-violet-400/50 text-right" : "text-zinc-600"}`}>
          {message.timestamp.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </div>
      </div>

      {/* Delete Button */}
      {!message.isStreaming && (
        <div className={`flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0 ${isUser ? "mr-1" : "ml-1"}`}>
          <button
            onClick={() => onDelete(message.id)}
            className="p-1 rounded-lg bg-zinc-900/60 hover:bg-rose-500/20 border border-zinc-800 hover:border-rose-500/30 text-zinc-500 hover:text-rose-400 transition-all duration-150 shadow-md backdrop-blur-sm"
            title="Hapus pesan"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Table Rendering Interfaces & Helpers ─────────────────────────────────────
interface TableBlock {
  type: "table";
  headers: string[];
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
}

interface TextBlock {
  type: "text";
  content: string;
}

type ContentBlock = TableBlock | TextBlock;

function parseContent(text: string): ContentBlock[] {
  const lines = text.split("\n");
  const blocks: ContentBlock[] = [];
  let currentTable: { headers: string[]; alignments: ("left" | "center" | "right")[]; rows: string[][] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("|") && line.endsWith("|")) {
      // Split cells and clean up spaces
      const cells = line
        .split("|")
        .map(c => c.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (!currentTable) {
        // Table Header
        currentTable = {
          headers: cells,
          alignments: [],
          rows: [],
        };
      } else if (
        currentTable.alignments.length === 0 &&
        cells.every(c => c.startsWith(":") || c.endsWith(":") || c.startsWith("-"))
      ) {
        // Table alignment separator row
        currentTable.alignments = cells.map(c => {
          const left = c.startsWith(":");
          const right = c.endsWith(":");
          if (left && right) return "center";
          if (right) return "right";
          return "left";
        });
      } else {
        // Table Data Row
        const paddedCells = [...cells];
        while (paddedCells.length < currentTable.headers.length) {
          paddedCells.push("");
        }
        currentTable.rows.push(paddedCells.slice(0, currentTable.headers.length));
      }
    } else {
      // Not a table line
      if (currentTable) {
        blocks.push({
          type: "table",
          headers: currentTable.headers,
          alignments: currentTable.alignments.length > 0 ? currentTable.alignments : currentTable.headers.map(() => "left"),
          rows: currentTable.rows,
        });
        currentTable = null;
      }
      blocks.push({ type: "text", content: lines[i] });
    }
  }

  if (currentTable) {
    blocks.push({
      type: "table",
      headers: currentTable.headers,
      alignments: currentTable.alignments.length > 0 ? currentTable.alignments : currentTable.headers.map(() => "left"),
      rows: currentTable.rows,
    });
  }

  return blocks;
}

function renderTableCell(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return <span className="text-zinc-600 font-mono">—</span>;

  const renderInlineBold = (str: string) => {
    if (!str.includes("**")) return str;
    const parts = str.split(/\*\*(.*?)\*\*/g);
    return parts.map((p, j) => 
      j % 2 === 1 ? <strong key={j} className="text-white font-bold">{p}</strong> : p
    );
  };

  const upper = trimmed.toUpperCase();

  // High Impact / Alert (FOMC, G7, high impact warnings, red markers)
  if (
    trimmed.includes("🔴") ||
    trimmed.includes("🔥") ||
    upper.includes("HIGH IMPACT") ||
    (upper.includes("HIGH") && trimmed.includes("🔥")) ||
    trimmed.includes("❗❗")
  ) {
    return (
      <span className="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-rose-500/10 border border-rose-500/30 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.15)] select-none">
        <span className="flex h-1.5 w-1.5 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
        </span>
        <span>{renderInlineBold(trimmed)}</span>
      </span>
    );
  }

  // Beat / Success (positive data release)
  if (trimmed.includes("✅") || upper.includes("BEAT") || upper.includes("UDAH RILIS")) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)] select-none">
        <span>{renderInlineBold(trimmed)}</span>
      </span>
    );
  }

  // Miss / Warning (negative data release / potential risks)
  if (
    trimmed.includes("❗") ||
    trimmed.includes("⚠️") ||
    upper.includes("MISS") ||
    upper.includes("WARNING") ||
    trimmed.includes("❌")
  ) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold font-mono bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.1)] select-none">
        <span>{renderInlineBold(trimmed)}</span>
      </span>
    );
  }

  // Speaks / Info / Neutral
  if (upper.includes("SPEAKS") || upper.includes("SPEECH") || upper.includes("MEETINGS") || upper.includes("MINUTES")) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold font-mono bg-sky-500/10 border border-sky-500/20 text-sky-300 select-none">
        💬 <span>{renderInlineBold(trimmed)}</span>
      </span>
    );
  }

  // Simple clean cells
  return <span className="text-zinc-200 font-mono text-[11px] font-medium tracking-tight whitespace-pre-wrap">{renderInlineBold(trimmed)}</span>;
}

function GlassmorphicTable({ block }: { block: TableBlock }) {
  return (
    <div className="my-3 w-full overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-950/20 backdrop-blur-xl shadow-2xl">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/[0.07] bg-white/[0.03]">
              {block.headers.map((h, i) => (
                <th
                  key={i}
                  className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400 font-mono border-r border-white/[0.04] last:border-r-0 select-none ${
                    block.alignments[i] === "center"
                      ? "text-center"
                      : block.alignments[i] === "right"
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-white/[0.02] transition-colors odd:bg-white/[0.005]">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-4 py-2.5 text-[11px] align-middle border-r border-white/[0.04] last:border-r-0 ${
                      block.alignments[cellIndex] === "center"
                        ? "text-center"
                        : block.alignments[cellIndex] === "right"
                        ? "text-right"
                        : "text-left"
                    }`}
                  >
                    {renderTableCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Simple markdown renderer ─────────────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const renderInline = (str: string) => {
    if (!str.includes("**")) return str;
    const parts = str.split(/\*\*(.*?)\*\*/g);
    return parts.map((p, j) => 
      j % 2 === 1 ? <strong key={j} className="text-white font-bold">{p}</strong> : p
    );
  };

  const blocks = parseContent(text);

  return (
    <div className="space-y-1">
      {blocks.map((block, i) => {
        if (block.type === "table") {
          return <GlassmorphicTable key={i} block={block} />;
        }

        const line = block.content;

        if (line.startsWith("## ")) return <h2 key={i} className="font-bold text-white text-xs mt-4 mb-1.5 border-b border-zinc-700/50 pb-1">{renderInline(line.slice(3))}</h2>;
        if (line.startsWith("### ")) return <h3 key={i} className="font-semibold text-violet-300 text-[12px] mt-3 mb-1.5">› {renderInline(line.slice(4))}</h3>;
        
        if (line.startsWith("[SIGNAL:") && line.includes("CONFIDENCE:")) {
          const match = line.match(/\[SIGNAL:\s*([^|]+)\s*\|\s*CONFIDENCE:\s*([^\]]+)\]/i);
          if (match) {
            const signal = match[1].trim().toUpperCase();
            const confidence = match[2].trim().toUpperCase();
            
            let sigColor = "text-zinc-400 bg-zinc-800 border-zinc-700";
            if (signal === "BULLISH") sigColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
            else if (signal === "BEARISH") sigColor = "text-rose-400 bg-rose-500/10 border-rose-500/30";
            else if (signal === "NEUTRAL") sigColor = "text-amber-400 bg-amber-500/10 border-amber-500/30";

            let confColor = "text-zinc-400";
            if (confidence === "HIGH") confColor = "text-emerald-400";
            else if (confidence === "LOW") confColor = "text-rose-400";

            return (
              <div key={i} className="flex flex-col gap-2 p-3 my-3 rounded-xl bg-zinc-900/50 border border-zinc-700/50 backdrop-blur-sm shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Kesimpulan Eksekutif</span>
                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${sigColor}`}>
                    {signal}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400">Confidence:</span>
                  <span className={`text-[11px] font-mono font-bold ${confColor}`}>{confidence}</span>
                </div>
              </div>
            );
          }
        }

        if (line.startsWith("- ") || line.startsWith("• ")) return <div key={i} className="flex gap-2 items-start mb-1"><span className="text-violet-400 mt-[3px] shrink-0 text-[10px]">▸</span><div className="text-[11px] text-zinc-300 leading-relaxed">{renderInline(line.replace(/^[-•] /, ""))}</div></div>;
        if (line.trim() === "---") return <hr key={i} className="border-zinc-700/40 my-3" />;
        if (line.trim() === "") return <div key={i} className="h-1.5" />;
        return <p key={i} className="text-[11px] text-zinc-300 leading-relaxed mb-1">{renderInline(line)}</p>;
      })}
    </div>
  );
}

// Helper to generate a random ID, safe in both secure and insecure contexts (HTTP/HTTPS)
const generateId = () => {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
};

// ─── Main Component ────────────────────────────────────────────────────────────
export default function GreeksAgentChat({ ticker, model }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationState, setConversationState] = useState<unknown>(null);
  const [decisionTree, setDecisionTree] = useState<DecisionTree | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(model ?? "meta-llama/llama-3.3-70b-instruct");
  const [availableModels, setAvailableModels] = useState<any[]>([
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", tier: "FREE" },
    { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", tier: "FAST" },
    { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", tier: "SMART" },
    { id: "openai/gpt-4o", name: "GPT-4o", tier: "BEST" },
    { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", tier: "ECON" },
  ]);
  const [modelSearch, setModelSearch] = useState("");
  const [memory, setMemory] = useState<AgentMemory>(() => loadMemory());

  // ── Persona state (persisted to localStorage) ─────────────────────────────
  const [personaId, setPersonaId] = useState<PersonaId>(() => {
    if (typeof window === "undefined") return "default";
    return (localStorage.getItem("vrp_agent_persona") as PersonaId) ?? "default";
  });
  const persona = PERSONAS[personaId];

  const handlePersonaChange = (id: PersonaId) => {
    setPersonaId(id);
    if (typeof window !== "undefined") localStorage.setItem("vrp_agent_persona", id);
  };

  // ── Active tools state (persisted to localStorage) ────────────────────────
  // Empty array = all tools active
  const [activeTools, setActiveTools] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("vrp_agent_active_tools");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [toolPanelOpen, setToolPanelOpen] = useState(false);

  const handleToolToggle = (toolNames: string[]) => {
    setActiveTools(prev => {
      let next: string[];
      if (toolNames.length === 0) {
        // @all — clear all restrictions
        next = [];
      } else {
        const allActive = toolNames.every(t => prev.includes(t));
        if (allActive) {
          next = prev.filter(t => !toolNames.includes(t));
        } else {
          next = [...prev, ...toolNames].filter((t, i, arr) => arr.indexOf(t) === i);
        }
      }
      if (typeof window !== "undefined") localStorage.setItem("vrp_agent_active_tools", JSON.stringify(next));
      return next;
    });
  };

  // ── @ mention state ────────────────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = popup hidden
  const [mentionIndex, setMentionIndex] = useState(0);

  const filteredMentions = mentionQuery !== null
    ? TOOL_MENTIONS.filter(m =>
        m.mention.includes(mentionQuery.toLowerCase()) ||
        m.label.toLowerCase().includes(mentionQuery.toLowerCase())
      )
    : [];

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolPanelRef = useRef<HTMLDivElement>(null);

  // Close tool panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolPanelRef.current && !toolPanelRef.current.contains(e.target as Node)) {
        setToolPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    fetch("/api/models")
      .then(res => res.json())
      .then(data => {
        if (data.models && data.models.length > 0) {
          setAvailableModels(data.models);
        }
      })
      .catch(err => console.error("Failed to fetch models", err));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading) return;
    setInput("");
    setMentionQuery(null);

    // ── Parse @mentions from message ─────────────────────────────────────────
    // Extract all @tool mentions from the text, resolve to tool names
    const mentionPattern = /@(\w+)/g;
    const mentionedKeys = new Set<string>();
    let match;
    while ((match = mentionPattern.exec(content)) !== null) {
      const key = "@" + match[1].toLowerCase();
      const found = TOOL_MENTIONS.find(m => m.mention === key);
      if (found) {
        if (found.tools.length === 0) {
          // @all — clear restriction
          mentionedKeys.clear();
          break;
        }
        found.tools.forEach(t => mentionedKeys.add(t));
      }
    }
    // Strip @mention tokens from the display message
    const cleanContent = content.replace(/@(greeks|vrp|regime|vol|trade|web|all)\b/gi, "").replace(/\s{2,}/g, " ").trim();
    // Per-message tool override: if @mentions present, use them; else fall back to global activeTools
    const perMessageTools = mentionedKeys.size > 0
      ? Array.from(mentionedKeys)
      : (activeTools.length > 0 ? activeTools : undefined);

    const userMsg: Message = { id: generateId(), role: "user", content: content.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Add streaming assistant placeholder
    const assistantId = generateId();
    setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "", isStreaming: true, timestamp: new Date() }]);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          message: cleanContent || content.trim(),
          model: selectedModel,
          ticker,
          conversationState,
          memoryContext: formatMemoryForPrompt(memory),
          personaId,
          activeTools: perMessageTools,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;

          try {
            const parsed = JSON.parse(raw) as { type: string; content?: string; state?: unknown; error?: string; memoryUpdates?: Array<{ category: string; content: string; ticker?: string }> };
            if (parsed.type === "delta" && parsed.content) {
              accumulated += parsed.content;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: accumulated } : m
              ));
            } else if (parsed.type === "done") {
              if (parsed.state) setConversationState(parsed.state);
              // Parse decision tree from accumulated response
              const tree = extractDecisionTree(accumulated);
              if (tree) setDecisionTree(tree);
              // Apply any memory updates the agent requested
              if (parsed.memoryUpdates && parsed.memoryUpdates.length > 0) {
                setMemory(prev => {
                  let updated = prev;
                  for (const upd of parsed.memoryUpdates!) {
                    updated = applyAgentMemoryUpdate(updated, upd as { category: MemoryCategory; content: string; ticker?: string });
                  }
                  saveMemory(updated);
                  return updated;
                });
              }
            } else if (parsed.type === "error") {
              accumulated += `\n\n⚠️ Error: ${parsed.error}`;
            }
          } catch { /* skip invalid JSON */ }
        }
      }

      // Mark done
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, isStreaming: false, content: accumulated || "(tidak ada respons)" } : m
      ));

      // Fallback: parse decision tree from full accumulated text
      const fullTree = extractDecisionTree(accumulated);
      if (fullTree) setDecisionTree(fullTree);
    } catch (e: any) {
      if (e.name === "AbortError") {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, isStreaming: false, content: m.content + "\n\n*(Generation stopped by user)*" }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, isStreaming: false, content: `⚠️ Error: ${e instanceof Error ? e.message : "Gagal terhubung ke Agent"}` }
            : m
        ));
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [loading, selectedModel, ticker, conversationState, memory, personaId, activeTools]);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // Handle textarea change with @ mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Detect @ position
    const cursor = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursor);
    const atIdx = textBeforeCursor.lastIndexOf("@");
    if (atIdx !== -1 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]))) {
      const query = textBeforeCursor.slice(atIdx + 1);
      if (!query.includes(" ")) {
        setMentionQuery(query);
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  };

  const insertMention = (mention: ToolMention) => {
    const cursor = textareaRef.current?.selectionStart ?? input.length;
    const textBefore = input.slice(0, cursor);
    const textAfter = input.slice(cursor);
    const atIdx = textBefore.lastIndexOf("@");
    const newText = textBefore.slice(0, atIdx) + mention.mention + " " + textAfter;
    setInput(newText);
    setMentionQuery(null);
    // Focus back
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = atIdx + mention.mention.length + 1;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate mention popup
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => (i + 1) % filteredMentions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentions[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const clearChat = () => { setMessages([]); setConversationState(null); setDecisionTree(null); setShowTree(false); };

  const deleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  return (
    <div className="relative rounded-2xl overflow-hidden flex flex-col" style={{ height: "600px" }}>
      {/* Glass background — persona-tinted */}
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-zinc-900/80" />
      <div className="absolute inset-0 backdrop-blur-xl" />
      <div className={`absolute inset-0 border rounded-2xl pointer-events-none transition-colors ${persona.borderClass} opacity-30`} />
      <div className="absolute inset-0 border border-white/[0.04] rounded-2xl pointer-events-none" />
      <div className="absolute -top-24 -right-16 w-72 h-72 bg-indigo-600/8 rounded-full blur-3xl pointer-events-none" />

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="relative z-50 flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-xl bg-gradient-to-br border ${persona.accentGradient} ${persona.borderClass}`}>
            <span className="text-base leading-none">{persona.emoji}</span>
          </div>
          <div>
            <h3 className={`text-sm font-bold ${persona.colorClass}`}>{persona.name}</h3>
            <p className="text-[10px] font-mono text-zinc-500">{persona.tagline}</p>
          </div>
          <div className="flex items-center gap-1 ml-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[9px] font-mono text-emerald-400">LIVE</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Persona Selector */}
          <PersonaSelector currentPersona={personaId} onChange={handlePersonaChange} />
          {/* Memory Panel */}
          <AgentMemoryPanel
            memory={memory}
            onMemoryChange={(mem) => { setMemory(mem); saveMemory(mem); }}
          />
          {/* Model picker */}
          <div className="relative">
            <button
              onClick={() => setModelOpen(o => !o)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-all"
            >
              <Sparkles size={9} className="text-violet-400" />
              <span className="max-w-[100px] truncate">{selectedModel.split("/")[1] ?? selectedModel}</span>
              <ChevronDown size={9} className={`transition-transform ${modelOpen ? "rotate-180" : ""}`} />
            </button>
            {modelOpen && (
              <div className="absolute right-0 top-full mt-1 w-72 flex flex-col max-h-80 rounded-xl bg-zinc-950/95 backdrop-blur-2xl border border-white/[0.08] shadow-2xl z-50 overflow-hidden">
                <div className="p-2 border-b border-white/[0.08] shrink-0">
                  <input 
                    type="text" 
                    placeholder="Search models..." 
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="w-full bg-white/[0.05] border border-white/[0.05] rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500/50"
                  />
                </div>
                <div className="overflow-y-auto flex-1 custom-scrollbar">
                  {availableModels
                    .filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase()))
                    .map((m) => (
                      <button key={m.id} onClick={() => { setSelectedModel(m.id); setModelOpen(false); setModelSearch(""); }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono hover:bg-white/[0.05] transition-colors ${selectedModel === m.id ? "text-violet-300 bg-violet-500/10" : "text-zinc-400"}`}>
                        <span className="truncate max-w-[180px] text-left">{m.name}</span>
                        <span className="text-[9px] text-zinc-600 shrink-0 ml-2">{m.tier}</span>
                      </button>
                  ))}
                  {availableModels.filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase())).length === 0 && (
                    <div className="px-3 py-4 text-center text-[10px] font-mono text-zinc-500">No models found</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Decision Tree toggle + Clear button */}
          <div className="flex items-center gap-1.5">
            {decisionTree && (
              <button
                onClick={() => setShowTree(s => !s)}
                className={`p-1.5 rounded-lg transition-colors ${showTree ? "text-violet-300 bg-violet-500/15" : "text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.06]"}`}
                title={showTree ? "Show text response" : "Show decision tree"}
              >
                <GitGraph size={13} />
              </button>
            )}
            <button onClick={clearChat} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-600 hover:text-zinc-300 transition-colors" title="Clear chat">
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Messages area ────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full space-y-4 text-center">
            {/* Persona avatar */}
            <div className={`p-4 rounded-2xl bg-gradient-to-br border ${persona.accentGradient} ${persona.borderClass} shadow-lg`}>
              <span className="text-3xl leading-none">{persona.emoji}</span>
            </div>
            <div>
              <p className={`text-sm font-mono font-bold ${persona.colorClass}`}>{persona.name}</p>
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{persona.tagline}</p>
              <p className="text-[11px] font-mono text-zinc-600 mt-2">
                Bilang <span className="text-zinc-400">"hi"</span> atau langsung tanya tentang{" "}
                <span className="text-zinc-400">{ticker}</span>
              </p>
            </div>
            {/* Quick actions */}
            <div className="flex flex-col gap-2 w-full max-w-sm mt-2">
              {QUICK_ACTIONS.map(({ icon: Icon, label, color }) => (
                <button
                  key={label}
                  onClick={() => sendMessage(`${label} untuk ${ticker}`)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border bg-transparent hover:bg-white/[0.03] transition-all text-left text-[11px] font-mono ${color}`}
                >
                  <Icon size={11} className="shrink-0" />
                  {label} untuk {ticker}
                </button>
              ))}
            </div>
            {/* @ hint */}
            <p className="text-[9px] font-mono text-zinc-700">
              Ketik <span className="text-zinc-500 font-semibold">@</span> untuk pilih tools spesifik
            </p>
          </div>
        )}

        {/* If showTree is active, render decision tree instead of text messages */}
        {showTree && decisionTree ? (
          <div className="py-2">
            <AgentDecisionTree
              tree={decisionTree}
              onClose={() => setShowTree(false)}
            />
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <MessageBubble key={msg.id} message={msg} onDelete={deleteMessage} />
            ))}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 px-4 py-3 border-t border-white/[0.06] shrink-0">

        {/* @ Mention Popup */}
        {mentionQuery !== null && filteredMentions.length > 0 && (
          <div className="absolute bottom-full left-4 mb-2 w-72 rounded-xl border border-white/[0.08] bg-zinc-950/95 backdrop-blur-2xl shadow-2xl z-50 overflow-hidden">
            <div className="px-3 py-2 border-b border-white/[0.06]">
              <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Tools — ketik untuk filter</p>
            </div>
            <div className="py-1">
              {filteredMentions.map((m, i) => (
                <button
                  key={m.mention}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    i === mentionIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-base leading-none shrink-0">{m.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-mono font-bold ${m.color}`}>{m.mention}</span>
                      <span className="text-[9px] font-mono text-zinc-500">{m.label}</span>
                    </div>
                    <p className="text-[9px] font-mono text-zinc-600 truncate">{m.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input row */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={`${persona.greeting} · Ketik @ untuk pilih tools`}
              disabled={loading}
              rows={1}
              className="w-full resize-none bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.08] focus:border-indigo-500/50 rounded-xl px-3 py-2.5 text-[12px] font-mono text-zinc-200 placeholder-zinc-600 outline-none transition-all max-h-32 overflow-y-auto"
              style={{ minHeight: "40px" }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 128) + "px";
              }}
            />
          </div>

          {/* ⚙️ Tool Scope Button */}
          <div className="relative shrink-0" ref={toolPanelRef}>
            <button
              onClick={() => setToolPanelOpen(o => !o)}
              title="Tool scope"
              className={`p-2.5 rounded-xl border transition-all ${
                activeTools.length > 0
                  ? "bg-amber-500/15 border-amber-500/30 text-amber-400"
                  : "bg-white/[0.04] border-white/[0.08] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.07]"
              }`}
            >
              <Settings size={14} />
            </button>

            {toolPanelOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-white/[0.07] bg-zinc-950/95 backdrop-blur-2xl shadow-2xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
                  <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Tool Scope</p>
                  <button
                    onClick={() => { setActiveTools([]); localStorage.setItem("vrp_agent_active_tools", "[]"); }}
                    className="text-[9px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    Reset All
                  </button>
                </div>
                <div className="p-2 space-y-1">
                  {TOOL_MENTIONS.map(tm => {
                    const isAll = tm.tools.length === 0;
                    const isActive = isAll
                      ? activeTools.length === 0
                      : tm.tools.every(t => activeTools.includes(t)) || activeTools.length === 0;
                    const isExplicit = isAll
                      ? activeTools.length === 0
                      : tm.tools.every(t => activeTools.includes(t));
                    return (
                      <button
                        key={tm.mention}
                        onClick={() => handleToolToggle(tm.tools)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all ${
                          isExplicit || (isAll && activeTools.length === 0)
                            ? `${tm.bg} ${tm.color}`
                            : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                        }`}
                      >
                        <span className="text-sm shrink-0">{tm.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-mono font-semibold">{tm.label}</span>
                            <span className="text-[8px] font-mono opacity-60">{tm.mention}</span>
                          </div>
                          <p className="text-[9px] font-mono opacity-60 truncate">{tm.description}</p>
                        </div>
                        <div className={`w-3 h-3 rounded-full border-2 shrink-0 transition-all ${
                          isExplicit || (isAll && activeTools.length === 0)
                            ? "bg-current border-current"
                            : "border-zinc-600"
                        }`} />
                      </button>
                    );
                  })}
                </div>
                <div className="px-3 py-2 border-t border-white/[0.05]">
                  <p className="text-[8px] font-mono text-zinc-700 text-center">
                    {activeTools.length === 0 ? "Semua tools aktif" : `${activeTools.length} tool${activeTools.length > 1 ? "s" : ""} aktif`} · Ketik @ di input untuk mention tool
                  </p>
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <button
              onClick={cancelGeneration}
              className="p-2.5 rounded-xl transition-all shrink-0 bg-rose-500/20 hover:bg-rose-500/40 border border-rose-500/30 text-rose-400 shadow-lg shadow-rose-500/10 active:scale-95"
              title="Stop Generating"
            >
              <Square size={14} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className={`p-2.5 rounded-xl transition-all shrink-0 ${
                !input.trim()
                  ? "bg-zinc-800/40 text-zinc-600 cursor-not-allowed"
                  : `bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/20 active:scale-95`
              }`}
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <p className="text-[9px] font-mono text-zinc-700 mt-1.5 text-center">
          Ketik <span className="text-zinc-500">@</span> untuk pilih tools · Max 6 steps · Conversation history tersimpan
        </p>
      </div>
    </div>
  );
}

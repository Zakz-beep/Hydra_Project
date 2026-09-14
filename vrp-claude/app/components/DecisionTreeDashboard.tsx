"use client";

import { useState, useRef, useCallback } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Bot, Send, Zap, RefreshCw, GitGraph, MessageSquare,
  TrendingUp, BarChart2, Activity, DollarSign, Square,
} from "lucide-react";
import {
  DecisionTree,
  DecisionNode,
  extractDecisionTree,
} from "../lib/decisionTree";
import {
  buildLayout,
  nodeTypes,
} from "./greeks/AgentDecisionTree";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  timestamp: Date;
}

// ─── QUICK PROMPTS ────────────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  { icon: TrendingUp, label: "Analisa SPY: Greeks, VRP, regime & decision tree", prompt: "analisa SPY sekarang, kasih greek flip, vanna charm, regime, sama vrp. Jangan lupa decision tree diagramnya ya" },
  { icon: BarChart2, label: "Trade setup SPY hari ini", prompt: "SPY hari ini gimana? ada setup bagus buat entry? kasih trading plan lengkap sama decision tree confluence" },
  { icon: Activity, label: "SPY breakdown scenario", prompt: "kalo SPY breakdown di $505, gimana dampak ke gamma flip sama regime? gambarin decision tree nya" },
  { icon: DollarSign, label: "Bandingin SPY vs QQQ", prompt: "bandingin SPY sama QQQ sekarang, mana yang lebih bagus buat long? kasih decision tree confluence perbandingannya" },
];

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

// ─── Simple markdown renderer ──────────────────────────────────────────────────
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

// ─── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  if (msg.role === "tool") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-700/40 w-fit my-1">
        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-[10px] font-mono text-violet-400">{msg.toolName}...</span>
      </div>
    );
  }
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-6 h-6 rounded-lg shrink-0 flex items-center justify-center ${isUser ? "bg-violet-600/30" : "bg-zinc-800"}`}>
        {isUser ? <span className="text-[10px]">👤</span> : <Bot size={12} className="text-zinc-400" />}
      </div>
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[11px] font-mono leading-relaxed ${isUser ? "bg-violet-600/25 border border-violet-500/30 text-violet-100" : "bg-zinc-900/70 border border-zinc-700/50 text-zinc-200"}`}>
        {msg.isStreaming ? (
          <div>
            <span className="whitespace-pre-wrap">{msg.content}</span>
            <span className="inline-block w-1.5 h-3.5 bg-violet-400 ml-0.5 animate-pulse rounded-sm" />
          </div>
        ) : (
          <MarkdownText text={msg.content} />
        )}
      </div>
    </div>
  );
}

// ─── Tree View (diagram only) ──────────────────────────────────────────────────
function TreeView({ tree }: { tree: DecisionTree }) {
  const { nodes: initialNodes, edges: initialEdges } = buildLayout(tree);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={1.5}
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(255,255,255,0.04)" />
        <Controls className="!bg-zinc-900 !border-zinc-700 !rounded-lg [&_button]:!text-zinc-400 [&_button]:!border-zinc-700 [&_button:hover]:!bg-zinc-800" />
        <MiniMap nodeColor={() => "rgba(139,92,246,0.3)"} maskColor="rgba(0,0,0,0.7)" style={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.06)" }} />
      </ReactFlow>
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

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function DecisionTreeDashboard() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [decisionTree, setDecisionTree] = useState<DecisionTree | null>(null);
  const [viewMode, setViewMode] = useState<"chat" | "tree">("chat");
  const chatRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { id: generateId(), role: "user", content: text, timestamp: new Date() };
    const assistantMsg: Message = { id: generateId(), role: "assistant", content: "", isStreaming: true, timestamp: new Date() };

    setMessages((p) => [...p, userMsg, assistantMsg]);
    setInput("");
    setDecisionTree(null);
    setViewMode("chat");
    setStreaming(true);
    scrollToBottom();

    let fullContent = "";

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({ message: text, stream: true }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.content) {
              fullContent += json.content;
              setMessages((p) =>
                p.map((m) => (m.id === assistantMsg.id ? { ...m, content: fullContent } : m))
              );
              scrollToBottom();
            }
          } catch {}
        }
      }

      // Finalize
      setMessages((p) =>
        p.map((m) => (m.id === assistantMsg.id ? { ...m, isStreaming: false } : m))
      );

      // Extract decision tree
      const tree = extractDecisionTree(fullContent);
      if (tree) setDecisionTree(tree);

    } catch (e: any) {
      if (e.name === "AbortError") {
        setMessages((p) =>
          p.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + "\n\n*(Generation stopped by user)*", isStreaming: false } : m))
        );
      } else {
        setMessages((p) =>
          p.map((m) => (m.id === assistantMsg.id ? { ...m, content: "⚠️ Error saat menghubungi Agent", isStreaming: false } : m))
        );
      }
    } finally {
      setStreaming(false);
      abortControllerRef.current = null;
    }
  }, [streaming, scrollToBottom]);

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleQuickPrompt = (prompt: string) => sendMessage(prompt);
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } };
  const handleClear = () => { setMessages([]); setDecisionTree(null); setViewMode("chat"); };

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/90 backdrop-blur-xl overflow-hidden flex flex-col" style={{ height: "calc(100vh - 12rem)", minHeight: 600 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">🌲</span>
          <div>
            <h4 className="text-[12px] font-mono text-white font-semibold">Decision Tree Dashboard</h4>
            <p className="text-[9px] font-mono text-zinc-500">AI Agent → ReactFlow Confluence Diagram</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {decisionTree && (
            <button
              onClick={() => setViewMode(viewMode === "chat" ? "tree" : "chat")}
              className={`p-1.5 rounded-lg transition-colors ${viewMode === "tree" ? "bg-violet-600/20 text-violet-400" : "hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300"}`}
              title={viewMode === "chat" ? "Lihat Decision Tree" : "Lihat Chat"}
            >
              {viewMode === "chat" ? <GitGraph size={15} /> : <MessageSquare size={15} />}
            </button>
          )}
          <button onClick={handleClear} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors" title="Clear chat">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Content area */}
      {viewMode === "tree" && decisionTree ? (
        <div className="flex-1">
          <TreeView tree={decisionTree} />
        </div>
      ) : (
        <>
          {/* Chat messages */}
          <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4 px-4">
                <div className="w-14 h-14 rounded-2xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center">
                  <GitGraph size={24} className="text-violet-400" />
                </div>
                <div>
                  <h5 className="text-sm font-mono text-zinc-300 font-semibold">AI Decision Tree Analyzer</h5>
                  <p className="text-[10px] font-mono text-zinc-500 mt-1 max-w-sm">
                    AI Agent menganalisis Greeks, VRP, dan Market Regime lalu menghasilkan Confluence Decision Tree interaktif.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                  {QUICK_PROMPTS.map((qp, i) => {
                    const Icon = qp.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => handleQuickPrompt(qp.prompt)}
                        disabled={streaming}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-zinc-700/60 bg-zinc-900/50 hover:bg-zinc-800/60 hover:border-zinc-600 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-all disabled:opacity-40"
                      >
                        <Icon size={11} className="text-violet-400" />
                        {qp.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
            {streaming && !lastAssistantMsg && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 px-2">
                <Zap size={11} className="text-violet-400 animate-pulse" />
                Agent sedang menganalisis...
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="px-4 py-3 border-t border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming}
                placeholder={streaming ? "Agent sedang menganalisis..." : "Ketik prompt analisis... (Enter to send)"}
                className="flex-1 bg-zinc-900/80 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-violet-500/50 disabled:opacity-50"
              />
              {streaming ? (
                <button
                  onClick={cancelGeneration}
                  className="p-2 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:bg-rose-500/30 transition-all"
                  title="Stop Generating"
                >
                  <Square size={14} className="fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="p-2 rounded-lg bg-violet-600/20 border border-violet-500/30 text-violet-400 hover:bg-violet-600/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

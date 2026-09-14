"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, User, Trash2, ChevronDown, Plus,
  TrendingUp, BarChart2, Activity, DollarSign,
  Sparkles, GitGraph, Search, Globe, Square, Settings,
  Brain, Tag, Clock, Check, Download, AlertCircle, Play,
  Zap, X, ShieldCheck, Cpu, ToggleLeft, ToggleRight,
  FolderOpen, Pencil, MessageSquarePlus, ChevronRight, Save
} from "lucide-react";
import {
  ChatSession, listSessions, createSession, getSession,
  saveSession, renameSession, deleteSession, autoNameSession, formatSessionTime,
  StoredMessage, StoredHistoryMessage
} from "../../lib/sessionMemory";
import AgentDecisionTree from "../greeks/AgentDecisionTree";
import AgentSankeyFlow from "./AgentSankeyFlow";
import PersonaSelector from "../greeks/PersonaSelector";
import SystemBlueprint, { LiveStepNode, AgentStatus } from "./SystemBlueprint";
import { extractDecisionTree, DecisionTree } from "../../lib/decisionTree";
import ToolApprovalCard, { PendingTool } from "./ToolApprovalCard";
import RadarWidget from "./widgets/RadarWidget";
import RichMessageWidget from "./widgets/RichMessageWidget";
import {
  loadMemory,
  saveMemory,
  clearMemory,
  addFact,
  formatMemoryForPrompt,
  AgentMemory,
  MemoryCategory,
  MemoryFact,
  SessionSummary
} from "../../lib/agentMemory";
import {
  PERSONAS, PersonaId, TOOL_MENTIONS, ToolMention
} from "../../lib/personas";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  timestamp: Date;
  pendingTools?: PendingTool[];   // approval cards attached to this message
}

interface Props {
  ticker: string;
}

// OpenAI-compatible message for conversation history in approval mode
interface HistoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// ─── Quick action chips ───────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: TrendingUp,  label: "Analisis posisi sekarang",        color: "text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10" },
  { icon: BarChart2,   label: "Cek regime & VRP",               color: "text-blue-400 border-blue-500/20 hover:bg-blue-500/10" },
  { icon: Activity,    label: "Forecast volatilitas 5 hari",     color: "text-violet-400 border-violet-500/20 hover:bg-violet-500/10" },
  { icon: DollarSign,  label: "Berikan trade setup spesifik",    color: "text-amber-400 border-amber-500/20 hover:bg-amber-500/10" },
];

const TOOL_ICONS: Record<string, { icon: any; color: string; label: string }> = {
  get_greeks:          { icon: BarChart2,  color: "text-violet-400", label: "Fetching Greeks" },
  get_greeks_by_expiry:{ icon: BarChart2,  color: "text-violet-400", label: "Greeks Breakdown" },
  get_regime:          { icon: Activity,   color: "text-blue-400",   label: "Checking Regime" },
  get_vrp:             { icon: TrendingUp, color: "text-emerald-400",label: "Fetching VRP" },
  get_vol_forecast:    { icon: Zap,        color: "text-amber-400",  label: "Vol Forecast" },
  execute_paper_trade: { icon: DollarSign, color: "text-rose-400",    label: "Executing Trade" },
  web_search:          { icon: Search,     color: "text-sky-400",    label: "Searching Web" },
  fetch_webpage:       { icon: Globe,      color: "text-teal-400",   label: "Reading Webpage" },
};

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

// Helper to generate a random ID, safe in both secure and insecure contexts (HTTP/HTTPS)
const generateId = () => {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
};

export default function AgentHubDashboard({ ticker }: Props) {
  // ─── Core States ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationState, setConversationState] = useState<unknown>(null);
  const [decisionTree, setDecisionTree] = useState<DecisionTree | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState("meta-llama/llama-3.3-70b-instruct");
  const [availableModels, setAvailableModels] = useState<any[]>([
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B", tier: "FREE" },
    { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash", tier: "FAST" },
    { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", tier: "SMART" },
    { id: "openai/gpt-4o", name: "GPT-4o", tier: "BEST" },
    { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", tier: "ECON" },
  ]);
  const [modelSearch, setModelSearch] = useState("");
  
  // ─── Memory States ───────────────────────────────────────────────────────────
  const [memory, setMemory] = useState<AgentMemory>(() => loadMemory());
  const [vaultTab, setVaultTab] = useState<"vault" | "mind">("vault");
  const [mindViewMode, setMindViewMode] = useState<"tree" | "sankey">("sankey");
  const [confirmClearMemory, setConfirmClearMemory] = useState(false);
  const [factFormOpen, setFactFormOpen] = useState(false);

  // Ingestion form state
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState<MemoryCategory>("preference");
  const [newTicker, setNewTicker] = useState("");

  // ─── Live DAG States ──────────────────────────────────────────────────────────
  const [dagNodes, setDagNodes] = useState<LiveStepNode[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");

  // ─── ReAct & Approval Mode States ────────────────────────────────────────────
  const [reactMode, setReactMode] = useState(false);
  const [approvalMode, setApprovalMode] = useState(false);
  // Approval-mode conversation history (OpenAI format for /api/agent/step)
  const [approvalHistory, setApprovalHistory] = useState<HistoryMessage[]>([]);
  // Resolver map: toolId → { resolve, reject } for Promise-based approval
  const approvalResolvers = useRef<Map<string, (approved: boolean) => void>>(new Map());

  // ─── Persona States ──────────────────────────────────────────────────────────
  const [personaId, setPersonaId] = useState<PersonaId>(() => {
    if (typeof window === "undefined") return "default";
    return (localStorage.getItem("vrp_agent_persona") as PersonaId) ?? "default";
  });
  const persona = PERSONAS[personaId];

  // ─── Active Tools ────────────────────────────────────────────────────────────
  const [activeTools, setActiveTools] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("vrp_agent_active_tools");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [toolPanelOpen, setToolPanelOpen] = useState(false);

  // ─── Session States ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [sessionSaving, setSessionSaving] = useState(false);
  const autoSaveRef = useRef<NodeJS.Timeout | null>(null);
  const sessionPanelRef = useRef<HTMLDivElement>(null);

  // ─── @ Mention States ─────────────────────────────────────────────────────────
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
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

  // ─── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  // Close tools panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolPanelRef.current && !toolPanelRef.current.contains(e.target as Node)) {
        setToolPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close session panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sessionPanelRef.current && !sessionPanelRef.current.contains(e.target as Node)) {
        setSessionPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Load sessions list on mount
  useEffect(() => {
    listSessions().then(setSessions);
  }, []);

  // Auto-save current session whenever messages change (debounced 2s)
  useEffect(() => {
    if (!currentSessionId || messages.length === 0) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      setSessionSaving(true);
      // Serialize messages (Date → ISO string)
      const storedMsgs: StoredMessage[] = messages.map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : m.timestamp,
        isStreaming: false,
        pendingTools: undefined,
      }));
      // Serialize dagNodes (Date → ISO string)
      const storedDag = dagNodes.map(n => ({
        ...n,
        timestamp: n.timestamp instanceof Date ? n.timestamp.toISOString() : String(n.timestamp),
      }));
      await saveSession(
        currentSessionId,
        storedMsgs,
        approvalHistory as StoredHistoryMessage[],
        conversationState,
        storedDag,
        decisionTree
      );
      // Update local session list preview
      setSessions(prev => prev.map(s =>
        s.id === currentSessionId
          ? { ...s, message_count: messages.length, updated_at: new Date().toISOString(), preview: storedMsgs.filter(m => m.content).slice(-1)[0]?.content.slice(0, 80) ?? "" }
          : s
      ));
      setSessionSaving(false);
    }, 2000);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [messages, currentSessionId, approvalHistory, conversationState, dagNodes, decisionTree]);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handlePersonaChange = (id: PersonaId) => {
    setPersonaId(id);
    if (typeof window !== "undefined") localStorage.setItem("vrp_agent_persona", id);
  };

  // ─── Session Handlers ─────────────────────────────────────────────────────────

  const handleNewSession = async () => {
    const name = autoNameSession(ticker);
    const session = await createSession(name, ticker, personaId);
    if (!session) return;
    setCurrentSessionId(session.id);
    setMessages([]);
    setConversationState(null);
    setApprovalHistory([]);
    setDecisionTree(null);
    setSessions(prev => [session, ...prev]);
    setSessionPanelOpen(false);
  };

  const handleLoadSession = async (sessionId: string) => {
    if (sessionId === currentSessionId) { setSessionPanelOpen(false); return; }
    const full = await getSession(sessionId);
    if (!full) return;
    // Restore messages — convert ISO string timestamps back to Date
    const restored = full.messages.map(m => ({
      ...m,
      timestamp: new Date(m.timestamp),
      pendingTools: [],
    }));
    setMessages(restored);
    setApprovalHistory(full.approval_history as any);
    setConversationState(full.conversation_state);
    // Restore DAG nodes — convert ISO timestamps back to Date
    if (full.dag_nodes && full.dag_nodes.length > 0) {
      const restoredDag = full.dag_nodes.map(n => ({
        ...n,
        timestamp: new Date(n.timestamp),
      }));
      setDagNodes(restoredDag);
      setAgentStatus("done");
    } else {
      setDagNodes([]);
      setAgentStatus("idle");
    }
    // Restore decision tree
    setDecisionTree(full.decision_tree ? (full.decision_tree as any) : null);
    setCurrentSessionId(sessionId);
    setSessionPanelOpen(false);
  };

  const handleStartRename = (session: ChatSession) => {
    setRenamingSessionId(session.id);
    setRenameInput(session.name);
  };

  const handleCommitRename = async (sessionId: string) => {
    if (!renameInput.trim()) { setRenamingSessionId(null); return; }
    await renameSession(sessionId, renameInput.trim());
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, name: renameInput.trim() } : s
    ));
    setRenamingSessionId(null);
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      setMessages([]);
      setConversationState(null);
      setApprovalHistory([]);
      setDagNodes([]);
      setDecisionTree(null);
      setAgentStatus("idle");
    }
  };

  // Auto-name session from first user message if still using default name
  useEffect(() => {
    if (!currentSessionId) return;
    const firstUserMsg = messages.find(m => m.role === "user");
    if (!firstUserMsg) return;
    const currentSession = sessions.find(s => s.id === currentSessionId);
    if (!currentSession) return;
    // Only auto-name if it looks like default name (contains "Session —")
    if (currentSession.name.includes("Session —") && firstUserMsg.content) {
      const newName = autoNameSession(ticker, firstUserMsg.content);
      renameSession(currentSessionId, newName);
      setSessions(prev => prev.map(s =>
        s.id === currentSessionId ? { ...s, name: newName } : s
      ));
    }
  }, [messages.length, currentSessionId]);

  const handleToolToggle = (toolNames: string[]) => {
    setActiveTools(prev => {
      let next: string[];
      if (toolNames.length === 0) {
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

  // CRUD Memory Vault Handlers
  const deleteFact = (id: string) => {
    const updatedFacts = memory.facts.filter(f => f.id !== id);
    const updatedMemory = { ...memory, facts: updatedFacts };
    setMemory(updatedMemory);
    saveMemory(updatedMemory);
  };

  const deleteSummary = (index: number) => {
    const updatedSummaries = memory.recentSummaries.filter((_, idx) => idx !== index);
    const updatedMemory = { ...memory, recentSummaries: updatedSummaries };
    setMemory(updatedMemory);
    saveMemory(updatedMemory);
  };

  const handleAddFact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    const updated = addFact(
      memory,
      newCategory,
      newContent.trim(),
      newTicker ? newTicker.trim().toUpperCase() : undefined,
      "user"
    );

    setMemory(updated);
    saveMemory(updated);
    setNewContent("");
    setNewTicker("");
    setFactFormOpen(false);
  };

  const handleClearMemory = () => {
    if (!confirmClearMemory) {
      setConfirmClearMemory(true);
      setTimeout(() => setConfirmClearMemory(false), 3500);
      return;
    }
    const fresh = clearMemory();
    setMemory(fresh);
    saveMemory(fresh);
    setConfirmClearMemory(false);
  };

  // Helper to parse OpenRouter Agent step state messages history to DAG Nodes
  const parseHistoryToDag = useCallback((state: any, initialPrompt: string): LiveStepNode[] => {
    const nodes: LiveStepNode[] = [];
    
    // Add user prompt first
    nodes.push({
      id: "user-input-" + generateId(),
      type: "user_input",
      label: initialPrompt.length > 50 ? initialPrompt.slice(0, 50) + "..." : initialPrompt,
      details: initialPrompt,
      status: "success",
      timestamp: new Date(),
    });

    if (!state || !state.messages) return nodes;

    const messages = state.messages;
    
    messages.forEach((msg: any, idx: number) => {
      if (!msg || msg.role === "system" || msg.role === "user") {
        return;
      }

      if (msg.role === "assistant") {
        // Add thought node if there is content
        if (msg.content && msg.content.trim()) {
          nodes.push({
            id: `thought-${idx}-${generateId()}`,
            type: "thought",
            label: msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content,
            details: msg.content,
            status: "success",
            timestamp: new Date(),
          });
        }

        // Add tool calls
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          msg.tool_calls.forEach((tc: any, tcIdx: number) => {
            const name = tc.function?.name ?? tc.name ?? "unknown_tool";
            const rawArgs = tc.function?.arguments ?? tc.arguments ?? tc.args ?? "{}";
            let parsedArgs = rawArgs;
            try {
              if (typeof rawArgs === "string") {
                parsedArgs = JSON.stringify(JSON.parse(rawArgs), null, 2);
              } else {
                parsedArgs = JSON.stringify(rawArgs, null, 2);
              }
            } catch {}

            nodes.push({
              id: tc.id ?? `tool-call-${idx}-${tcIdx}-${generateId()}`,
              type: "tool_call",
              label: `Call: ${name}`,
              details: parsedArgs,
              status: "success",
              timestamp: new Date(),
            });
          });
        }
      }

      if (msg.role === "tool" || msg.role === "function") {
        // Find the tool output
        let displayContent = msg.content || "";
        try {
          if (typeof displayContent === "string" && (displayContent.startsWith("{") || displayContent.startsWith("["))) {
            displayContent = JSON.stringify(JSON.parse(displayContent), null, 2);
          }
        } catch {}

        nodes.push({
          id: `observation-${idx}-${generateId()}`,
          type: "observation",
          label: `Observation for ${msg.name || "Tool"}`,
          details: displayContent,
          status: "success",
          timestamp: new Date(),
        });
      }
    });

    // Make the last thought node a final_answer node if present
    let lastThoughtIdx = -1;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i].type === "thought") {
        lastThoughtIdx = i;
        break;
      }
    }
    if (lastThoughtIdx !== -1) {
      nodes[lastThoughtIdx].type = "final_answer";
      nodes[lastThoughtIdx].label = "Final Answer";
    }

    return nodes;
  }, []);

  // ─── Approval Mode: promise-based per-tool gate ───────────────────────────
  const waitForApproval = (toolId: string): Promise<boolean> =>
    new Promise(resolve => { approvalResolvers.current.set(toolId, resolve); });

  const handleToolApprove = useCallback((toolId: string) => {
    const resolve = approvalResolvers.current.get(toolId);
    if (resolve) { resolve(true); approvalResolvers.current.delete(toolId); }
    // Update visual status
    setMessages(prev => prev.map(m => ({
      ...m,
      pendingTools: m.pendingTools?.map(t =>
        t.id === toolId ? { ...t, status: "running" as const } : t
      ),
    })));
    // Synchronously set tool node status to "running"
    setDagNodes(prev => prev.map(n =>
      n.id === toolId ? { ...n, status: "running" } : n
    ));
    setAgentStatus("executing_tool");
  }, []);

  const handleToolDeny = useCallback((toolId: string) => {
    const resolve = approvalResolvers.current.get(toolId);
    if (resolve) { resolve(false); approvalResolvers.current.delete(toolId); }
    setMessages(prev => prev.map(m => ({
      ...m,
      pendingTools: m.pendingTools?.map(t =>
        t.id === toolId ? { ...t, status: "denied" as const } : t
      ),
    })));
    // Synchronously set tool node status to "denied"
    setDagNodes(prev => prev.map(n =>
      n.id === toolId ? { ...n, status: "denied" } : n
    ));
    setAgentStatus("thinking");
  }, []);

  // ─── Approval-mode agentic loop ───────────────────────────────────────────
  const sendMessageWithApproval = useCallback(async (content: string, perMessageTools: string[] | undefined) => {
    const assistantId = generateId();
    setMessages(prev => [...prev, {
      id: assistantId, role: "assistant", content: "", isStreaming: true,
      timestamp: new Date(), pendingTools: [],
    }]);

    let localHistory: HistoryMessage[] = [...approvalHistory, { role: "user", content }];
    let finalText = "";
    const MAX_STEPS = 8;

    // Reset DAG and status
    setAgentStatus("thinking");
    setDagNodes([
      {
        id: generateId(),
        type: "user_input",
        label: content.length > 50 ? content.slice(0, 50) + "..." : content,
        details: content,
        status: "success",
        timestamp: new Date(),
      }
    ]);

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        setAgentStatus("thinking");
        const stepRes = await fetch("/api/agent/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: localHistory,
            model: selectedModel,
            ticker,
            memoryContext: formatMemoryForPrompt(memory),
            personaId,
            activeTools: perMessageTools,
            reactMode,
          }),
        });

        if (!stepRes.ok) throw new Error(`Step API error ${stepRes.status}`);
        const stepData = await stepRes.json();

        if (stepData.type === "error") throw new Error(stepData.error ?? "Step error");

        if (stepData.type === "final") {
          finalText = stepData.text ?? "";
          // Persist assistant message to history
          localHistory = [...localHistory, { role: "assistant", content: finalText }];
          
          setAgentStatus("done");
          setDagNodes(prev => [
            ...prev,
            {
              id: generateId(),
              type: "final_answer",
              label: "Final Answer",
              details: finalText,
              status: "success",
              timestamp: new Date(),
            }
          ]);
          break;
        }

        if (stepData.type === "tool_requests") {
          // Add assistant message (with tool_calls) to history
          localHistory = [...localHistory, stepData.assistantMessage];

          // Parse and append assistant's thought first
          const assistantContent = stepData.assistantMessage?.content || "";
          if (assistantContent.trim()) {
            setDagNodes(prev => [
              ...prev,
              {
                id: `thought-${step}-${generateId()}`,
                type: "thought",
                label: assistantContent.length > 80 ? assistantContent.slice(0, 80) + "..." : assistantContent,
                details: assistantContent,
                status: "success",
                timestamp: new Date(),
              }
            ]);
          }

          // Build approval cards
          const pendingList: PendingTool[] = (stepData.calls as any[]).map((c: any, i: number) => ({
            id: c.id, callIndex: i, name: c.name, args: c.args,
            description: c.description, status: "pending" as const,
          }));

          // Add tool calls to DAG Nodes
          const newToolNodes: LiveStepNode[] = pendingList.map(pt => ({
            id: pt.id,
            type: "tool_call",
            label: `Call: ${pt.name}`,
            sub: pt.description,
            details: JSON.stringify(pt.args, null, 2),
            status: "pending",
            timestamp: new Date(),
          }));
          setDagNodes(prev => [...prev, ...newToolNodes]);

          setMessages(prev => prev.map(m =>
            m.id === assistantId
              ? { ...m, content: finalText, pendingTools: pendingList }
              : m
          ));

          setAgentStatus("waiting_approval");

          // Wait for each tool approval in parallel and preserve order to match tool_calls index
          const toolResults: HistoryMessage[] = new Array(pendingList.length);
          await Promise.all(pendingList.map(async (pending, index) => {
            const approved = await waitForApproval(pending.id);
            if (!approved) {
              // Denied — inject empty result
              toolResults[index] = {
                role: "tool",
                tool_call_id: pending.id,
                content: JSON.stringify({ denied: true, message: "User denied execution of this tool." }),
              };
              setMessages(prev => prev.map(m => ({
                ...m,
                pendingTools: m.pendingTools?.map(t =>
                  t.id === pending.id ? { ...t, status: "denied" } : t
                ),
              })));
              
              // Sync denied to DAG
              setDagNodes(prev => prev.map(n =>
                n.id === pending.id ? { ...n, status: "denied" } : n
              ));
              return;
            }

            // Sync running to DAG
            setAgentStatus("executing_tool");
            setDagNodes(prev => prev.map(n =>
              n.id === pending.id ? { ...n, status: "running" } : n
            ));

            // Execute the approved tool
            try {
              const toolRes = await fetch("/api/agent/tool", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toolName: pending.name, toolArgs: pending.args }),
              });
              const toolData = await toolRes.json();
              const result = toolData.result ?? toolData;

              // For save_memory, also persist to local memory vault
              if (pending.name === "save_memory") {
                const args = pending.args as { category?: string; content?: string; ticker?: string };
                if (args.content) {
                  setMemory(prev => {
                    const updated = addFact(prev, (args.category ?? "context") as MemoryCategory, args.content!, args.ticker, "agent");
                    saveMemory(updated);
                    return updated;
                  });
                }
              }

              toolResults[index] = {
                role: "tool",
                tool_call_id: pending.id,
                content: JSON.stringify(result),
              };

              setMessages(prev => prev.map(m => ({
                ...m,
                pendingTools: m.pendingTools?.map(t =>
                  t.id === pending.id ? { ...t, status: "done", result } : t
                ),
              })));

              // Update DAG node to success, and add observation node!
              setDagNodes(prev => {
                const updated: LiveStepNode[] = prev.map(n =>
                  n.id === pending.id ? { ...n, status: "success" as const } : n
                );
                const obsNode: LiveStepNode = {
                  id: `observation-${pending.id}-${generateId()}`,
                  type: "observation",
                  label: `Observation: ${pending.name}`,
                  details: JSON.stringify(result, null, 2),
                  status: "success",
                  timestamp: new Date(),
                };
                return [...updated, obsNode];
              });
            } catch (toolErr) {
              const errMsg = toolErr instanceof Error ? toolErr.message : "Tool error";
              toolResults[index] = {
                role: "tool",
                tool_call_id: pending.id,
                content: JSON.stringify({ error: errMsg }),
              };
              setMessages(prev => prev.map(m => ({
                ...m,
                pendingTools: m.pendingTools?.map(t =>
                  t.id === pending.id ? { ...t, status: "error", errorMsg: errMsg } : t
                ),
              })));

              // Update DAG node to failed, and add observation node!
              setDagNodes(prev => {
                const updated: LiveStepNode[] = prev.map(n =>
                  n.id === pending.id ? { ...n, status: "failed" as const } : n
                );
                const failNode: LiveStepNode = {
                  id: `observation-fail-${pending.id}-${generateId()}`,
                  type: "observation",
                  label: `Failed: ${pending.name}`,
                  details: errMsg,
                  status: "failed",
                  timestamp: new Date(),
                };
                return [...updated, failNode];
              });
            }
          }));

          // Append all tool results to history for next LLM step
          localHistory = [...localHistory, ...toolResults];
        }
      }
    } catch (e) {
      finalText = `⚠️ Error: ${e instanceof Error ? e.message : "Approval loop error"}`;
      setAgentStatus("error");
      setDagNodes(prev => [
        ...prev,
        {
          id: generateId(),
          type: "final_answer",
          label: "Error Encountered",
          details: finalText,
          status: "failed",
          timestamp: new Date(),
        }
      ]);
    }

    // Update approval history for next conversation turn
    setApprovalHistory(localHistory);

    // Extract decision tree
    const tree = extractDecisionTree(finalText);
    if (tree) { setDecisionTree(tree); setVaultTab("mind"); }

    setMessages(prev => prev.map(m =>
      m.id === assistantId ? { ...m, content: finalText || "(selesai)", isStreaming: false } : m
    ));
  }, [approvalHistory, selectedModel, ticker, memory, personaId, reactMode]);

  // Chat API Communication (normal streaming mode)
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading) return;
    setInput("");
    setMentionQuery(null);

    // Parse @mentions
    const mentionPattern = /@(\w+)/g;
    const mentionedKeys = new Set<string>();
    let match;
    while ((match = mentionPattern.exec(content)) !== null) {
      const key = "@" + match[1].toLowerCase();
      const found = TOOL_MENTIONS.find(m => m.mention === key);
      if (found) {
        if (found.tools.length === 0) { mentionedKeys.clear(); break; }
        found.tools.forEach(t => mentionedKeys.add(t));
      }
    }

    const cleanContent = content.replace(/@(greeks|vrp|regime|vol|trade|web|all)\b/gi, "").replace(/\s{2,}/g, " ").trim();
    const perMessageTools = mentionedKeys.size > 0
      ? Array.from(mentionedKeys)
      : (activeTools.length > 0 ? activeTools : undefined);

    const userMsg: Message = { id: generateId(), role: "user", content: content.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    // Route to approval-mode loop if enabled
    if (approvalMode) {
      await sendMessageWithApproval(cleanContent || content.trim(), perMessageTools);
      setLoading(false);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

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
          reactMode,
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
            const parsed = JSON.parse(raw) as {
              type: string;
              content?: string;
              state?: unknown;
              error?: string;
              memoryUpdates?: Array<{ category: string; content: string; ticker?: string }>;
            };

            if (parsed.type === "delta" && parsed.content) {
              accumulated += parsed.content;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: accumulated } : m
              ));
            } else if (parsed.type === "done") {
              if (parsed.state) setConversationState(parsed.state);
              const tree = extractDecisionTree(accumulated);
              if (tree) { setDecisionTree(tree); setVaultTab("mind"); }
              if (parsed.memoryUpdates && parsed.memoryUpdates.length > 0) {
                setMemory(prev => {
                  let updated = prev;
                  for (const upd of parsed.memoryUpdates!) {
                    updated = addFact(updated, upd.category as MemoryCategory, upd.content, upd.ticker, "agent");
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

      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, isStreaming: false, content: accumulated || "(tidak ada respons)" } : m
      ));
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
  }, [loading, approvalMode, sendMessageWithApproval, selectedModel, ticker, conversationState, memory, personaId, activeTools, reactMode]);


  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

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
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = atIdx + mention.mention.length + 1;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => (i + 1) % filteredMentions.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filteredMentions[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionQuery(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const exportConversation = () => {
    const text = messages.map(m => `[${m.role.toUpperCase()} - ${m.timestamp.toLocaleTimeString()}]\n${m.content}\n`).join("\n---\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agent_convo_${ticker}_${new Date().toISOString().slice(0,10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const factCount = memory.facts.length;
  const summaryCount = memory.recentSummaries.length;
  const totalCount = factCount + summaryCount;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 min-h-[750px]">
      
      {/* ═══════════════════════════════════════════════════════
           LEFT WIDESCREEN CHAT TERMINAL (8 cols)
          ═══════════════════════════════════════════════════════ */}
      <div className="xl:col-span-8 flex flex-col rounded-2xl overflow-hidden border border-white/[0.06] bg-zinc-950/30 backdrop-blur-xl relative" style={{ height: "730px" }}>
        
        {/* Glow tint from selected persona */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950/20 via-zinc-950/50 to-zinc-950/90 pointer-events-none" />
        <div className={`absolute inset-0 border border-white/[0.04] rounded-2xl pointer-events-none`} />
        
        {/* TOP TERMINAL HEADER */}
        <div className="relative z-20 flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-black/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-gradient-to-br border ${persona.accentGradient} ${persona.borderClass} shadow-md`}>
              <span className="text-lg leading-none">{persona.emoji}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`text-xs sm:text-sm font-mono font-bold ${persona.colorClass}`}>{persona.name}</h3>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[8px] font-mono text-emerald-400">ACTIVE</span>
                </div>
              </div>
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{persona.tagline}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Persona Selector */}
            <PersonaSelector currentPersona={personaId} onChange={handlePersonaChange} />

            {/* Model Selector */}
            <div className="relative">
              <button
                onClick={() => setModelOpen(o => !o)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
              >
                <Sparkles size={9} className="text-violet-400" />
                <span className="max-w-[100px] truncate">{selectedModel.split("/")[1] ?? selectedModel}</span>
                <ChevronDown size={9} className={`transition-transform ${modelOpen ? "rotate-180" : ""}`} />
              </button>
              {modelOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-72 flex flex-col max-h-80 rounded-xl bg-zinc-950/95 border border-white/[0.08] shadow-2xl z-50 overflow-hidden">
                  <div className="p-2 border-b border-white/[0.08] shrink-0 bg-black/40">
                    <input 
                      type="text" 
                      placeholder="Search models..." 
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/[0.05] rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500/50"
                    />
                  </div>
                  <div className="overflow-y-auto flex-1 custom-scrollbar max-h-60">
                    {availableModels
                      .filter(m => m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase()))
                      .map((m) => (
                        <button key={m.id} onClick={() => { setSelectedModel(m.id); setModelOpen(false); setModelSearch(""); }}
                          className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-mono hover:bg-white/[0.05] transition-colors cursor-pointer ${selectedModel === m.id ? "text-violet-300 bg-violet-500/10" : "text-zinc-500"}`}>
                          <span className="truncate max-w-[180px] text-left">{m.name}</span>
                          <span className="text-[9px] text-zinc-600 shrink-0 ml-2">{m.tier}</span>
                        </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ─── ReAct Toggle ─────────────────────────────────── */}
            <button
              onClick={() => setReactMode(v => !v)}
              title={reactMode ? "ReAct Mode: ON — Klik untuk matikan" : "ReAct Mode: OFF — Klik untuk aktifkan"}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[9px] font-mono font-bold transition-all cursor-pointer ${
                reactMode
                  ? "bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                  : "bg-zinc-900 border-white/[0.05] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Cpu size={9} className={reactMode ? "text-amber-400" : "text-zinc-600"} />
              <span>ReAct</span>
              {reactMode && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
            </button>

            {/* ─── Approval Gate Toggle ────────────────────────── */}
            <button
              onClick={() => {
                setApprovalMode(v => !v);
                if (approvalMode) setApprovalHistory([]); // reset history when disabling
              }}
              title={approvalMode ? "Approval Gate: ON — Klik untuk matikan" : "Approval Gate: OFF — Klik untuk aktifkan"}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[9px] font-mono font-bold transition-all cursor-pointer ${
                approvalMode
                  ? "bg-violet-500/15 border-violet-500/30 text-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.15)]"
                  : "bg-zinc-900 border-white/[0.05] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <ShieldCheck size={9} className={approvalMode ? "text-violet-400" : "text-zinc-600"} />
              <span>Approval</span>
              {approvalMode && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
            </button>

            {/* Session auto-save indicator */}
            {currentSessionId && (
              <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[8px] font-mono transition-all ${
                sessionSaving
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-emerald-500/20 bg-emerald-500/5 text-emerald-600"
              }`}>
                <Save size={8} className={sessionSaving ? "animate-pulse" : ""} />
                <span>{sessionSaving ? "Saving…" : "Saved"}</span>
              </div>
            )}

            {/* New Session button */}
            <button
              onClick={handleNewSession}
              className="flex items-center gap-1 p-1.5 rounded-lg border border-white/[0.05] bg-zinc-900 text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/20 transition-colors cursor-pointer"
              title="New Session"
            >
              <MessageSquarePlus size={13} />
            </button>

            {/* Session Panel Toggle */}
            <div className="relative" ref={sessionPanelRef}>
              <button
                onClick={() => { setSessionPanelOpen(o => !o); if (!sessionPanelOpen) listSessions().then(setSessions); }}
                className={`flex items-center gap-1.5 p-1.5 rounded-lg border text-[9px] font-mono transition-all cursor-pointer ${
                  sessionPanelOpen
                    ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-400"
                    : "border-white/[0.05] bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
                title="Sessions"
              >
                <FolderOpen size={13} />
                {sessions.length > 0 && (
                  <span className="text-[8px] font-mono text-zinc-500">{sessions.length}</span>
                )}
              </button>

              {/* ─── Session Sidebar Panel ─────────────────────────────── */}
              {sessionPanelOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 flex flex-col rounded-xl bg-zinc-950/98 border border-white/[0.08] shadow-2xl z-50 overflow-hidden" style={{ maxHeight: "520px" }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06] bg-black/30 shrink-0">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={11} className="text-indigo-400" />
                      <span className="text-[10px] font-mono font-bold text-zinc-200">SAVED SESSIONS</span>
                    </div>
                    <button
                      onClick={handleNewSession}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[9px] font-mono hover:bg-indigo-500/25 transition-all cursor-pointer"
                    >
                      <Plus size={8} />
                      <span>New</span>
                    </button>
                  </div>

                  {/* Search */}
                  <div className="px-3 py-2 border-b border-white/[0.04] shrink-0">
                    <input
                      type="text"
                      placeholder="Cari sesi..."
                      value={sessionSearch}
                      onChange={e => setSessionSearch(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-600 outline-none focus:border-indigo-500/40 transition-colors"
                    />
                  </div>

                  {/* Session List */}
                  <div className="overflow-y-auto flex-1 custom-scrollbar">
                    {sessions.filter(s =>
                      sessionSearch === "" ||
                      s.name.toLowerCase().includes(sessionSearch.toLowerCase()) ||
                      s.ticker.toLowerCase().includes(sessionSearch.toLowerCase())
                    ).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                        <FolderOpen size={24} className="text-zinc-700" />
                        <p className="text-[10px] font-mono text-zinc-600">Belum ada sesi tersimpan</p>
                        <button
                          onClick={handleNewSession}
                          className="mt-1 px-3 py-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[9px] font-mono hover:bg-indigo-500/25 transition-all cursor-pointer"
                        >
                          Buat Sesi Baru
                        </button>
                      </div>
                    ) : (
                      <div className="p-2 space-y-1">
                        {sessions
                          .filter(s =>
                            sessionSearch === "" ||
                            s.name.toLowerCase().includes(sessionSearch.toLowerCase()) ||
                            s.ticker.toLowerCase().includes(sessionSearch.toLowerCase())
                          )
                          .map(session => {
                            const isActive = session.id === currentSessionId;
                            return (
                              <div
                                key={session.id}
                                className={`rounded-xl border p-2.5 transition-all group ${
                                  isActive
                                    ? "border-indigo-500/40 bg-indigo-500/10"
                                    : "border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.07]"
                                }`}
                              >
                                {/* Session name row */}
                                <div className="flex items-start gap-2">
                                  <div className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${
                                    isActive ? "bg-indigo-400 animate-pulse" : "bg-zinc-700"
                                  }`} />
                                  <div className="flex-1 min-w-0">
                                    {renamingSessionId === session.id ? (
                                      <input
                                        autoFocus
                                        value={renameInput}
                                        onChange={e => setRenameInput(e.target.value)}
                                        onBlur={() => handleCommitRename(session.id)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") handleCommitRename(session.id);
                                          if (e.key === "Escape") setRenamingSessionId(null);
                                        }}
                                        className="w-full bg-white/[0.06] border border-indigo-500/40 rounded-md px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 outline-none"
                                      />
                                    ) : (
                                      <button
                                        onClick={() => handleLoadSession(session.id)}
                                        className="text-left w-full"
                                      >
                                        <p className={`text-[10px] font-mono font-semibold truncate ${
                                          isActive ? "text-indigo-300" : "text-zinc-300"
                                        }`}>{session.name}</p>
                                      </button>
                                    )}
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[8px] font-mono text-zinc-600">{session.ticker}</span>
                                      <span className="text-[8px] font-mono text-zinc-700">•</span>
                                      <span className="text-[8px] font-mono text-zinc-600">{session.message_count} pesan</span>
                                      <span className="text-[8px] font-mono text-zinc-700">•</span>
                                      <span className="text-[8px] font-mono text-zinc-600">{formatSessionTime(session.updated_at)}</span>
                                    </div>
                                    {session.preview && (
                                      <p className="text-[8px] font-mono text-zinc-600 mt-0.5 truncate">{session.preview}</p>
                                    )}
                                  </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex items-center gap-1.5 mt-2">
                                  {!isActive && (
                                    <button
                                      onClick={() => handleLoadSession(session.id)}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[8px] font-mono hover:bg-indigo-500/20 transition-all cursor-pointer"
                                    >
                                      <ChevronRight size={7} />
                                      Load
                                    </button>
                                  )}
                                  <button
                                    onClick={() => handleStartRename(session)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-zinc-500 text-[8px] font-mono hover:text-zinc-300 hover:border-white/[0.1] transition-all cursor-pointer"
                                  >
                                    <Pencil size={7} />
                                    Rename
                                  </button>
                                  <button
                                    onClick={() => handleDeleteSession(session.id)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-500/5 border border-rose-500/15 text-rose-600 text-[8px] font-mono hover:bg-rose-500/15 hover:text-rose-400 transition-all cursor-pointer ml-auto"
                                  >
                                    <Trash2 size={7} />
                                    Hapus
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Conversation Exporter */}
            {messages.length > 0 && (
              <button 
                onClick={exportConversation} 
                className="p-1.5 rounded-lg border border-white/[0.05] bg-zinc-900 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title="Ekspor Log Chat"
              >
                <Download size={13} />
              </button>
            )}

            {/* Trash button */}
            <button 
              onClick={() => { setMessages([]); setConversationState(null); setDecisionTree(null); setApprovalHistory([]); setCurrentSessionId(null); }} 
              disabled={messages.length === 0}
              className="p-1.5 rounded-lg border border-white/[0.05] bg-zinc-900 text-zinc-500 hover:text-rose-400 disabled:opacity-40 disabled:hover:text-zinc-500 transition-colors cursor-pointer" 
              title="Bersihkan Terminal"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* MESSAGES VIEW */}
        <div className="relative z-10 flex-1 overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full space-y-6 text-center max-w-lg mx-auto py-8">
              <div className={`p-5 rounded-2xl bg-gradient-to-br border ${persona.accentGradient} ${persona.borderClass} shadow-xl relative`}>
                <span className="text-4xl leading-none">{persona.emoji}</span>
                <span className="absolute bottom-[-4px] right-[-4px] flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
              </div>
              <div>
                <p className={`text-base font-mono font-bold tracking-tight ${persona.colorClass}`}>{persona.name}</p>
                <p className="text-xs font-mono text-zinc-400 mt-1">{persona.tagline}</p>
                <p className="text-[11px] font-mono text-zinc-600 mt-3 leading-relaxed">
                  Halo! Tanyakan analisa komprehensif volatilitas, Greeks, korelasi DCC-GARCH, ataupun lakukan Paper Trading secara real-time pada ticker <span className="text-zinc-300 font-semibold">{ticker}</span>.
                </p>
              </div>

              {/* Quick actions grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full mt-4">
                {QUICK_ACTIONS.map(({ icon: Icon, label, color }) => (
                  <button
                    key={label}
                    onClick={() => sendMessage(`${label} untuk ${ticker}`)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border bg-zinc-950/40 border-white/[0.04] hover:bg-white/[0.02] hover:border-white/[0.08] transition-all text-left text-[11px] font-mono cursor-pointer ${color}`}
                  >
                    <Icon size={12} className="shrink-0" />
                    <span className="truncate">{label} untuk {ticker}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => {
            const isUser = msg.role === "user";
            const isTool = msg.role === "tool";

            if (isTool) {
              const info = TOOL_ICONS[msg.toolName ?? ""] ?? { icon: Zap, color: "text-zinc-400", label: msg.toolName ?? "Tool Call" };
              const Icon = info.icon;
              return (
                <div key={msg.id} className="flex items-center gap-2 group relative w-fit my-1.5">
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.05] backdrop-blur-md">
                    <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" style={{ color: info.color.replace("text-", "") }} />
                    <Icon size={12} className={info.color} />
                    <span className={`text-[10px] font-mono font-semibold ${info.color}`}>{info.label}...</span>
                  </div>
                  <button
                    onClick={() => setMessages(prev => prev.filter(m => m.id !== msg.id))}
                    className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1.5 rounded-lg bg-zinc-900 border border-white/[0.06] hover:border-rose-500/20 text-zinc-500 hover:text-rose-400 backdrop-blur-sm shrink-0 cursor-pointer"
                    title="Hapus status tool"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            }

            return (
              <div key={msg.id} className="space-y-2">
                <div className={`flex gap-3 group relative items-start ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-0.5 border ${
                    isUser 
                      ? "bg-violet-600/10 border-violet-500/30 text-violet-300" 
                      : "bg-zinc-900 border-white/[0.06] text-zinc-300"
                  }`}>
                    {isUser ? <User size={13} /> : <Bot size={13} />}
                  </div>

                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[12px] font-mono leading-relaxed relative ${
                    isUser
                      ? "bg-indigo-600/15 border border-indigo-500/20 text-indigo-100 rounded-tr-sm"
                      : "bg-zinc-900/40 border border-white/[0.05] text-zinc-200 rounded-tl-sm shadow-md"
                  }`}>
                    {(() => {
                      let displayContent = msg.content;
                      let radarData = null;
                      let richData = null;

                      if (!msg.isStreaming) {
                        const radarMatch = displayContent.match(/\[RADAR_CHART\]([\s\S]*?)\[\/RADAR_CHART\]/);
                        if (radarMatch) {
                          try {
                            radarData = JSON.parse(radarMatch[1]);
                          } catch (e) {
                            console.error("Failed to parse Radar JSON", e);
                          }
                          displayContent = displayContent.replace(/\[RADAR_CHART\][\s\S]*?\[\/RADAR_CHART\]/, "").trim();
                        }

                        const richMatch = displayContent.match(/\[RICH_MESSAGE\]([\s\S]*?)\[\/RICH_MESSAGE\]/);
                        if (richMatch) {
                          try {
                            richData = JSON.parse(richMatch[1]);
                          } catch (e) {
                            console.error("Failed to parse RichMessage JSON", e);
                          }
                          displayContent = displayContent.replace(/\[RICH_MESSAGE\][\s\S]*?\[\/RICH_MESSAGE\]/, "").trim();
                        }
                      }

                      return (
                        <>
                          {richData && (
                            <RichMessageWidget 
                              greeting={richData.greeting}
                              time={richData.time}
                              status={richData.status}
                              metrics={richData.metrics}
                              question={richData.question}
                              suggestions={richData.suggestions}
                              onSelectSuggestion={sendMessage}
                            />
                          )}

                          {displayContent && (
                            msg.isStreaming ? (
                              <div>
                                <span className="whitespace-pre-wrap">{msg.content}</span>
                                <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm" />
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {displayContent.split("\n").map((line, idx) => {
                                  // Custom table block rendering
                                  if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                                    // Simple visual grid builder in bubble
                                    const cells = line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
                                    return (
                                      <div key={idx} className="grid grid-flow-col auto-cols-fr gap-2 border-b border-white/[0.04] py-1 bg-white/[0.01] px-1 font-mono text-[10px]">
                                        {cells.map((cell, cidx) => (
                                          <span key={cidx} className="truncate text-zinc-300">{cell}</span>
                                        ))}
                                      </div>
                                    );
                                  }
                                  if (line.startsWith("## ")) return <h4 key={idx} className="font-bold text-white text-xs mt-3 mb-1 border-b border-white/[0.06] pb-0.5">{line.slice(3)}</h4>;
                                  if (line.startsWith("### ")) return <h5 key={idx} className="font-semibold text-violet-300 text-[11px] mt-2 mb-0.5">› {line.slice(4)}</h5>;
                                  if (line.startsWith("- ") || line.startsWith("• ")) return <div key={idx} className="flex gap-1.5 items-start mb-0.5"><span className="text-indigo-400 mt-[4px] shrink-0 text-[8px]">▸</span><span className="text-[11px] text-zinc-300 leading-relaxed">{line.replace(/^[-•] /, "")}</span></div>;
                                  if (line.trim() === "---") return <hr key={idx} className="border-white/[0.05] my-2" />;
                                  if (line.startsWith("> 🤔") || line.startsWith("> ⚡") || line.startsWith("> 👁️")) {
                                    const isThought = line.startsWith("> 🤔");
                                    const isAction  = line.startsWith("> ⚡");
                                    return (
                                      <div key={idx} className={`flex items-start gap-2 px-3 py-2 rounded-lg border my-1 text-[10px] font-mono ${
                                        isThought ? "bg-amber-500/5 border-amber-500/15 text-amber-300" :
                                        isAction  ? "bg-violet-500/5 border-violet-500/15 text-violet-300" :
                                                    "bg-sky-500/5 border-sky-500/15 text-sky-300"
                                      }`}>
                                        <span className="shrink-0">{line.slice(2, 4)}</span>
                                        <span className="leading-relaxed">{line.slice(5)}</span>
                                      </div>
                                    );
                                  }
                                  if (line.startsWith("**") && line.endsWith("**")) return <p key={idx} className="font-bold text-white text-[11px] mt-1">{line.replace(/\*\*/g, "")}</p>;
                                  if (line.trim() === "") return <div key={idx} className="h-1" />;
                                  return <p key={idx} className="text-[11px] text-zinc-300 leading-relaxed">{line}</p>;
                                })}
                              </div>
                            )
                          )}

                          {radarData && (
                            <RadarWidget 
                              title={radarData.title || "Radar Profiler"} 
                              data={radarData.data || []} 
                              color={radarData.color || "violet"} 
                            />
                          )}
                        </>
                      );
                    })()}

                    <div className={`text-[9px] mt-2 flex items-center gap-1.5 justify-end ${isUser ? "text-indigo-400/40" : "text-zinc-600"}`}>
                      <Clock size={8} />
                      <span>{msg.timestamp.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>

                  {!msg.isStreaming && (
                    <div className="flex items-center self-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0 ml-1.5">
                      <button
                        onClick={() => setMessages(prev => prev.filter(m => m.id !== msg.id))}
                        className="p-1.5 rounded-lg border border-white/[0.05] bg-zinc-900 hover:bg-rose-950/20 hover:border-rose-500/25 text-zinc-500 hover:text-rose-400 transition-all cursor-pointer shadow-md"
                        title="Hapus pesan"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Tool Approval Cards (Approval Mode only) ──────────── */}
                {!isUser && msg.pendingTools && msg.pendingTools.length > 0 && (
                  <div className="ml-11 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <ShieldCheck size={9} className="text-violet-400" />
                      <span className="text-[8px] font-mono text-violet-400 uppercase tracking-widest">
                        {msg.pendingTools.filter(t => t.status === "pending").length > 0
                          ? `${msg.pendingTools.filter(t => t.status === "pending").length} tool menunggu persetujuan`
                          : "Semua tool selesai"}
                      </span>
                    </div>
                    {msg.pendingTools.map(pt => (
                      <ToolApprovalCard
                        key={pt.id}
                        tool={pt}
                        onApprove={handleToolApprove}
                        onDeny={handleToolDeny}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>


        {/* INPUT BOX AREA */}
        <div className="relative z-20 px-6 py-3.5 border-t border-white/[0.06] bg-black/10 shrink-0">
          
          {/* @ Mention Popup */}
          {mentionQuery !== null && filteredMentions.length > 0 && (
            <div className="absolute bottom-full left-6 mb-2.5 w-72 rounded-xl border border-white/[0.08] bg-zinc-950/95 shadow-2xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.06] bg-black/40">
                <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Pilih Modul / Tool</p>
              </div>
              <div className="py-1 max-h-56 overflow-y-auto custom-scrollbar">
                {filteredMentions.map((m, i) => (
                  <button
                    key={m.mention}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
                      i === mentionIndex ? "bg-white/[0.06]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <span className="text-sm shrink-0 leading-none">{m.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono font-bold ${m.color}`}>{m.mention}</span>
                        <span className="text-[9px] font-mono text-zinc-500">{m.label}</span>
                      </div>
                      <p className="text-[9px] font-mono text-zinc-600 truncate">{m.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2.5 items-end">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={`${persona.greeting} · Gunakan @ untuk memanggil tools`}
                disabled={loading}
                rows={1}
                className="w-full resize-none bg-zinc-900 border border-white/[0.06] focus:border-indigo-500/40 rounded-xl px-3.5 py-3 text-[11px] sm:text-[12px] font-mono text-zinc-200 placeholder-zinc-600 outline-none transition-all max-h-32 overflow-y-auto"
                style={{ minHeight: "44px" }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 128) + "px";
                }}
              />
            </div>

            {/* Tool selection settings toggle */}
            <div className="relative shrink-0" ref={toolPanelRef}>
              <button
                onClick={() => setToolPanelOpen(o => !o)}
                title="Filter Modul Aktif"
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  activeTools.length > 0
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-zinc-900 border-white/[0.06] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                <Settings size={14} />
              </button>

              {toolPanelOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-72 rounded-xl border border-white/[0.08] bg-zinc-950/95 shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06] bg-black/40">
                    <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-wider">Filter Tool Active</p>
                    <button
                      onClick={() => { setActiveTools([]); localStorage.setItem("vrp_agent_active_tools", "[]"); }}
                      className="text-[9px] font-mono text-zinc-500 hover:text-white transition-colors cursor-pointer"
                    >
                      Reset All
                    </button>
                  </div>
                  <div className="p-2 space-y-1 max-h-72 overflow-y-auto custom-scrollbar">
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
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer ${
                            isExplicit || (isAll && activeTools.length === 0)
                              ? `${tm.bg} ${tm.color}`
                              : "border-transparent text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"
                          }`}
                        >
                          <span className="text-base shrink-0 leading-none">{tm.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono font-semibold">{tm.label}</span>
                              <span className="text-[8px] font-mono opacity-50">{tm.mention}</span>
                            </div>
                            <p className="text-[8px] font-mono opacity-60 truncate">{tm.description}</p>
                          </div>
                          <div className={`w-2.5 h-2.5 rounded-full border shrink-0 transition-all ${
                            isExplicit || (isAll && activeTools.length === 0)
                              ? "bg-current border-current"
                              : "border-zinc-700"
                          }`} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="px-3 py-1.5 border-t border-white/[0.05] bg-black/10">
                    <p className="text-[8px] font-mono text-zinc-600 text-center">
                      Semua modul diizinkan jika bernilai kosong
                    </p>
                  </div>
                </div>
              )}
            </div>

            {loading ? (
              <button
                onClick={cancelGeneration}
                className="p-3 rounded-xl transition-all shrink-0 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 cursor-pointer shadow-lg active:scale-95"
                title="Hentikan Analisa"
              >
                <Square size={13} className="fill-current animate-pulse" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className={`p-3 rounded-xl transition-all shrink-0 cursor-pointer ${
                  !input.trim()
                    ? "bg-zinc-900 border border-white/[0.04] text-zinc-600 cursor-not-allowed"
                    : `bg-gradient-to-br from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/10 active:scale-95`
                }`}
              >
                <Send size={13} />
              </button>
            )}
          </div>
          <p className="text-[9px] font-mono text-zinc-600 mt-1.5 text-center leading-none">
            Llama-3.3-70B · persistent local storage memory aktif · max 6 logical steps
          </p>
        </div>
      </div>

      {/* ─── RIGHT VISUAL COCKPIT DECKS (4 cols) ─────────────────────────────────── */}
      <div className="xl:col-span-4 flex flex-col space-y-4 h-[730px]">
        
        {/* TAB CONTROLLERS DECK */}
        <div className="flex rounded-xl p-1 bg-zinc-900/60 border border-white/[0.06] backdrop-blur-md shrink-0">
          {(["vault", "mind"] as const).map(t => (
            <button
              key={t}
              onClick={() => setVaultTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-mono font-bold cursor-pointer transition-all uppercase tracking-wider
                ${vaultTab === t
                  ? "bg-indigo-600/15 border border-indigo-500/20 text-indigo-300 shadow-md"
                  : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
            >
              {t === "vault" ? <Brain size={11} /> : <GitGraph size={11} />}
              <span>{t === "vault" ? "Memory Vault" : "System Mind"}</span>
            </button>
          ))}
        </div>

        {/* CONTENT DECKS CONTAINER */}
        <div className="flex-1 overflow-hidden">
          
          {/* TAB 1: MEMORY VAULT */}
          {vaultTab === "vault" && (
            <div className="h-full rounded-2xl border border-white/[0.06] bg-zinc-950/30 backdrop-blur-xl flex flex-col p-4 overflow-hidden relative">
              <div className="absolute -top-16 -right-16 w-32 h-32 bg-violet-600/5 rounded-full blur-2xl pointer-events-none" />
              
              {/* Vault Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.04] shrink-0">
                <div className="flex items-center gap-2">
                  <Brain size={14} className="text-violet-400" />
                  <div>
                    <h4 className="text-[11px] font-mono text-white font-bold tracking-wide uppercase">Core Memory Bank</h4>
                    <span className="text-[8px] font-mono text-zinc-500 uppercase">{totalCount} entri disimpan</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Plus Trigger Button */}
                  <button
                    onClick={() => setFactFormOpen(f => !f)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-mono border transition-all cursor-pointer
                      ${factFormOpen 
                        ? "bg-zinc-800 border-zinc-700 text-zinc-300"
                        : "bg-indigo-500/10 border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/20"
                      }`}
                  >
                    <Plus size={9} />
                    <span>INGEST</span>
                  </button>

                  {/* Clear Button */}
                  {totalCount > 0 && (
                    <button
                      onClick={handleClearMemory}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-mono transition-all cursor-pointer ${
                        confirmClearMemory
                          ? "bg-rose-500/20 border border-rose-500/30 text-rose-300 animate-pulse"
                          : "bg-zinc-900 border border-white/[0.04] text-zinc-500 hover:text-rose-400"
                      }`}
                    >
                      <Trash2 size={9} />
                      <span>{confirmClearMemory ? "Yakin?" : "CLEAR"}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Dynamic Storage Capacity Bar */}
              <div className="my-2.5 px-1 py-2 rounded-lg bg-white/[0.01] border border-white/[0.02] shrink-0">
                <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-1">
                  <span>CAPACITY (FACTS)</span>
                  <span>{factCount} / 30 MEMORIES</span>
                </div>
                <div className="w-full h-1 bg-zinc-900 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500" 
                    style={{ width: `${(factCount / 30) * 100}%` }}
                  />
                </div>
              </div>

              {/* Memory List / Ingestion Form */}
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-0.5 space-y-3">
                {/* Form to manual ingest fact */}
                {factFormOpen && (
                  <form onSubmit={handleAddFact} className="p-3 rounded-xl border border-white/[0.06] bg-zinc-900/60 backdrop-blur-sm space-y-2.5 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold text-zinc-400 uppercase">Ingest New Fact Node</span>
                      <button type="button" onClick={() => setFactFormOpen(false)} className="text-[9px] font-mono text-zinc-600 hover:text-zinc-400 cursor-pointer">Tutup</button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[8px] font-mono text-zinc-500 uppercase">Kategori Memori</label>
                      <div className="grid grid-cols-3 gap-1">
                        {(["preference", "opinion", "plan"] as const).map(cat => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setNewCategory(cat)}
                            className={`py-1 rounded text-[8px] font-mono border transition-all cursor-pointer
                              ${newCategory === cat
                                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300 font-bold"
                                : "bg-zinc-950 border-white/[0.04] text-zinc-500 hover:text-zinc-300"
                              }`}
                          >
                            {cat === "preference" ? "Preferensi" : cat === "opinion" ? "Opini" : "Rencana"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[8px] font-mono text-zinc-500 uppercase">Ticker (Optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. SPY"
                          value={newTicker}
                          onChange={e => setNewTicker(e.target.value)}
                          className="w-full bg-zinc-950 border border-white/[0.05] rounded px-2 py-1 text-[10px] font-mono text-zinc-200 uppercase outline-none focus:border-indigo-500/40"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[8px] font-mono text-zinc-500 uppercase">Isi Memori Fact</label>
                      <textarea
                        required
                        rows={2}
                        placeholder="e.g. Toleransi risiko portofolio maks $500 per trade..."
                        value={newContent}
                        onChange={e => setNewContent(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/[0.05] rounded px-2 py-1.5 text-[10px] font-mono text-zinc-200 outline-none focus:border-indigo-500/40 resize-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={!newContent.trim()}
                      className="w-full py-1.5 rounded bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold font-mono text-[9px] cursor-pointer shadow-md disabled:opacity-40 transition-all active:scale-95"
                    >
                      INGEST MEMORY NODE
                    </button>
                  </form>
                )}

                {/* Session Summaries Section */}
                {memory.recentSummaries.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1 h-1 bg-sky-400 rounded-full" />
                      <span>Last Session Summaries</span>
                    </p>
                    <div className="space-y-2">
                      {memory.recentSummaries.map((s, i) => (
                        <div key={i} className="flex gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.06] transition-all group relative">
                          <div className="shrink-0">
                            <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border leading-none ${
                              s.signal === "BULLISH" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                              s.signal === "BEARISH" ? "text-rose-400 bg-rose-500/10 border-rose-500/20" :
                              "text-amber-400 bg-amber-500/10 border-amber-500/20"
                            }`}>
                              {s.ticker}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-mono text-zinc-300 leading-normal line-clamp-3">{s.summary}</p>
                            <span className="text-[7.5px] font-mono text-zinc-600 mt-1 block">{s.date}</span>
                          </div>
                          <button
                            onClick={() => deleteSummary(i)}
                            className="absolute right-2 top-2 p-1 rounded hover:bg-rose-500/10 text-zinc-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                            title="Hapus summary"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Facts Section */}
                {memory.facts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-1 h-1 bg-violet-400 rounded-full" />
                      <span>Ingatan / Facts</span>
                    </p>
                    <div className="space-y-2">
                      {memory.facts.map((fact) => {
                        const cfg = CATEGORY_CONFIG[fact.category] ?? CATEGORY_CONFIG.preference;
                        return (
                          <div key={fact.id} className={`flex items-start gap-2 p-2.5 rounded-xl border relative group transition-all hover:scale-[1.005] ${cfg.bg}`}>
                            <Tag size={10} className={`${cfg.color} shrink-0 mt-0.5`} />
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1 leading-none">
                                <span className={`text-[8px] font-mono font-bold uppercase tracking-tight ${cfg.color}`}>
                                  {cfg.label}
                                </span>
                                {fact.ticker && (
                                  <span className="text-[7.5px] font-mono text-zinc-400 bg-black/40 border border-white/[0.04] px-1 rounded">
                                    {fact.ticker}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] font-mono text-zinc-300 leading-normal">{fact.content}</p>
                              
                              <div className="flex items-center gap-1 mt-1.5 leading-none">
                                <Clock size={8} className="text-zinc-600" />
                                <span className="text-[7.5px] font-mono text-zinc-600">
                                  {formatRelativeTime(fact.timestamp)}
                                </span>
                              </div>
                            </div>

                            <button
                              onClick={() => deleteFact(fact.id)}
                              className="absolute right-2 top-2 p-1 rounded hover:bg-rose-500/10 text-zinc-700 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
                              title="Hapus ingatan"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {totalCount === 0 && !factFormOpen && (
                  <div className="flex flex-col items-center justify-center py-16 text-center px-4 h-full">
                    <div className="p-3 rounded-full bg-zinc-900 border border-white/[0.04] mb-3">
                      <Brain size={22} className="text-zinc-600" />
                    </div>
                    <p className="text-[10px] font-mono text-zinc-500 font-bold uppercase tracking-wider">Memory Bank Empty</p>
                    <p className="text-[9px] font-mono text-zinc-600 mt-1 max-w-[200px] leading-relaxed">
                      Belum ada memori. Klik <strong className="text-indigo-400">INGEST</strong> di atas untuk menambahkan ingatan baru secara manual.
                    </p>
                  </div>
                )}
              </div>

              {/* Vault Footer */}
              <div className="pt-2 border-t border-white/[0.04] bg-white/[0.005] mt-2 shrink-0">
                <p className="text-[8px] font-mono text-zinc-600 text-center leading-normal">
                  Memori di-sync secara lokal di browser Anda.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: SYSTEM MIND / FALLBACK SYSTEM BLUEPRINT */}
          {vaultTab === "mind" && (
            <div className="h-full overflow-hidden flex flex-col space-y-3">
              {decisionTree ? (
                <div className="flex-1 flex flex-col justify-between overflow-hidden">
                  {/* View Mode Toggle Pill */}
                  <div className="flex justify-end shrink-0 mb-2">
                    <div className="inline-flex rounded-lg p-0.5 bg-zinc-900 border border-white/[0.04] text-[9px] font-mono">
                      <button
                        onClick={() => setMindViewMode("sankey")}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                          mindViewMode === "sankey"
                            ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 font-bold"
                            : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                        }`}
                      >
                        🌊 Sankey Flow
                      </button>
                      <button
                        onClick={() => setMindViewMode("tree")}
                        className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                          mindViewMode === "tree"
                            ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 font-bold"
                            : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                        }`}
                      >
                        🌲 Classic Tree
                      </button>
                    </div>
                  </div>

                  {/* Render based on view mode */}
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {mindViewMode === "sankey" ? (
                      <AgentSankeyFlow
                        tree={decisionTree}
                        onClose={() => { setDecisionTree(null); setVaultTab("vault"); }}
                      />
                    ) : (
                      <AgentDecisionTree 
                        tree={decisionTree} 
                        onClose={() => { setDecisionTree(null); setVaultTab("vault"); }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full">
                  <SystemBlueprint 
                    dagNodes={dagNodes}
                    agentStatus={agentStatus}
                    ticker={ticker}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

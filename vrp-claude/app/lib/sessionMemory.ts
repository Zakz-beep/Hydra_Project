// ─── Session Memory — API Client for SQLite-backed Chat Sessions ───────────────
// All sessions are stored in the backend SQLite DB via vrp_api3.py (port 8000).
// This lib provides typed helpers to interact with the /api/sessions endpoints.

export interface ChatSession {
  id: string;
  name: string;
  ticker: string;
  persona_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

export interface ChatSessionFull extends ChatSession {
  messages: StoredMessage[];
  approval_history: StoredHistoryMessage[];
  conversation_state: unknown | null;
  dag_nodes: StoredDagNode[];      // Spider/Blueprint visualization
  decision_tree: unknown | null;   // DecisionTree JSON (typed in decisionTree.ts)
}

// Shape of messages stored — timestamps serialized as strings (from JSON)
export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  timestamp: string; // ISO string, was Date in runtime
  pendingTools?: unknown[];
}

export interface StoredHistoryMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

// LiveStepNode serialized (timestamp as string)
export interface StoredDagNode {
  id: string;
  type: "user_input" | "thought" | "tool_call" | "observation" | "final_answer";
  label: string;
  sub?: string;
  status: "pending" | "running" | "success" | "failed" | "denied";
  details?: string;
  timestamp: string; // ISO string (was Date in LiveStepNode)
}

const BASE = "/api/sessions";

// ─── List all sessions (no messages) ──────────────────────────────────────────
export async function listSessions(): Promise<ChatSession[]> {
  try {
    const res = await fetch(BASE, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.sessions ?? []) as ChatSession[];
  } catch {
    return [];
  }
}

// ─── Get single session with full messages ────────────────────────────────────
export async function getSession(sessionId: string): Promise<ChatSessionFull | null> {
  try {
    const res = await fetch(`${BASE}/${sessionId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.session ?? null) as ChatSessionFull | null;
  } catch {
    return null;
  }
}

// ─── Create a new empty session ───────────────────────────────────────────────
export async function createSession(
  name: string,
  ticker: string,
  personaId: string
): Promise<ChatSession | null> {
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ticker, persona_id: personaId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.session ?? null) as ChatSession | null;
  } catch {
    return null;
  }
}

// ─── Save/update session messages ───────────────────────────────────────────────────
export async function saveSession(
  sessionId: string,
  messages: StoredMessage[],
  approvalHistory: StoredHistoryMessage[],
  conversationState: unknown | null,
  dagNodes: StoredDagNode[],
  decisionTree: unknown | null
): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        approval_history: approvalHistory,
        conversation_state: conversationState,
        dag_nodes: dagNodes,
        decision_tree: decisionTree,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Rename a session ─────────────────────────────────────────────────────────
export async function renameSession(sessionId: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${sessionId}/rename`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Delete a session ─────────────────────────────────────────────────────────
export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${sessionId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Generate auto name from first user message ───────────────────────────────
export function autoNameSession(ticker: string, firstUserMessage?: string): string {
  if (firstUserMessage && firstUserMessage.trim().length > 0) {
    const clean = firstUserMessage.trim().replace(/[@\n]/g, " ").replace(/\s+/g, " ").trim();
    return clean.length > 32 ? clean.slice(0, 32) + "…" : clean;
  }
  const now = new Date();
  const time = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${ticker} Session — ${time}`;
}

// ─── Format relative time for UI display ─────────────────────────────────────
export function formatSessionTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days >= 2) return `${days} hari lalu`;
  if (days === 1) return "Kemarin";
  if (hours > 0) return `${hours}j lalu`;
  if (minutes > 0) return `${minutes}m lalu`;
  return "baru saja";
}

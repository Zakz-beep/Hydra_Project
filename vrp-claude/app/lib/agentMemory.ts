// ─── Agent Memory Utility ─────────────────────────────────────────────────────
// Persistent memory for the VRP Quant Agent.
// Stores facts, preferences, and session summaries in localStorage so the
// agent can reference prior conversations even after the browser is closed.

export type MemoryCategory = "preference" | "opinion" | "plan" | "context" | "observation";

export interface MemoryFact {
  id: string;
  category: MemoryCategory;
  content: string;
  ticker?: string;
  timestamp: string; // ISO string
  source: "agent" | "user";
}

export interface SessionSummary {
  date: string; // YYYY-MM-DD
  ticker: string;
  summary: string;
  signal?: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}

export interface AgentMemory {
  version: number;
  createdAt: string;
  updatedAt: string;
  facts: MemoryFact[];
  recentSummaries: SessionSummary[];
}

const STORAGE_KEY = "vrp_agent_memory_v1";
const MAX_FACTS = 30;
const MAX_SUMMARIES = 7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId(): string {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + "_" + Date.now().toString(36);
}

function emptyMemory(): AgentMemory {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    facts: [],
    recentSummaries: [],
  };
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/** Load memory from localStorage. Returns empty memory if none found. */
export function loadMemory(): AgentMemory {
  if (typeof window === "undefined") return emptyMemory();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw) as AgentMemory;
    // Basic validation
    if (!parsed.facts || !Array.isArray(parsed.facts)) return emptyMemory();
    return parsed;
  } catch {
    return emptyMemory();
  }
}

/** Persist memory to localStorage. */
export function saveMemory(memory: AgentMemory): void {
  if (typeof window === "undefined") return;
  try {
    memory.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage might be full — silently fail
  }
}

/** Add a new fact to memory. Deduplicates similar content and trims to MAX_FACTS. */
export function addFact(
  memory: AgentMemory,
  category: MemoryCategory,
  content: string,
  ticker?: string,
  source: "agent" | "user" = "agent"
): AgentMemory {
  // Skip if very similar content already exists (simple check)
  const duplicate = memory.facts.some((f) => {
    const existing = f.content.toLowerCase().trim();
    const incoming = content.toLowerCase().trim();
    if (existing === incoming) return true;
    
    // Only check substring duplication if both are reasonably long to prevent false-positive duplicate detection
    if (existing.length > 20 && incoming.length > 20) {
      return existing.includes(incoming) || incoming.includes(existing);
    }
    return false;
  });
  if (duplicate) return memory;

  const newFact: MemoryFact = {
    id: genId(),
    category,
    content: content.trim(),
    ticker: ticker?.toUpperCase(),
    timestamp: new Date().toISOString(),
    source,
  };

  const updatedFacts = [newFact, ...memory.facts].slice(0, MAX_FACTS);
  return { ...memory, facts: updatedFacts };
}

/** Add a session summary (deduplicated by date+ticker). */
export function addSessionSummary(
  memory: AgentMemory,
  ticker: string,
  summary: string,
  signal?: SessionSummary["signal"],
  confidence?: SessionSummary["confidence"]
): AgentMemory {
  const today = new Date().toISOString().slice(0, 10);
  const existing = memory.recentSummaries.filter(
    (s) => !(s.date === today && s.ticker === ticker.toUpperCase())
  );
  const newSummary: SessionSummary = {
    date: today,
    ticker: ticker.toUpperCase(),
    summary: summary.trim(),
    signal,
    confidence,
  };
  const updated = [newSummary, ...existing].slice(0, MAX_SUMMARIES);
  return { ...memory, recentSummaries: updated };
}

/** Clear all memory. */
export function clearMemory(): AgentMemory {
  const fresh = emptyMemory();
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
  return fresh;
}

/** Format memory as a readable string for injection into the system prompt. */
export function formatMemoryForPrompt(memory: AgentMemory): string {
  if (memory.facts.length === 0 && memory.recentSummaries.length === 0) return "";

  const lines: string[] = ["### 🧠 Agent Long-Term Memory (Konteks dari Sesi Sebelumnya)"];
  lines.push("Gunakan informasi ini untuk memberikan respons yang lebih personal dan relevan.\n");

  if (memory.recentSummaries.length > 0) {
    lines.push("**Ringkasan Sesi Terakhir:**");
    for (const s of memory.recentSummaries) {
      const signalStr = s.signal ? ` [${s.signal}${s.confidence ? ` / ${s.confidence}` : ""}]` : "";
      lines.push(`- ${s.date} | ${s.ticker}${signalStr}: ${s.summary}`);
    }
    lines.push("");
  }

  if (memory.facts.length > 0) {
    lines.push("**Facts yang Diingat tentang User:**");
    const byCategory: Partial<Record<MemoryCategory, MemoryFact[]>> = {};
    for (const fact of memory.facts) {
      if (!byCategory[fact.category]) byCategory[fact.category] = [];
      byCategory[fact.category]!.push(fact);
    }

    const categoryLabels: Record<MemoryCategory, string> = {
      preference: "🎯 Preferensi",
      opinion: "💬 Opini/Pandangan",
      plan: "📋 Rencana Trading",
      context: "📌 Konteks",
      observation: "🔍 Observasi",
    };

    for (const [cat, facts] of Object.entries(byCategory) as [MemoryCategory, MemoryFact[]][]) {
      lines.push(`\n${categoryLabels[cat]}:`);
      for (const f of facts) {
        const tickerStr = f.ticker ? ` [${f.ticker}]` : "";
        lines.push(`  - ${f.content}${tickerStr}`);
      }
    }
  }

  lines.push("\n⚠️ Jika memory ini tidak lagi relevan dengan kondisi pasar terkini, prioritaskan data real-time dari tools.");
  return lines.join("\n");
}

/** Parse save_memory tool call result from agent and apply it to memory. */
export function applyAgentMemoryUpdate(
  memory: AgentMemory,
  update: { category: MemoryCategory; content: string; ticker?: string }
): AgentMemory {
  return addFact(memory, update.category, update.content, update.ticker, "agent");
}

// ──────────────────────────────────────────────────────────────────────────────
// Decision Tree Types & Parser untuk VRP Quant Agent
// ──────────────────────────────────────────────────────────────────────────────

/** Tipe node dalam decision tree */
export type TreeNodeType =
  | "root"        // Starting node / market overview
  | "analysis"    // Data point (GEX, VRP, Regime, Vol)
  | "condition"   // Branching decision point
  | "outcome"     // Final conclusion / recommendation
  | "signal";     // Bullish / Bearish / Neutral signal

/** Sebuah node dalam decision tree */
export interface DecisionNode {
  id: string;
  type: TreeNodeType;
  label: string;
  /** Key metrics untuk ditampilkan di node (optional) */
  metrics?: Record<string, string | number>;
  /** Persentase confidence / probabilitas (0-100) */
  probability: number;
  /** Warna accent node */
  color?: "emerald" | "rose" | "amber" | "blue" | "violet" | "zinc";
  /** Detail tambahan untuk tooltip */
  detail?: string;
}

/** Edge antar node */
export interface DecisionEdge {
  from: string;
  to: string;
  label?: string;
  /** Persentase probabilitas transisi (0-100) */
  probability?: number;
}

/** Full decision tree JSON dari AI */
export interface DecisionTree {
  title: string;
  summary?: string;
  ticker?: string;
  nodes: DecisionNode[];
  edges: DecisionEdge[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Mengekstrak JSON decision tree dari teks response AI.
 * Format yang diharapkan:
 * [DECISION_TREE]
 * { ... json ... }
 * [/DECISION_TREE]
 */
export function extractDecisionTree(text: string): DecisionTree | null {
  const match = text.match(/\[DECISION_TREE\]([\s\S]*?)\[\/DECISION_TREE\]/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1].trim()) as DecisionTree;
    // Validasi minimal
    if (!parsed.nodes || !parsed.edges || !parsed.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Color helpers ───────────────────────────────────────────────────────────

export function getNodeColor(color?: string): string {
  switch (color) {
    case "emerald": return "#10b981";
    case "rose":    return "#f43f5e";
    case "amber":   return "#f59e0b";
    case "blue":    return "#3b82f6";
    case "violet":  return "#8b5cf6";
    default:        return "#71717a"; // zinc
  }
}

export function getNodeBg(color?: string): string {
  switch (color) {
    case "emerald": return "rgba(16,185,129,0.12)";
    case "rose":    return "rgba(244,63,94,0.12)";
    case "amber":   return "rgba(245,158,11,0.12)";
    case "blue":    return "rgba(59,130,246,0.12)";
    case "violet":  return "rgba(139,92,246,0.12)";
    default:        return "rgba(113,113,122,0.12)";
  }
}

export function getNodeBorder(color?: string): string {
  switch (color) {
    case "emerald": return "rgba(16,185,129,0.3)";
    case "rose":    return "rgba(244,63,94,0.3)";
    case "amber":   return "rgba(245,158,11,0.3)";
    case "blue":    return "rgba(59,130,246,0.3)";
    case "violet":  return "rgba(139,92,246,0.3)";
    default:        return "rgba(113,113,122,0.3)";
  }
}

export function getNodeIcon(type: TreeNodeType): string {
  switch (type) {
    case "root":      return "🎯";
    case "analysis":  return "📊";
    case "condition": return "⚡";
    case "outcome":   return "🎯";
    case "signal":    return "📈";
  }
}

/** Get gradient color for probability bar */
export function getProbabilityColor(pct: number): string {
  if (pct >= 80) return "#10b981"; // High - Emerald
  if (pct >= 60) return "#3b82f6"; // Medium - Blue
  if (pct >= 40) return "#f59e0b"; // Moderate - Amber
  return "#f43f5e";                // Low - Rose
}

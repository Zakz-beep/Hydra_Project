// app/components/agent/AgentSankeyFlow.tsx
"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { DecisionTree, DecisionNode } from "../../lib/decisionTree";

// Dynamically import Plotly to avoid Next.js SSR issues
const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center text-zinc-500 font-mono text-xs border border-white/[0.04] rounded-xl bg-zinc-950/20 min-h-[400px]">
      Loading Sankey Flow Engine...
    </div>
  ),
});

interface Props {
  tree: DecisionTree;
  onClose?: () => void;
}

// Neon color mapping
const nodeColors: Record<string, string> = {
  emerald: "rgba(16, 185, 129, 0.85)",
  rose: "rgba(244, 63, 94, 0.85)",
  amber: "rgba(245, 158, 11, 0.85)",
  blue: "rgba(59, 130, 246, 0.85)",
  violet: "rgba(139, 92, 246, 0.85)",
  zinc: "rgba(113, 113, 122, 0.85)",
};

const linkColors: Record<string, string> = {
  emerald: "rgba(16, 185, 129, 0.18)",
  rose: "rgba(244, 63, 94, 0.18)",
  amber: "rgba(245, 158, 11, 0.18)",
  blue: "rgba(59, 130, 246, 0.18)",
  violet: "rgba(139, 92, 246, 0.18)",
  zinc: "rgba(113, 113, 122, 0.15)",
};

export default function AgentSankeyFlow({ tree, onClose }: Props) {
  const chartData = useMemo(() => {
    if (!tree || !tree.nodes || tree.nodes.length === 0) return null;

    const nodes = tree.nodes;
    const nodeIdToIndex = new Map<string, number>();
    nodes.forEach((n, idx) => {
      nodeIdToIndex.set(n.id, idx);
    });

    const labels: string[] = [];
    const colors: string[] = [];
    const hoverTexts: string[] = [];

    // Map nodes
    nodes.forEach((n) => {
      // Build custom rich metrics string for hover
      let metricsText = "";
      if (n.metrics && Object.keys(n.metrics).length > 0) {
        metricsText = "<br>" + Object.entries(n.metrics)
          .map(([key, val]) => `${key.toUpperCase()}: <b>${val}</b>`)
          .join("<br>");
      }

      labels.push(n.label);
      colors.push(nodeColors[n.color || "zinc"]);
      hoverTexts.push(
        `<b>${n.label}</b><br>` +
        `Tipe: <b>${n.type.toUpperCase()}</b><br>` +
        `Confidence: <b>${n.probability}%</b>` +
        metricsText
      );
    });

    // Map links/edges
    const sources: number[] = [];
    const targets: number[] = [];
    const values: number[] = [];
    const edgeColors: string[] = [];
    const edgeHovers: string[] = [];

    tree.edges.forEach((e) => {
      const srcIdx = nodeIdToIndex.get(e.from);
      const tgtIdx = nodeIdToIndex.get(e.to);

      if (srcIdx !== undefined && tgtIdx !== undefined) {
        sources.push(srcIdx);
        targets.push(tgtIdx);
        
        // Probability determines link thickness (min value 10 for visibility)
        const val = e.probability !== undefined ? e.probability : (nodes[tgtIdx]?.probability ?? 50);
        values.push(Math.max(val, 15));

        // Color matches the target node color
        const targetColorKey = nodes[tgtIdx]?.color || "zinc";
        edgeColors.push(linkColors[targetColorKey]);

        // Rich hover info for flow connection
        edgeHovers.push(
          `Aliran: <b>${nodes[srcIdx].label}</b> ➜ <b>${nodes[tgtIdx].label}</b><br>` +
          `Kondisi: <b>${e.label || "N/A"}</b><br>` +
          `Probabilitas: <b>${e.probability || val}%</b>`
        );
      }
    });

    return {
      node: {
        pad: 18,
        thickness: 20,
        line: { color: "rgba(255,255,255,0.08)", width: 0.5 },
        label: labels,
        color: colors,
        customdata: hoverTexts,
        hovertemplate: "%{customdata}<extra></extra>",
      },
      link: {
        source: sources,
        target: targets,
        value: values,
        color: edgeColors,
        customdata: edgeHovers,
        hovertemplate: "%{customdata}<extra></extra>",
      },
    };
  }, [tree]);

  if (!chartData) {
    return (
      <div className="h-[400px] flex items-center justify-center text-zinc-500 font-mono text-xs">
        No valid tree structure found.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/90 backdrop-blur-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-black/20 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400">🌊</span>
          <div>
            <h4 className="text-[12px] font-mono text-zinc-100 font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <span>Sankey Decision Flow</span>
              {tree.ticker && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[9px]">
                  {tree.ticker}
                </span>
              )}
            </h4>
            {tree.title && (
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{tree.title}</p>
            )}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Diagram container */}
      <div className="w-full relative px-2 py-4" style={{ height: 460 }}>
        <Plot
          data={[
            {
              type: "sankey",
              orientation: "h",
              node: chartData.node,
              link: chartData.link,
            },
          ]}
          layout={{
            font: {
              family: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
              size: 9,
              color: "#d4d4d8", // zinc-300
            },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            margin: { l: 20, r: 20, t: 20, b: 20 },
            autosize: true,
            hoverlabel: {
              bgcolor: "#09090b", // zinc-950
              bordercolor: "rgba(255,255,255,0.08)",
              font: {
                family: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
                size: 10,
                color: "#e4e4e7",
              },
            },
          }}
          config={{
            responsive: true,
            displayModeBar: false,
          }}
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}

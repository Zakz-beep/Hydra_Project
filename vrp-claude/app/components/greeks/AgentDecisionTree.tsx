"use client";

import { useCallback, useMemo } from "react";
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  NodeProps,
  Edge,
  Node,
  useNodesState,
  useEdgesState,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  DecisionTree,
  DecisionNode,
  getNodeColor,
  getNodeBg,
  getNodeBorder,
  getNodeIcon,
  getProbabilityColor,
  TreeNodeType,
} from "../../lib/decisionTree";

// ─── Custom Node Components ─────────────────────────────────────────────────

export function DecisionTreeNode({ data }: NodeProps) {
  const node = data.node as DecisionNode;
  const accentColor = getNodeColor(node.color);
  const bgColor = getNodeBg(node.color);
  const borderColor = getNodeBorder(node.color);
  const icon = getNodeIcon(node.type);
  const probColor = getProbabilityColor(node.probability);

  return (
    <div
      className="rounded-xl border backdrop-blur-sm shadow-lg overflow-hidden min-w-[200px] max-w-[260px]"
      style={{
        background: bgColor,
        borderColor: borderColor,
        boxShadow: `0 0 20px ${borderColor.replace("0.3", "0.05")}`,
      }}
      title={node.detail}
    >
      {/* Top accent bar */}
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)` }}
      />

      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-white/[0.06]">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
          {node.type}
        </span>
      </div>

      {/* Label */}
      <div className="px-3 py-2">
        <p className="text-[12px] font-mono text-zinc-200 font-semibold leading-tight">
          {node.label}
        </p>

        {/* Metrics */}
        {node.metrics && Object.keys(node.metrics).length > 0 && (
          <div className="mt-2 space-y-1">
            {Object.entries(node.metrics).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[9px] font-mono text-zinc-500 uppercase">{key}</span>
                <span className="text-[10px] font-mono text-zinc-300 font-bold">{val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Probability bar */}
      <div className="px-3 pb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[8px] font-mono text-zinc-500 uppercase">Probabilitas</span>
          <span className="text-[10px] font-mono font-bold" style={{ color: probColor }}>
            {node.probability}%
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${node.probability}%`,
              background: `linear-gradient(90deg, ${probColor}66, ${probColor})`,
            }}
          />
        </div>
      </div>

      {/* Handles for edges */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !border-2"
        style={{ background: accentColor, borderColor: borderColor }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !border-2"
        style={{ background: accentColor, borderColor: borderColor }}
      />
    </div>
  );
}

// ─── Node Types Registry ────────────────────────────────────────────────────

export const nodeTypes = {
  decisionNode: DecisionTreeNode,
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  tree: DecisionTree;
  onClose?: () => void;
}

// ─── Layout Helpers ─────────────────────────────────────────────────────────

/** Simple tree layout: level-order assignment */
export function buildLayout(tree: DecisionTree): { nodes: Node[]; edges: Edge[] } {
  const nodeMap = new Map<string, DecisionNode>();
  for (const n of tree.nodes) nodeMap.set(n.id, n);

  // Build adjacency
  const children = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  for (const e of tree.edges) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
    parentMap.set(e.to, e.from);
  }

  // Find root (node with no parent)
  const rootId = tree.nodes.find((n) => !parentMap.has(n.id))?.id ?? tree.nodes[0]?.id;
  if (!rootId) return { nodes: [], edges: [] };

  // BFS to assign levels
  const levels = new Map<string, number>();
  const levelCount = new Map<number, number>();
  const queue: { id: string; level: number }[] = [{ id: rootId, level: 0 }];
  levels.set(rootId, 0);
  levelCount.set(0, 1);

  let qi = 0;
  while (qi < queue.length) {
    const { id, level } = queue[qi++];
    const kids = children.get(id) ?? [];
    for (const kid of kids) {
      if (!levels.has(kid)) {
        const nextLevel = level + 1;
        levels.set(kid, nextLevel);
        levelCount.set(nextLevel, (levelCount.get(nextLevel) ?? 0) + 1);
        queue.push({ id: kid, level: nextLevel });
      }
    }
  }

  // Assign positions
  const nodePositions = new Map<string, { x: number; y: number }>();
  const levelPos = new Map<number, number>();

  for (const item of queue) {
    const { id, level } = item;
    const width = 260;
    const height = 180;
    const totalInLevel = levelCount.get(level) ?? 1;
    const idx = levelPos.get(level) ?? 0;
    const x = idx * (width + 40) - ((totalInLevel - 1) * (width + 40)) / 2;
    const y = level * (height + 80) + 40;

    nodePositions.set(id, { x, y });
    levelPos.set(level, idx + 1);
  }

  // Build ReactFlow nodes
  const flowNodes: Node[] = tree.nodes.map((n) => ({
    id: n.id,
    type: "decisionNode",
    position: nodePositions.get(n.id) ?? { x: 0, y: 0 },
    data: { node: n },
  }));

  // Build ReactFlow edges
  const flowEdges: Edge[] = tree.edges.map((e) => {
    const edgeProb = e.probability;
    const probColor = edgeProb !== undefined ? getProbabilityColor(edgeProb) : "#71717a";
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      label: e.label
        ? `${e.label}${edgeProb !== undefined ? ` (${edgeProb}%)` : ""}`
        : edgeProb !== undefined
          ? `${edgeProb}%`
          : undefined,
      type: "smoothstep",
      animated: true,
      style: {
        stroke: probColor,
        strokeWidth: 2,
        opacity: 0.8,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: probColor,
      },
      labelStyle: {
        fill: probColor,
        fontSize: 10,
        fontFamily: "monospace",
        fontWeight: "bold",
      },
      labelBgStyle: {
        fill: "rgba(24,24,27,0.9)",
        rx: 4,
      },
      labelBgPadding: [6, 3] as [number, number],
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AgentDecisionTree({ tree, onClose }: Props) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildLayout(tree),
    [tree]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/90 backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-base">🌲</span>
          <div>
            <h4 className="text-[12px] font-mono text-white font-semibold">
              {tree.title}
            </h4>
            {tree.summary && (
              <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{tree.summary}</p>
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

      {/* React Flow canvas */}
      <div className="w-full" style={{ height: 450 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={1.5}
          attributionPosition="bottom-left"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="rgba(255,255,255,0.03)"
          />
          <Controls
            className="!bg-zinc-900 !border-zinc-700 !rounded-lg [&_button]:!text-zinc-400 [&_button]:!border-zinc-700 [&_button:hover]:!bg-zinc-800"
          />
          <MiniMap
            nodeColor={() => "rgba(139,92,246,0.3)"}
            maskColor="rgba(0,0,0,0.7)"
            style={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.06)" }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

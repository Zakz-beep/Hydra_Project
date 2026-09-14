"use client";

import { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  MarkerType,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Node for styling
const CustomNode = ({ data, isConnectable }: any) => {
  return (
    <div className={`px-4 py-2 shadow-xl rounded-lg border-2 ${data.type === 'primary' ? 'border-blue-500/50 bg-blue-900/20' : data.type === 'secondary' ? 'border-emerald-500/50 bg-emerald-900/20' : data.type === 'tertiary' ? 'border-pink-500/50 bg-pink-900/20' : 'border-zinc-700 bg-zinc-900/80'} backdrop-blur-md`}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} className="w-2 h-2 !bg-zinc-500" />
      <div className="flex flex-col">
        <span className="font-mono font-bold text-xs text-zinc-200">{data.label}</span>
        {data.desc && <span className="font-mono text-[9px] text-zinc-400 mt-1 max-w-[120px]">{data.desc}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} className="w-2 h-2 !bg-zinc-500" />
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

const initialNodes: Node[] = [
  // Primary Inputs (Layer 1)
  { id: 'spot', type: 'custom', data: { label: 'Spot Price (S)', desc: 'Harga aset saat ini', type: 'primary' }, position: { x: 350, y: 50 } },
  { id: 'time', type: 'custom', data: { label: 'Time (T)', desc: 'Waktu kedaluwarsa', type: 'primary' }, position: { x: 50, y: 50 } },
  { id: 'vol', type: 'custom', data: { label: 'Volatility (σ)', desc: 'Implied Volatility', type: 'primary' }, position: { x: 650, y: 50 } },

  // First Order Greeks (Layer 2)
  { id: 'delta', type: 'custom', data: { label: 'Delta (Δ)', desc: 'Sensitivitas opsi vs Harga Spot', type: 'secondary' }, position: { x: 350, y: 200 } },
  { id: 'theta', type: 'custom', data: { label: 'Theta (Θ)', desc: 'Peluruhan waktu', type: 'secondary' }, position: { x: 50, y: 200 } },
  { id: 'vega', type: 'custom', data: { label: 'Vega (ν)', desc: 'Sensitivitas vs Volatilitas', type: 'secondary' }, position: { x: 650, y: 200 } },

  // Second Order Greeks (Layer 3)
  { id: 'gamma', type: 'custom', data: { label: 'Gamma (Γ)', desc: 'Percepatan Delta vs Spot', type: 'tertiary' }, position: { x: 350, y: 350 } },
  { id: 'charm', type: 'custom', data: { label: 'Charm (Delta Decay)', desc: 'Delta vs Waktu (Δ/T)', type: 'tertiary' }, position: { x: 200, y: 350 } },
  { id: 'vanna', type: 'custom', data: { label: 'Vanna (Δ/σ)', desc: 'Delta vs Volatilitas', type: 'tertiary' }, position: { x: 500, y: 350 } },
  { id: 'volga', type: 'custom', data: { label: 'Volga (Vomma)', desc: 'Vega vs Volatilitas', type: 'tertiary' }, position: { x: 650, y: 350 } },
  
  // Third Order Greeks (Layer 4)
  { id: 'speed', type: 'custom', data: { label: 'Speed', desc: 'Gamma vs Spot', type: 'default' }, position: { x: 200, y: 500 } },
  { id: 'color', type: 'custom', data: { label: 'Color (Gamma Decay)', desc: 'Gamma vs Waktu', type: 'default' }, position: { x: 350, y: 500 } },
  { id: 'zomma', type: 'custom', data: { label: 'Zomma', desc: 'Gamma vs Volatilitas', type: 'default' }, position: { x: 500, y: 500 } },
];

const initialEdges: Edge[] = [
  // Spot dependencies
  { id: 'e-spot-delta', source: 'spot', target: 'delta', animated: true, style: { stroke: '#3b82f6' } },
  { id: 'e-delta-gamma', source: 'delta', target: 'gamma', animated: true, style: { stroke: '#10b981' } },
  { id: 'e-gamma-speed', source: 'gamma', target: 'speed', animated: true, style: { stroke: '#71717a' } },

  // Time dependencies
  { id: 'e-time-theta', source: 'time', target: 'theta', animated: true, style: { stroke: '#3b82f6' } },
  { id: 'e-time-charm', source: 'time', target: 'charm', animated: true, style: { stroke: '#10b981' }, label: 'via Delta' },
  { id: 'e-delta-charm', source: 'delta', target: 'charm', style: { stroke: '#3f3f46' } },
  { id: 'e-time-color', source: 'time', target: 'color', animated: true, style: { stroke: '#71717a' }, label: 'via Gamma' },
  { id: 'e-gamma-color', source: 'gamma', target: 'color', style: { stroke: '#3f3f46' } },

  // Volatility dependencies
  { id: 'e-vol-vega', source: 'vol', target: 'vega', animated: true, style: { stroke: '#3b82f6' } },
  { id: 'e-vol-volga', source: 'vega', target: 'volga', animated: true, style: { stroke: '#10b981' } },
  
  // Cross dependencies (Vanna, Zomma)
  { id: 'e-vol-vanna', source: 'vol', target: 'vanna', animated: true, style: { stroke: '#10b981' }, label: 'via Delta' },
  { id: 'e-delta-vanna', source: 'delta', target: 'vanna', style: { stroke: '#3f3f46' } },
  
  { id: 'e-vol-zomma', source: 'vol', target: 'zomma', animated: true, style: { stroke: '#71717a' }, label: 'via Gamma' },
  { id: 'e-gamma-zomma', source: 'gamma', target: 'zomma', style: { stroke: '#3f3f46' } },
];

export default function GreeksDependencyGraph() {
  const nodes = useMemo(() => initialNodes, []);
  const edges = useMemo(() => initialEdges.map(edge => ({
    ...edge,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: edge.style?.stroke || '#71717a',
    },
    labelStyle: { fill: '#a1a1aa', fontFamily: 'monospace', fontSize: 9 },
    labelBgStyle: { fill: '#18181b', opacity: 0.8 },
  })), []);

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4 space-y-4 overflow-hidden h-[500px] flex flex-col">
       <div className="flex justify-between items-center mb-2">
          <div>
             <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Greeks Dependency Network Map</h3>
             <div className="flex gap-4 mt-1 text-[10px] font-mono">
                <span className="text-blue-400">1st Order</span>
                <span className="text-emerald-400">2nd Order</span>
                <span className="text-pink-400">3rd Order</span>
             </div>
          </div>
          <span className="text-[10px] text-zinc-600 font-mono">Powered by React Flow</span>
       </div>
       <div className="flex-1 w-full relative bg-[#0a0a0a] rounded-lg border border-zinc-800/50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-right"
            className="react-flow-dark"
          >
            <Background color="#27272a" gap={16} size={1} />
            <Controls className="!bg-zinc-800 !border-zinc-700 !fill-zinc-400" />
          </ReactFlow>
       </div>
    </div>
  );
}

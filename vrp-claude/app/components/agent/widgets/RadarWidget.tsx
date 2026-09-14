import React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

export interface RadarData {
  subject: string;
  value: number;
  fullMark: number;
}

export interface RadarWidgetProps {
  title: string;
  data: RadarData[];
  color?: string;
}

const COLOR_MAP: Record<string, { stroke: string; fill: string }> = {
  violet: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.4)" },
  emerald: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.4)" },
  amber: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.4)" },
  rose: { stroke: "#f43f5e", fill: "rgba(244, 63, 94, 0.4)" },
  sky: { stroke: "#0ea5e9", fill: "rgba(14, 165, 233, 0.4)" },
  default: { stroke: "#8b5cf6", fill: "rgba(139, 92, 246, 0.4)" }
};

export default function RadarWidget({ title, data, color = "violet" }: RadarWidgetProps) {
  const theme = COLOR_MAP[color] || COLOR_MAP.default;

  return (
    <div className="mt-2 mb-2 border border-white/[0.1] bg-zinc-950/90 backdrop-blur-md rounded-xl overflow-hidden shadow-2xl w-full max-w-sm">
      <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.02]">
        <h4 className="text-[11px] font-mono font-bold text-zinc-200 tracking-widest">{title}</h4>
      </div>
      <div className="h-56 w-full pt-4 pb-2">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="65%" data={data}>
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis 
              dataKey="subject" 
              tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 9, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} 
            />
            <PolarRadiusAxis 
              angle={90} 
              domain={[0, 100]} 
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 8 }}
              axisLine={false}
              tickCount={6}
            />
            <Radar
              name={title}
              dataKey="value"
              stroke={theme.stroke}
              fill={theme.fill}
              strokeWidth={1.5}
              fillOpacity={0.6}
              isAnimationActive={true}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

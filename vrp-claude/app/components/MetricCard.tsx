// app/components/MetricCard.tsx
"use client";

import { ReactNode } from "react";

interface MetricCardProps {
  label:      string;
  value:      string;
  sub?:       string;
  highlight?: "green" | "red" | "amber" | "neutral";
  badge?:     ReactNode;
  tooltip?:   string;
  size?:      "sm" | "md" | "lg";
}

const highlightClasses = {
  green:   "text-emerald-400",
  red:     "text-red-400",
  amber:   "text-amber-400",
  neutral: "text-zinc-200",
};

export default function MetricCard({
  label,
  value,
  sub,
  highlight = "neutral",
  badge,
  tooltip,
  size = "md",
}: MetricCardProps) {
  const valueSize = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-3xl",
  }[size];

  return (
    <div
      className="relative group rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-4 py-3 flex flex-col gap-1 hover:border-zinc-700/60 transition-colors"
      title={tooltip}
    >
      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">
          {label}
        </span>
        {badge}
      </div>

      {/* Value */}
      <span className={`font-mono font-semibold ${valueSize} ${highlightClasses[highlight]} leading-none`}>
        {value}
      </span>

      {/* Sub text */}
      {sub && (
        <span className="text-[11px] font-mono text-zinc-600 leading-none mt-0.5">
          {sub}
        </span>
      )}
    </div>
  );
}

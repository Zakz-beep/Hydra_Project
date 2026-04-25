// app/components/SignalBadge.tsx
"use client";

import { SignalType, SIGNAL_META } from "../lib/vrp";

interface SignalBadgeProps {
  signal: SignalType;
  size?:  "sm" | "md" | "lg";
  desc?:  string;
}

export default function SignalBadge({ signal, size = "md", desc }: SignalBadgeProps) {
  const meta = SIGNAL_META[signal];

  const padding = {
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-3 py-1   text-xs",
    lg: "px-4 py-1.5 text-sm",
  }[size];

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-semibold tracking-wide
          ${padding} ${meta.color} ${meta.bg} ${meta.border}`}
      >
        <span className="text-base leading-none">{meta.icon}</span>
        {meta.label}
      </span>
      {desc && (
        <span className="text-[11px] text-zinc-500 font-mono leading-snug max-w-xs">
          {desc}
        </span>
      )}
    </div>
  );
}

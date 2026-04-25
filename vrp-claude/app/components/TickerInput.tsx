// app/components/TickerInput.tsx
"use client";

import { useState, KeyboardEvent } from "react";

const PRESETS = ["^GSPC", "^NDX", "QQQ", "SPY", "NQ=F", "BBRI.JK", "TLKM.JK"];

interface TickerInputProps {
  value:     string;
  onChange:  (ticker: string) => void;
  loading?:  boolean;
}

export default function TickerInput({ value, onChange, loading }: TickerInputProps) {
  const [draft, setDraft] = useState(value);

  const submit = () => {
    const t = draft.trim().toUpperCase();
    if (t) onChange(t);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Input row */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={onKey}
            placeholder="^GSPC"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 font-mono text-sm text-zinc-100
              placeholder-zinc-600 focus:outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30
              transition-colors"
          />
          {loading && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-zinc-500 border-t-zinc-200 animate-spin" />
            </span>
          )}
        </div>
        <button
          onClick={submit}
          disabled={loading}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40
            border border-zinc-700 rounded-lg font-mono text-xs text-zinc-300
            transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Fetch
        </button>
      </div>

      {/* Preset chips */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((t) => (
          <button
            key={t}
            onClick={() => { setDraft(t); onChange(t); }}
            className={`px-2 py-0.5 rounded font-mono text-[10px] border transition-colors cursor-pointer
              ${value === t
                ? "bg-zinc-700 border-zinc-500 text-zinc-200"
                : "bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
              }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { PERSONAS, PersonaId, Persona } from "../../lib/personas";

interface Props {
  currentPersona: PersonaId;
  onChange: (id: PersonaId) => void;
}

const PERSONA_ORDER: PersonaId[] = ["quant", "strategist", "sensei", "default"];

export default function PersonaSelector({ currentPersona, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = PERSONAS[currentPersona];

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-all select-none ${active.bgClass} ${active.borderClass} ${active.colorClass} hover:brightness-125`}
        title="Switch persona"
      >
        <span>{active.emoji}</span>
        <span>{active.shortName}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-50 rounded-xl border border-white/[0.07] bg-zinc-950/95 backdrop-blur-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Pilih Persona AI</p>
          </div>

          {/* Persona Cards */}
          <div className="p-2 space-y-1.5">
            {PERSONA_ORDER.map(id => {
              const p = PERSONAS[id];
              const isActive = id === currentPersona;
              return (
                <button
                  key={id}
                  onClick={() => { onChange(id); setOpen(false); }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                    isActive
                      ? `${p.bgClass} ${p.borderClass}`
                      : "border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]"
                  }`}
                >
                  {/* Avatar */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 bg-gradient-to-br ${p.accentGradient} border ${p.borderClass}`}>
                    {p.emoji}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-[11px] font-mono font-bold ${isActive ? p.colorClass : "text-zinc-300"}`}>
                        {p.name}
                      </span>
                      {isActive && (
                        <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded-full border ${p.bgClass} ${p.borderClass} ${p.colorClass}`}>
                          AKTIF
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] font-mono text-zinc-500 mt-0.5 leading-relaxed">{p.tagline}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-white/[0.05] bg-white/[0.01]">
            <p className="text-[8px] font-mono text-zinc-700 text-center">
              Persona mempengaruhi gaya bicara & cara analisis AI
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

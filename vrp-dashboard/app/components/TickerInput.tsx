'use client'
// components/TickerInput.tsx

import { useState } from 'react'
import { Search } from 'lucide-react'

interface Props {
  value: string
  onSubmit: (ticker: string) => void
  loading: boolean
}

const PRESETS = ['^GSPC', '^NDX', 'BBRI.JK', 'TLKM.JK', 'AAPL', 'NVDA']

export default function TickerInput({ value, onSubmit, loading }: Props) {
  const [input, setInput] = useState(value)

  const handle = () => {
    const t = input.trim().toUpperCase()
    if (t) onSubmit(t)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dim" />
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handle()}
            placeholder="TICKER..."
            className="w-full bg-surface border border-border rounded pl-8 pr-4 py-2
                       font-mono text-sm text-bright placeholder-dim
                       focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <button
          onClick={handle}
          disabled={loading}
          className="px-4 py-2 bg-accent/10 border border-accent/30 rounded
                     font-mono text-xs text-accent tracking-widest uppercase
                     hover:bg-accent/20 active:bg-accent/30
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all duration-200"
        >
          {loading ? 'LOADING...' : 'FETCH'}
        </button>
      </div>

      {/* Preset tickers */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(t => (
          <button
            key={t}
            onClick={() => { setInput(t); onSubmit(t) }}
            className="px-2 py-0.5 text-[10px] font-mono text-dim border border-muted/50 rounded-sm
                       hover:text-accent hover:border-accent/40 transition-colors"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

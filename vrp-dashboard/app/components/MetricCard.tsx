'use client'
// components/MetricCard.tsx

import clsx from 'clsx'

interface Props {
  label: string
  value: string
  sub?: string
  accent?: string   // hex color
  glow?: boolean
  size?: 'sm' | 'md' | 'lg'
  badge?: string
  animateIn?: boolean
}

export default function MetricCard({
  label, value, sub, accent = '#00D4FF', glow = false, size = 'md', badge, animateIn = false,
}: Props) {
  const valueSize = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-5xl',
  }

  return (
    <div
      className={clsx(
        'relative flex flex-col gap-1 p-4 rounded border bg-surface overflow-hidden',
        'transition-all duration-300',
        animateIn && 'animate-slide-up',
      )}
      style={{
        borderColor: accent + '33',
        boxShadow:   glow ? `0 0 24px ${accent}22, inset 0 0 24px ${accent}08` : undefined,
      }}
    >
      {/* Top-left corner accent */}
      <div
        className="absolute top-0 left-0 w-8 h-px"
        style={{ backgroundColor: accent }}
      />
      <div
        className="absolute top-0 left-0 w-px h-8"
        style={{ backgroundColor: accent }}
      />

      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-dim tracking-widest uppercase">{label}</span>
        {badge && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded-sm"
            style={{ color: accent, backgroundColor: accent + '15', border: `1px solid ${accent}30` }}>
            {badge}
          </span>
        )}
      </div>

      <span
        className={clsx('font-mono font-bold tabular-nums', valueSize[size])}
        style={{ color: accent }}
      >
        {value}
      </span>

      {sub && (
        <span className="text-xs font-mono text-dim">{sub}</span>
      )}
    </div>
  )
}

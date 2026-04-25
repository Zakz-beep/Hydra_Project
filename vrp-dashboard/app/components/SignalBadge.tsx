'use client'
// components/SignalBadge.tsx

import { SIGNAL_META, SignalKey } from '../lib/vrp'
import clsx from 'clsx'

interface Props {
  signal: SignalKey
  size?: 'sm' | 'md' | 'lg'
  animate?: boolean
}

export default function SignalBadge({ signal, size = 'md', animate = false }: Props) {
  const meta = SIGNAL_META[signal]

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-sm px-3 py-1 gap-1.5',
    lg: 'text-base px-4 py-2 gap-2',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center font-mono font-bold tracking-widest uppercase rounded-sm border',
        sizeClasses[size],
        animate && 'animate-pulse-slow',
      )}
      style={{
        color:           meta.color,
        borderColor:     meta.color + '55',
        backgroundColor: meta.color + '12',
        boxShadow:       `0 0 12px ${meta.color}22`,
      }}
    >
      <span className="text-base leading-none">{meta.emoji}</span>
      <span>{meta.label}</span>
    </span>
  )
}

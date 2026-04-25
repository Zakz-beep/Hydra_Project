'use client'
// components/VRPGauge.tsx

interface Props {
  zScore: number
}

export default function VRPGauge({ zScore }: Props) {
  // Clamp z-score to [-3, +3] for display
  const clamped = Math.max(-3, Math.min(3, zScore))
  // Map [-3,+3] to [0,100]%
  const pct = ((clamped + 3) / 6) * 100

  // Color based on zone
  const getColor = (z: number) => {
    if (z > 1.5)  return '#FF3B5C'
    if (z > 0.5)  return '#FF8C00'
    if (z < -1.5) return '#00FF9C'
    if (z < -0.5) return '#FFD700'
    return '#4A5E75'
  }

  const color = getColor(zScore)

  const zones = [
    { label: 'STRONG\nLONG',  pct: 0,    color: '#00FF9C' },
    { label: 'MILD\nLONG',    pct: 16.7, color: '#FFD700' },
    { label: 'NEUTRAL',       pct: 33.3, color: '#4A5E75' },
    { label: 'MILD\nSHORT',   pct: 50,   color: '#FF8C00' },
    { label: 'STRONG\nSHORT', pct: 66.7, color: '#FF3B5C' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-dim tracking-widest uppercase">VRP Z-Score</span>
        <span className="text-xs font-mono" style={{ color }}>
  {typeof zScore === 'number' 
    ? `${zScore >= 0 ? '+' : ''}${zScore.toFixed(2)}σ` 
    : '—'
  }
</span>
      </div>

      {/* Gauge track */}
      <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#1A2230' }}>
        {/* Gradient track */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, #00FF9C, #FFD700, #4A5E75, #FF8C00, #FF3B5C)',
            opacity: 0.25,
          }}
        />

        {/* Zone markers */}
        {[16.7, 33.3, 50, 66.7, 83.3].map((p, i) => (
          <div key={i} className="absolute top-0 bottom-0 w-px" style={{ left: `${p}%`, backgroundColor: '#080C1060' }} />
        ))}

        {/* Needle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-5 rounded-sm transition-all duration-700 ease-out"
          style={{
            left:            `calc(${pct}% - 4px)`,
            backgroundColor: color,
            boxShadow:       `0 0 8px ${color}, 0 0 16px ${color}88`,
          }}
        />
      </div>

      {/* Zone labels */}
      <div className="flex justify-between text-[9px] font-mono text-dim">
        <span style={{ color: '#00FF9C' }}>−3σ</span>
        <span>−1.5σ</span>
        <span>−0.5σ</span>
        <span>0</span>
        <span>+0.5σ</span>
        <span>+1.5σ</span>
        <span style={{ color: '#FF3B5C' }}>+3σ</span>
      </div>
    </div>
  )
}

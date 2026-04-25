'use client'
// components/Pipeline.tsx

interface Props {
  activeStep: number  // 0-4
  loading: boolean
}

const STEPS = [
  { id: 0, label: 'COLLECT',  sub: 'OHLC/Tick' },
  { id: 1, label: 'HITUNG RV', sub: 'GK/HAR-RV' },
  { id: 2, label: 'EXTRACT IV', sub: 'BSM+N-R' },
  { id: 3, label: 'HITUNG VRP', sub: 'IV − RV' },
  { id: 4, label: 'SIGNAL',   sub: 'Long/Short' },
]

export default function Pipeline({ activeStep, loading }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {STEPS.map((step, i) => {
        const isDone    = !loading && activeStep >= step.id
        const isActive  = loading && activeStep === step.id
        const isPending = !isDone && !isActive

        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {/* Step box */}
            <div
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded border transition-all duration-500"
              style={{
                borderColor:     isDone ? '#00D4FF55' : isActive ? '#FFD70055' : '#1A2230',
                backgroundColor: isDone ? '#00D4FF0A' : isActive ? '#FFD7000A' : 'transparent',
              }}
            >
              <div className="flex items-center gap-1">
                {/* Status dot */}
                <div
                  className={`w-1.5 h-1.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
                  style={{
                    backgroundColor: isDone ? '#00D4FF' : isActive ? '#FFD700' : '#2A3545',
                  }}
                />
                <span
                  className="text-[10px] font-mono font-bold tracking-wider uppercase"
                  style={{ color: isDone ? '#00D4FF' : isActive ? '#FFD700' : '#4A5E75' }}
                >
                  {step.label}
                </span>
              </div>
              <span className="text-[9px] font-mono text-dim">{step.sub}</span>
            </div>

            {/* Arrow */}
            {i < STEPS.length - 1 && (
              <div
                className="text-xs transition-colors duration-500"
                style={{ color: isDone ? '#00D4FF55' : '#1A2230' }}
              >
                →
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

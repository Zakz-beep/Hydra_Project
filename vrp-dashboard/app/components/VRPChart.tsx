'use client'
// components/VRPChart.tsx

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { HistoryPoint } from '../lib/vrp'

interface Props {
  data: HistoryPoint[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border rounded p-3 text-xs font-mono space-y-1">
      <div className="text-dim">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value.toFixed(2)}%
        </div>
      ))}
    </div>
  )
}

export default function VRPChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-dim text-xs font-mono">
        AWAITING DATA... ({data.length} pts)
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1A2230" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fill: '#4A5E75', fontSize: 10, fontFamily: 'monospace' }}
          tickLine={false}
          axisLine={{ stroke: '#1A2230' }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#4A5E75', fontSize: 10, fontFamily: 'monospace' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={v => `${v}%`}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="#2A3545" strokeDasharray="4 4" />
        <Legend
          wrapperStyle={{ fontSize: 10, fontFamily: 'monospace', paddingTop: 8 }}
          iconType="line"
        />
        <Line
          type="monotone"
          dataKey="iv"
          name="IV"
          stroke="#00D4FF"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#00D4FF' }}
        />
        <Line
          type="monotone"
          dataKey="rv"
          name="RV"
          stroke="#FF8C00"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#FF8C00' }}
        />
        <Line
          type="monotone"
          dataKey="vrp"
          name="VRP"
          stroke="#00FF9C"
          strokeWidth={2}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 4, fill: '#00FF9C' }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

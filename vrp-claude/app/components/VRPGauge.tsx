// app/components/VRPGauge.tsx
"use client";

import { useMemo } from "react";

interface VRPGaugeProps {
  vrpZ:    number;   // z-score, roughly -3 to +3
  vrpPct:  number;   // raw VRP in percent
}

export default function VRPGauge({ vrpZ, vrpPct }: VRPGaugeProps) {
  // Clamp z to [-3, 3] and map to 0–180 degrees arc
  const clampedZ = Math.max(-3, Math.min(3, vrpZ));
  // Map: -3 → 0deg (left), 0 → 90deg (center), +3 → 180deg (right)
  const angleDeg = ((clampedZ + 3) / 6) * 180;

  const { needleX, needleY, arcColor } = useMemo(() => {
    const rad = ((angleDeg - 180) * Math.PI) / 180;
    const cx = 100, cy = 100, r = 70;
    const nx = cx + r * Math.cos(rad);
    const ny = cy + r * Math.sin(rad);

    let color = "#71717a"; // neutral zinc
    if (vrpZ > 1.5)       color = "#34d399"; // emerald strong
    else if (vrpZ > 0.5)  color = "#6ee7b7"; // emerald mild
    else if (vrpZ < -1.5) color = "#f87171"; // red strong
    else if (vrpZ < -0.5) color = "#fcd34d"; // amber mild

    return { needleX: nx, needleY: ny, arcColor: color };
  }, [angleDeg, vrpZ]);

  // Arc segments: left=long vol zone, center=neutral, right=short vol zone
  const segments = [
    { start: 180, end: 240, color: "#7f1d1d44", label: "Long Vol" },
    { start: 240, end: 270, color: "#78350f44" },
    { start: 270, end: 300, color: "#3f3f4644" },
    { start: 300, end: 330, color: "#052e1644" },
    { start: 330, end: 360, color: "#14532d44", label: "Short Vol" },
  ];

  function arcPath(startDeg: number, endDeg: number, r: number, cx: number, cy: number) {
    const s = ((startDeg - 180) * Math.PI) / 180;
    const e = ((endDeg   - 180) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="20 30 160 90" className="w-full max-w-[220px]">
        {/* Segment fills */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={arcPath(seg.start, seg.end, 78, 100, 100)}
            fill={seg.color}
          />
        ))}

        {/* Outer arc track */}
        <path
          d="M 22 100 A 78 78 0 0 1 178 100"
          fill="none"
          stroke="#3f3f46"
          strokeWidth="2"
        />

        {/* Tick marks */}
        {[-3, -2, -1, 0, 1, 2, 3].map((z) => {
          const a = (((z + 3) / 6) * 180 - 180) * (Math.PI / 180);
          const x1 = 100 + 72 * Math.cos(a), y1 = 100 + 72 * Math.sin(a);
          const x2 = 100 + 80 * Math.cos(a), y2 = 100 + 80 * Math.sin(a);
          const lx  = 100 + 90 * Math.cos(a), ly  = 100 + 90 * Math.sin(a);
          return (
            <g key={z}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#52525b" strokeWidth="1.5" />
              <text
                x={lx} y={ly}
                textAnchor="middle" dominantBaseline="middle"
                fontSize="6" fill="#71717a" fontFamily="monospace"
              >
                {z > 0 ? `+${z}` : z}
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <line
          x1="100" y1="100"
          x2={needleX} y2={needleY}
          stroke={arcColor}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Needle pivot */}
        <circle cx="100" cy="100" r="4" fill={arcColor} />
        <circle cx="100" cy="100" r="2" fill="#18181b" />

        {/* Center value label */}
        <text
          x="100" y="85"
          textAnchor="middle" dominantBaseline="middle"
          fontSize="11" fontWeight="700" fill={arcColor}
          fontFamily="monospace"
        >
          {vrpZ >= 0 ? `+${vrpZ.toFixed(2)}σ` : `${vrpZ.toFixed(2)}σ`}
        </text>
        <text
          x="100" y="95"
          textAnchor="middle" dominantBaseline="middle"
          fontSize="6.5" fill="#71717a"
          fontFamily="monospace"
        >
          VRP {vrpPct >= 0 ? "+" : ""}{vrpPct.toFixed(2)}%
        </text>

        {/* Zone labels */}
        <text x="28"  y="108" fontSize="6" fill="#f87171" fontFamily="monospace" textAnchor="middle">LONG</text>
        <text x="172" y="108" fontSize="6" fill="#34d399" fontFamily="monospace" textAnchor="middle">SHORT</text>
      </svg>
    </div>
  );
}

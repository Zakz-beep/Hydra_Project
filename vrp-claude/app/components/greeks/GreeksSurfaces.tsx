// app/components/greeks/GreeksSurfaces.tsx
"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine, Legend, ScatterChart, Scatter, ZAxis
} from "recharts";
import { GreeksSnapshot, StrikeGreeks, fmtGex } from "../../lib/greeks";

interface GreeksSurfacesProps {
  data: GreeksSnapshot;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-400 mb-1">Strike: {label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-4 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-zinc-200">
             {typeof p.value === "number" ? p.value.toFixed(2) : p.value}
          </span>
        </div>
      ))}
      {payload[0]?.payload?.call_oi !== undefined && (
        <>
          <div className="flex gap-4 justify-between mt-2 pt-2 border-t border-zinc-700/50">
            <span className="text-zinc-500">Call OI</span>
            <span className="text-zinc-300">{payload[0].payload.call_oi.toLocaleString()}</span>
          </div>
          <div className="flex gap-4 justify-between">
            <span className="text-zinc-500">Put OI</span>
            <span className="text-zinc-300">{payload[0].payload.put_oi.toLocaleString()}</span>
          </div>
          <div className="flex gap-4 justify-between mt-2 pt-2 border-t border-zinc-700/50">
            <span className="text-zinc-500">Vanna Exp</span>
            <span className={(payload[0].payload.vanna || 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
              {fmtGex(payload[0].payload.vanna || 0)}
            </span>
          </div>
          <div className="flex gap-4 justify-between">
            <span className="text-zinc-500">Charm Exp</span>
            <span className={(payload[0].payload.charm || 0) >= 0 ? "text-emerald-400" : "text-red-400"}>
              {fmtGex(payload[0].payload.charm || 0)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

const CustomReferenceLabel = ({ viewBox, value, fill, position = "top" }: any) => {
  const { x, y, width, height } = viewBox;
  const isTop = position === "top";
  const rectY = isTop ? y + 15 : y + height - 25;
  return (
    <g>
      <rect x={x - 45} y={rectY - 12} width={90} height={18} fill={fill} rx={4} />
      <text x={x} y={rectY} fill="#fff" fontSize={10} fontFamily="monospace" textAnchor="middle">{value}</text>
    </g>
  );
};

export default function GreeksSurfaces({ data }: GreeksSurfacesProps) {
  const [activeDte, setActiveDte] = useState<string>("all");

  const { gexProfile, volSurface, netGexTot, posGexTot, negGexTot, callWallStrike, putWallStrike, overallMaxPain } = useMemo(() => {
    if (!data.by_expiry) return { gexProfile: [], volSurface: [], netGexTot: 0, posGexTot: 0, negGexTot: 0, callWallStrike: 0, putWallStrike: 0, overallMaxPain: null };

    const strikeGexMap = new Map<number, { strike: number, call_gex: number, put_gex: number, total_oi: number, call_oi: number, put_oi: number, vanna: number, charm: number }>();
    const volMap = new Map<number, any>();

    let posGex = 0;
    let negGex = 0;

    Object.entries(data.by_expiry).forEach(([bucketKey, bucket]) => {
       // Filter by DTE if selected
       if (activeDte !== "all" && bucketKey !== activeDte) return;

       if (bucket.strikes) {
         bucket.strikes.forEach((s) => {
           // GEX AGGREGATION
           if (!strikeGexMap.has(s.strike)) {
             strikeGexMap.set(s.strike, { strike: s.strike, call_gex: 0, put_gex: 0, total_oi: 0, call_oi: 0, put_oi: 0, vanna: 0, charm: 0 });
           }
           const st = strikeGexMap.get(s.strike)!;
           st.total_oi += (s.oi || 0);
           st.vanna += (s.vanna_exp || 0);
           st.charm += (s.charm_exp || 0);
           
           let val = s.gex_spotgamma;
           if (s.option_type === "call") {
             val = Math.abs(val);
             st.call_gex += val;
             posGex += val;
             st.call_oi += s.oi || 0;
           } else {
             val = -Math.abs(val);
             st.put_gex += val;
             negGex += val;
             st.put_oi += s.oi || 0;
           }

           // VOL SURFACE AGGREGATION
           if (!volMap.has(s.strike)) {
             volMap.set(s.strike, { strike: s.strike });
           }
           const vs = volMap.get(s.strike)!;
           if (s.oi > 10) { 
              if (!vs[`iv_${bucketKey}`]) vs[`iv_${bucketKey}`] = s.iv * 100;
              else vs[`iv_${bucketKey}`] = (vs[`iv_${bucketKey}`] + s.iv * 100) / 2;
           }
         });
       }
    });

    const gexArr = Array.from(strikeGexMap.values())
      .map(v => ({ 
         ...v, 
         net_gex: v.call_gex + v.put_gex,
         abs_gex: Math.abs(v.call_gex) + Math.abs(v.put_gex)
      }))
      .sort((a, b) => a.strike - b.strike);
      
    let callWallStrike = 0;
    let putWallStrike = 0;
    let maxCallGex = 0;
    let maxPutGex = 0; // Since put_gex is negative, we want the lowest value

    gexArr.forEach(v => {
      if (v.call_gex > maxCallGex) {
        maxCallGex = v.call_gex;
        callWallStrike = v.strike;
      }
      if (v.put_gex < maxPutGex) {
        maxPutGex = v.put_gex;
        putWallStrike = v.strike;
      }
    });

    const spot = data.spot || 0;
    const gexFiltered = spot > 0 ? gexArr.filter(x => x.strike >= spot * 0.85 && x.strike <= spot * 1.15) : gexArr;
    
    const volArr = Array.from(volMap.values())
      .sort((a,b) => a.strike - b.strike);
    
    const volFiltered = spot > 0 ? volArr.filter(x => x.strike >= spot * 0.85 && x.strike <= spot * 1.15) : volArr;

    let overallMaxPain: number | null = null;
    if (activeDte !== "all" && data.by_expiry[activeDte]) {
      overallMaxPain = data.by_expiry[activeDte].max_pain || null;
    } else {
      const buckets = Object.values(data.by_expiry);
      if (buckets.length > 0) {
        const minDteBucket = buckets.reduce((prev, curr) => prev.dte_bucket < curr.dte_bucket ? prev : curr);
        overallMaxPain = minDteBucket.max_pain || null;
      }
    }

    return { 
       gexProfile: gexFiltered, 
       volSurface: volFiltered,
       posGexTot: posGex,
       negGexTot: negGex,
       netGexTot: posGex + negGex,
       callWallStrike,
       putWallStrike,
       overallMaxPain
    };
  }, [data, activeDte]);

  if (!data.by_expiry) {
     return <div className="text-zinc-500 font-mono text-sm">Tidak ada data strike (by_expiry) yang tersedia.</div>;
  }

  return (
    <div className="space-y-4">
       
      {/* Filters & Net Summary */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-5 py-4">
         <div className="flex gap-2 text-xs font-mono">
            <span className="text-zinc-500 my-auto">DTE Filter:</span>
            {["all", Object.keys(data.by_expiry)].flat().map(dte => (
               <button 
                  key={dte}
                  onClick={() => setActiveDte(dte as string)}
                  className={`px-2 py-1 rounded transition-colors ${activeDte === dte ? "bg-indigo-900/60 text-indigo-300 border border-indigo-700/50" : "bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800"}`}
               >
                  {dte === "all" ? "All Expiries" : `${dte} DTE`}
               </button>
            ))}
         </div>
         
         {/* Net GEX Summary Table */}
         <div className="flex gap-4 font-mono text-[11px]">
            <div className="text-right">
               <div className="text-zinc-500">Call / Pos GEX</div>
               <div className="text-emerald-400">+{posGexTot.toFixed(2)}</div>
            </div>
            <div className="text-right">
               <div className="text-zinc-500">Put / Neg GEX</div>
               <div className="text-red-400">{negGexTot.toFixed(2)}</div>
            </div>
            <div className="text-right border-l border-zinc-700 pl-4">
               <div className="text-zinc-500 font-bold">Total Net GEX</div>
               <div className={`font-bold ${netGexTot >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {netGexTot > 0 ? "+" : ""}{netGexTot.toFixed(2)}
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
         
         {/* CHART: GEX Profile / Walls */}
         <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
            <div className="flex justify-between items-center mb-4">
               <div>
                  <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">GEX Profile (Call vs Put Wall)</h3>
                  <div className="flex gap-4 mt-1 text-[10px] font-mono">
                     <span className="text-emerald-400">Call Wall: {callWallStrike > 0 ? callWallStrike : "-"}</span>
                     <span className="text-red-400">Put Wall: {putWallStrike > 0 ? putWallStrike : "-"}</span>
                  </div>
               </div>
               <span className="text-[10px] text-zinc-600 font-mono">Spot: ${data.spot ? data.spot.toFixed(2) : "N/A"}</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
               <ComposedChart data={gexProfile} margin={{ top: 20, right: 0, left: -20, bottom: 0 }} barGap={0} barCategoryGap="10%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => v?.toFixed ? (v/1000).toFixed(0) + "k" : v} />
                  <Tooltip content={<CustomTooltip />} cursor={{fill: '#27272a', opacity: 0.4}} />
                  <ReferenceLine y={0} stroke="#3f3f46" />
                  
                  {data.spot && <ReferenceLine x={data.spot} stroke="#3b82f6" strokeDasharray="4 4" label={<CustomReferenceLabel value="Current Price" fill="#3b82f6" position="bottom" />} />}
                  {overallMaxPain && <ReferenceLine x={overallMaxPain} stroke="#f59e0b" strokeDasharray="4 4" label={<CustomReferenceLabel value="Max Pain" fill="#f59e0b" position="top" />} />}
                  
                  <Bar dataKey="call_gex" name="Call GEX" fill="#10b981" stackId="stack" />
                  <Bar dataKey="put_gex" name="Put GEX" fill="#ef4444" stackId="stack" />
                  <Line type="monotone" dataKey="abs_gex" name="Absolute GEX" stroke="#eab308" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#eab308" }} />
               </ComposedChart>
            </ResponsiveContainer>
         </div>

         {/* CHART: Volatility Surface (Skew) */}
         <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-4">Volatility Skew (IV by Strike & DTE)</h3>
            <ResponsiveContainer width="100%" height={260}>
               <LineChart data={volSurface} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => v?.toFixed ? `${v.toFixed(0)}%` : `${v}%`} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }} />
                  {data.spot && <ReferenceLine x={data.spot} stroke="#e4e4e7" strokeDasharray="3 3" />}
                  
                  {activeDte === "all" ? (
                     // Draw top 3 common DTEs
                     ["0", "1", "7"].map((dte, idx) => {
                        const colors = ["#818cf8", "#fb923c", "#f472b6", "#34d399"];
                        return (
                           <Line key={dte} type="monotone" dataKey={`iv_${dte}`} name={`${dte} DTE`} stroke={colors[idx]} strokeWidth={2} dot={false} connectNulls />
                        )
                     })
                  ) : (
                     <Line type="monotone" dataKey={`iv_${activeDte}`} name={`${activeDte} DTE IV`} stroke="#818cf8" strokeWidth={2} dot={true} connectNulls />
                  )}
               </LineChart>
            </ResponsiveContainer>
         </div>
         
      </div>
    </div>
  );
}

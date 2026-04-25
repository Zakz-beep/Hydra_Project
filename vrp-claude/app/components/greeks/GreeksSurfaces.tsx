// app/components/greeks/GreeksSurfaces.tsx
"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine, Legend, ScatterChart, Scatter, ZAxis
} from "recharts";
import { GreeksSnapshot, StrikeGreeks } from "../../lib/greeks";

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
    </div>
  );
};

export default function GreeksSurfaces({ data }: GreeksSurfacesProps) {
  const [activeDte, setActiveDte] = useState<string>("all");

  const { gexProfile, volSurface, netGexTot, posGexTot, negGexTot } = useMemo(() => {
    if (!data.by_expiry) return { gexProfile: [], volSurface: [], netGexTot: 0, posGexTot: 0, negGexTot: 0 };

    const strikeGexMap = new Map<number, { strike: number, call_gex: number, put_gex: number }>();
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
             strikeGexMap.set(s.strike, { strike: s.strike, call_gex: 0, put_gex: 0 });
           }
           const st = strikeGexMap.get(s.strike)!;
           
           // We assume gex_spotgamma is absolute or directional.
           // Commonly dealer is short calls (negative gamma) and long puts (positive gamma) 
           // Or standard assumption: calls provide positive GEX, puts provide negative GEX
           // We will just sum up what they are, or force signs. 
           // Usually Calls = positive GEX, Puts = negative GEX.
           let val = s.gex_spotgamma;
           if (s.option_type === "call") {
             // force positive for visualization if needed, but let's trust the engine's sign. 
             // IF the engine uses negative for puts and calls, we sort by absolute.
             // Actually, SpotGamma assumes calls are long (+GEX), puts are short (-GEX).
             val = Math.abs(val);
             st.call_gex += val;
             posGex += val;
           } else {
             val = -Math.abs(val);
             st.put_gex += val;
             negGex += val;
           }

           // VOL SURFACE AGGREGATION
           if (!volMap.has(s.strike)) {
             volMap.set(s.strike, { strike: s.strike });
           }
           const vs = volMap.get(s.strike)!;
           // We store IV for each bucket (e.g. `iv_0`, `iv_1`)
           if (s.oi > 10) { // filter out zero OI noise
              // average IV by bucket if multiple expiries exist in the bucket
              if (!vs[`iv_${bucketKey}`]) vs[`iv_${bucketKey}`] = s.iv * 100;
              else vs[`iv_${bucketKey}`] = (vs[`iv_${bucketKey}`] + s.iv * 100) / 2;
           }
         });
       }
    });

    const gexArr = Array.from(strikeGexMap.values())
      .map(v => ({ ...v, net_gex: v.call_gex + v.put_gex }))
      .sort((a, b) => a.strike - b.strike); // Order by strike Asc
      
    // Filter strike range to S +/- 15% for readability
    const spot = data.spot;
    const gexFiltered = gexArr.filter(x => x.strike >= spot * 0.85 && x.strike <= spot * 1.15);
    
    const volArr = Array.from(volMap.values())
      .sort((a,b) => a.strike - b.strike)
      .filter(x => x.strike >= spot * 0.85 && x.strike <= spot * 1.15);

    return { 
       gexProfile: gexFiltered, 
       volSurface: volArr,
       posGexTot: posGex,
       negGexTot: negGex,
       netGexTot: posGex + negGex
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
               <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">GEX Profile (Call vs Put Wall)</h3>
               <span className="text-[10px] text-zinc-600 font-mono">Spot: ${data.spot.toFixed(2)}</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
               <BarChart data={gexProfile} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barGap={0} barCategoryGap="10%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => v.toFixed(0)} />
                  <Tooltip content={<CustomTooltip />} cursor={{fill: '#27272a', opacity: 0.4}} />
                  <ReferenceLine x={data.spot} stroke="#e4e4e7" strokeDasharray="3 3" label={{ position: 'top', value: 'Spot', fill: '#e4e4e7', fontSize: 10 }} />
                  <ReferenceLine y={0} stroke="#3f3f46" />
                  <Bar dataKey="call_gex" name="Call GEX" fill="#34d399" stackId="stack" />
                  <Bar dataKey="put_gex" name="Put GEX" fill="#f87171" stackId="stack" />
               </BarChart>
            </ResponsiveContainer>
         </div>

         {/* CHART: Volatility Surface (Skew) */}
         <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
            <h3 className="text-xs font-mono text-zinc-400 uppercase tracking-wider mb-4">Volatility Skew (IV by Strike & DTE)</h3>
            <ResponsiveContainer width="100%" height={260}>
               <LineChart data={volSurface} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="strike" tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => `${v.toFixed(0)}%`} domain={['auto', 'auto']} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#71717a" }} />
                  <ReferenceLine x={data.spot} stroke="#e4e4e7" strokeDasharray="3 3" />
                  
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

import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Activity } from 'lucide-react';

interface VixData {
    symbol: string;
    label: string;
    days: number;
    value: number | null;
}

const TICKERS = [
    { symbol: '^VIX1D', label: '1D', days: 1 },
    { symbol: '^VIX9D', label: '9D', days: 9 },
    { symbol: '^VIX', label: '30D', days: 30 },
    { symbol: '^VIX3M', label: '3M', days: 90 },
    { symbol: '^VIX6M', label: '6M', days: 180 },
];

export default function VIXTermStructure() {
    const [data, setData] = useState<VixData[]>(TICKERS.map(t => ({ ...t, value: null })));
    const [loading, setLoading] = useState(true);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const fetchData = async () => {
        try {
            const promises = TICKERS.map(async (t) => {
                const res = await fetch(`/api/yahoo?ticker=${encodeURIComponent(t.symbol)}&interval=1d&range=1d`);
                const json = await res.json();
                const closeArr = json.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter((c: any) => c !== null);
                
                let value = null;
                if (closeArr && closeArr.length > 0) {
                    value = closeArr[closeArr.length - 1];
                } else if (json.chart?.result?.[0]?.meta?.regularMarketPrice) {
                    value = json.chart.result[0].meta.regularMarketPrice;
                }
                
                return { ...t, value };
            });

            const results = await Promise.all(promises);
            setData(results);
            setLastUpdate(new Date());
            setLoading(false);
        } catch (error) {
            console.error("Error fetching VIX data:", error);
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // Poll every minute
        return () => clearInterval(interval);
    }, []);

    // Determine state (Contango vs Backwardation)
    const vix30 = data.find(d => d.symbol === '^VIX')?.value;
    const vix3m = data.find(d => d.symbol === '^VIX3M')?.value;
    
    let structureState = "UNKNOWN";
    let stateColor = "text-zinc-500";
    let StateIcon = Activity;

    if (vix30 && vix3m) {
        const ratio = vix3m / vix30;
        if (ratio >= 1.05) {
            structureState = "CONTANGO (NORMAL)";
            stateColor = "text-emerald-400";
            StateIcon = TrendingUp;
        } else if (ratio < 1.05 && ratio >= 0.95) {
            structureState = "FLAT / TRANSITION";
            stateColor = "text-amber-400";
            StateIcon = Activity;
        } else {
            structureState = "BACKWARDATION (PANIC)";
            stateColor = "text-red-400";
            StateIcon = AlertTriangle;
        }
    }

    const chartData = data.filter(d => d.value !== null).map(d => ({
        name: d.label,
        vix: Number(d.value?.toFixed(2))
    }));

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 shadow-xl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-mono text-zinc-100 uppercase tracking-wider">VIX Term Structure</h3>
                    {loading && <span className="text-[10px] font-mono text-indigo-400 animate-pulse">Loading...</span>}
                </div>
                
                {!loading && (
                    <div className="flex items-center gap-3 bg-zinc-900/80 px-3 py-1.5 rounded-lg border border-zinc-800">
                        <StateIcon className={`w-4 h-4 ${stateColor}`} />
                        <span className={`text-xs font-mono font-bold ${stateColor}`}>
                            {structureState}
                        </span>
                        {vix30 && vix3m && (
                            <span className="text-[10px] font-mono text-zinc-500">
                                (3M/1M: {(vix3m / vix30).toFixed(2)})
                            </span>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-5 gap-2 mb-4">
                {data.map((item) => (
                    <div key={item.symbol} className="bg-zinc-900 border border-zinc-800/50 rounded-lg p-2 text-center">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">{item.label}</div>
                        <div className={`text-sm sm:text-base font-mono font-bold ${item.value ? 'text-zinc-200' : 'text-zinc-600'}`}>
                            {item.value ? item.value.toFixed(2) : '--'}
                        </div>
                    </div>
                ))}
            </div>

            <div className="h-[120px] w-full">
                {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorVix" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={structureState.includes('CONTANGO') ? '#10b981' : '#f43f5e'} stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor={structureState.includes('CONTANGO') ? '#10b981' : '#f43f5e'} stopOpacity={0}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                            <XAxis dataKey="name" stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#52525b" fontSize={10} tickLine={false} axisLine={false} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                                itemStyle={{ color: '#e4e4e7', fontFamily: 'monospace' }}
                                labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace' }}
                            />
                            <Area 
                                type="monotone" 
                                dataKey="vix" 
                                stroke={structureState.includes('CONTANGO') ? '#10b981' : '#f43f5e'} 
                                fillOpacity={1} 
                                fill="url(#colorVix)" 
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-mono text-zinc-600">
                        Waiting for data...
                    </div>
                )}
            </div>
            {lastUpdate && (
                <div className="text-[9px] font-mono text-zinc-600 text-right mt-2">
                    Updated: {lastUpdate.toLocaleTimeString()}
                </div>
            )}
        </div>
    );
}

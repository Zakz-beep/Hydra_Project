import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend } from 'recharts';

export default function COTDashboard() {
    const [data, setData] = useState<any[]>([]);
    const [reportDate, setReportDate] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [metric, setMetric] = useState<'HF_Net_%OI' | 'HF_COT_Index' | 'Compare_%OI' | 'Compare_Index'>('HF_Net_%OI');

    useEffect(() => {
        const fetchCOT = async () => {
            try {
                const res = await fetch('/api/cot/latest');
                const text = await res.text();

                if (!res.ok) {
                    if (res.status === 503) {
                        setError('COT data loading in background — retrying...');
                    } else if (res.status === 502 || res.status === 504) {
                        setError('COT API (port 8008) offline. Restart backend to load.');
                    } else {
                        setError(`API error ${res.status}: ${text.slice(0, 80)}`);
                    }
                    setLoading(false);
                    return;
                }

                let json: any;
                try {
                    json = JSON.parse(text);
                } catch {
                    setError('COT API returned invalid response. Check backend.');
                    setLoading(false);
                    return;
                }

                if (json.error) throw new Error(json.error);

                // Sort by the selected metric descending
                const sortKey = metric === 'Compare_%OI' ? 'HF_Net_%OI' : metric === 'Compare_Index' ? 'HF_COT_Index' : metric;
                const sorted = (json.data || []).sort((a: any, b: any) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
                
                if (sorted.length > 0) {
                    // Cari tanggal paling baru di seluruh dataset
                    const maxDate = sorted.reduce((latest, current) => {
                        return current.Date && current.Date > latest ? current.Date : latest;
                    }, "1900-01-01");
                    
                    if (maxDate !== "1900-01-01") {
                        setReportDate(maxDate);
                    }
                }
                
                setData(sorted);
                setError(null);
            } catch (err: any) {
                setError('COT API unreachable. Start backend on port 8008.');
            } finally {
                setLoading(false);
            }
        };

        fetchCOT();
        // Retry every 30 seconds until data comes in
        const interval = setInterval(fetchCOT, 30000);
        return () => clearInterval(interval);
    }, [metric]);

    if (loading) {
        return (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 shadow-xl h-96 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    <p className="text-zinc-500 font-mono text-sm animate-pulse">Loading COT Data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 shadow-xl">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-xl font-bold text-zinc-100 font-mono uppercase tracking-wider flex items-center gap-2">
                        Commitment of Traders (COT)
                        {error && <span className="text-[10px] text-amber-500 font-normal bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">{error}</span>}
                    </h2>
                    <p className="text-xs text-zinc-500 font-mono mt-1">
                        Hedge Fund Positioning across futures markets
                        {reportDate && <span className="ml-2 text-indigo-400">| As of: {reportDate}</span>}
                    </p>
                </div>
                
                <div className="flex bg-zinc-900 rounded-lg p-1 border border-zinc-800 flex-wrap gap-1">
                    <button 
                        onClick={() => setMetric('HF_Net_%OI')}
                        className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${metric === 'HF_Net_%OI' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        Spec % OI
                    </button>
                    <button 
                        onClick={() => setMetric('HF_COT_Index')}
                        className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${metric === 'HF_COT_Index' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        Spec Index
                    </button>
                    <button 
                        onClick={() => setMetric('Compare_%OI')}
                        className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${metric === 'Compare_%OI' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        vs Hedger (%OI)
                    </button>
                    <button 
                        onClick={() => setMetric('Compare_Index')}
                        className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${metric === 'Compare_Index' ? 'bg-indigo-500/20 text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        vs Hedger (Index)
                    </button>
                </div>
            </div>

            {data.length > 0 ? (
                <>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} margin={{ top: 20, right: 20, left: -20, bottom: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                                <XAxis 
                                    dataKey="Asset" 
                                    stroke="#52525b" 
                                    fontSize={10} 
                                    tickMargin={15}
                                    angle={-45}
                                    textAnchor="end"
                                    interval={0}
                                />
                                <YAxis 
                                    stroke="#52525b" 
                                    fontSize={10} 
                                    domain={metric.includes('Index') ? [0, 100] : ['auto', 'auto']}
                                    tickFormatter={(val) => metric.includes('Index') ? val : `${val}%`}
                                />
                                <Tooltip 
                                    cursor={{ fill: '#27272a', opacity: 0.4 }}
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                                    itemStyle={{ color: '#e4e4e7', fontFamily: 'monospace', fontWeight: 'bold' }}
                                    labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace', marginBottom: '4px' }}
                                />
                                {metric.startsWith('Compare_') && <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'monospace', paddingTop: '10px' }} />}
                                
                                {metric === 'HF_COT_Index' && (
                                    <>
                                        <ReferenceLine y={75} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.5} />
                                        <ReferenceLine y={25} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                                    </>
                                )}
                                {metric.includes('%OI') && (
                                    <ReferenceLine y={0} stroke="#52525b" />
                                )}
                                
                                {metric.startsWith('Compare_') ? (
                                    <>
                                        <Bar dataKey={metric === 'Compare_%OI' ? 'HF_Net_%OI' : 'HF_COT_Index'} fill="#6366f1" name="Speculator (Hedge Fund)" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey={metric === 'Compare_%OI' ? 'Comm_Net_%OI' : 'Comm_COT_Index'} fill="#f59e0b" name="Hedger (Commercial)" radius={[4, 4, 0, 0]} />
                                    </>
                                ) : (
                                    <Bar dataKey={metric} name="Speculator" radius={[4, 4, 0, 0]}>
                                        {data.map((entry, index) => {
                                            let color = '#6366f1'; // default indigo
                                            if (metric === 'HF_COT_Index') {
                                                if (entry[metric] >= 75) color = '#10b981'; // bullish green
                                                else if (entry[metric] <= 25) color = '#ef4444'; // bearish red
                                                else color = '#f59e0b'; // neutral amber
                                            } else {
                                                color = entry[metric] >= 0 ? '#10b981' : '#ef4444';
                                            }
                                            return <Cell key={`cell-${index}`} fill={color} />;
                                        })}
                                    </Bar>
                                )}
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    
                    <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
                        {data.map((asset) => (
                            <div key={asset.Asset} className="bg-zinc-900/50 p-3 rounded-lg border border-zinc-800/50 relative overflow-hidden group hover:bg-zinc-900 transition-colors">
                                <div className={`absolute top-0 left-0 w-full h-0.5 ${
                                    asset.Bias === 'BULLISH' ? 'bg-emerald-500' : 
                                    asset.Bias === 'BEARISH' ? 'bg-red-500' : 
                                    'bg-amber-500'
                                }`}></div>
                                
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-mono text-zinc-100 font-bold">{asset.Asset}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                                        asset.Bias === 'BULLISH' ? 'bg-emerald-500/20 text-emerald-400' : 
                                        asset.Bias === 'BEARISH' ? 'bg-red-500/20 text-red-400' : 
                                        'bg-amber-500/20 text-amber-400'
                                    }`}>{asset.Bias}</span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-[10px] text-zinc-500 font-mono uppercase">Signal</p>
                                        <p className={`text-sm font-mono font-bold ${
                                            asset.Signal.includes('BUY') ? 'text-emerald-400' : 
                                            asset.Signal.includes('SELL') ? 'text-red-400' : 
                                            'text-amber-400'
                                        }`}>{asset.Signal}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] text-zinc-500 font-mono uppercase">COT Index</p>
                                        <p className="text-sm font-mono text-zinc-300">{asset.HF_COT_Index ?? '--'}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                !error && !loading && (
                    <div className="flex flex-col justify-center items-center h-48 border-2 border-dashed border-zinc-800 rounded-lg">
                        <p className="text-zinc-500 font-mono text-sm">No COT data available</p>
                    </div>
                )
            )}
        </div>
    );
}

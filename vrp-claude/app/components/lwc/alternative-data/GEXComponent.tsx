import React, { useEffect, useState } from 'react';
import { fmtGex } from '../../../lib/greeks';
import { RefreshCw } from 'lucide-react';

interface GEXComponentProps {
    ticker: string;
}

export default function GEXComponent({ ticker }: GEXComponentProps) {
    const [activeTab, setActiveTab] = useState<'GEX' | 'VANNA' | 'CHARM' | 'LEVELS'>('GEX');
    const [data, setData] = useState<any>(null);
    const [strikes, setStrikes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            if (!ticker) return;
            setLoading(true);
            setError(null);
            try {
                // Fetch summary and top 0DTE strikes in parallel
                const [resSummary, resStrikes] = await Promise.all([
                    fetch(`/api/greeks/summary?ticker=${encodeURIComponent(ticker)}&force=true`),
                    fetch(`/api/greeks/strikes?ticker=${encodeURIComponent(ticker)}&bucket=0&sort_by=gex_spotgamma&limit=5&force=true`)
                ]);
                
                if (!resSummary.ok || !resStrikes.ok) throw new Error('Gagal mengambil data Greeks');
                
                const jsonSummary = await resSummary.json();
                const jsonStrikes = await resStrikes.json();

                if (isMounted) {
                    setData(jsonSummary);
                    setStrikes(jsonStrikes.strikes || []);
                    setLoading(false);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err.message || 'Terjadi kesalahan');
                    setLoading(false);
                }
            }
        };

        fetchData();

        // Optional polling every 30s
        const interval = setInterval(fetchData, 30000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [ticker, refreshTrigger]);

    // Format helpers removed in favor of fmtGex from lib/greeks

    if (loading && !data) {
        return (
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-xl p-4 flex items-center justify-center min-h-[120px]">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                    <span className="text-xs font-mono text-zinc-500">Loading {ticker} Greeks...</span>
                </div>
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="bg-red-950/20 border border-red-900/50 rounded-xl p-4 flex items-center justify-center min-h-[120px]">
                <span className="text-xs font-mono text-red-400">Error: {error}</span>
            </div>
        );
    }

    if (!data) return null;

    const zeroDte = data.by_expiry?.['0'];

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col mt-4">
            {/* Header Tabs */}
            <div className="flex bg-zinc-900/80 border-b border-zinc-800 justify-between items-center pr-2">
                <div className="flex flex-1">
                    {['GEX', 'VANNA', 'CHARM', 'LEVELS'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`flex-1 py-2 text-[10px] sm:text-xs font-mono font-bold transition-colors ${
                                activeTab === tab 
                                ? 'bg-zinc-800/80 text-indigo-400 border-b-2 border-indigo-500' 
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
                            }`}
                        >
                            {tab} {tab !== 'LEVELS' && '(0DTE)'}
                        </button>
                    ))}
                </div>
                <button 
                    onClick={() => setRefreshTrigger(p => p + 1)}
                    className="p-1.5 ml-2 rounded-md text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 transition-all"
                    title="Update Open Interest & Greeks Data"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-400' : ''} />
                </button>
            </div>

            {/* Content Area */}
            <div className="p-4">
                {!zeroDte ? (
                    <div className="text-center text-zinc-500 text-xs font-mono py-4">
                        Data 0DTE tidak tersedia untuk aset ini.
                    </div>
                ) : (
                    <>
                        {activeTab === 'GEX' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">0DTE Net GEX</p>
                                    <p className={`text-xl font-mono font-bold ${zeroDte.net_gex_spotgamma >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {fmtGex(zeroDte.net_gex_spotgamma)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">0DTE Regime</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                                        zeroDte.net_gex_spotgamma >= 0 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                        'bg-red-500/20 text-red-400 border border-red-500/30'
                                    }`}>
                                        {zeroDte.net_gex_spotgamma >= 0 ? 'POSITIVE GAMMA' : 'NEGATIVE GAMMA'}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">0DTE Gamma Flip</p>
                                    <p className="text-sm font-mono text-zinc-300">${zeroDte.gamma_flip?.toFixed(2) || '--'}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Spot Price</p>
                                    <p className="text-sm font-mono text-zinc-300">${data.spot?.toFixed(2)}</p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'VANNA' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">0DTE Net Vanna</p>
                                    <p className={`text-xl font-mono font-bold ${zeroDte.net_vanna >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {fmtGex(zeroDte.net_vanna)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Overall Vanna Signal</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                                        data.signals?.vanna_signal?.includes('BULLISH') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                        data.signals?.vanna_signal?.includes('BEARISH') ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                        'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                    }`}>
                                        {data.signals?.vanna_signal || 'NEUTRAL'}
                                    </span>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Description</p>
                                    <p className="text-xs font-mono text-zinc-400 mt-1 leading-relaxed">
                                        {data.signals?.vanna_desc || 'No description available.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'CHARM' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">0DTE Net Charm</p>
                                    <p className={`text-xl font-mono font-bold ${zeroDte.net_charm >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {fmtGex(zeroDte.net_charm)}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Overall Charm Signal</p>
                                    <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-mono font-bold rounded ${
                                        data.signals?.charm_signal?.includes('BULLISH') ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                                        data.signals?.charm_signal?.includes('BEARISH') ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                                        'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                    }`}>
                                        {data.signals?.charm_signal || 'NEUTRAL'}
                                    </span>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase">Description</p>
                                    <p className="text-xs font-mono text-zinc-400 mt-1 leading-relaxed">
                                        {data.signals?.charm_desc || 'No description available.'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'LEVELS' && (
                            <div className="space-y-3">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex flex-col">
                                        <p className="text-[10px] font-mono text-zinc-500 uppercase">Top 0DTE GEX Strikes</p>
                                        <p className="text-[9px] font-mono text-zinc-500 mt-0.5">
                                            Total OI: <span className="text-zinc-300">{(zeroDte.total_oi_calls + zeroDte.total_oi_puts).toLocaleString()}</span>
                                            <span className="mx-1">|</span>
                                            PCR (OI): <span className="text-zinc-300">{zeroDte.pcr_oi?.toFixed(2) || '--'}</span>
                                        </p>
                                    </div>
                                    <p className="text-[10px] font-mono text-zinc-500 uppercase text-right">Spot: <span className="text-zinc-300">${data.spot?.toFixed(2)}</span></p>
                                </div>
                                {strikes.length === 0 ? (
                                    <p className="text-xs font-mono text-zinc-500 text-center py-4">Tidak ada data level</p>
                                ) : (
                                    strikes.map((s, idx) => {
                                        const isCallWall = s.gex_spotgamma > 0;
                                        const distPct = ((s.strike - data.spot) / data.spot) * 100;
                                        return (
                                            <div key={idx} className="flex flex-col bg-zinc-900/50 border border-zinc-800/50 p-2 rounded-lg">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-mono font-bold text-zinc-200">${s.strike.toFixed(2)}</span>
                                                        <span className={`text-[10px] font-mono ${distPct >= 0 ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                                            {distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}% away
                                                        </span>
                                                        <span className="text-[9px] font-mono text-zinc-500 mt-1">
                                                            Open Interest: <span className="text-zinc-300">{s.oi?.toLocaleString() || 0}</span>
                                                        </span>
                                                    </div>
                                                    <div className="text-right flex flex-col items-end">
                                                        <span className={`text-sm font-mono font-bold ${isCallWall ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {fmtGex(s.gex_spotgamma)}
                                                        </span>
                                                        <div className="mt-0.5">
                                                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase ${
                                                                isCallWall ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                                                            }`}>
                                                                {isCallWall ? 'Resistance (Call)' : 'Support (Put)'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                
                                                {/* Vanna & Charm Level Visuals */}
                                                <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-zinc-800/50">
                                                    <div className="flex flex-col">
                                                        <span className="text-[9px] font-mono text-zinc-500 uppercase">Vanna Exp</span>
                                                        <span className={`text-[10px] font-mono font-bold ${(s.vanna_exp || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {fmtGex(s.vanna_exp || 0)}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[9px] font-mono text-zinc-500 uppercase">Charm Exp</span>
                                                        <span className={`text-[10px] font-mono font-bold ${(s.charm_exp || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                            {fmtGex(s.charm_exp || 0)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

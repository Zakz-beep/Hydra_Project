import React, { useState, useMemo } from 'react';

export interface PaperHistory {
    id: string;
    ticker: string;
    mode: 'long' | 'short';
    entry_price: number;
    close_price: number;
    close_reason: string;
    pnl: number;
    margin: number;
    leverage: number;
    qty: number;
    opened_at: string;
    closed_at: string;
}

export default function TransactionHistoryPanel({ history }: { history: PaperHistory[] }) {
    const [filter, setFilter] = useState<'today' | 'yesterday' | 'last_week' | 'last_month' | 'custom' | 'all'>('all');
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    const filteredHistory = useMemo(() => {
        if (filter === 'all') return history;
        
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        const lastWeek = new Date(now);
        lastWeek.setDate(lastWeek.getDate() - 7);
        
        const lastMonth = new Date(now);
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        
        return history.filter(item => {
            const closedDate = new Date(item.closed_at);
            const closedDateStr = item.closed_at.split('T')[0];
            
            if (filter === 'today') return closedDateStr === todayStr;
            if (filter === 'yesterday') return closedDateStr === yesterdayStr;
            if (filter === 'last_week') return closedDate >= lastWeek;
            if (filter === 'last_month') return closedDate >= lastMonth;
            if (filter === 'custom') {
                if (customStart && customEnd) {
                    const start = new Date(customStart);
                    const end = new Date(customEnd);
                    end.setHours(23, 59, 59, 999);
                    return closedDate >= start && closedDate <= end;
                }
                if (customStart) return closedDate >= new Date(customStart);
                if (customEnd) {
                    const end = new Date(customEnd);
                    end.setHours(23, 59, 59, 999);
                    return closedDate <= end;
                }
                return true;
            }
            return true;
        });
    }, [history, filter, customStart, customEnd]);

    const totalPnl = filteredHistory.reduce((acc, curr) => acc + curr.pnl, 0);

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl mt-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <h3 className="text-lg font-mono text-zinc-100 uppercase tracking-wider">Transaction History</h3>
                    <span className="bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-xs font-mono ml-2">
                        {filteredHistory.length} trades
                    </span>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                    <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shrink-0">
                        {['all', 'today', 'yesterday', 'last_week', 'last_month', 'custom'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f as any)}
                                className={`px-3 py-1.5 text-xs font-mono transition-colors ${
                                    filter === f
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                                }`}
                            >
                                {f.replace('_', ' ').toUpperCase()}
                            </button>
                        ))}
                    </div>

                    {filter === 'custom' && (
                        <div className="flex items-center gap-2 shrink-0">
                            <input 
                                type="date" 
                                value={customStart}
                                onChange={e => setCustomStart(e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded py-1.5 px-2 focus:outline-none focus:border-indigo-500"
                            />
                            <span className="text-zinc-500 font-mono text-xs">-</span>
                            <input 
                                type="date" 
                                value={customEnd}
                                onChange={e => setCustomEnd(e.target.value)}
                                className="bg-zinc-900 border border-zinc-700 text-zinc-300 font-mono text-xs rounded py-1.5 px-2 focus:outline-none focus:border-indigo-500"
                            />
                        </div>
                    )}
                </div>
            </div>

            {filteredHistory.length > 0 && (
                <div className="flex gap-4 mb-4 p-3 bg-zinc-900/40 rounded-lg border border-zinc-800/50">
                    <div>
                        <p className="text-[10px] font-mono text-zinc-500 uppercase">Period PNL</p>
                        <p className={`text-lg font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                        </p>
                    </div>
                    <div className="border-l border-zinc-800 pl-4">
                        <p className="text-[10px] font-mono text-zinc-500 uppercase">Win Rate</p>
                        <p className="text-lg font-mono text-zinc-300">
                            {((filteredHistory.filter(h => h.pnl > 0).length / filteredHistory.length) * 100).toFixed(0)}%
                        </p>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm font-mono text-zinc-400">
                    <thead className="bg-zinc-900/80 uppercase text-[10px] border-b border-zinc-800">
                        <tr>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3">Ticker</th>
                            <th className="px-4 py-3">Side</th>
                            <th className="px-4 py-3">Entry</th>
                            <th className="px-4 py-3">Exit</th>
                            <th className="px-4 py-3">Margin</th>
                            <th className="px-4 py-3">Reason</th>
                            <th className="px-4 py-3 text-right">PNL</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                        {filteredHistory.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="text-center py-8 text-zinc-600">
                                    No transactions found for this period.
                                </td>
                            </tr>
                        ) : (
                            filteredHistory.map(hist => {
                                const dateObj = new Date(hist.closed_at);
                                const dateStr = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                
                                return (
                                    <tr key={hist.id} className="hover:bg-zinc-900/50 transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">{dateStr}</td>
                                        <td className="px-4 py-3 font-bold text-zinc-300">{hist.ticker}</td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${hist.mode === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                                {hist.mode} {hist.leverage}x
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">${hist.entry_price.toFixed(2)}</td>
                                        <td className="px-4 py-3">${hist.close_price.toFixed(2)}</td>
                                        <td className="px-4 py-3">${hist.margin.toFixed(2)}</td>
                                        <td className="px-4 py-3">
                                            <span className="bg-zinc-800 px-2 py-0.5 rounded text-[10px] text-zinc-300">
                                                {hist.close_reason}
                                            </span>
                                        </td>
                                        <td className={`px-4 py-3 text-right font-bold ${hist.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {hist.pnl >= 0 ? '+' : ''}${hist.pnl.toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

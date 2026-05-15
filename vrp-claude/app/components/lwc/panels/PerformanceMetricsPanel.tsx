import React, { useMemo } from 'react';
import { PaperHistory } from './TransactionHistoryPanel';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface Props {
    history: PaperHistory[];
    currentBalance: number;
}

export default function PerformanceMetricsPanel({ history, currentBalance }: Props) {
    const metrics = useMemo(() => {
        if (!history || history.length === 0) {
            return {
                equityCurve: [],
                profitFactor: 0,
                maxDrawdown: 0,
                totalTrades: 0,
                winRate: 0,
                grossProfit: 0,
                grossLoss: 0,
                netProfit: 0
            };
        }

        // Sort chronological for equity curve calculation
        const sorted = [...history].sort((a, b) => new Date(a.closed_at).getTime() - new Date(b.closed_at).getTime());

        let grossProfit = 0;
        let grossLoss = 0;
        let winningTrades = 0;
        let netProfit = 0;

        sorted.forEach(trade => {
            if (trade.pnl > 0) {
                grossProfit += trade.pnl;
                winningTrades++;
            } else {
                grossLoss += Math.abs(trade.pnl);
            }
            netProfit += trade.pnl;
        });

        const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99.99 : 0) : grossProfit / grossLoss;
        const winRate = (winningTrades / sorted.length) * 100;

        // Calculate Equity Curve backwards to match current balance exactly at the end
        // because users can manually edit their balance, we anchor to the current state.
        const equityCurve = [];
        let runningBalance = currentBalance;
        
        // The last point is current balance
        equityCurve.unshift({
            date: 'Now',
            balance: runningBalance,
            pnl: 0,
            index: sorted.length
        });

        for (let i = sorted.length - 1; i >= 0; i--) {
            const trade = sorted[i];
            runningBalance -= trade.pnl;
            
            const dateObj = new Date(trade.closed_at);
            const dateStr = `${dateObj.getMonth()+1}/${dateObj.getDate()} ${dateObj.getHours()}:${dateObj.getMinutes().toString().padStart(2, '0')}`;
            
            equityCurve.unshift({
                date: dateStr,
                balance: runningBalance,
                pnl: trade.pnl,
                index: i
            });
        }

        // Calculate Max Drawdown (forward)
        let peak = equityCurve[0].balance;
        let maxDrawdown = 0;
        
        for (let i = 0; i < equityCurve.length; i++) {
            if (equityCurve[i].balance > peak) {
                peak = equityCurve[i].balance;
            }
            const drawdown = ((peak - equityCurve[i].balance) / peak) * 100;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }

        return {
            equityCurve,
            profitFactor,
            maxDrawdown,
            totalTrades: sorted.length,
            winRate,
            grossProfit,
            grossLoss,
            netProfit
        };
    }, [history, currentBalance]);

    if (!history || history.length === 0) return null;

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 shadow-xl mt-6">
            <h3 className="text-lg font-mono text-zinc-100 uppercase tracking-wider mb-6 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
                Performance Metrics
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-zinc-700"></div>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1">Net Profit</p>
                    <p className={`text-xl font-mono font-bold ${metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {metrics.netProfit >= 0 ? '+' : ''}${metrics.netProfit.toFixed(2)}
                    </p>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-amber-500"></div>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1">Profit Factor</p>
                    <p className="text-xl font-mono font-bold text-amber-400">
                        {metrics.profitFactor.toFixed(2)}
                    </p>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-red-500"></div>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1">Max Drawdown</p>
                    <p className="text-xl font-mono font-bold text-red-400">
                        {metrics.maxDrawdown.toFixed(2)}%
                    </p>
                </div>
                <div className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500"></div>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase mb-1">Win Rate</p>
                    <p className="text-xl font-mono font-bold text-blue-400">
                        {metrics.winRate.toFixed(1)}%
                    </p>
                </div>
            </div>

            <div className="h-64 w-full mt-4 bg-zinc-900/20 rounded-lg p-2 border border-zinc-800/30">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics.equityCurve} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={metrics.netProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.3}/>
                                <stop offset="95%" stopColor={metrics.netProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="date" stroke="#52525b" fontSize={10} tickMargin={10} minTickGap={30} />
                        <YAxis stroke="#52525b" fontSize={10} domain={['auto', 'auto']} tickFormatter={(val) => `$${val.toLocaleString()}`} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                            itemStyle={{ color: metrics.netProfit >= 0 ? '#10b981' : '#ef4444', fontFamily: 'monospace' }}
                            labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace', marginBottom: '4px' }}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
                        />
                        <Area type="monotone" dataKey="balance" stroke={metrics.netProfit >= 0 ? "#10b981" : "#ef4444"} strokeWidth={2} fillOpacity={1} fill="url(#colorBalance)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

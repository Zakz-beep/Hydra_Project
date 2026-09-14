import React, { useMemo } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip,
    CartesianGrid, ReferenceLine, Area, ComposedChart
} from 'recharts';

interface RollingBetaPoint {
    date: string;
    beta: number;
}

interface RollingBetaChartProps {
    rollingBeta: RollingBetaPoint[];
    ticker: string;
    benchmark: string;
    window: number;
}

export default function RollingBetaChart({ rollingBeta, ticker, benchmark, window }: RollingBetaChartProps) {
    const chartData = useMemo(() => {
        return rollingBeta.map(d => ({
            date: d.date,
            beta: d.beta,
            // Color zone indicators
            aggressive: d.beta > 1.0 ? d.beta : null,
            defensive: d.beta < 1.0 ? d.beta : null,
        }));
    }, [rollingBeta]);

    const { minBeta, maxBeta, avgBeta } = useMemo(() => {
        if (rollingBeta.length === 0) return { minBeta: 0, maxBeta: 2, avgBeta: 1 };
        const betas = rollingBeta.map(d => d.beta);
        return {
            minBeta: Math.min(...betas),
            maxBeta: Math.max(...betas),
            avgBeta: betas.reduce((s, v) => s + v, 0) / betas.length,
        };
    }, [rollingBeta]);

    // Custom tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload?.length) return null;
        const beta = payload[0]?.value;
        if (beta === undefined || beta === null) return null;
        return (
            <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl">
                <p className="text-[10px] font-mono text-zinc-500 mb-1">{label}</p>
                <p className={`text-sm font-mono font-bold ${beta > 1 ? 'text-amber-400' : beta < 1 ? 'text-cyan-400' : 'text-zinc-300'}`}>
                    β = {beta.toFixed(4)}
                </p>
                <p className="text-[9px] font-mono text-zinc-600 mt-0.5">
                    {beta > 1.5 ? 'Highly Aggressive' : beta > 1.0 ? 'Aggressive (> Market)' : beta > 0.5 ? 'Moderate / Defensive' : 'Highly Defensive'}
                </p>
            </div>
        );
    };

    const yDomain = [Math.floor((minBeta - 0.2) * 10) / 10, Math.ceil((maxBeta + 0.2) * 10) / 10];

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 pt-3 pb-1 border-b border-zinc-900 flex items-center justify-between">
                <div>
                    <h4 className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                        Rolling Beta Time Series
                    </h4>
                    <p className="text-[9px] font-mono text-zinc-600 mt-0.5">
                        {ticker} vs {benchmark} — {window}-day rolling window
                    </p>
                </div>
                <div className="flex items-center gap-3 text-[9px] font-mono">
                    <span className="text-zinc-500">Min: <span className="text-cyan-400 font-bold">{minBeta.toFixed(3)}</span></span>
                    <span className="text-zinc-500">Avg: <span className="text-zinc-300 font-bold">{avgBeta.toFixed(3)}</span></span>
                    <span className="text-zinc-500">Max: <span className="text-amber-400 font-bold">{maxBeta.toFixed(3)}</span></span>
                </div>
            </div>

            <div className="px-2 py-3" style={{ height: '320px' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 5, bottom: 5 }}>
                        <defs>
                            <linearGradient id="betaGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
                                <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.02} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.2)" />
                        <XAxis
                            dataKey="date"
                            tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                            tickLine={false}
                            axisLine={{ stroke: '#27272a' }}
                            interval="preserveStartEnd"
                            minTickGap={60}
                        />
                        <YAxis
                            domain={yDomain}
                            tick={{ fill: '#52525b', fontSize: 9, fontFamily: 'monospace' }}
                            tickLine={false}
                            axisLine={{ stroke: '#27272a' }}
                            tickFormatter={(v: number) => v.toFixed(2)}
                        />
                        <Tooltip content={<CustomTooltip />} />

                        {/* Beta = 1.0 reference line */}
                        <ReferenceLine
                            y={1.0}
                            stroke="#71717a"
                            strokeDasharray="6 3"
                            strokeWidth={1}
                            label={{
                                value: 'β = 1.0 (Market)',
                                position: 'insideTopRight',
                                fill: '#71717a',
                                fontSize: 9,
                                fontFamily: 'monospace',
                            }}
                        />

                        <Area
                            type="monotone"
                            dataKey="beta"
                            fill="url(#betaGradient)"
                            stroke="none"
                        />
                        <Line
                            type="monotone"
                            dataKey="beta"
                            stroke="#a78bfa"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4, fill: '#c4b5fd', stroke: '#a78bfa', strokeWidth: 2 }}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Zone legend */}
            <div className="px-4 pb-3 flex flex-wrap gap-4 text-[9px] font-mono text-zinc-500 border-t border-zinc-900 pt-2">
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-0.5 bg-amber-500 inline-block rounded"></span>
                    β &gt; 1.0 = Aggressive (amplifies market moves)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-0.5 bg-cyan-500 inline-block rounded"></span>
                    β &lt; 1.0 = Defensive (dampens market moves)
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-6 h-0.5 bg-zinc-500 inline-block rounded" style={{ borderTop: '1px dashed #71717a' }}></span>
                    β = 1.0 Market Neutral
                </span>
            </div>
        </div>
    );
}

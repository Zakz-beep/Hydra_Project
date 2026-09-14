import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ScatterPoint {
    date: string;
    asset_return: number;
    market_return: number;
}

interface RegressionLine {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
}

interface BetaScatterPlotProps {
    scatterData: ScatterPoint[];
    regressionLine: RegressionLine;
    ticker: string;
    benchmark: string;
    beta: number;
    alpha: number;
    rSquared: number;
}

export default function BetaScatterPlot({
    scatterData, regressionLine, ticker, benchmark, beta, alpha, rSquared
}: BetaScatterPlotProps) {

    const { traceScatter, traceRegression, layout } = useMemo(() => {
        const marketReturns = scatterData.map(d => d.market_return);
        const assetReturns = scatterData.map(d => d.asset_return);
        const dates = scatterData.map(d => d.date);

        // Color code by quadrant
        const colors = scatterData.map(d => {
            if (d.asset_return > 0 && d.market_return > 0) return '#34d399'; // Q1: both up
            if (d.asset_return < 0 && d.market_return < 0) return '#f87171'; // Q3: both down
            if (d.asset_return > 0 && d.market_return < 0) return '#60a5fa'; // Q2: asset up, market down
            return '#fbbf24'; // Q4: asset down, market up
        });

        const scatter: Partial<Plotly.PlotData> = {
            x: marketReturns,
            y: assetReturns,
            mode: 'markers' as const,
            type: 'scatter' as const,
            name: 'Daily Returns',
            text: dates.map((d, i) =>
                `${d}<br>${benchmark}: ${marketReturns[i].toFixed(3)}%<br>${ticker}: ${assetReturns[i].toFixed(3)}%`
            ),
            hoverinfo: 'text' as const,
            marker: {
                color: colors,
                size: 5,
                opacity: 0.7,
                line: { color: 'rgba(255,255,255,0.1)', width: 0.5 },
            },
        };

        const regression: Partial<Plotly.PlotData> = {
            x: [regressionLine.x_min, regressionLine.x_max],
            y: [regressionLine.y_min, regressionLine.y_max],
            mode: 'lines' as const,
            type: 'scatter' as const,
            name: `β=${beta.toFixed(3)}, α=${(alpha * 100).toFixed(4)}%`,
            line: {
                color: '#a78bfa',
                width: 2.5,
                dash: 'dot',
            },
        };

        const plotLayout: Partial<Plotly.Layout> = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(9,9,11,0.6)',
            font: { family: 'JetBrains Mono, monospace', color: '#a1a1aa', size: 10 },
            margin: { t: 30, r: 20, b: 50, l: 55 },
            xaxis: {
                title: { text: `${benchmark} Return (%)`, font: { size: 10, color: '#71717a' } },
                gridcolor: 'rgba(63,63,70,0.3)',
                zerolinecolor: 'rgba(161,161,170,0.3)',
                zerolinewidth: 1,
                tickfont: { size: 9 },
            },
            yaxis: {
                title: { text: `${ticker} Return (%)`, font: { size: 10, color: '#71717a' } },
                gridcolor: 'rgba(63,63,70,0.3)',
                zerolinecolor: 'rgba(161,161,170,0.3)',
                zerolinewidth: 1,
                tickfont: { size: 9 },
            },
            showlegend: true,
            legend: {
                x: 0.02, y: 0.98,
                bgcolor: 'rgba(0,0,0,0.4)',
                bordercolor: 'rgba(63,63,70,0.4)',
                borderwidth: 1,
                font: { size: 9, color: '#a1a1aa' },
            },
            hovermode: 'closest' as const,
            annotations: [
                {
                    x: 0.98, y: 0.02,
                    xref: 'paper', yref: 'paper',
                    text: `R² = ${rSquared.toFixed(4)}`,
                    showarrow: false,
                    font: { size: 11, color: '#818cf8', family: 'JetBrains Mono, monospace' },
                    bgcolor: 'rgba(0,0,0,0.5)',
                    bordercolor: 'rgba(99,102,241,0.3)',
                    borderwidth: 1,
                    borderpad: 4,
                },
            ],
        };

        return { traceScatter: scatter, traceRegression: regression, layout: plotLayout };
    }, [scatterData, regressionLine, ticker, benchmark, beta, alpha, rSquared]);

    return (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 pt-3 pb-1 border-b border-zinc-900">
                <h4 className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-wider">
                    Return Scatter Plot & Characteristic Line (OLS)
                </h4>
                <p className="text-[9px] font-mono text-zinc-600 mt-0.5">
                    Each dot represents one trading day. Purple dashed line = Security Market Line (slope = Beta).
                </p>
            </div>
            <Plot
                data={[traceScatter, traceRegression] as Plotly.Data[]}
                layout={layout}
                config={{ responsive: true, displayModeBar: false }}
                style={{ width: '100%', height: '400px' }}
            />
            {/* Legend explainer */}
            <div className="px-4 pb-3 flex flex-wrap gap-3 text-[9px] font-mono text-zinc-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span> Both Up (Q1)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> Both Down (Q3)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> Asset Up / Mkt Down (Q2)</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span> Asset Down / Mkt Up (Q4)</span>
            </div>
        </div>
    );
}

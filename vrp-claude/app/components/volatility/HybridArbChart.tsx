"use client";

import React, { useState, useEffect } from "react";
import { Loader2, RefreshCw, TrendingUp, TrendingDown, Target, Shield, AlertTriangle } from "lucide-react";
import { fetchHybridArb, HybridArbResult, HybridOptionOpp } from "../../lib/volatility";
import dynamic from "next/dynamic";

// Dynamically import Plotly to avoid SSR issues
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false, loading: () => <div className="h-full w-full flex items-center justify-center text-slate-400">Loading 3D Engine...</div> });

interface Props {
  initialTicker: string;
}

export default function HybridArbChart({ initialTicker }: Props) {
  const [data, setData] = useState<HybridArbResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"3D_SURFACE" | "OPPORTUNITIES">("3D_SURFACE");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHybridArb(initialTicker);
      setData(res);
    } catch (err: any) {
      setError(err.message || "Failed to load Hybrid Arbitrage data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker]);

  if (loading) {
    return (
      <div className="h-[600px] flex flex-col items-center justify-center bg-[#0a0a0f] border border-slate-800 rounded-xl">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-400">AI scanning mispriced options for {initialTicker}...</p>
        <p className="text-xs text-slate-500 mt-2">Running LSTM Volatility + BSM Pricing</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-[600px] flex flex-col items-center justify-center bg-[#0a0a0f] border border-red-900/50 rounded-xl">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-4" />
        <p className="text-red-400 font-medium mb-2">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const { ai_model, market_summary, top_overvalued, top_undervalued, vol_surface } = data;

  // Prepare 3D Plotly Data
  const callsData = vol_surface.filter(p => p.type === "call");
  const putsData = vol_surface.filter(p => p.type === "put");

  const surfaceTraces: any[] = [
    {
      type: "scatter3d",
      mode: "markers",
      name: "Market Calls IV",
      x: callsData.map(d => d.dte),
      y: callsData.map(d => d.moneyness),
      z: callsData.map(d => d.market_iv_pct),
      marker: { size: 4, color: "#10b981", opacity: 0.8 },
      hovertemplate: "DTE: %{x}<br>Moneyness: %{y:.2f}<br>Market IV: %{z:.2f}%<extra></extra>",
    },
    {
      type: "scatter3d",
      mode: "markers",
      name: "Market Puts IV",
      x: putsData.map(d => d.dte),
      y: putsData.map(d => d.moneyness),
      z: putsData.map(d => d.market_iv_pct),
      marker: { size: 4, color: "#ef4444", opacity: 0.8 },
      hovertemplate: "DTE: %{x}<br>Moneyness: %{y:.2f}<br>Market IV: %{z:.2f}%<extra></extra>",
    },
    {
      // AI Fair Volatility Plane (Flat for LSTM baseline)
      type: "mesh3d",
      name: "AI Fair Vol",
      x: [0, 45, 0, 45],
      y: [0.9, 0.9, 1.1, 1.1],
      z: [ai_model.fair_vol_pct, ai_model.fair_vol_pct, ai_model.fair_vol_pct, ai_model.fair_vol_pct],
      color: "#3b82f6",
      opacity: 0.3,
      hoverinfo: "skip",
    }
  ];

  const renderOppTable = (opps: HybridOptionOpp[], title: string, isSell: boolean) => {
    const headerColor = isSell ? "from-red-500/20 to-transparent border-red-500/30 text-red-400" : "from-emerald-500/20 to-transparent border-emerald-500/30 text-emerald-400";
    const badgeBg = isSell ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
    
    return (
      <div className="bg-[#0f111a]/80 backdrop-blur-xl border border-[#1e2235] rounded-xl overflow-hidden shadow-2xl relative">
        {/* Top subtle glow edge */}
        <div className={`absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r ${isSell ? 'from-transparent via-red-500/50 to-transparent' : 'from-transparent via-emerald-500/50 to-transparent'}`}></div>
        
        <div className={`p-4 border-b bg-gradient-to-r ${headerColor}`}>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full animate-pulse ${isSell ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
            <h3 className="font-semibold uppercase tracking-wider text-sm">{title}</h3>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-slate-400 bg-[#0a0c14] border-b border-[#1e2235]">
              <tr>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">Type</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">Strike</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">DTE</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">Market $</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">AI Fair $</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">Edge</th>
                <th className="px-4 py-4 font-medium uppercase tracking-wider">Hedge Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2235]/50">
              {opps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Target className="h-6 w-6 text-slate-600" />
                      <span className="uppercase tracking-widest text-xs">No opportunities detected</span>
                    </div>
                  </td>
                </tr>
              ) : (
                opps.map((opp, idx) => (
                  <tr key={idx} className="hover:bg-[#1a1d2d] transition-all duration-200 group">
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
                        opp.type === 'call' 
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                          : 'bg-red-500/10 border-red-500/20 text-red-400'
                      }`}>
                        {opp.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-white">${opp.strike.toFixed(1)}</td>
                    <td className="px-4 py-3 text-slate-300">{opp.dte}</td>
                    <td className="px-4 py-3 font-mono text-slate-300 group-hover:text-white transition-colors">${opp.mid_price.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-blue-400 drop-shadow-[0_0_8px_rgba(59,130,246,0.3)]">${opp.ai_fair_price.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono">
                      <span className={`px-2 py-1 rounded bg-[#0a0c14] border border-[#1e2235] shadow-inner ${opp.mispricing_pct > 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {opp.mispricing_pct > 0 ? "+" : ""}{opp.mispricing_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 bg-[#0a0c14] px-3 py-1.5 rounded border border-[#1e2235] w-fit">
                        <Shield className="h-3.5 w-3.5 text-indigo-400" />
                        <span className="text-xs text-slate-300 uppercase tracking-wider font-medium">{opp.action} Opt,</span>
                        <span className={`text-xs font-bold uppercase tracking-wider ${opp.hedge_direction === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                          {opp.hedge_direction} {opp.hedge_shares} Shs
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-[#1e2235]/80 to-[#0a0c14]/80 backdrop-blur-xl border border-[#2a2f4c] p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">AI Fair Volatility</span>
            <Target className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-3xl font-light text-white tracking-tight relative z-10">
            {ai_model.fair_vol_pct.toFixed(2)}<span className="text-lg text-slate-500">%</span>
          </div>
          <div className="text-[10px] text-blue-400/80 uppercase tracking-widest mt-2 font-medium relative z-10">LSTM Deep Learning</div>
        </div>
        
        <div className="bg-gradient-to-br from-[#1e2235]/80 to-[#0a0c14]/80 backdrop-blur-xl border border-[#2a2f4c] p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-slate-500/5 rounded-full blur-3xl group-hover:bg-slate-500/10 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Market Implied Vol</span>
            <RefreshCw className="h-4 w-4 text-slate-400" />
          </div>
          <div className="text-3xl font-light text-white tracking-tight relative z-10">
            {market_summary.avg_market_iv_pct.toFixed(2)}<span className="text-lg text-slate-500">%</span>
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-2 font-medium relative z-10">Avg 0-45 DTE</div>
        </div>

        <div className="bg-gradient-to-br from-[#1e2235]/80 to-[#0a0c14]/80 backdrop-blur-xl border border-[#2a2f4c] p-5 rounded-2xl relative overflow-hidden group">
          <div className={`absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl transition-all ${market_summary.iv_spread_pct > 0 ? 'bg-red-500/10 group-hover:bg-red-500/20' : 'bg-emerald-500/10 group-hover:bg-emerald-500/20'}`}></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Mispricing Spread</span>
            {market_summary.iv_spread_pct > 0 ? (
              <TrendingDown className="h-4 w-4 text-red-400" />
            ) : (
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            )}
          </div>
          <div className={`text-3xl font-light tracking-tight relative z-10 ${market_summary.iv_spread_pct > 0 ? 'text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.3)]' : 'text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.3)]'}`}>
            {market_summary.iv_spread_pct > 0 ? "+" : ""}{market_summary.iv_spread_pct.toFixed(2)}<span className="text-lg opacity-60">%</span>
          </div>
          <div className="text-[10px] text-slate-500 uppercase tracking-widest mt-2 font-medium relative z-10">Mkt IV vs AI Vol</div>
        </div>

        <div className="bg-gradient-to-br from-[#1e2235]/80 to-[#0a0c14]/80 backdrop-blur-xl border border-[#2a2f4c] p-5 rounded-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all"></div>
          <div className="flex items-center justify-between mb-3 relative z-10">
            <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Market Regime</span>
            <Shield className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-semibold text-indigo-400 tracking-tight relative z-10 drop-shadow-[0_0_8px_rgba(129,140,248,0.4)]">
            {market_summary.regime.replace("_", " ")}
          </div>
          <div className="text-[10px] text-slate-400 mt-2 leading-snug relative z-10">{market_summary.regime_desc}</div>
        </div>
      </div>

      {/* ── Main View Toggle ── */}
      <div className="flex justify-between items-center bg-[#0a0c14]/80 backdrop-blur-md border border-[#1e2235] p-2 rounded-xl shadow-lg">
        <div className="flex gap-2">
          <button
            onClick={() => setView("3D_SURFACE")}
            className={`px-6 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              view === "3D_SURFACE" 
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
                : "text-slate-400 hover:bg-[#1e2235] hover:text-white"
            }`}
          >
            3D Volatility Surface
          </button>
          <button
            onClick={() => setView("OPPORTUNITIES")}
            className={`px-6 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              view === "OPPORTUNITIES" 
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
                : "text-slate-400 hover:bg-[#1e2235] hover:text-white"
            }`}
          >
            Delta-Neutral Opportunities
          </button>
        </div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-widest px-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Scanned {market_summary.n_options_scanned} options
        </div>
      </div>

      {/* ── View Content ── */}
      {view === "3D_SURFACE" ? (
        <div className="bg-gradient-to-b from-[#0a0c14] to-[#05060a] border border-[#1e2235] rounded-2xl overflow-hidden h-[650px] relative shadow-2xl">
          <div className="absolute top-6 left-6 z-10 bg-[#0f111a]/90 p-4 rounded-xl border border-[#2a2f4c] backdrop-blur-md shadow-xl">
            <h4 className="text-xs font-bold text-white mb-3 uppercase tracking-wider">3D Market vs AI Surface</h4>
            <div className="flex items-center gap-3 text-xs text-slate-300 mb-2 font-medium">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span> Market Calls
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-300 mb-2 font-medium">
              <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span> Market Puts
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-300 font-medium">
              <span className="w-3 h-3 bg-blue-500/40 border border-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.4)]"></span> AI Fair Volatility Plane
            </div>
          </div>
          <Plot
            data={surfaceTraces}
            layout={{
              autosize: true,
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
              margin: { l: 0, r: 0, b: 0, t: 0 },
              font: { family: 'Inter, sans-serif', color: '#64748b' },
              scene: {
                xaxis: { title: { text: 'DTE (Days)' }, color: '#64748b', gridcolor: '#1e2235', zerolinecolor: '#334155', showbackground: false },
                yaxis: { title: { text: 'Moneyness' }, color: '#64748b', gridcolor: '#1e2235', zerolinecolor: '#334155', showbackground: false },
                zaxis: { title: { text: 'Implied Vol (%)' }, color: '#64748b', gridcolor: '#1e2235', zerolinecolor: '#334155', showbackground: false },
                bgcolor: 'transparent',
                camera: { eye: { x: 1.6, y: -1.6, z: 0.6 } }
              },
              showlegend: false
            }}
            useResizeHandler={true}
            style={{ width: "100%", height: "100%" }}
            config={{ displayModeBar: false }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {renderOppTable(top_overvalued, "Overvalued Options (SELL Premium)", true)}
          {renderOppTable(top_undervalued, "Undervalued Options (BUY Premium)", false)}
        </div>
      )}
    </div>
  );
}

"use client";

import React, { useMemo, useState, useEffect, useCallback } from "react";
import {
  AreaChart, Area, ComposedChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ReferenceLine
} from "recharts";
import { MSARResult, fetchVolMSAR, STATE_COLORS, STATE_ICONS } from "../../lib/volatility";

interface Props {
  initialTicker: string;
}

const fmtDate = (s: string) => s.slice(0, 10).slice(5); // MM-DD

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900/95 border border-zinc-700/60 rounded-lg px-3 py-2 text-[11px] font-mono shadow-xl space-y-0.5">
      <p className="text-zinc-400 border-b border-zinc-800 pb-1 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color ?? p.fill }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(4) : p.value}
        </p>
      ))}
    </div>
  );
};

export default function MSARChart({ initialTicker }: Props) {
  const [ticker, setTicker] = useState(initialTicker);
  const [period, setPeriod] = useState("2y");
  const [forecastDays, setForecastDays] = useState(10);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msar, setMsar] = useState<MSARResult | null>(null);

  const handleRun = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchVolMSAR(ticker, period, 2, 2, forecastDays);
      setMsar(res);
    } catch (e: any) {
      setError(e.message ?? "Failed to fetch MSAR data");
    } finally {
      setLoading(false);
    }
  }, [ticker, period, forecastDays]);

  // Initial load
  useEffect(() => {
    handleRun();
  }, [handleRun]);

  const currentRegime = msar?.current_regime;
  const isBull = currentRegime?.regime_name.includes("BULL") || currentRegime?.regime_id === 1;
  const col = isBull ? STATE_COLORS[2] : STATE_COLORS[0];

  // Transform Filtered Probs for AreaChart
  const probData = useMemo(() => {
    if (!msar) return [];
    return msar.filtered_probabilities.map(p => {
      const keys = Object.keys(p.probabilities);
      const bearKey = keys.find(k => k.includes("BEAR")) || keys[0];
      const bullKey = keys.find(k => k.includes("BULL")) || keys[1];
      return {
        date: fmtDate(p.timestamp),
        p_bear: p.probabilities[bearKey] || 0,
        p_bull: p.probabilities[bullKey] || 0,
      };
    });
  }, [msar]);

  // Transform Forecast for Cone Chart
  const coneData = useMemo(() => {
    if (!msar?.forecast?.price_forecast) return [];
    return msar.forecast.price_forecast.series.map(s => ({
      step: `t+${s.step}`,
      mid: s.price_mid,
      range: [s.price_lower_95, s.price_upper_95]
    }));
  }, [msar]);

  return (
    <div className="space-y-6">
      
      {/* ── MSAR Independent Control Panel ─────────────────────────────────── */}
      <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/10 px-5 py-4 flex flex-col sm:flex-row gap-4 items-end">
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Ticker</label>
          <input
            type="text"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">History (In-Sample)</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
          >
            <option value="6mo">6 Months</option>
            <option value="1y">1 Year</option>
            <option value="2y">2 Years</option>
            <option value="5y">5 Years</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <label className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider font-bold">OOS Forecast (Days)</label>
          <input
            type="number"
            min={1}
            max={30}
            value={forecastDays}
            onChange={e => setForecastDays(Number(e.target.value))}
            className="bg-indigo-950/30 border border-indigo-700/50 rounded-md px-3 py-2 text-sm font-mono text-indigo-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md font-mono text-sm font-bold transition-colors disabled:opacity-50"
        >
          {loading ? "Running..." : "Run MSAR"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          ⚠ {error}
        </div>
      )}

      {loading && !msar && (
        <div className="h-64 rounded-xl bg-zinc-800/40 animate-pulse flex items-center justify-center font-mono text-zinc-500">
          Computing Markov-Switching Autoregression...
        </div>
      )}

      {msar && currentRegime && (
        <div className="space-y-5 animate-in fade-in duration-500">
          {/* ── Current Regime Hero ─────────────────────────────────────── */}
          <div className={`rounded-xl border ${col.border} ${col.bg} px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
            <div>
              <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mb-1">MSAR Current Regime</p>
              <h2 className={`text-2xl font-mono font-bold ${col.text}`}>
                {isBull ? "▲" : "▼"} {currentRegime.regime_name}
              </h2>
              <p className="text-[11px] font-mono text-zinc-500 mt-1">
                Confidence: <span className={`font-semibold ${col.text}`}>{(currentRegime.probability * 100).toFixed(1)}%</span>
                &nbsp;· {msar.model_spec.type}
                &nbsp;· AIC: {msar.model_spec.aic.toFixed(1)}
              </p>
            </div>
            
            {/* Traffic Light */}
            <div className="flex gap-3">
              {Object.entries(currentRegime.posteriors).map(([name, prob]) => {
                const isThisBull = name.includes("BULL");
                const c = isThisBull ? STATE_COLORS[2] : STATE_COLORS[0];
                const active = name === currentRegime.regime_name;
                return (
                  <div key={name} className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl border transition-all duration-300
                    ${active ? `${c.bg} ${c.border} shadow-lg` : "bg-zinc-900/30 border-zinc-800/50 opacity-40"}`}>
                    <span className={`text-xl font-bold ${c.text}`}>{isThisBull ? "▲" : "▼"}</span>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${c.text}`}>{name}</span>
                    <div className="w-12 h-1 rounded-full bg-zinc-800">
                      <div className={`h-full rounded-full ${c.bg.replace("/40", "")}`} style={{ width: `${prob * 100}%` }} />
                    </div>
                    <span className="text-[9px] font-mono text-zinc-500">{(prob * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* ── Position Sizing ───────────────────────────────────────────── */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                Optimal Position Sizing (Kelly Fraction)
              </p>
              <div className="space-y-4">
                {msar.position_sizing.map(s => {
                  const isThisBull = s.name.includes("BULL");
                  const c = isThisBull ? STATE_COLORS[2] : STATE_COLORS[0];
                  const maxScale = Math.max(100, Math.abs(s.full_kelly_pct));
                  return (
                    <div key={s.regime_id}>
                      <div className="flex justify-between text-[11px] font-mono mb-1.5">
                        <span className={c.text}>{s.name} Regime</span>
                        <span className="text-zinc-400">Full Kelly: <span className={s.full_kelly_pct > 0 ? c.text : "text-zinc-500"}>{s.full_kelly_pct.toFixed(1)}%</span></span>
                      </div>
                      <div className="h-4 rounded bg-zinc-800 overflow-hidden relative">
                        <div className="absolute top-0 bottom-0 left-0 border-l border-zinc-500 z-10" />
                        {s.full_kelly_pct > 0 ? (
                          <div className={`h-full ${c.bg.replace("/40", "/60")} transition-all`} style={{ width: `${Math.min(100, (s.full_kelly_pct / maxScale) * 100)}%` }} />
                        ) : (
                          <div className="h-full bg-zinc-700/50" style={{ width: `0%` }} />
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] font-mono mt-1 text-zinc-500">
                        <span>Half Kelly (Safe): {(s.half_kelly_pct).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── VaR & CVaR ──────────────────────────────────────────────── */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
              <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
                Regime-Conditional Risk (VaR / CVaR)
              </p>
              <div className="space-y-4">
                {msar.var_cvar.map(v => {
                  const isThisBull = v.name.includes("BULL");
                  const c = isThisBull ? STATE_COLORS[2] : STATE_COLORS[0];
                  const risk95 = v.risk_metrics.find(r => r.confidence === 0.95);
                  const risk99 = v.risk_metrics.find(r => r.confidence === 0.99);
                  return (
                    <div key={v.regime_id} className={`p-3 rounded-lg border ${c.border.replace("500/40", "800/60")} bg-zinc-950/50`}>
                      <div className={`text-[11px] font-mono font-bold mb-2 ${c.text}`}>{v.name}</div>
                      <div className="grid grid-cols-2 gap-4 text-[11px] font-mono">
                        <div>
                          <div className="text-zinc-500 mb-1">95% Confidence</div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400">VaR:</span>
                            <span className="text-red-400">{risk95?.var_pct.toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400">CVaR:</span>
                            <span className="text-red-500">{risk95?.cvar_pct.toFixed(2)}%</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-zinc-500 mb-1">99% Confidence</div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400">VaR:</span>
                            <span className="text-red-400">{risk99?.var_pct.toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-zinc-400">CVaR:</span>
                            <span className="text-red-500">{risk99?.cvar_pct.toFixed(2)}%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Filtered Probabilities ────────────────────────────────────── */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">
              Regime Filtered Probabilities (In-Sample History)
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={probData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }} stackOffset="expand">
                <CartesianGrid strokeDasharray="2 4" stroke="#27272a" />
                <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} interval={Math.floor(probData.length / 8)} />
                <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Area dataKey="p_bear" name="Bearish" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} />
                <Area dataKey="p_bull" name="Bullish" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* ── OOS Notes & Cone ────────────────────────────────────────── */}
          {coneData.length > 0 && (
            <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/10 px-5 py-5 space-y-4">
              
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between border-b border-indigo-900/30 pb-4">
                <div>
                  <h3 className="text-lg font-mono font-bold text-indigo-300">OOS (Out-of-Sample) Price Forecast</h3>
                  <p className="text-[11px] font-mono text-zinc-400 mt-1 max-w-2xl">
                    <span className="text-indigo-400 font-bold">Catatan OOS:</span> Grafik di bawah ini adalah murni proyeksi ke masa depan ( Out-of-Sample) berdasarkan distribusi probabilitas regime {msar.model_spec.type} saat ini. Area biru menunjukkan <strong>95% Confidence Interval (Cone)</strong> untuk batas atas dan bawah pergerakan harga. Semakin jauh ke depan, ketidakpastian membesar (cone melebar).
                  </p>
                </div>
                <div className="bg-indigo-900/30 border border-indigo-800/50 px-4 py-2 rounded-lg text-center min-w-[120px]">
                  <p className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider mb-1">Forecast Horizon</p>
                  <p className="text-xl font-mono font-bold text-indigo-100">{forecastDays} Days</p>
                </div>
              </div>

              <div className="pt-2">
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={coneData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#312e81" opacity={0.3} />
                    <XAxis dataKey="step" tick={{ fill: "#6366f1", fontSize: 10, fontFamily: "monospace" }} tickLine={false} />
                    <YAxis domain={['auto', 'auto']} tick={{ fill: "#6366f1", fontSize: 10, fontFamily: "monospace" }} tickLine={false} width={50} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area dataKey="range" name="95% CI Bounds" stroke="none" fill="#6366f1" fillOpacity={0.15} />
                    <Line dataKey="mid" name="Expected Price" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3, fill: "#818cf8", strokeWidth: 0 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

            </div>
          )}

        </div>
      )}
    </div>
  );
}

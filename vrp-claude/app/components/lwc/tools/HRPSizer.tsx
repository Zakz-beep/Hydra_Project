"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────
interface HRPResult {
  tickers: string[];
  weights: Record<string, number>;
  allocations: Record<string, number>;
  sorted_order: string[];
  mst_edges: { source: string; target: string; distance: number }[];
  clusters: Record<string, number>;
  correlation: Record<string, Record<string, number>>;
  annual_vol_pct: Record<string, number>;
  var95_daily_pct: Record<string, number>;
  lookback_days: number;
  total_balance: number;
}

// ─── Cluster Colors ───────────────────────────────────────────────────
const CLUSTER_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const clusterColor = (id: number) => CLUSTER_COLORS[(id - 1) % CLUSTER_COLORS.length];

// ─── MST Force-Layout (simple iterative spring) ───────────────────────
function computeMSTLayout(
  tickers: string[],
  edges: { source: string; target: string; distance: number }[],
  width: number,
  height: number
): Record<string, { x: number; y: number }> {
  const n = tickers.length;
  const angleStep = (2 * Math.PI) / n;
  const r = Math.min(width, height) * 0.35;
  const cx = width / 2;
  const cy = height / 2;

  // Initial positions — circle layout
  const pos: Record<string, { x: number; y: number }> = {};
  tickers.forEach((t, i) => {
    pos[t] = {
      x: cx + r * Math.cos(angleStep * i - Math.PI / 2),
      y: cy + r * Math.sin(angleStep * i - Math.PI / 2),
    };
  });

  // Spring simulation (50 iterations)
  const SPRING_LEN = Math.min(width, height) * 0.25;
  const REPULSION = 3000;
  const SPRING_K = 0.3;

  for (let iter = 0; iter < 60; iter++) {
    const force: Record<string, { fx: number; fy: number }> = {};
    tickers.forEach((t) => (force[t] = { fx: 0, fy: 0 }));

    // Repulsion between all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = tickers[i];
        const b = tickers[j];
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = REPULSION / (dist * dist);
        force[a].fx += (dx / dist) * f;
        force[a].fy += (dy / dist) * f;
        force[b].fx -= (dx / dist) * f;
        force[b].fy -= (dy / dist) * f;
      }
    }

    // Spring attraction along MST edges
    edges.forEach(({ source, target, distance }) => {
      const dx = pos[source].x - pos[target].x;
      const dy = pos[source].y - pos[target].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetLen = SPRING_LEN * (1 + distance);
      const f = SPRING_K * (dist - targetLen);
      force[source].fx -= (dx / dist) * f;
      force[source].fy -= (dy / dist) * f;
      force[target].fx += (dx / dist) * f;
      force[target].fy += (dy / dist) * f;
    });

    // Apply forces with damping
    const damping = 0.15;
    tickers.forEach((t) => {
      pos[t].x += force[t].fx * damping;
      pos[t].y += force[t].fy * damping;
      // Keep within bounds
      pos[t].x = Math.max(40, Math.min(width - 40, pos[t].x));
      pos[t].y = Math.max(30, Math.min(height - 30, pos[t].y));
    });
  }

  return pos;
}

// ─── Custom Tooltip for BarChart ──────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl">
      <p className="text-zinc-300 font-bold mb-1">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-4 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="text-zinc-200">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Correlation Heatmap Cell ─────────────────────────────────────────
const corrColor = (v: number) => {
  if (v >= 0.9) return "#ef4444";
  if (v >= 0.7) return "#f97316";
  if (v >= 0.4) return "#eab308";
  if (v >= 0) return "#22c55e";
  if (v >= -0.3) return "#3b82f6";
  return "#8b5cf6";
};

// ─── Main Component ───────────────────────────────────────────────────
const DEFAULT_TICKERS = ["SPY", "QQQ", "IWM", "GLD", "TLT"];

export default function HRPSizer({ balance }: { balance?: number }) {
  const [tickerInput, setTickerInput] = useState(DEFAULT_TICKERS.join(", "));
  const [lookback, setLookback] = useState(60);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HRPResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"weights" | "mst" | "corr">("weights");

  const svgWidth = 800;
  const svgHeight = 400;

  const handleOptimize = async () => {
    const tickers = tickerInput
      .split(/[,\s]+/)
      .map((t) => t.trim().toUpperCase())
      .filter((t) => t.length > 0);

    if (tickers.length < 2) {
      setError("Enter at least 2 tickers.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/hrp/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers,
          balance: balance ?? 10000,
          lookback_days: lookback,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Optimization failed");
      }

      const data: HRPResult = await res.json();
      setResult(data);
      setActiveTab("weights");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Prepare chart data ──────────────────────────────────────────────
  const weightData = useMemo(() => {
    if (!result) return [];
    return result.tickers.map((t) => ({
      ticker: t,
      weight_pct: +(result.weights[t] * 100).toFixed(2),
      allocation: result.allocations[t],
      vol: result.annual_vol_pct[t],
      var: result.var95_daily_pct[t],
      cluster: result.clusters[t],
    }));
  }, [result]);

  // ── MST Layout ─────────────────────────────────────────────────────
  const mstLayout = useMemo(() => {
    if (!result) return null;
    return computeMSTLayout(result.tickers, result.mst_edges, svgWidth, svgHeight);
  }, [result]);

  // ── Correlation grid ───────────────────────────────────────────────
  const corrTickers = result?.tickers ?? [];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
        <div>
          <h2 className="text-sm font-mono font-bold text-zinc-100 flex items-center gap-2">
            <span className="text-indigo-400">HRP</span>
            <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded uppercase tracking-wider">
              Hierarchical Risk Parity
            </span>
          </h2>
          <p className="text-[10px] font-mono text-zinc-500 mt-0.5">
            Optimal position sizing via graph-based clustering (López de Prado 2018)
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="p-5 border-b border-zinc-800/40 flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex-1">
          <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            Tickers (comma-separated)
          </label>
          <input
            type="text"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            className="mt-1 w-full bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 uppercase"
            placeholder="SPY, QQQ, IWM, GLD, TLT"
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            Lookback (days)
          </label>
          <input
            type="number"
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            min={20}
            max={252}
            className="mt-1 w-full bg-zinc-900 border border-zinc-700 text-zinc-100 font-mono text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={handleOptimize}
          disabled={loading}
          className="h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-mono font-bold text-xs px-5 rounded-lg transition-colors shadow-lg shadow-indigo-900/30 whitespace-nowrap"
        >
          {loading ? "Optimizing..." : "Run HRP"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mt-4 text-xs font-mono text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="p-5 space-y-5">
          {/* Summary Chips */}
          <div className="flex flex-wrap gap-2">
            {result.tickers.map((t) => (
              <div
                key={t}
                className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700/60 rounded-lg px-3 py-1.5"
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: clusterColor(result.clusters[t]) }}
                />
                <span className="text-xs font-mono font-bold text-zinc-200">{t}</span>
                <span className="text-xs font-mono text-indigo-400">
                  {(result.weights[t] * 100).toFixed(1)}%
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  ${result.allocations[t].toFixed(0)}
                </span>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-zinc-950/60 p-1 rounded-lg w-fit border border-zinc-800">
            {(["weights", "mst", "corr"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded font-mono text-xs transition-colors ${
                  activeTab === tab
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {tab === "weights" ? "HRP Weights" : tab === "mst" ? "MST Graph" : "Correlation"}
              </button>
            ))}
          </div>

          {/* ── TAB: WEIGHTS ─────────────────────────────────────────────────── */}
          {activeTab === "weights" && (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weightData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="ticker" tick={{ fill: "#71717a", fontSize: 11, fontFamily: "monospace" }} />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: "#71717a", fontSize: 10, fontFamily: "monospace" }}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "#27272a", opacity: 0.5 }} />
                  <Bar dataKey="weight_pct" name="HRP Weight %" radius={[4, 4, 0, 0]}>
                    {weightData.map((entry) => (
                      <Cell key={entry.ticker} fill={clusterColor(entry.cluster)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Risk Table */}
              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="bg-zinc-900/80">
                      {["Ticker", "Cluster", "HRP Weight", "Allocation", "Ann. Vol", "1D VaR 95%"].map(
                        (h) => (
                          <th key={h} className="text-left px-3 py-2 text-zinc-500 uppercase text-[10px] tracking-wider">
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sorted_order.map((t) => (
                      <tr key={t} className="border-t border-zinc-800/60 hover:bg-zinc-800/30">
                        <td className="px-3 py-2 text-zinc-100 font-bold">{t}</td>
                        <td className="px-3 py-2">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] text-white"
                            style={{ backgroundColor: clusterColor(result.clusters[t]) + "99" }}
                          >
                            C{result.clusters[t]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-indigo-400">
                          {(result.weights[t] * 100).toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-emerald-400">
                          ${result.allocations[t].toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-amber-400">{result.annual_vol_pct[t]}%</td>
                        <td className="px-3 py-2 text-red-400">{result.var95_daily_pct[t]}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[10px] font-mono text-zinc-600">
                Sorted in dendrogram order · Lookback: {result.lookback_days}d · Total: ${result.total_balance.toLocaleString()}
              </p>
            </div>
          )}

          {/* ── TAB: MST GRAPH ──────────────────────────────────────────────── */}
          {activeTab === "mst" && mstLayout && (
            <div className="space-y-3">
              <p className="text-[10px] font-mono text-zinc-500">
                Minimum Spanning Tree — nodes colored by cluster. Edge thickness = correlation strength.
              </p>
              <div className="bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
                <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
                  {/* MST Edges */}
                  {result.mst_edges.map((e, i) => {
                    const s = mstLayout[e.source];
                    const t = mstLayout[e.target];
                    if (!s || !t) return null;
                    const strokeW = Math.max(0.5, 3 * (1 - e.distance));
                    return (
                      <g key={i}>
                        <line
                          x1={s.x}
                          y1={s.y}
                          x2={t.x}
                          y2={t.y}
                          stroke="#3f3f46"
                          strokeWidth={strokeW + 2}
                        />
                        <line
                          x1={s.x}
                          y1={s.y}
                          x2={t.x}
                          y2={t.y}
                          stroke="#6366f1"
                          strokeWidth={strokeW}
                          strokeOpacity={0.6}
                        />
                        {/* Distance label at midpoint */}
                        <text
                          x={(s.x + t.x) / 2}
                          y={(s.y + t.y) / 2 - 4}
                          fontSize={8}
                          fill="#52525b"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {e.distance.toFixed(3)}
                        </text>
                      </g>
                    );
                  })}

                  {/* Nodes */}
                  {result.tickers.map((t) => {
                    const pos = mstLayout[t];
                    if (!pos) return null;
                    const color = clusterColor(result.clusters[t]);
                    const w = (result.weights[t] * 100).toFixed(1);
                    return (
                      <g key={t}>
                        {/* Glow */}
                        <circle cx={pos.x} cy={pos.y} r={20} fill={color} opacity={0.08} />
                        {/* Node */}
                        <circle
                          cx={pos.x}
                          cy={pos.y}
                          r={14}
                          fill="#18181b"
                          stroke={color}
                          strokeWidth={2}
                        />
                        {/* Ticker label */}
                        <text
                          x={pos.x}
                          y={pos.y + 1}
                          fontSize={9}
                          fill={color}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {t}
                        </text>
                        {/* Weight below node */}
                        <text
                          x={pos.x}
                          y={pos.y + 22}
                          fontSize={8}
                          fill="#71717a"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {w}%
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* MST Edge table */}
              <div className="text-[10px] font-mono text-zinc-500 grid grid-cols-3 gap-1">
                {result.mst_edges.map((e, i) => (
                  <span key={i} className="bg-zinc-900 rounded px-2 py-1">
                    {e.source} — {e.target}
                    <span className="text-indigo-400 ml-1">{e.distance.toFixed(3)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── TAB: CORRELATION ────────────────────────────────────────────── */}
          {activeTab === "corr" && (
            <div className="space-y-3">
              <p className="text-[10px] font-mono text-zinc-500">
                Rolling {result.lookback_days}d correlation matrix. Color: red=high, green=low, blue=negative.
              </p>
              <div className="overflow-x-auto">
                <table className="text-xs font-mono border-collapse">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-zinc-600 text-[10px]"></th>
                      {corrTickers.map((t) => (
                        <th key={t} className="px-2 py-1 text-zinc-400 text-[10px] font-bold">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {corrTickers.map((t1) => (
                      <tr key={t1}>
                        <td className="px-2 py-1 text-zinc-400 font-bold">{t1}</td>
                        {corrTickers.map((t2) => {
                          const v = result.correlation[t1]?.[t2] ?? 0;
                          return (
                            <td
                              key={t2}
                              className="px-2 py-1 text-center rounded"
                              style={{
                                backgroundColor: corrColor(v) + "33",
                                color: corrColor(v),
                                fontWeight: t1 === t2 ? "bold" : "normal",
                              }}
                            >
                              {v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="p-8 text-center text-zinc-600 font-mono text-xs">
          Enter tickers and click "Run HRP" to optimize your portfolio allocation.
        </div>
      )}
    </div>
  );
}

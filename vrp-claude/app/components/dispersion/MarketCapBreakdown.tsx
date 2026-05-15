"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, PieChart, Database, Zap, AlertTriangle } from "lucide-react";
import {
  WeightsResponse, WeightsConstituent,
  fetchWeights, fmtCap, getMethodBadge,
} from "../../lib/dispersion";

type SupportedIndex = "SPY" | "QQQ" | "IWM";

interface MarketCapBreakdownProps {
  index?: SupportedIndex;
}

/* ── Color palette for bars (cycled) ── */
const BAR_COLORS = [
  "#818cf8", "#a78bfa", "#c084fc", "#e879f9",
  "#f472b6", "#fb7185", "#f87171", "#fb923c",
  "#fbbf24", "#a3e635", "#34d399",
];

export default function MarketCapBreakdown({ index: parentIndex }: MarketCapBreakdownProps) {
  const [activeIndex, setActiveIndex] = useState<SupportedIndex>(parentIndex ?? "SPY");
  const [data, setData] = useState<WeightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchWeights(activeIndex, force);
      setData(d);
    } catch (e: any) {
      setError(e.message || "Fetch gagal");
    } finally {
      setLoading(false);
    }
  }, [activeIndex]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync with parent index if provided
  useEffect(() => {
    if (parentIndex && parentIndex !== activeIndex) {
      setActiveIndex(parentIndex);
    }
  }, [parentIndex]);

  const methodBadge = data ? getMethodBadge(data.method) : null;
  const maxWeight = data ? Math.max(...data.constituents.map(c => c.weight_pct)) : 0;

  return (
    <div className="space-y-4">

      {/* Header Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <PieChart size={14} className="text-violet-400" />
            <h3 className="text-xs font-mono font-bold text-zinc-100 uppercase tracking-wider">
              Dynamic Market Cap Weights
            </h3>
          </div>

          {/* Method Badge */}
          {methodBadge && data && (
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${methodBadge.color}`}>
              {methodBadge.label}
            </span>
          )}

          {/* Coverage Badge */}
          {data && (
            <span className="text-[9px] font-mono text-zinc-500 bg-zinc-800/50 border border-zinc-700/40 px-2 py-0.5 rounded">
              Coverage: {data.coverage}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Index Selector (standalone mode) */}
          {!parentIndex && (
            <div className="flex gap-1">
              {(["SPY", "QQQ", "IWM"] as SupportedIndex[]).map(idx => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`px-2 py-1 text-[10px] font-mono rounded transition-colors ${
                    activeIndex === idx
                      ? "bg-violet-900/50 text-violet-300 border border-violet-700/50"
                      : "bg-zinc-800/40 text-zinc-500 hover:bg-zinc-800"
                  }`}
                >
                  {idx}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => loadData(true)}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-mono rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:text-violet-400 hover:border-violet-700/50 transition-all"
          >
            <RefreshCw size={10} className={loading ? "animate-spin text-violet-400" : ""} />
            {loading ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[10px] font-mono text-red-400">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 px-4 py-8 text-center text-zinc-500 text-[10px] font-mono">
          Fetching market cap data from yfinance...
        </div>
      )}

      {/* Content */}
      {data && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-4 space-y-4">

          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Database size={12} className="text-violet-400" />}
              label="Total Market Cap"
              value={data.total_market_cap_fmt ?? "--"}
              sub={`${data.n_constituents} constituents`}
            />
            <SummaryCard
              icon={<PieChart size={12} className="text-blue-400" />}
              label="Method"
              value={data.method === "sector_proxy" ? "Sector ETF" : data.method === "market_cap_top10" ? "Market Cap" : "Static"}
              sub={data.method_label}
            />
            <SummaryCard
              icon={<Zap size={12} className="text-amber-400" />}
              label="Coverage"
              value={data.coverage}
              sub={`of ${data.index} index`}
            />
            <SummaryCard
              icon={<RefreshCw size={12} className="text-emerald-400" />}
              label="Cache TTL"
              value="1 Hour"
              sub="Auto-refresh"
            />
          </div>

          {/* Bar Chart */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500 uppercase tracking-wider px-1">
              <span>Constituent</span>
              <span>Weight / Market Cap</span>
            </div>

            {data.constituents.map((c, i) => (
              <ConstituentBar
                key={c.ticker}
                constituent={c}
                maxWeight={maxWeight}
                color={BAR_COLORS[i % BAR_COLORS.length]}
                rank={i + 1}
              />
            ))}
          </div>

          {/* Timestamp */}
          <div className="text-[9px] font-mono text-zinc-600 text-right">
            Updated: {new Date(data.timestamp).toLocaleTimeString()} · {data.index}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Summary Card ── */
function SummaryCard({ icon, label, value, sub }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/50 bg-zinc-900/50 px-3 py-2.5 space-y-1">
      <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-500 uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <p className="text-sm font-mono font-bold text-zinc-100">{value}</p>
      <p className="text-[9px] font-mono text-zinc-600 truncate">{sub}</p>
    </div>
  );
}

/* ── Constituent Bar Row ── */
function ConstituentBar({ constituent, maxWeight, color, rank }: {
  constituent: WeightsConstituent;
  maxWeight: number;
  color: string;
  rank: number;
}) {
  const c = constituent;
  const pct = maxWeight > 0 ? (c.weight_pct / maxWeight) * 100 : 0;

  return (
    <div className="group flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-zinc-800/30 transition-colors">
      {/* Rank */}
      <span className="text-[9px] font-mono text-zinc-600 w-4 text-right">{rank}</span>

      {/* Ticker + Sector */}
      <div className="w-16 sm:w-20 flex-shrink-0">
        <span className="text-[11px] font-mono font-bold text-zinc-200">{c.ticker}</span>
        {c.sector_name && (
          <p className="text-[8px] font-mono text-zinc-600 truncate">{c.sector_name}</p>
        )}
      </div>

      {/* Bar */}
      <div className="flex-1 h-5 bg-zinc-800/50 rounded overflow-hidden relative">
        <div
          className="h-full rounded transition-all duration-700 ease-out relative"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            opacity: 0.7,
          }}
        >
          {/* Shimmer */}
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)`,
            }}
          />
        </div>

        {/* Weight label inside bar */}
        <span
          className="absolute inset-y-0 flex items-center text-[10px] font-mono font-bold"
          style={{
            left: `max(${pct}% + 6px, 6px)`,
            color: pct > 60 ? "#fff" : "#a1a1aa",
          }}
        >
          {c.weight_pct.toFixed(1)}%
        </span>
      </div>

      {/* Market Cap */}
      <div className="w-16 sm:w-20 text-right flex-shrink-0">
        <span className="text-[10px] font-mono text-zinc-400">
          {c.market_cap_fmt ?? "--"}
        </span>
      </div>
    </div>
  );
}

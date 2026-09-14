"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";

const LiveTxFeed = dynamic(() => import("./LiveTxFeed"), { ssr: false });
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  LineChart,
  Line,
} from "recharts";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface HistoryPoint {
  day_index: number;
  date: string;
  price: number;
  mvrv: number;
  nupl: number;
  sopr: number;
}

interface MarketValData {
  status: "success" | "fallback";
  coin: string;
  price: number;
  market_cap: number;
  realized_cap: number;
  mvrv_ratio: number;
  mvrv_zone: string;
  nupl: number;
  nupl_zone: string;
  sopr: number;
  sopr_signal: string;
  history: HistoryPoint[];
}

const COINS = ["BTC", "ETH", "SOL"] as const;
type Coin = (typeof COINS)[number];

/* ─── Color config per zone ───────────────────────────────────────────── */
const MVRV_COLORS: Record<string, { bg: string; text: string; glow: string; label: string }> = {
  EXTREME_UNDERVALUED: { bg: "bg-sky-500/15",   text: "text-sky-300",    glow: "#0ea5e9", label: "Extreme Undervalued 🔵" },
  UNDERVALUED:         { bg: "bg-emerald-500/15",text: "text-emerald-400",glow: "#10b981", label: "Undervalued 🟢" },
  FAIR_VALUE:          { bg: "bg-yellow-500/10", text: "text-yellow-400", glow: "#eab308", label: "Fair Value 🟡" },
  OVERVALUED:          { bg: "bg-orange-500/12", text: "text-orange-400", glow: "#f97316", label: "Overvalued 🟠" },
  EXTREME_OVERVALUED:  { bg: "bg-red-500/15",    text: "text-red-400",    glow: "#ef4444", label: "Extreme Overvalued 🔴" },
};

const NUPL_COLORS: Record<string, { text: string; glow: string; label: string }> = {
  CAPITULATION:    { text: "text-sky-300",     glow: "#0ea5e9", label: "Capitulation" },
  HOPE_FEAR:       { text: "text-blue-400",    glow: "#3b82f6", label: "Hope/Fear" },
  OPTIMISM:        { text: "text-emerald-400", glow: "#10b981", label: "Optimism" },
  BELIEF_DENIAL:   { text: "text-yellow-400",  glow: "#eab308", label: "Belief/Denial" },
  EUPHORIA:        { text: "text-orange-400",  glow: "#f97316", label: "Euphoria" },
  GREED:           { text: "text-red-400",     glow: "#ef4444", label: "Greed" },
};

const SOPR_COLORS: Record<string, { text: string; glow: string; label: string }> = {
  BEARISH_CAPITULATION: { text: "text-sky-300",     glow: "#0ea5e9", label: "Capitulation" },
  BEARISH:              { text: "text-red-400",     glow: "#ef4444", label: "Bearish" },
  NEUTRAL:              { text: "text-zinc-400",    glow: "#71717a", label: "Neutral" },
  BULLISH:              { text: "text-emerald-400", glow: "#10b981", label: "Bullish" },
};

/* ─── Number formatters ───────────────────────────────────────────────── */
const fmtCap = (v: number) => {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
};
const fmtPrice = (v: number) =>
  v >= 10000
    ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ─── Gauge SVG component ─────────────────────────────────────────────── */
function ArcGauge({
  value,       // 0–1
  color,
  size = 110,
  label,
  sublabel,
}: {
  value: number;
  color: string;
  size?: number;
  label: string;
  sublabel: string;
}) {
  const r = 40;
  const cx = size / 2;
  const cy = size / 2 + 8;
  const startAngle = -210;
  const sweep = 240;
  const endAngle = startAngle + sweep * Math.max(0, Math.min(1, value));

  const polarToXY = (angle: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcPath = (from: number, to: number, color: string, strokeW = 6) => {
    const steps = 60;
    const pts = Array.from({ length: steps + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / steps;
      return polarToXY(a);
    });
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    return (
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
    );
  };

  return (
    <svg width={size} height={size * 0.85} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <filter id={`glow-${label}`}>
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Track */}
      {arcPath(startAngle, startAngle + sweep, "#27272a", 6)}
      {/* Value arc */}
      {arcPath(startAngle, endAngle, color, 7)}
      {/* Needle dot */}
      {(() => {
        const pt = polarToXY(endAngle);
        return (
          <circle
            cx={pt.x}
            cy={pt.y}
            r={4}
            fill={color}
            filter={`url(#glow-${label})`}
          />
        );
      })()}
      {/* Label */}
      <text x={cx} y={cy - 2} textAnchor="middle" fill="white" fontSize={11} fontFamily="monospace" fontWeight="bold">
        {label}
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" fill="#71717a" fontSize={7.5} fontFamily="monospace">
        {sublabel}
      </text>
    </svg>
  );
}

/* ─── Custom Recharts Tooltip ─────────────────────────────────────────── */
const MetricTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-950/95 border border-zinc-800 rounded-lg px-3 py-2 shadow-2xl backdrop-blur-sm min-w-[160px]">
      <p className="text-[9px] font-mono text-zinc-500 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono" style={{ color: entry.color }}>
            {entry.name}
          </span>
          <span className="text-[10px] font-mono text-zinc-200 font-bold">
            {typeof entry.value === "number" ? entry.value.toFixed(4) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ─── MVRV Cycle Band Chart ───────────────────────────────────────────── */
function MVRVCycleChart({ history }: { history: HistoryPoint[] }) {
  const last20 = history.slice(-20).map((h) => ({
    ...h,
    date: h.date.slice(5), // MM-DD
    band_extreme_low: 0,
    band_underval: 1.0,
    band_fair: 1.5,
    band_over: 2.2,
    band_extreme_high: 3.0,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={last20} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="mvrvGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} interval={4} />
        <YAxis domain={[0, 3.5]} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} />
        <Tooltip content={<MetricTooltip />} />
        {/* Reference bands */}
        <ReferenceLine y={1.0} stroke="#0ea5e9" strokeDasharray="4 4" strokeOpacity={0.5} />
        <ReferenceLine y={1.5} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.5} />
        <ReferenceLine y={2.2} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.5} />
        <ReferenceLine y={3.0} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.5} />
        <Area
          type="monotone"
          dataKey="mvrv"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#mvrvGrad)"
          dot={false}
          name="MVRV"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── NUPL Heatmap Chart ──────────────────────────────────────────────── */
function NUPLChart({ history }: { history: HistoryPoint[] }) {
  const last20 = history.slice(-20).map((h) => ({
    ...h,
    date: h.date.slice(5),
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={last20} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="nuplGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} interval={4} />
        <YAxis domain={[-0.3, 0.9]} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
        <Tooltip content={<MetricTooltip />} />
        <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
        <ReferenceLine y={0.25} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.5} />
        <ReferenceLine y={0.5} stroke="#f97316" strokeDasharray="3 3" strokeOpacity={0.5} />
        <Area
          type="monotone"
          dataKey="nupl"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#nuplGrad)"
          dot={false}
          name="NUPL"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── SOPR Chart ──────────────────────────────────────────────────────── */
function SOPRChart({ history }: { history: HistoryPoint[] }) {
  const last20 = history.slice(-20).map((h) => ({
    ...h,
    date: h.date.slice(5),
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={last20} margin={{ top: 6, right: 4, left: -24, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} interval={4} />
        <YAxis domain={[0.85, 1.25]} tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(2)} />
        <Tooltip content={<MetricTooltip />} />
        <ReferenceLine y={1.0} stroke="#facc15" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: "1.0", position: "insideTopRight", fill: "#facc15", fontSize: 8, fontFamily: "monospace" }} />
        <Line
          type="monotone"
          dataKey="sopr"
          stroke="#f97316"
          strokeWidth={2}
          dot={false}
          name="SOPR"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ─── Price History Chart ─────────────────────────────────────────────── */
function PriceHistoryChart({ history, coin }: { history: HistoryPoint[]; coin: string }) {
  const color = coin === "BTC" ? "#f7931a" : coin === "ETH" ? "#627eea" : "#9945ff";
  const last30 = history.slice(-30).map((h) => ({ ...h, date: h.date.slice(5) }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={last30} margin={{ top: 2, right: 4, left: -32, bottom: 0 }}>
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0.0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: "#52525b", fontSize: 8, fontFamily: "monospace" }} tickLine={false} axisLine={false} interval={9} />
        <YAxis hide />
        <Tooltip content={<MetricTooltip />} />
        <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill="url(#priceGrad)" dot={false} name="Price" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Skeleton loader ─────────────────────────────────────────────────── */
function SkeletonBox({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} rounded-xl bg-zinc-900/60 animate-pulse`} />;
}

/* ─── Main Dashboard ──────────────────────────────────────────────────── */
export default function OnChainDashboard() {
  const [activeTab, setActiveTab] = useState<"valuation" | "live">("valuation");
  const [coin, setCoin]     = useState<Coin>("BTC");
  const [data, setData]     = useState<MarketValData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [activeChart, setActiveChart] = useState<"mvrv" | "nupl" | "sopr">("mvrv");
  const timerRef            = useRef<NodeJS.Timeout | null>(null);
  const [tick, setTick]     = useState(0); // for animated counter

  /* Fetch */
  const fetchData = useCallback(async (c: Coin) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto/onchain/market-valuation?coin=${c}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message ?? "Gagal memuat data on-chain.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(coin);
    timerRef.current = setInterval(() => fetchData(coin), 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [coin, fetchData]);

  // tick animation for loading
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 80);
    return () => clearInterval(id);
  }, []);

  /* Coin accent color */
  const coinColor = coin === "BTC" ? "#f7931a" : coin === "ETH" ? "#627eea" : "#9945ff";
  const mvrvInfo  = MVRV_COLORS[data?.mvrv_zone ?? "FAIR_VALUE"] ?? MVRV_COLORS.FAIR_VALUE;
  const nuplInfo  = NUPL_COLORS[data?.nupl_zone ?? "OPTIMISM"]  ?? NUPL_COLORS.OPTIMISM;
  const soprInfo  = SOPR_COLORS[data?.sopr_signal ?? "NEUTRAL"] ?? SOPR_COLORS.NEUTRAL;

  /* MVRV gauge: map 0–3.5 to 0–1 */
  const mvrvGaugeVal  = Math.min(1, (data?.mvrv_ratio ?? 0) / 3.5);
  /* NUPL gauge: map -0.3..0.9 to 0..1 */
  const nuplGaugeVal  = Math.min(1, Math.max(0, ((data?.nupl ?? 0) + 0.3) / 1.2));
  /* SOPR gauge: map 0.85..1.25 to 0..1 */
  const soprGaugeVal  = Math.min(1, Math.max(0, ((data?.sopr ?? 1) - 0.85) / 0.4));

  return (
    <div className="relative min-h-screen overflow-hidden">

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* DECORATED BACKGROUND                                               */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="absolute inset-0 pointer-events-none select-none -z-10">
        {/* Dark base */}
        <div className="absolute inset-0 bg-zinc-950" />
        
        {/* Radial hero gradient – top left corner glow */}
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(16,185,129,0.07) 0%, transparent 70%)" }} />
        
        {/* Second glow – bottom right */}
        <div className="absolute -bottom-60 -right-40 w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%)" }} />

        {/* Coin accent glow near header */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] transition-all duration-1000"
          style={{ background: `radial-gradient(ellipse at center, ${coinColor}10 0%, transparent 70%)` }}
        />

        {/* Grid lines (blockchain aesthetic) */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.035]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#10b981" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Diagonal scanline shimmer */}
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)" }} />

        {/* Floating hex nodes (decorative) */}
        {[
          { top: "12%",  left: "4%",   size: 6, opacity: 0.25 },
          { top: "28%",  left: "18%",  size: 4, opacity: 0.18 },
          { top: "60%",  left: "8%",   size: 5, opacity: 0.20 },
          { top: "8%",   right: "6%",  size: 7, opacity: 0.22 },
          { top: "45%",  right: "3%",  size: 4, opacity: 0.15 },
          { top: "75%",  right: "12%", size: 6, opacity: 0.20 },
        ].map((n, i) => (
          <div
            key={i}
            className="absolute rounded-full border"
            style={{
              top: n.top, left: (n as any).left, right: (n as any).right,
              width: n.size * 8, height: n.size * 8,
              borderColor: `${coinColor}${Math.round(n.opacity * 255).toString(16).padStart(2,"0")}`,
              background: `${coinColor}08`,
            }}
          />
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* HERO HEADER                                                         */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="relative px-0 pt-2 pb-4">
        {/* Top badge row */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base"
              style={{ background: `${coinColor}20`, border: `1px solid ${coinColor}40` }}>
              ⛓️
            </div>
            <div>
              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">On-Chain Intelligence</div>
              <h1 className="text-base font-mono font-bold text-zinc-100 leading-tight">Blockchain Analytics Dashboard</h1>
            </div>
          </div>

          {/* Data source badge */}
          <div className="flex items-center gap-2">
            {data?.status === "fallback" && activeTab === "valuation" && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-wider bg-amber-950/40 text-amber-400 border border-amber-500/30">
                ⚠ Simulation Mode
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-mono uppercase tracking-wider bg-zinc-900 border border-zinc-800">
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: activeTab === "live" ? "#22c55e" : coinColor }} />
              <span className="text-zinc-400">{activeTab === "live" ? "Live · 12s block" : "Live · 60s refresh"}</span>
            </span>
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          {([
            { key: "valuation", label: "📊 Market Valuation", color: coinColor },
            { key: "live",      label: "⛓ Live Tx Feed",     color: "#22d3ee" },
          ] as const).map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: "7px 16px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "monospace",
                cursor: "pointer",
                border: activeTab === key ? `1px solid ${color}50` : "1px solid rgba(148,163,184,0.12)",
                background: activeTab === key ? `${color}12` : "rgba(15,23,42,0.6)",
                color: activeTab === key ? color : "#52525b",
                boxShadow: activeTab === key ? `0 0 12px ${color}20` : "none",
                transition: "all 0.2s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Coin selector — only show for valuation tab */}
        {activeTab === "valuation" && (
          <div className="inline-flex bg-zinc-950/80 border border-zinc-800/60 rounded-xl p-1 gap-1 backdrop-blur-sm">
            {COINS.map((c) => {
              const cc = c === "BTC" ? "#f7931a" : c === "ETH" ? "#627eea" : "#9945ff";
              const emoji = c === "BTC" ? "₿" : c === "ETH" ? "Ξ" : "◎";
              return (
                <button
                  key={c}
                  onClick={() => setCoin(c)}
                  className="relative px-4 py-1.5 text-[11px] font-mono font-bold uppercase rounded-lg transition-all duration-200 cursor-pointer overflow-hidden"
                  style={
                    coin === c
                      ? { background: `${cc}18`, color: cc, border: `1px solid ${cc}40`, boxShadow: `0 0 12px ${cc}25` }
                      : { color: "#52525b", border: "1px solid transparent" }
                  }
                >
                  {emoji} {c}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Live Tx Feed Tab ── */}
      {activeTab === "live" && (
        <div className="relative">
          <LiveTxFeed />
        </div>
      )}

      {/* ── Market Valuation Tab wrapper ── */}
      {activeTab === "valuation" && (
        <div className="relative space-y-0">

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: MARKET VALUATION & CYCLE METRICS                        */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div className="relative space-y-4">

        {/* Section label */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-1 h-5 rounded-full" style={{ background: coinColor }} />
            <span className="text-[11px] font-mono font-bold text-zinc-300 uppercase tracking-widest">
              01 · Market Valuation & Cycle Metrics
            </span>
          </div>
          <div className="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
          <span className="text-[9px] font-mono text-zinc-600 uppercase">MVRV · NUPL · SOPR</span>
        </div>

        {/* ── ROW 1: Price card + Gauges ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">

          {/* Price + Cap Card */}
          <div className="lg:col-span-1 rounded-2xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm p-5 space-y-3 relative overflow-hidden">
            <div className="absolute inset-0 rounded-2xl opacity-[0.04]"
              style={{ background: `radial-gradient(circle at 80% 20%, ${coinColor}, transparent 65%)` }} />
            
            {loading && !data ? (
              <div className="space-y-2 pt-2">
                <SkeletonBox h="h-6" />
                <SkeletonBox h="h-10" />
                <SkeletonBox h="h-4" />
                <SkeletonBox h="h-4" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">{coin} · Spot Price</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full border"
                    style={{ color: coinColor, borderColor: `${coinColor}40`, background: `${coinColor}10` }}>
                    Live
                  </span>
                </div>
                
                <div className="font-mono font-bold leading-none" style={{ color: coinColor, fontSize: "clamp(18px, 3vw, 26px)" }}>
                  {data ? fmtPrice(data.price) : "—"}
                </div>
                
                <div className="h-px bg-zinc-800/60" />
                
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-zinc-500">Market Cap</span>
                    <span className="text-zinc-200">{data ? fmtCap(data.market_cap) : "—"}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-zinc-500">Realized Cap</span>
                    <span className="text-zinc-200">{data ? fmtCap(data.realized_cap) : "—"}</span>
                  </div>
                </div>

                {/* Mini sparkline */}
                {data && data.history.length > 0 && (
                  <div className="-mx-1">
                    <PriceHistoryChart history={data.history} coin={coin} />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 3 Gauges */}
          {(["mvrv", "nupl", "sopr"] as const).map((metric) => {
            const metricLabels: Record<string, { title: string; formula: string; desc: string; color: string; zone: string; val: string; gaugeVal: number }> = {
              mvrv: {
                title: "MVRV Ratio",
                formula: "Market Cap / Realized Cap",
                desc: ">3 = Overvalued · <1 = Undervalued",
                color: mvrvInfo.glow,
                zone: mvrvInfo.label,
                val: data ? data.mvrv_ratio.toFixed(3) : "—",
                gaugeVal: mvrvGaugeVal,
              },
              nupl: {
                title: "NUPL",
                formula: "(Market Cap − Realized Cap) / Market Cap",
                desc: ">0.75 = Greed · <0 = Fear/Capitulation",
                color: nuplInfo.glow,
                zone: nuplInfo.label,
                val: data ? (data.nupl * 100).toFixed(1) + "%" : "—",
                gaugeVal: nuplGaugeVal,
              },
              sopr: {
                title: "SOPR",
                formula: "Spent Output Profit Ratio",
                desc: ">1.0 = Selling at Profit · <1.0 = Selling at Loss",
                color: soprInfo.glow,
                zone: soprInfo.label,
                val: data ? data.sopr.toFixed(4) : "—",
                gaugeVal: soprGaugeVal,
              },
            };
            const m = metricLabels[metric];

            return (
              <div
                key={metric}
                className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm p-4 flex flex-col items-center gap-2 relative overflow-hidden hover:border-zinc-700/60 transition-colors cursor-default"
                style={{ boxShadow: loading ? "none" : `0 0 30px ${m.color}08` }}
              >
                {/* Background glow */}
                <div className="absolute inset-0 rounded-2xl opacity-[0.04]"
                  style={{ background: `radial-gradient(circle at 50% 0%, ${m.color}, transparent 65%)` }} />

                {/* Title */}
                <div className="w-full flex items-center justify-between relative z-10">
                  <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-400">{m.title}</span>
                  {!loading && data && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-full border"
                      style={{ color: m.color, borderColor: `${m.color}40`, background: `${m.color}12` }}>
                      {m.zone}
                    </span>
                  )}
                </div>

                {/* Arc Gauge */}
                <div className="relative z-10">
                  {loading && !data ? (
                    <div className="w-[110px] h-[80px] rounded-full bg-zinc-800/40 animate-pulse" />
                  ) : (
                    <ArcGauge
                      value={m.gaugeVal}
                      color={m.color}
                      label={m.val}
                      sublabel={m.title}
                    />
                  )}
                </div>

                {/* Formula & desc */}
                <div className="text-center relative z-10 space-y-0.5">
                  <div className="text-[8px] font-mono text-zinc-500">{m.formula}</div>
                  <div className="text-[8px] font-mono text-zinc-600 leading-relaxed max-w-[160px]">{m.desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── ROW 2: Historical Chart Panel ── */}
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm overflow-hidden">
          {/* Chart tab switcher */}
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-3">
            <div className="flex gap-1">
              {(["mvrv", "nupl", "sopr"] as const).map((ch) => {
                const labels: Record<string, string> = { mvrv: "MVRV History", nupl: "NUPL History", sopr: "SOPR History" };
                const colors: Record<string, string> = { mvrv: "#10b981", nupl: "#8b5cf6", sopr: "#f97316" };
                return (
                  <button
                    key={ch}
                    onClick={() => setActiveChart(ch)}
                    className="px-3 py-1 text-[10px] font-mono font-bold uppercase rounded-lg transition-all cursor-pointer"
                    style={
                      activeChart === ch
                        ? { background: `${colors[ch]}18`, color: colors[ch], border: `1px solid ${colors[ch]}35` }
                        : { color: "#52525b", border: "1px solid transparent" }
                    }
                  >
                    {labels[ch]}
                  </button>
                );
              })}
            </div>
            <span className="text-[9px] font-mono text-zinc-600">Last 20 days · Daily</span>
          </div>

          <div className="px-4 pb-4 pt-3">
            {/* Chart area legend */}
            {activeChart === "mvrv" && (
              <div className="flex gap-4 mb-2 flex-wrap">
                {[
                  { label: "Underval <1.0", color: "#0ea5e9" },
                  { label: "Fair 1.0-1.5",  color: "#10b981" },
                  { label: "Over 2.2+",     color: "#eab308" },
                  { label: "Extreme 3.0+",  color: "#ef4444" },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-1">
                    <div className="w-6 h-0.5 border-t border-dashed" style={{ borderColor: b.color }} />
                    <span className="text-[8px] font-mono text-zinc-500">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
            {activeChart === "nupl" && (
              <div className="flex gap-4 mb-2 flex-wrap">
                {[
                  { label: "Optimism >0.25", color: "#eab308" },
                  { label: "Fear/Hopium =0",  color: "#52525b" },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-1">
                    <div className="w-6 h-0.5 border-t border-dashed" style={{ borderColor: b.color }} />
                    <span className="text-[8px] font-mono text-zinc-500">{b.label}</span>
                  </div>
                ))}
              </div>
            )}
            {activeChart === "sopr" && (
              <div className="flex gap-4 mb-2">
                <div className="flex items-center gap-1">
                  <div className="w-6 h-0.5 border-t border-dashed" style={{ borderColor: "#facc15" }} />
                  <span className="text-[8px] font-mono text-zinc-500">Break-Even = 1.0</span>
                </div>
              </div>
            )}

            {/* Chart */}
            {loading && !data ? (
              <SkeletonBox h="h-44" />
            ) : !data ? (
              <div className="h-44 flex items-center justify-center text-[10px] font-mono text-zinc-600">{error ?? "Tidak ada data"}</div>
            ) : (
              <>
                {activeChart === "mvrv" && <MVRVCycleChart history={data.history} />}
                {activeChart === "nupl" && <NUPLChart history={data.history} />}
                {activeChart === "sopr" && <SOPRChart history={data.history} />}
              </>
            )}
          </div>
        </div>

        {/* ── ROW 3: Interpretation Card ── */}
        {data && (
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm p-4">
            <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-3">
              📖 Interpretasi Saat Ini — {coin}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* MVRV interpretation */}
              <div className={`rounded-xl p-3 border ${mvrvInfo.bg} border-zinc-800/50`}>
                <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">MVRV · {data.mvrv_ratio.toFixed(2)}</div>
                <div className={`text-[10px] font-mono font-bold ${mvrvInfo.text}`}>{mvrvInfo.label}</div>
                <p className="text-[9px] font-mono text-zinc-500 mt-1 leading-relaxed">
                  {data.mvrv_zone === "EXTREME_UNDERVALUED" && "Pasar sangat undervalued. Potensi akumulasi terbaik secara historis."}
                  {data.mvrv_zone === "UNDERVALUED"         && "Harga di bawah nilai realized. Zona akumulasi strategis."}
                  {data.mvrv_zone === "FAIR_VALUE"          && "Valuasi wajar. Pasar dalam keseimbangan supply-demand."}
                  {data.mvrv_zone === "OVERVALUED"          && "Harga jauh di atas cost basis. Waspadai distribusi."}
                  {data.mvrv_zone === "EXTREME_OVERVALUED"  && "Zona euforia. Probabilitas koreksi signifikan sangat tinggi."}
                </p>
              </div>

              {/* NUPL interpretation */}
              <div className="rounded-xl p-3 border bg-violet-500/5 border-zinc-800/50">
                <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">NUPL · {(data.nupl * 100).toFixed(1)}%</div>
                <div className={`text-[10px] font-mono font-bold ${nuplInfo.text}`}>{nuplInfo.label}</div>
                <p className="text-[9px] font-mono text-zinc-500 mt-1 leading-relaxed">
                  {data.nupl_zone === "CAPITULATION"   && "Mayoritas holder merugi. Sinyal bottom historis yang kuat."}
                  {data.nupl_zone === "HOPE_FEAR"       && "Sentimen antara harapan dan ketakutan. Recovery awal."}
                  {data.nupl_zone === "OPTIMISM"        && "Market mulai membangun keuntungan unrealized secara luas."}
                  {data.nupl_zone === "BELIEF_DENIAL"   && "Holder percaya diri. Distribusi dari smart money mungkin terjadi."}
                  {data.nupl_zone === "EUPHORIA"        && "Keuntungan besar di seluruh pasar. Hati-hati sell-off mendadak."}
                  {data.nupl_zone === "GREED"           && "Greed level maksimal. Zona distribusi cycle top."}
                </p>
              </div>

              {/* SOPR interpretation */}
              <div className="rounded-xl p-3 border bg-orange-500/5 border-zinc-800/50">
                <div className="text-[9px] font-mono text-zinc-500 uppercase mb-1">SOPR · {data.sopr.toFixed(4)}</div>
                <div className={`text-[10px] font-mono font-bold ${soprInfo.text}`}>{soprInfo.label}</div>
                <p className="text-[9px] font-mono text-zinc-500 mt-1 leading-relaxed">
                  {data.sopr_signal === "BEARISH_CAPITULATION" && "Investor menjual di bawah harga beli. Capitulation — potensi reversal."}
                  {data.sopr_signal === "BEARISH"              && "Koin dijual dalam kerugian. Tekanan jual masih aktif."}
                  {data.sopr_signal === "NEUTRAL"              && "SOPR di sekitar 1.0 — break-even selling. Pasar konsolidasi."}
                  {data.sopr_signal === "BULLISH"              && "Koin dijual dalam keuntungan. Buyer masih dominan, tren positif."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Coming Soon: Part 2 teaser */}
        <div className="rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-950/40 p-4 flex items-center justify-between">
          <div>
            <div className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Coming Next</div>
            <div className="text-xs font-mono text-zinc-500">
              02 · Exchange Flows &nbsp;·&nbsp; 03 · Holder Cohorts &nbsp;·&nbsp; 04 · Network Activity
            </div>
          </div>
          <div className="text-zinc-700 text-xl">🔐</div>
        </div>

      </div>{/* end valuation content */}
        </div>
      )}
    </div>
  );
}


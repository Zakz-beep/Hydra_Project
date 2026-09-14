"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface LSDataPoint {
  timestamp: number;
  time: string;
  longShortRatio: number;
  longAccount: number;
  shortAccount: number;
}

interface TakerDataPoint {
  timestamp: number;
  time: string;
  buySellRatio: number;
  buyVol: number;
  sellVol: number;
}

interface LSSnapshot {
  symbol: string;
  longShortRatio: number;
  longAccount: number;
  shortAccount: number;
  ratioDelta: number;
  sentiment: "BULLISH" | "BEARISH";
  strength: "STRONG" | "MODERATE" | "NEUTRAL";
  source?: string;
}

type ExchangeSource = "auto" | "binance" | "bybit" | "okx" | "bitget";

const EXCHANGE_OPTIONS: { id: ExchangeSource; label: string; color: string }[] = [
  { id: "auto",    label: "⚡ Auto",    color: "#a78bfa" },
  { id: "binance", label: "🟡 Binance",  color: "#f59e0b" },
  { id: "bybit",   label: "🟠 Bybit",    color: "#fb923c" },
  { id: "okx",     label: "⚫ OKX",      color: "#6b7280" },
  { id: "bitget",  label: "🔵 Bitget",   color: "#3b82f6" },
];

const EXCHANGE_COLORS: Record<string, string> = {
  binance: "#f59e0b",
  bybit: "#fb923c",
  okx: "#6b7280",
  bitget: "#3b82f6",
  mock: "#ef4444",
  auto: "#a78bfa",
};

/* ─── Constants ─────────────────────────────────────────────────────────── */
const PERIODS = ["5m", "15m", "30m", "1h", "4h", "12h", "1d"] as const;
type Period = (typeof PERIODS)[number];

const TOP_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT",
];

const COIN_LABELS: Record<string, string> = {
  BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL", XRPUSDT: "XRP",
  BNBUSDT: "BNB", DOGEUSDT: "DOGE", ADAUSDT: "ADA", AVAXUSDT: "AVAX",
  LINKUSDT: "LINK", SUIUSDT: "SUI",
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmtVol = (v: number) => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtRatio = (r: number) => r.toFixed(4);

const getSentimentColor = (ratio: number) => {
  if (ratio >= 1.5) return "#10b981"; // strong bullish
  if (ratio >= 1.1) return "#34d399"; // bullish
  if (ratio >= 0.9) return "#a1a1aa"; // neutral
  if (ratio >= 0.7) return "#f87171"; // bearish
  return "#ef4444"; // strong bearish
};

const getSentimentBg = (ratio: number) => {
  if (ratio >= 1.5) return "rgba(16,185,129,0.12)";
  if (ratio >= 1.1) return "rgba(52,211,153,0.08)";
  if (ratio >= 0.9) return "rgba(161,161,170,0.06)";
  if (ratio >= 0.7) return "rgba(248,113,113,0.08)";
  return "rgba(239,68,68,0.12)";
};

const getSentimentLabel = (ratio: number) => {
  if (ratio >= 1.5) return "ULTRA BULL";
  if (ratio >= 1.1) return "BULLISH";
  if (ratio >= 0.9) return "NEUTRAL";
  if (ratio >= 0.7) return "BEARISH";
  return "ULTRA BEAR";
};

/* ─── Custom Tooltip ─────────────────────────────────────────────────────── */
const LSTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 shadow-2xl min-w-[160px]">
      <p className="text-[9px] font-mono text-zinc-500 mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono" style={{ color: p.color }}>{p.name}</span>
          <span className="text-[10px] font-mono font-bold text-zinc-200">
            {typeof p.value === "number" ? (p.value >= 100 ? fmtVol(p.value) : fmtRatio(p.value)) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

/* ─── Mini Gauge ─────────────────────────────────────────────────────────── */
function RatioGauge({ ratio, label }: { ratio: number; label: string }) {
  const clamp = Math.max(0, Math.min(1, (ratio - 0.5) / 2.5));
  const angleDeg = -90 + clamp * 180;
  const color = getSentimentColor(ratio);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="100" height="58" viewBox="0 0 100 58">
        {/* Arc background */}
        <path d="M 10 55 A 40 40 0 0 1 90 55" fill="none" stroke="#27272a" strokeWidth="8" strokeLinecap="round" />
        {/* Arc foreground */}
        <path d="M 10 55 A 40 40 0 0 1 90 55" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${clamp * 126} 126`} />
        {/* Needle */}
        <g transform={`rotate(${angleDeg}, 50, 55)`}>
          <line x1="50" y1="55" x2="50" y2="20" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="50" cy="55" r="3.5" fill={color} />
        </g>
        {/* Value */}
        <text x="50" y="50" textAnchor="middle" fill={color} fontSize="11" fontFamily="monospace" fontWeight="bold">
          {ratio.toFixed(3)}
        </text>
      </svg>
      <span className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

/* ─── Sentiment Heatmap Card ──────────────────────────────────────────────── */
function SnapshotCard({ item }: { item: LSSnapshot }) {
  const label = COIN_LABELS[item.symbol] || item.symbol;
  const color = getSentimentColor(item.longShortRatio);
  const bg = getSentimentBg(item.longShortRatio);
  const sentimentLabel = getSentimentLabel(item.longShortRatio);
  const deltaSign = item.ratioDelta >= 0 ? "+" : "";
  const longPct = (item.longAccount * 100).toFixed(1);
  const shortPct = (item.shortAccount * 100).toFixed(1);

  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-2 transition-all hover:scale-[1.02] cursor-default"
      style={{ borderColor: `${color}30`, background: bg }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-bold text-zinc-200">{label}</span>
          {item.source && item.source !== "mock" && (
            <span
              className="text-[7px] font-mono px-1 py-0.5 rounded border"
              style={{ color: EXCHANGE_COLORS[item.source] || "#71717a", borderColor: `${EXCHANGE_COLORS[item.source] || "#71717a"}30`, backgroundColor: `${EXCHANGE_COLORS[item.source] || "#71717a"}10` }}
            >
              {item.source.toUpperCase()}
            </span>
          )}
          {item.source === "mock" && (
            <span className="text-[7px] font-mono px-1 py-0.5 rounded border border-amber-700/30 text-amber-500 bg-amber-950/10">MOCK</span>
          )}
        </div>
        <span
          className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider"
          style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
        >
          {sentimentLabel}
        </span>
      </div>

      {/* Ratio */}
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-mono font-bold" style={{ color }}>
          {item.longShortRatio.toFixed(3)}
        </span>
        <span
          className="text-[9px] font-mono"
          style={{ color: item.ratioDelta >= 0 ? "#10b981" : "#ef4444" }}
        >
          {deltaSign}{item.ratioDelta.toFixed(4)}
        </span>
      </div>

      {/* Long/Short bar */}
      <div className="space-y-0.5">
        <div className="flex justify-between text-[8px] font-mono">
          <span className="text-emerald-400">L: {longPct}%</span>
          <span className="text-red-400">S: {shortPct}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-zinc-900 overflow-hidden flex">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${longPct}%`, background: "linear-gradient(90deg, #10b981, #34d399)" }}
          />
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${shortPct}%`, background: "linear-gradient(90deg, #f87171, #ef4444)" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Main Dashboard ─────────────────────────────────────────────────────── */
export default function LongShortDashboard() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [period, setPeriod] = useState<Period>("1h");
  const [activeMetric, setActiveMetric] = useState<"global" | "topPos" | "topAcc" | "taker">("global");

  // Data states
  const [globalData, setGlobalData] = useState<LSDataPoint[]>([]);
  const [topPosData, setTopPosData] = useState<LSDataPoint[]>([]);
  const [topAccData, setTopAccData] = useState<LSDataPoint[]>([]);
  const [takerData, setTakerData] = useState<TakerDataPoint[]>([]);
  const [snapshot, setSnapshot] = useState<LSSnapshot[]>([]);

  const [loading, setLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [sourceExchange, setSourceExchange] = useState<ExchangeSource>("auto");
  const [dataSources, setDataSources] = useState<Record<string, string>>({});

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [symInput, setSymInput] = useState("BTCUSDT");

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Fetch main chart data ── */
  const fetchData = useCallback(async (sym: string, per: string, src: ExchangeSource) => {
    setLoading(true);
    try {
      const [globalRes, topPosRes, topAccRes, takerRes] = await Promise.all([
        fetch(`/api/crypto/long-short-ratio?symbol=${sym}&period=${per}&limit=72&source=${src}`),
        fetch(`/api/crypto/top-trader-position-ratio?symbol=${sym}&period=${per}&limit=72&source=${src}`),
        fetch(`/api/crypto/top-trader-account-ratio?symbol=${sym}&period=${per}&limit=72&source=${src}`),
        fetch(`/api/crypto/taker-buy-sell-volume?symbol=${sym}&period=${per}&limit=72&source=${src}`),
      ]);

      const [gJson, pJson, aJson, tJson] = await Promise.all([
        globalRes.json(), topPosRes.json(), topAccRes.json(), takerRes.json(),
      ]);

      setGlobalData(gJson.data || []);
      setTopPosData(pJson.data || []);
      setTopAccData(aJson.data || []);
      setTakerData(tJson.data || []);
      setDataSources({
        global: gJson.source || "unknown",
        topPos: pJson.source || "unknown",
        topAcc: aJson.source || "unknown",
        taker: tJson.source || "unknown",
      });
      setIsFallback(
        gJson.source === "mock" || pJson.source === "mock" ||
        aJson.source === "mock" || tJson.source === "mock"
      );
    } catch (err) {
      console.error("[LS] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Fetch snapshot heatmap ── */
  const fetchSnapshot = useCallback(async (per: string, src: ExchangeSource) => {
    setSnapshotLoading(true);
    try {
      const res = await fetch(
        `/api/crypto/ls-snapshot?symbols=${TOP_SYMBOLS.join(",")}&period=${per}&source=${src}`
      );
      const json = await res.json();
      setSnapshot(json.data || []);
    } catch (err) {
      console.error("[LS_SNAP] Fetch error:", err);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(symbol, period, sourceExchange);
    fetchSnapshot(period, sourceExchange);
    // Auto-refresh setiap 30 detik
    timerRef.current = setInterval(() => {
      fetchData(symbol, period, sourceExchange);
      fetchSnapshot(period, sourceExchange);
    }, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [symbol, period, sourceExchange, fetchData, fetchSnapshot]);

  /* ── Active data set ── */
  const activeData = activeMetric === "global" ? globalData
    : activeMetric === "topPos" ? topPosData
    : activeMetric === "topAcc" ? topAccData
    : [];

  /* ── Latest value snapshot ── */
  const latestLS = globalData.at(-1);
  const latestTopPos = topPosData.at(-1);
  const latestTopAcc = topAccData.at(-1);
  const latestTaker = takerData.at(-1);

  /* ── Ratio-series chart color based on last value ── */
  const chartColor = latestLS ? getSentimentColor(latestLS.longShortRatio) : "#a1a1aa";

  /* ── Compute taker stacked bar data ── */
  const takerBarData = takerData.map((d) => ({
    ...d,
    buyVolM: d.buyVol / 1e6,
    sellVolM: d.sellVol / 1e6,
  }));

  /* ── Divergence: global vs top trader ── */
  const divergenceData = globalData.map((g, i) => {
    const p = topPosData[i];
    return {
      time: g.time,
      global: g.longShortRatio,
      topPos: p ? p.longShortRatio : null,
      topAcc: topAccData[i] ? topAccData[i].longShortRatio : null,
      delta: p ? parseFloat((g.longShortRatio - p.longShortRatio).toFixed(4)) : null,
    };
  });

  const METRIC_TABS = [
    { id: "global", label: "🌐 Global L/S", desc: "All accounts combined" },
    { id: "topPos", label: "📍 Top Trader Pos.", desc: "Smart money positions" },
    { id: "topAcc", label: "👤 Top Trader Acc.", desc: "Elite account ratio" },
    { id: "taker", label: "⚡ Taker Volume", desc: "Aggressive buy/sell" },
  ] as const;

  return (
    <div className="space-y-4">
      {/* ══ Control Panel ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Symbol Input */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <input
                type="text"
                value={symInput}
                onChange={(e) => { setSymInput(e.target.value.toUpperCase()); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = symInput.trim().toUpperCase();
                    const sym = val.endsWith("USDT") ? val : val + "USDT";
                    setSymbol(sym);
                    setShowSuggestions(false);
                  }
                }}
                placeholder="BTCUSDT, ETHUSDT..."
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-600 placeholder-zinc-600 w-44"
              />
              {showSuggestions && symInput.length > 0 && (
                <div className="absolute z-50 left-0 top-full mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl max-h-52 overflow-y-auto w-44">
                  {TOP_SYMBOLS.filter((s) => s.includes(symInput)).slice(0, 6).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={() => { setSymInput(s); setSymbol(s); setShowSuggestions(false); }}
                      className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-400 hover:bg-zinc-900 hover:text-emerald-400 transition-colors block"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider hidden md:block">
              Active: <span className="text-zinc-300 font-bold">{symbol}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Exchange Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-zinc-500 uppercase">Source:</span>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 flex gap-0.5">
                {EXCHANGE_OPTIONS.map((ex) => (
                  <button
                    key={ex.id}
                    onClick={() => setSourceExchange(ex.id)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-wide transition-all cursor-pointer border ${
                      sourceExchange === ex.id
                        ? "text-zinc-100 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300 border-transparent"
                    }`}
                    style={sourceExchange === ex.id ? { color: ex.color, borderColor: `${ex.color}40`, backgroundColor: `${ex.color}15` } : {}}
                  >
                    {ex.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Period Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-zinc-500 uppercase">Interval:</span>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 flex flex-wrap gap-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wide transition-all cursor-pointer ${
                      period === p
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { fetchData(symbol, period, sourceExchange); fetchSnapshot(period, sourceExchange); }}
                disabled={loading}
                className="px-2.5 py-1 rounded border border-zinc-800 hover:border-zinc-600 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40"
              >
                {loading ? "…" : "↺"}
              </button>
            </div>
          </div>
        </div>

        {/* Exchange Status Bar */}
        <div className="flex flex-wrap items-center gap-2 text-[8px] font-mono">
          {Object.entries(dataSources).map(([key, src]) => (
            <span
              key={key}
              className="px-1.5 py-0.5 rounded border"
              style={{ color: EXCHANGE_COLORS[src] || "#71717a", borderColor: `${EXCHANGE_COLORS[src] || "#71717a"}30`, backgroundColor: `${EXCHANGE_COLORS[src] || "#71717a"}10` }}
            >
              {key === "global" ? "Global" : key === "topPos" ? "Top Pos" : key === "topAcc" ? "Top Acc" : "Taker"}: {src.toUpperCase()}
            </span>
          ))}
          {isFallback && (
            <span className="text-amber-400 bg-amber-950/10 border border-amber-900/20 rounded px-2 py-0.5">
              ⚠️ Sebagian data fallback mock — cek koneksi
            </span>
          )}
        </div>
      </div>

      {/* ══ Summary Metric Cards ══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Global L/S Ratio */}
        <div
          className="rounded-xl border p-3.5 space-y-1.5 relative overflow-hidden group"
          style={{ borderColor: latestLS ? `${getSentimentColor(latestLS.longShortRatio)}40` : "#27272a", background: latestLS ? getSentimentBg(latestLS.longShortRatio) : "transparent" }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">🌐 Global L/S Ratio</div>
          <div className="text-xl font-mono font-bold" style={{ color: latestLS ? getSentimentColor(latestLS.longShortRatio) : "#a1a1aa" }}>
            {latestLS ? latestLS.longShortRatio.toFixed(4) : "—"}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            {latestLS ? `${getSentimentLabel(latestLS.longShortRatio)}` : "Loading…"}
          </div>
          {latestLS && (
            <div className="text-[8px] font-mono text-zinc-500">
              Long {(latestLS.longAccount * 100).toFixed(1)}% / Short {(latestLS.shortAccount * 100).toFixed(1)}%
            </div>
          )}
        </div>

        {/* Top Trader Position */}
        <div
          className="rounded-xl border p-3.5 space-y-1.5"
          style={{ borderColor: latestTopPos ? `${getSentimentColor(latestTopPos.longShortRatio)}40` : "#27272a", background: latestTopPos ? getSentimentBg(latestTopPos.longShortRatio) : "transparent" }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">📍 Top Trader Pos.</div>
          <div className="text-xl font-mono font-bold" style={{ color: latestTopPos ? getSentimentColor(latestTopPos.longShortRatio) : "#a1a1aa" }}>
            {latestTopPos ? latestTopPos.longShortRatio.toFixed(4) : "—"}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            {latestTopPos ? getSentimentLabel(latestTopPos.longShortRatio) : "Loading…"}
          </div>
          {latestTopPos && (
            <div className="text-[8px] font-mono text-zinc-500">
              Long {(latestTopPos.longAccount * 100).toFixed(1)}% / Short {(latestTopPos.shortAccount * 100).toFixed(1)}%
            </div>
          )}
        </div>

        {/* Top Trader Account */}
        <div
          className="rounded-xl border p-3.5 space-y-1.5"
          style={{ borderColor: latestTopAcc ? `${getSentimentColor(latestTopAcc.longShortRatio)}40` : "#27272a", background: latestTopAcc ? getSentimentBg(latestTopAcc.longShortRatio) : "transparent" }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">👤 Top Trader Acc.</div>
          <div className="text-xl font-mono font-bold" style={{ color: latestTopAcc ? getSentimentColor(latestTopAcc.longShortRatio) : "#a1a1aa" }}>
            {latestTopAcc ? latestTopAcc.longShortRatio.toFixed(4) : "—"}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            {latestTopAcc ? getSentimentLabel(latestTopAcc.longShortRatio) : "Loading…"}
          </div>
          {latestTopAcc && (
            <div className="text-[8px] font-mono text-zinc-500">
              Long {(latestTopAcc.longAccount * 100).toFixed(1)}% / Short {(latestTopAcc.shortAccount * 100).toFixed(1)}%
            </div>
          )}
        </div>

        {/* Taker Buy/Sell */}
        <div
          className="rounded-xl border p-3.5 space-y-1.5"
          style={{ borderColor: latestTaker ? `${latestTaker.buySellRatio >= 1 ? "#10b981" : "#ef4444"}40` : "#27272a", background: latestTaker ? (latestTaker.buySellRatio >= 1 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)") : "transparent" }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">⚡ Taker Buy/Sell</div>
          <div
            className="text-xl font-mono font-bold"
            style={{ color: latestTaker ? (latestTaker.buySellRatio >= 1 ? "#10b981" : "#ef4444") : "#a1a1aa" }}
          >
            {latestTaker ? latestTaker.buySellRatio.toFixed(4) : "—"}
          </div>
          <div className="text-[9px] font-mono text-zinc-400">
            {latestTaker ? (latestTaker.buySellRatio >= 1 ? "BUY PRESSURE" : "SELL PRESSURE") : "Loading…"}
          </div>
          {latestTaker && (
            <div className="text-[8px] font-mono text-zinc-500">
              Buy {fmtVol(latestTaker.buyVol)} / Sell {fmtVol(latestTaker.sellVol)}
            </div>
          )}
        </div>
      </div>

      {/* ══ Mini Gauges Row ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-3 border-b border-zinc-900 pb-2">
          📊 Sentiment Gauges — {symbol} ({period})
        </div>
        <div className="flex flex-wrap justify-around gap-4">
          <RatioGauge ratio={latestLS?.longShortRatio ?? 1} label="Global L/S" />
          <RatioGauge ratio={latestTopPos?.longShortRatio ?? 1} label="Top Trader Pos." />
          <RatioGauge ratio={latestTopAcc?.longShortRatio ?? 1} label="Top Trader Acc." />
          <RatioGauge ratio={latestTaker?.buySellRatio ?? 1} label="Taker Buy/Sell" />
        </div>
      </div>

      {/* ══ Main Chart Area ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-3">
        {/* Metric tab selector */}
        <div className="flex flex-wrap gap-1 border-b border-zinc-900 pb-2">
          {METRIC_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveMetric(tab.id)}
              className={`px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-wide rounded-t transition-all cursor-pointer border-b-2 -mb-[9px] ${
                activeMetric === tab.id
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
              <span className="hidden md:inline ml-1 text-[7px] normal-case text-zinc-600 font-normal">
                ({tab.desc})
              </span>
            </button>
          ))}
        </div>

        {/* Chart body */}
        {activeMetric !== "taker" ? (
          <div className="h-64 w-full">
            {activeData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">
                {loading ? "Memuat data…" : "Tidak ada data"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={activeData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="longGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="shortGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="#18181b" />
                  <XAxis
                    dataKey="time"
                    stroke="#3f3f46"
                    fontSize={8}
                    fontFamily="monospace"
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    yAxisId="ratio"
                    stroke="#3f3f46"
                    fontSize={8}
                    fontFamily="monospace"
                    tickLine={false}
                    tickFormatter={(v) => v.toFixed(2)}
                    width={38}
                  />
                  <YAxis
                    yAxisId="pct"
                    orientation="right"
                    stroke="#3f3f46"
                    fontSize={8}
                    fontFamily="monospace"
                    tickLine={false}
                    tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                    width={36}
                  />
                  <Tooltip content={<LSTooltip />} />
                  <ReferenceLine yAxisId="ratio" y={1} stroke="#52525b" strokeDasharray="4 4" />
                  <Area
                    yAxisId="ratio"
                    type="monotone"
                    dataKey="longShortRatio"
                    name="L/S Ratio"
                    stroke={chartColor}
                    fill="url(#lsGradient)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, fill: chartColor }}
                  />
                  <Area
                    yAxisId="pct"
                    type="monotone"
                    dataKey="longAccount"
                    name="Long %"
                    stroke="#10b981"
                    fill="url(#longGradient)"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="3 3"
                  />
                  <Area
                    yAxisId="pct"
                    type="monotone"
                    dataKey="shortAccount"
                    name="Short %"
                    stroke="#ef4444"
                    fill="url(#shortGradient)"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="3 3"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          /* Taker Volume chart */
          <div className="h-64 w-full">
            {takerBarData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">
                {loading ? "Memuat data…" : "Tidak ada data"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={takerBarData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="buySellGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="#18181b" />
                  <XAxis dataKey="time" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="vol" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} tickFormatter={(v) => `$${v.toFixed(0)}M`} width={42} />
                  <YAxis yAxisId="ratio" orientation="right" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} tickFormatter={(v) => v.toFixed(2)} width={34} />
                  <Tooltip content={<LSTooltip />} />
                  <ReferenceLine yAxisId="ratio" y={1} stroke="#52525b" strokeDasharray="4 4" />
                  <Bar yAxisId="vol" dataKey="buyVolM" name="Buy Vol ($M)" stackId="a" fill="#10b981" fillOpacity={0.65} />
                  <Bar yAxisId="vol" dataKey="sellVolM" name="Sell Vol ($M)" stackId="a" fill="#ef4444" fillOpacity={0.65} />
                  <Line
                    yAxisId="ratio"
                    type="monotone"
                    dataKey="buySellRatio"
                    name="Buy/Sell Ratio"
                    stroke="#6366f1"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-[8px] font-mono text-zinc-500 pt-1 border-t border-zinc-900/60">
          {activeMetric !== "taker" ? (
            <>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: chartColor }} /> L/S Ratio (Left)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-emerald-500" style={{ opacity: 0.7 }} /> Long % (Right, dashed)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-red-500" style={{ opacity: 0.7 }} /> Short % (Right, dashed)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-px inline-block bg-zinc-500 border-dashed border-b border-zinc-500" /> Ratio=1 Reference</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block bg-emerald-500 opacity-70" /> Buy Volume</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block bg-red-500 opacity-70" /> Sell Volume</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-indigo-500" /> Buy/Sell Ratio (Right)</span>
            </>
          )}
        </div>
      </div>

      {/* ══ Divergence Chart: All 3 L/S Metrics ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2">
        <div className="text-xs font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2 flex items-center justify-between">
          <span>📐 Divergence View — Global vs Smart Money</span>
          <span className="text-[9px] font-normal text-zinc-500">Deteksi divergensi antara retail & institutional</span>
        </div>
        <div className="h-52 w-full">
          {divergenceData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">Tidak ada data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={divergenceData} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#18181b" />
                <XAxis dataKey="time" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} interval="preserveStartEnd" />
                <YAxis yAxisId="main" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} tickFormatter={(v) => v.toFixed(2)} width={36} />
                <YAxis yAxisId="delta" orientation="right" stroke="#3f3f46" fontSize={8} fontFamily="monospace" tickLine={false} tickFormatter={(v) => v.toFixed(3)} width={36} />
                <Tooltip content={<LSTooltip />} />
                <ReferenceLine yAxisId="main" y={1} stroke="#52525b" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="delta" y={0} stroke="#52525b" strokeDasharray="2 4" />
                <Line yAxisId="main" type="monotone" dataKey="global" name="Global L/S" stroke="#a78bfa" strokeWidth={2} dot={false} />
                <Line yAxisId="main" type="monotone" dataKey="topPos" name="Top Pos L/S" stroke="#fb923c" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line yAxisId="main" type="monotone" dataKey="topAcc" name="Top Acc L/S" stroke="#60a5fa" strokeWidth={1.5} dot={false} strokeDasharray="2 3" />
                <Bar yAxisId="delta" dataKey="delta" name="Δ Global−TopPos" barSize={3}>
                  {divergenceData.map((d, i) => (
                    <Cell key={i} fill={(d.delta ?? 0) >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.6} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-[8px] font-mono text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-violet-400" /> Global L/S</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-orange-400" style={{ borderBottom: "1px dashed" }} /> Top Pos L/S</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded inline-block bg-blue-400" style={{ borderBottom: "1px dashed" }} /> Top Acc L/S</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block bg-emerald-500 opacity-60" /> Δ Positif (Retail lebih Bullish)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded inline-block bg-red-500 opacity-60" /> Δ Negatif (Smart money lebih Bullish)</span>
        </div>
      </div>

      {/* ══ Market Heatmap Snapshot ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-3">
        <div className="text-xs font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2 flex items-center justify-between">
          <span>🗺️ Market Sentiment Heatmap — Top {TOP_SYMBOLS.length} Futures</span>
          <div className="flex items-center gap-2">
            {snapshotLoading && (
              <span className="text-[8px] font-mono text-zinc-500 animate-pulse">Memuat…</span>
            )}
            <span className="text-[8px] font-mono text-zinc-600">Interval: {period} · Auto-refresh 30s</span>
          </div>
        </div>

        {snapshot.length === 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {TOP_SYMBOLS.map((s) => (
              <div key={s} className="h-24 rounded-xl border border-zinc-800 bg-zinc-900/20 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {snapshot.map((item) => (
              <SnapshotCard key={item.symbol} item={item} />
            ))}
          </div>
        )}

        {/* Scale legend */}
        <div className="flex flex-wrap items-center gap-3 text-[8px] font-mono pt-1 border-t border-zinc-900/60">
          <span className="text-zinc-500 uppercase tracking-wider">Skala Ratio:</span>
          {[
            { label: "≥1.5 Ultra Bull", color: "#10b981" },
            { label: "1.1–1.5 Bullish", color: "#34d399" },
            { label: "0.9–1.1 Neutral", color: "#71717a" },
            { label: "0.7–0.9 Bearish", color: "#f87171" },
            { label: "<0.7 Ultra Bear", color: "#ef4444" },
          ].map((s) => (
            <span key={s.label} className="flex items-center gap-1" style={{ color: s.color }}>
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* ══ Interpretation Guide ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-900 pb-1">
            📖 Panduan Interpretasi L/S Ratio
          </div>
          <div className="space-y-1.5 text-[9px] font-mono text-zinc-500 leading-relaxed">
            <p><span className="text-emerald-400 font-bold">Ratio &gt; 1.5</span> — Majority bullish; potensi "short squeeze" jika harga naik tiba-tiba.</p>
            <p><span className="text-zinc-300 font-bold">Ratio ≈ 1.0</span> — Pasar seimbang; arah breakout tidak jelas.</p>
            <p><span className="text-red-400 font-bold">Ratio &lt; 0.7</span> — Majority bearish; potensi "long squeeze" jika harga turun tajam.</p>
            <p><span className="text-violet-400 font-bold">Divergensi Global vs Top Trader</span> — Jika smart money berlawanan dengan retail, smart money cenderung benar.</p>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-900 pb-1">
            ⚡ Panduan Taker Volume
          </div>
          <div className="space-y-1.5 text-[9px] font-mono text-zinc-500 leading-relaxed">
            <p><span className="text-emerald-400 font-bold">Buy/Sell Ratio &gt; 1.1</span> — Aggressive buyer mendominasi; momentum naik.</p>
            <p><span className="text-zinc-300 font-bold">Ratio ≈ 1.0</span> — Tekanan seimbang; konsolidasi.</p>
            <p><span className="text-red-400 font-bold">Ratio &lt; 0.9</span> — Aggressive seller mendominasi; momentum turun.</p>
            <p><span className="text-blue-400 font-bold">Volume spike</span> — Volume tiba-tiba besar sering menandakan reversal atau akselerasi tren.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

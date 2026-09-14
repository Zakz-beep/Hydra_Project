"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceLine,
  Cell,
} from "recharts";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface OiVolumeHistoryPoint {
  timestamp: number;
  time: string;
  price: number;
  open_interest_coin: number;
  open_interest_usd: number;
  volume_usd: number;
  volume_coin: number;
}

interface OiVolumeResponse {
  status: string;
  symbol: string;
  interval: string;
  history: OiVolumeHistoryPoint[];
}

interface AggregatedRow {
  symbol: string;
  name: string;
  oi_usd: number;
  volume_usd: number;
  price: number;
  vol_oi_ratio: number;
  oi_share: number;
  vol_share: number;
  flow: string;
  flowColor: string;
}

interface ScatterDot {
  symbol: string;
  oi: number;
  volume: number;
  vol_oi_ratio: number;
  price: number;
  flow: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const AGG_TICKERS = [
  "BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT",
  "PEPE-USDT", "SUI-USDT", "WIF-USDT", "NEAR-USDT", "AVAX-USDT",
  "ADA-USDT", "LINK-USDT", "DOT-USDT", "ARB-USDT", "OP-USDT",
  "APT-USDT", "ATOM-USDT", "LTC-USDT", "FET-USDT", "RUNE-USDT",
];

const NAME_MAP: Record<string, string> = {
  "BTC-USDT": "Bitcoin",    "ETH-USDT": "Ethereum",   "SOL-USDT": "Solana",
  "XRP-USDT": "XRP",        "DOGE-USDT": "Dogecoin",  "PEPE-USDT": "Pepe",
  "SUI-USDT": "Sui",        "WIF-USDT": "dogwifhat",   "NEAR-USDT": "NEAR",
  "AVAX-USDT": "Avalanche", "ADA-USDT": "Cardano",    "LINK-USDT": "Chainlink",
  "DOT-USDT": "Polkadot",   "ARB-USDT": "Arbitrum",   "OP-USDT": "Optimism",
  "APT-USDT": "Aptos",      "ATOM-USDT": "Cosmos",    "LTC-USDT": "Litecoin",
  "FET-USDT": "Fetch.ai",   "RUNE-USDT": "THORChain",
};

const SCATTER_COLORS = [
  "#a78bfa","#34d399","#60a5fa","#f97316","#f472b6",
  "#fbbf24","#22d3ee","#4ade80","#fb7185","#c084fc",
  "#38bdf8","#84cc16","#e879f9","#fb923c","#2dd4bf",
  "#facc15","#818cf8","#86efac","#f43f5e","#a3e635",
];

function formatLargeNumber(num: number) {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(2)}`;
}

function formatPrice(p: number) {
  if (p >= 1.0) return `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${p.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
}

function classifyFlow(priceDiff: number, oiDiff: number): { label: string; color: string } {
  if (priceDiff > 0 && oiDiff > 0) return { label: "Long Buildup", color: "#34d399" };
  if (priceDiff < 0 && oiDiff > 0) return { label: "Short Buildup", color: "#f87171" };
  if (priceDiff > 0 && oiDiff < 0) return { label: "Short Squeeze", color: "#fbbf24" };
  if (priceDiff < 0 && oiDiff < 0) return { label: "Long Unwind", color: "#fb923c" };
  return { label: "Neutral", color: "#71717a" };
}

/* ─── Custom Scatter Tooltip ─────────────────────────────────────────────── */
interface ScatterTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ScatterDot }>;
}

function ScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[10px] font-mono space-y-1 shadow-xl">
      <div className="text-zinc-300 font-bold">{d.symbol.split("-")[0]}</div>
      <div className="text-zinc-400">OI: <span className="text-emerald-400">{formatLargeNumber(d.oi)}</span></div>
      <div className="text-zinc-400">Volume: <span className="text-indigo-400">{formatLargeNumber(d.volume)}</span></div>
      <div className="text-zinc-400">Vol/OI: <span className="text-amber-400">{d.vol_oi_ratio.toFixed(3)}x</span></div>
      <div className="text-zinc-400">Price: <span className="text-violet-400">{formatPrice(d.price)}</span></div>
      <div className="text-zinc-400">Flow: <span style={{ color: d.flow === "Long Buildup" ? "#34d399" : d.flow === "Short Buildup" ? "#f87171" : d.flow === "Short Squeeze" ? "#fbbf24" : d.flow === "Long Unwind" ? "#fb923c" : "#71717a" }}>{d.flow}</span></div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────────────── */
export default function OiVolumeDashboard() {
  // ── Single ticker analysis ──
  const [symbol, setSymbol] = useState("BTC-USDT");
  const [interval, setIntervalVal] = useState<"1h" | "4h" | "1d">("1h");
  const [dataSource, setDataSource] = useState<"binance" | "bybit">("binance");
  const [data, setData] = useState<OiVolumeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customSymbol, setCustomSymbol] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ── Market Aggregator ──
  const [aggData, setAggData] = useState<AggregatedRow[]>([]);
  const [scatterData, setScatterData] = useState<ScatterDot[]>([]);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState<string | null>(null);
  const [aggSortKey, setAggSortKey] = useState<"oi_usd" | "volume_usd" | "vol_oi_ratio" | "oi_share">("oi_usd");
  const [aggSortDir, setAggSortDir] = useState<"desc" | "asc">("desc");
  const aggFetchedRef = useRef(false);

  const cryptoSuggestions = [
    "BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "PEPE-USDT", "ADA-USDT", "LINK-USDT",
    "SUI-USDT", "WIF-USDT", "BONK-USDT", "NEAR-USDT", "FET-USDT", "FTM-USDT", "SHIB-USDT", "AVAX-USDT",
    "DOT-USDT", "MATIC-USDT", "UNI-USDT", "FIL-USDT", "APT-USDT", "OP-USDT", "ARB-USDT", "LTC-USDT",
    "BCH-USDT", "ETC-USDT", "ATOM-USDT", "VET-USDT", "RUNE-USDT", "ICP-USDT", "AAVE-USDT", "LDO-USDT",
    "JASMY-USDT", "RENDER-USDT", "PENDLE-USDT", "TIA-USDT", "MKR-USDT", "CRV-USDT", "DYDX-USDT"
  ];

  const popularTickers = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "PEPE-USDT", "SUI-USDT", "NEAR-USDT"];

  /* ── Single ticker fetch ── */
  const fetchHistory = useCallback(async (sym: string, iv: string, src: "binance" | "bybit") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto/oi-volume-history?symbol=${encodeURIComponent(sym)}&interval=${iv}&source=${src}`);
      if (!res.ok) throw new Error("Gagal mengambil data Open Interest & Volume.");
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat data.");
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── Market Aggregator fetch ── */
  const fetchAggregated = useCallback(async (src: "binance" | "bybit") => {
    if (aggLoading) return;
    setAggLoading(true);
    setAggError(null);
    const results: AggregatedRow[] = [];
    const BATCH = 5;

    for (let i = 0; i < AGG_TICKERS.length; i += BATCH) {
      const batch = AGG_TICKERS.slice(i, i + BATCH);
      const batchResults = await Promise.allSettled(
        batch.map(async (sym) => {
          const res = await fetch(`/api/crypto/oi-volume-history?symbol=${encodeURIComponent(sym)}&interval=1h&source=${src}`);
          if (!res.ok) return null;
          const json: OiVolumeResponse = await res.json();
          if (!json.history || json.history.length < 2) return null;
          const hist = json.history;
          const latest = hist[hist.length - 1];
          const prev = hist[hist.length - 2];
          const flow = classifyFlow(latest.price - prev.price, latest.open_interest_usd - prev.open_interest_usd);
          return {
            symbol: sym,
            name: NAME_MAP[sym] ?? sym.split("-")[0],
            oi_usd: latest.open_interest_usd,
            volume_usd: latest.volume_usd,
            price: latest.price,
            vol_oi_ratio: latest.open_interest_usd > 0 ? latest.volume_usd / latest.open_interest_usd : 0,
            oi_share: 0,
            vol_share: 0,
            flow: flow.label,
            flowColor: flow.color,
          } as AggregatedRow;
        })
      );
      batchResults.forEach((r) => {
        if (r.status === "fulfilled" && r.value !== null) results.push(r.value);
      });
      // Tiny delay between batches to respect rate limits
      if (i + BATCH < AGG_TICKERS.length) {
        await new Promise((res) => setTimeout(res, 600));
      }
    }

    if (results.length === 0) {
      setAggError("Tidak ada data yang berhasil diambil untuk Market Aggregator.");
      setAggLoading(false);
      return;
    }

    const totalOi = results.reduce((s, r) => s + r.oi_usd, 0);
    const totalVol = results.reduce((s, r) => s + r.volume_usd, 0);
    results.forEach((r) => {
      r.oi_share = totalOi > 0 ? (r.oi_usd / totalOi) * 100 : 0;
      r.vol_share = totalVol > 0 ? (r.volume_usd / totalVol) * 100 : 0;
    });

    const scatter: ScatterDot[] = results.map((r) => ({
      symbol: r.symbol,
      oi: r.oi_usd,
      volume: r.volume_usd,
      vol_oi_ratio: r.vol_oi_ratio,
      price: r.price,
      flow: r.flow,
    }));

    setAggData(results);
    setScatterData(scatter);
    setAggLoading(false);
  }, [aggLoading]);

  useEffect(() => {
    fetchHistory(symbol, interval, dataSource);
  }, [symbol, interval, dataSource, fetchHistory]);

  // Auto-load aggregator when component mounts or dataSource changes
  useEffect(() => {
    fetchAggregated(dataSource);
  }, [dataSource, fetchAggregated]);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSymbol.trim()) return;
    let formatted = customSymbol.trim().toUpperCase();
    if (!formatted.includes("-") && formatted.endsWith("USDT")) {
      formatted = `${formatted.replace("USDT", "")}-USDT`;
    }
    setSymbol(formatted);
    setCustomSymbol("");
    setShowSuggestions(false);
  };

  /* ── Stats from single ticker ── */
  const getStats = () => {
    if (!data || !data.history || data.history.length < 2) return null;
    const hist = data.history;
    const latest = hist[hist.length - 1];
    const prev = hist[hist.length - 2];

    const oiChangeUSD = latest.open_interest_usd - prev.open_interest_usd;
    const oiChangePct = (oiChangeUSD / prev.open_interest_usd) * 100;
    const priceChangePct = ((latest.price - prev.price) / prev.price) * 100;
    const volUSD = latest.volume_usd;
    const volOiRatio = latest.open_interest_usd > 0 ? volUSD / latest.open_interest_usd : 0;

    let flowLabel = "Neutral Flow";
    let flowColor = "text-zinc-400 border-zinc-800 bg-zinc-900/10";
    if (latest.price > prev.price && oiChangeUSD > 0) {
      flowLabel = "Long Buildup (Bullish)";
      flowColor = "text-emerald-400 border-emerald-950/40 bg-emerald-950/10";
    } else if (latest.price < prev.price && oiChangeUSD > 0) {
      flowLabel = "Short Buildup (Bearish)";
      flowColor = "text-red-400 border-red-950/40 bg-red-950/10";
    } else if (latest.price > prev.price && oiChangeUSD < 0) {
      flowLabel = "Short Squeeze (Covering)";
      flowColor = "text-amber-400 border-amber-950/40 bg-amber-950/10";
    } else if (latest.price < prev.price && oiChangeUSD < 0) {
      flowLabel = "Long Liquidation (Unwinding)";
      flowColor = "text-orange-400 border-orange-950/40 bg-orange-950/10";
    }

    return { latest, prevPrice: prev.price, oiChangeUSD, oiChangePct, priceChangePct, volUSD, volOiRatio, flowLabel, flowColor };
  };

  const stats = getStats();

  /* ── Sort aggregated table ── */
  const sortedAgg = [...aggData].sort((a, b) => {
    const mult = aggSortDir === "desc" ? -1 : 1;
    return (a[aggSortKey] - b[aggSortKey]) * mult;
  });

  const aggTotalOi = aggData.reduce((s, r) => s + r.oi_usd, 0);
  const aggTotalVol = aggData.reduce((s, r) => s + r.volume_usd, 0);

  const handleAggSort = (key: typeof aggSortKey) => {
    if (key === aggSortKey) setAggSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setAggSortKey(key); setAggSortDir("desc"); }
  };

  /* ── Average Vol/OI for reference line ── */
  const avgVolOi = aggData.length > 0 ? aggData.reduce((s, r) => s + r.vol_oi_ratio, 0) / aggData.length : 0;

  return (
    <div className="space-y-5">

      {/* ══ Section 1: Single Ticker Selector ══ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Quick:</span>
            {popularTickers.map((t) => (
              <button
                key={t}
                onClick={() => setSymbol(t)}
                className={`px-2.5 py-0.5 text-[10px] font-mono rounded border transition-all cursor-pointer ${
                  symbol === t
                    ? "bg-zinc-800 border-zinc-700 text-emerald-400 font-bold"
                    : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.split("-")[0]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 justify-between md:justify-end">
            <form onSubmit={handleCustomSubmit} className="flex items-center gap-1 relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Cari Ticker (e.g. SOL-USDT)..."
                  value={customSymbol}
                  onChange={(e) => { setCustomSymbol(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder-zinc-600 w-44"
                />
                {showSuggestions && customSymbol.trim() !== "" && (() => {
                  const query = customSymbol.toLowerCase().replace("-", "");
                  const matches = cryptoSuggestions.filter((s) => s.toLowerCase().replace("-", "").includes(query)).slice(0, 5);
                  if (matches.length === 0) return null;
                  return (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl max-h-48 overflow-y-auto divide-y divide-zinc-900/60 w-44">
                      {matches.map((s) => (
                        <button
                          key={s} type="button"
                          onMouseDown={() => { setSymbol(s); setCustomSymbol(""); setShowSuggestions(false); }}
                          className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-350 hover:bg-zinc-900 hover:text-emerald-400 transition-colors cursor-pointer block"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button type="submit" className="px-2.5 py-1 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded text-xs font-mono text-zinc-300 cursor-pointer">Cari</button>
            </form>

            {/* Source Toggle */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 inline-flex">
              {(["binance", "bybit"] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => setDataSource(src)}
                  className={`px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider rounded transition-all cursor-pointer ${
                    dataSource === src
                      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/30"
                      : "text-zinc-500 hover:text-zinc-350 border border-transparent"
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>

            {/* Interval Toggle */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 inline-flex">
              {(["1h", "4h", "1d"] as const).map((iv) => (
                <button
                  key={iv}
                  onClick={() => setIntervalVal(iv)}
                  className={`px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider rounded transition-all cursor-pointer ${
                    interval === iv
                      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/30"
                      : "text-zinc-500 hover:text-zinc-350 border border-transparent"
                  }`}
                >
                  {iv}
                </button>
              ))}
            </div>

            <button
              onClick={() => fetchHistory(symbol, interval, dataSource)}
              disabled={loading}
              className="px-2 py-1 rounded border border-zinc-800 hover:border-zinc-650 hover:bg-zinc-850 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40"
            >
              {loading ? "..." : "↺"}
            </button>
          </div>
        </div>
      </div>

      {/* ══ Section 2: Single Ticker Stats Cards ══ */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Live Open Interest</div>
            <div className="mt-1">
              <div className="text-lg font-mono font-bold text-zinc-100">{formatLargeNumber(stats.latest.open_interest_usd)}</div>
              <div className="text-[10px] font-mono text-zinc-400">{stats.latest.open_interest_coin.toLocaleString(undefined, { maximumFractionDigits: 1 })} {symbol.split("-")[0]}</div>
            </div>
            <div className={`text-[9px] font-mono font-bold mt-1 ${stats.oiChangeUSD >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {stats.oiChangeUSD >= 0 ? "▲" : "▼"} {Math.abs(stats.oiChangePct).toFixed(2)}% ({interval} change)
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Last Candle Price & Volume</div>
            <div className="mt-1">
              <div className="text-lg font-mono font-bold text-zinc-100">{formatPrice(stats.latest.price)}</div>
              <div className="text-[10px] font-mono text-zinc-400">Candle Vol: {formatLargeNumber(stats.volUSD)}</div>
            </div>
            <div className={`text-[9px] font-mono font-bold mt-1 ${stats.latest.price >= stats.prevPrice ? "text-emerald-400" : "text-red-400"}`}>
              {stats.latest.price >= stats.prevPrice ? "▲" : "▼"} {Math.abs(stats.priceChangePct).toFixed(2)}% ({interval} price change)
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Modal Flow Classification</div>
            <div className={`mt-1.5 px-3 py-1.5 border rounded-lg text-xs font-mono font-bold text-center ${stats.flowColor}`}>
              {stats.flowLabel}
            </div>
            <div className="text-[9px] font-mono text-zinc-500 mt-1">Speculation Ratio (Vol/OI): {stats.volOiRatio.toFixed(3)}</div>
          </div>
        </div>
      )}

      {/* ══ Section 3: Single Ticker Charts ══ */}
      <div className="space-y-4">
        {/* Chart 1: Direct Open Interest vs Volume Comparison (Full Width) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-900 pb-2 gap-2">
            <div>
              <span className="text-xs font-mono font-bold text-zinc-300 uppercase">📊 Direct Open Interest vs Volume dynamics</span>
              <span className="ml-2 text-[9px] font-mono text-zinc-500">Left Axis: Open Interest (Area) · Right Axis: Volume (Bar) & Ratio (Line)</span>
            </div>
            <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-400">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"></span> Open Interest</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-indigo-500 rounded-full inline-block"></span> Volume</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full inline-block"></span> Vol/OI Ratio</span>
            </div>
          </div>
          {loading ? (
            <div className="h-80 flex items-center justify-center text-xs font-mono text-zinc-500 animate-pulse">
              Memuat chart hubungan Open Interest & Volume...
            </div>
          ) : !data || data.history.length === 0 ? (
            <div className="h-80 flex items-center justify-center text-xs font-mono text-zinc-650">
              Tidak ada data historis.
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart 
                  data={data.history.map(pt => ({
                    ...pt,
                    vol_oi_ratio: pt.open_interest_usd > 0 ? pt.volume_usd / pt.open_interest_usd : 0
                  }))} 
                  margin={{ top: 15, right: 5, left: 5, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="colorOiGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.01}/>
                    </linearGradient>
                    <linearGradient id="colorVolGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f22" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#52525b" 
                    fontSize={9} 
                    fontFamily="monospace" 
                    tickFormatter={(val) => val.split(" ")[1] || val} 
                  />
                  <YAxis 
                    yAxisId="left" 
                    stroke="#10b981" 
                    fontSize={9} 
                    fontFamily="monospace"
                    tickFormatter={(val) => `$${(val / 1e6).toFixed(1)}M`}
                  />
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    stroke="#6366f1" 
                    fontSize={9} 
                    fontFamily="monospace" 
                    tickFormatter={(val) => `$${(val / 1e6).toFixed(1)}M`}
                  />
                  <YAxis 
                    yAxisId="ratio" 
                    orientation="right"
                    stroke="#f59e0b" 
                    fontSize={8} 
                    fontFamily="monospace"
                    domain={[0, "auto"]}
                    tickFormatter={(val) => `${val.toFixed(2)}x`}
                    dx={40}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                    labelStyle={{ fontFamily: "monospace", fontSize: 10, color: "#a1a1aa" }}
                    itemStyle={{ fontFamily: "monospace", fontSize: 10 }}
                    formatter={(value: number, name: string) => {
                      if (name === "Vol/OI Ratio") return [`${value.toFixed(3)}x`, name];
                      return [formatLargeNumber(value), name];
                    }}
                  />
                  <Bar 
                    yAxisId="right" 
                    dataKey="volume_usd" 
                    name="Volume" 
                    fill="#6366f1" 
                    fillOpacity={0.12} 
                    radius={[2, 2, 0, 0]} 
                  />
                  <Area 
                    yAxisId="left" 
                    type="monotone" 
                    dataKey="open_interest_usd" 
                    name="Open Interest" 
                    fill="url(#colorOiGlow)" 
                    stroke="#10b981" 
                    strokeWidth={2}
                  />
                  <Line 
                    yAxisId="ratio" 
                    type="monotone" 
                    dataKey="vol_oi_ratio" 
                    name="Vol/OI Ratio" 
                    stroke="#f59e0b" 
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Supporting charts: Price vs OI and Price vs Volume */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chart 2: Price vs OI */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-xs font-mono font-bold text-zinc-300 uppercase">📈 Price vs Open Interest</span>
              <span className="text-[9px] font-mono text-zinc-500">Left: Price · Right: OI (Area)</span>
            </div>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-xs font-mono text-zinc-500 animate-pulse">Memuat chart OI...</div>
            ) : !data || data.history.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs font-mono text-zinc-600">Tidak ada data historis.</div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.history} margin={{ top: 10, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f1f22" />
                    <XAxis dataKey="time" stroke="#52525b" fontSize={9} fontFamily="monospace" tickFormatter={(val) => val.split(" ")[1] || val} />
                    <YAxis yAxisId="left" stroke="#a78bfa" fontSize={9} fontFamily="monospace" domain={["auto", "auto"]} tickFormatter={(val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={9} fontFamily="monospace" tickFormatter={(val) => `${(val / 1e6).toFixed(0)}M`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                      labelStyle={{ fontFamily: "monospace", fontSize: 10, color: "#a1a1aa" }}
                      itemStyle={{ fontFamily: "monospace", fontSize: 10 }}
                      formatter={(value: number, name: string) => {
                        if (name === "Price") return [formatPrice(value), "Price"];
                        return [formatLargeNumber(value), "Open Interest"];
                      }}
                    />
                    <Area yAxisId="right" type="monotone" dataKey="open_interest_usd" name="Open Interest" fill="#10b981" stroke="#10b981" fillOpacity={0.07} strokeWidth={1.5} />
                    <Line yAxisId="left" type="monotone" dataKey="price" name="Price" stroke="#a78bfa" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Chart 3: Price vs Volume */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
              <span className="text-xs font-mono font-bold text-zinc-300 uppercase">📊 Price vs Volume</span>
              <span className="text-[9px] font-mono text-zinc-500">Left: Price · Right: Volume (Bar)</span>
            </div>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-xs font-mono text-zinc-500 animate-pulse">Memuat chart Volume...</div>
            ) : !data || data.history.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs font-mono text-zinc-650">Tidak ada data volume.</div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.history} margin={{ top: 10, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f1f22" />
                    <XAxis dataKey="time" stroke="#52525b" fontSize={9} fontFamily="monospace" tickFormatter={(val) => val.split(" ")[1] || val} />
                    <YAxis yAxisId="left" stroke="#a78bfa" fontSize={9} fontFamily="monospace" domain={["auto", "auto"]} tickFormatter={(val) => `$${val.toLocaleString(undefined, { maximumFractionDigits: 1 })}`} />
                    <YAxis yAxisId="right" orientation="right" stroke="#6366f1" fontSize={9} fontFamily="monospace" tickFormatter={(val) => `${(val / 1e6).toFixed(0)}M`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                      labelStyle={{ fontFamily: "monospace", fontSize: 10, color: "#a1a1aa" }}
                      itemStyle={{ fontFamily: "monospace", fontSize: 10 }}
                      formatter={(value: number, name: string) => {
                        if (name === "Price") return [formatPrice(value), "Price"];
                        return [formatLargeNumber(value), "Volume"];
                      }}
                    />
                    <Bar yAxisId="right" dataKey="volume_usd" name="Volume" fill="#6366f1" fillOpacity={0.15} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="left" type="monotone" dataKey="price" name="Price" stroke="#a78bfa" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ══ Section 4: Market Aggregator ══ */}
      <div className="rounded-xl border border-zinc-700/60 bg-gradient-to-b from-zinc-900/50 to-zinc-950/30 p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-mono font-bold text-zinc-200 flex items-center gap-2">
              <span className="text-base">🌐</span> Market Aggregator
            </div>
            <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
              Agregasi OI & Volume dari {AGG_TICKERS.length} futures teratas • Data {dataSource === "binance" ? "Binance" : "Bybit"} 1H terkini
            </div>
          </div>
          <button
            onClick={() => { aggFetchedRef.current = false; fetchAggregated(dataSource); }}
            disabled={aggLoading}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900/60 hover:bg-zinc-800/60 text-[10px] font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
          >
            {aggLoading ? (
              <><span className="animate-spin inline-block">⟳</span> Memuat...</>
            ) : (
              <><span>↺</span> Refresh</>
            )}
          </button>
        </div>

        {aggError && (
          <div className="text-[10px] font-mono text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
            ⚠ {aggError}
          </div>
        )}

        {aggLoading && aggData.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2">
            <div className="text-xs font-mono text-zinc-500 animate-pulse">Mengumpulkan data dari {AGG_TICKERS.length} koin...</div>
            <div className="text-[9px] font-mono text-zinc-600">Ini mungkin memakan waktu 10–20 detik untuk menghindari rate limit</div>
          </div>
        ) : aggData.length > 0 ? (
          <>
            {/* ── Aggregate Summary Row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total OI (Market)", value: formatLargeNumber(aggTotalOi), sub: `${aggData.length} koin`, color: "text-emerald-400" },
                { label: "Total Volume (Market)", value: formatLargeNumber(aggTotalVol), sub: `1H turnover`, color: "text-indigo-400" },
                { label: "Market Vol/OI Ratio", value: aggTotalOi > 0 ? (aggTotalVol / aggTotalOi).toFixed(3) + "x" : "N/A", sub: `avg per coin: ${avgVolOi.toFixed(3)}x`, color: "text-amber-400" },
                { label: "Dominant Asset", value: aggData.sort((a, b) => b.oi_usd - a.oi_usd)[0]?.symbol.split("-")[0] ?? "—", sub: `${aggData[0]?.oi_share.toFixed(1)}% of total OI`, color: "text-violet-400" },
              ].map((c, i) => (
                <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{c.label}</div>
                  <div className={`text-base font-mono font-bold mt-1 ${c.color}`}>{c.value}</div>
                  <div className="text-[9px] font-mono text-zinc-600 mt-0.5">{c.sub}</div>
                </div>
              ))}
            </div>

            {/* ── Scatter Chart: OI vs Volume ── */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <div>
                  <span className="text-xs font-mono font-bold text-zinc-300">⬡ OI vs Volume Relationship</span>
                  <span className="ml-2 text-[9px] font-mono text-zinc-500">Setiap titik = 1 koin · Size = Vol/OI Ratio</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] font-mono text-zinc-500">
                  <span><span className="text-emerald-400 font-bold">●</span> Long Buildup</span>
                  <span><span className="text-red-400 font-bold">●</span> Short Buildup</span>
                  <span><span className="text-amber-400 font-bold">●</span> Short Squeeze</span>
                  <span><span className="text-orange-400 font-bold">●</span> Long Unwind</span>
                </div>
              </div>

              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1e" />
                    <XAxis
                      type="number"
                      dataKey="oi"
                      name="Open Interest"
                      stroke="#52525b"
                      fontSize={9}
                      fontFamily="monospace"
                      tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`}
                      label={{ value: "Open Interest (USD)", position: "insideBottom", offset: -12, fontSize: 9, fontFamily: "monospace", fill: "#52525b" }}
                    />
                    <YAxis
                      type="number"
                      dataKey="volume"
                      name="Volume"
                      stroke="#52525b"
                      fontSize={9}
                      fontFamily="monospace"
                      tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`}
                      label={{ value: "Volume (USD)", angle: -90, position: "insideLeft", offset: 15, fontSize: 9, fontFamily: "monospace", fill: "#52525b" }}
                    />
                    <ZAxis type="number" dataKey="vol_oi_ratio" range={[40, 400]} />
                    <Tooltip content={<ScatterTooltip />} />
                    <Scatter data={scatterData} isAnimationActive={false}>
                      {scatterData.map((d, i) => {
                        const flowColors: Record<string, string> = {
                          "Long Buildup": "#34d399",
                          "Short Buildup": "#f87171",
                          "Short Squeeze": "#fbbf24",
                          "Long Unwind": "#fb923c",
                          "Neutral": "#71717a",
                        };
                        return (
                          <Cell
                            key={i}
                            fill={flowColors[d.flow] ?? SCATTER_COLORS[i % SCATTER_COLORS.length]}
                            fillOpacity={0.8}
                            stroke={flowColors[d.flow] ?? SCATTER_COLORS[i % SCATTER_COLORS.length]}
                            strokeOpacity={0.4}
                          />
                        );
                      })}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Ticker Labels Legend */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {scatterData.map((d, i) => {
                  const flowColors: Record<string, string> = {
                    "Long Buildup": "#34d399", "Short Buildup": "#f87171",
                    "Short Squeeze": "#fbbf24", "Long Unwind": "#fb923c", "Neutral": "#71717a",
                  };
                  return (
                    <span
                      key={i}
                      className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-zinc-800/60 bg-zinc-900/30"
                      style={{ color: flowColors[d.flow] ?? "#a1a1aa" }}
                    >
                      {d.symbol.split("-")[0]}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* ── Bar Chart: OI Share ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OI Share Bar */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4 space-y-2">
                <div className="text-[10px] font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2">📊 Open Interest Market Share</div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      layout="vertical"
                      data={[...aggData].sort((a, b) => b.oi_usd - a.oi_usd).slice(0, 12)}
                      margin={{ top: 0, right: 50, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1e" horizontal={false} />
                      <XAxis type="number" stroke="#52525b" fontSize={8} fontFamily="monospace" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                      <YAxis type="category" dataKey="symbol" stroke="#52525b" fontSize={8} fontFamily="monospace" tickFormatter={(v) => v.split("-")[0]} width={32} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                        labelStyle={{ fontFamily: "monospace", fontSize: 9, color: "#a1a1aa" }}
                        itemStyle={{ fontFamily: "monospace", fontSize: 9 }}
                        formatter={(v: number) => [`${v.toFixed(2)}%`, "OI Share"]}
                      />
                      <Bar dataKey="oi_share" name="OI Share" radius={[0, 3, 3, 0]}>
                        {[...aggData].sort((a, b) => b.oi_usd - a.oi_usd).slice(0, 12).map((_, i) => (
                          <Cell key={i} fill={SCATTER_COLORS[i % SCATTER_COLORS.length]} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Volume Share Bar */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4 space-y-2">
                <div className="text-[10px] font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2">📊 Volume Market Share</div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      layout="vertical"
                      data={[...aggData].sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 12)}
                      margin={{ top: 0, right: 50, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1e" horizontal={false} />
                      <XAxis type="number" stroke="#52525b" fontSize={8} fontFamily="monospace" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                      <YAxis type="category" dataKey="symbol" stroke="#52525b" fontSize={8} fontFamily="monospace" tickFormatter={(v) => v.split("-")[0]} width={32} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                        labelStyle={{ fontFamily: "monospace", fontSize: 9, color: "#a1a1aa" }}
                        itemStyle={{ fontFamily: "monospace", fontSize: 9 }}
                        formatter={(v: number) => [`${v.toFixed(2)}%`, "Vol Share"]}
                      />
                      <Bar dataKey="vol_share" name="Vol Share" radius={[0, 3, 3, 0]}>
                        {[...aggData].sort((a, b) => b.volume_usd - a.volume_usd).slice(0, 12).map((_, i) => (
                          <Cell key={i} fill={SCATTER_COLORS[(i + 5) % SCATTER_COLORS.length]} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ── Aggregated Table ── */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-zinc-300 uppercase">📋 Aggregated OI & Volume — Full List</span>
                <span className="text-[9px] font-mono text-zinc-500">{aggData.length} koin · Klik header untuk sort</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="border-b border-zinc-800/60 bg-zinc-900/40">
                      <th className="text-left px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider w-8">#</th>
                      <th className="text-left px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider">Koin</th>
                      <th
                        className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-zinc-300 transition-colors select-none"
                        onClick={() => handleAggSort("oi_usd")}
                      >
                        Open Interest {aggSortKey === "oi_usd" ? (aggSortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th
                        className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-zinc-300 transition-colors select-none"
                        onClick={() => handleAggSort("oi_share")}
                      >
                        OI Share {aggSortKey === "oi_share" ? (aggSortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th
                        className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-zinc-300 transition-colors select-none"
                        onClick={() => handleAggSort("volume_usd")}
                      >
                        Volume (1H) {aggSortKey === "volume_usd" ? (aggSortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider">Vol Share</th>
                      <th
                        className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider cursor-pointer hover:text-zinc-300 transition-colors select-none"
                        onClick={() => handleAggSort("vol_oi_ratio")}
                      >
                        Vol/OI {aggSortKey === "vol_oi_ratio" ? (aggSortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th className="text-right px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider">Price</th>
                      <th className="text-center px-3 py-2 text-zinc-500 font-semibold uppercase tracking-wider">Flow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgg.map((row, i) => (
                      <tr
                        key={row.symbol}
                        className="border-b border-zinc-900/50 hover:bg-zinc-900/30 transition-colors cursor-pointer"
                        onClick={() => setSymbol(row.symbol)}
                        title={`Klik untuk lihat detail ${row.symbol}`}
                      >
                        <td className="px-3 py-2 text-zinc-600">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="text-zinc-200 font-bold">{row.symbol.split("-")[0]}</span>
                            <span className="text-[8px] text-zinc-600">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-semibold">{formatLargeNumber(row.oi_usd)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-500/60"
                                style={{ width: `${Math.min(row.oi_share * 2.5, 100)}%` }}
                              />
                            </div>
                            <span className="text-zinc-400">{row.oi_share.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-indigo-400 font-semibold">{formatLargeNumber(row.volume_usd)}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-indigo-500/60"
                                style={{ width: `${Math.min(row.vol_share * 2.5, 100)}%` }}
                              />
                            </div>
                            <span className="text-zinc-400">{row.vol_share.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${
                          row.vol_oi_ratio > avgVolOi * 1.5 ? "text-amber-400" : row.vol_oi_ratio < avgVolOi * 0.5 ? "text-zinc-500" : "text-zinc-300"
                        }`}>
                          {row.vol_oi_ratio.toFixed(3)}x
                        </td>
                        <td className="px-3 py-2 text-right text-zinc-400">{formatPrice(row.price)}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className="px-2 py-0.5 rounded-full text-[8px] font-bold border"
                            style={{
                              color: row.flowColor,
                              borderColor: `${row.flowColor}40`,
                              backgroundColor: `${row.flowColor}12`,
                            }}
                          >
                            {row.flow}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr className="border-t-2 border-zinc-700/50 bg-zinc-900/50">
                      <td className="px-3 py-2.5 text-zinc-500" colSpan={2}>
                        <span className="font-bold text-zinc-400">TOTAL ({aggData.length} koin)</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-emerald-400 font-bold">{formatLargeNumber(aggTotalOi)}</td>
                      <td className="px-3 py-2.5 text-right text-zinc-500">100%</td>
                      <td className="px-3 py-2.5 text-right text-indigo-400 font-bold">{formatLargeNumber(aggTotalVol)}</td>
                      <td className="px-3 py-2.5 text-right text-zinc-500">100%</td>
                      <td className="px-3 py-2.5 text-right text-amber-400 font-bold">
                        {aggTotalOi > 0 ? (aggTotalVol / aggTotalOi).toFixed(3) : "N/A"}x
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-zinc-800/40 text-[8px] font-mono text-zinc-600">
                💡 Klik baris untuk lihat detail chart ticker • Vol/OI &gt; rata-rata = aktivitas spekulatif tinggi
              </div>
            </div>
          </>
        ) : !aggLoading ? (
          <div className="text-center py-8 text-xs font-mono text-zinc-600">
            Tekan <span className="text-zinc-400 font-bold">Refresh</span> untuk memuat Market Aggregator
          </div>
        ) : null}
      </div>

      {/* error bubble for single ticker */}
      {error && (
        <div className="text-[10px] font-mono text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg px-3 py-2">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

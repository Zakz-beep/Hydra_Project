"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from "recharts";

/* ─── Interfaces ────────────────────────────────────────────────────────── */
interface LiquidationOrder {
  symbol: string;
  price: number;
  orig_qty: number;
  executed_qty: number;
  usd_value: number;
  liq_type: "LONG" | "SHORT";
  side: "SELL" | "BUY";
  timestamp: number;
  time: string;
}

interface LiquidationResponse {
  status: string;
  message?: string;
  data: LiquidationOrder[];
}

const COLOR_UP = "#10b981"; // short liquidated -> buy order -> green
const COLOR_DOWN = "#ef5350"; // long liquidated -> sell order -> red

const cryptoSuggestions = [
  "BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "PEPE-USDT", "ADA-USDT", "LINK-USDT",
  "SUI-USDT", "WIF-USDT", "BONK-USDT", "NEAR-USDT", "FET-USDT", "FTM-USDT", "SHIB-USDT", "AVAX-USDT",
];

export default function LiquidationDashboard() {
  const [data, setData] = useState<LiquidationOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<"success" | "fallback" | null>(null);

  // ── Filters ──
  const [symbolFilter, setSymbolFilter] = useState("");
  const [minUsdFilter, setMinUsdFilter] = useState<number>(0);
  const [sideFilter, setSideFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState<string>(""); // empty = all symbols

  // ── Auto Refresh ──
  const [refreshInterval, setRefreshInterval] = useState<number>(5000); // 5s default
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  /* ── Fetch Data ── */
  const fetchLiquidations = useCallback(async (sym?: string) => {
    setLoading(true);
    setError(null);
    try {
      let url = "/api/crypto/liquidations?limit=150";
      if (sym) {
        url += `&symbol=${encodeURIComponent(sym.replace("-", ""))}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error("Gagal mengambil data likuidasi.");
      const json: LiquidationResponse = await res.json();
      setData(json.data || []);
      setApiStatus(json.status as any);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal memuat data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle auto-refresh interval
  useEffect(() => {
    fetchLiquidations(activeSymbol);

    if (refreshInterval > 0) {
      timerRef.current = setInterval(() => {
        fetchLiquidations(activeSymbol);
      }, refreshInterval);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeSymbol, refreshInterval, fetchLiquidations]);

  const handleSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSymbol(symbolFilter.trim().toUpperCase());
    setShowSuggestions(false);
  };

  const clearSymbolFilter = () => {
    setSymbolFilter("");
    setActiveSymbol("");
  };

  // Helper formats
  const formatLargeNumber = (num: number) => {
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
    return `$${num.toFixed(2)}`;
  };

  const formatPrice = (p: number) => {
    if (p >= 1.0) return `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `$${p.toLocaleString(undefined, { minimumFractionDigits: 5, maximumFractionDigits: 5 })}`;
  };

  /* ── Data Processing ── */
  const filteredData = data.filter((item) => {
    // 1. Min USD Filter
    if (item.usd_value < minUsdFilter) return false;
    // 2. Side Filter
    if (sideFilter !== "ALL" && item.liq_type !== sideFilter) return false;
    return true;
  });

  // Calculate statistics based on filtered dataset
  const stats = (() => {
    let totalUSD = 0;
    let longUSD = 0;
    let longCount = 0;
    let shortUSD = 0;
    let shortCount = 0;
    let largestOrder: LiquidationOrder | null = null;

    for (const item of filteredData) {
      totalUSD += item.usd_value;
      if (item.liq_type === "LONG") {
        longUSD += item.usd_value;
        longCount++;
      } else {
        shortUSD += item.usd_value;
        shortCount++;
      }

      if (!largestOrder || item.usd_value > largestOrder.usd_value) {
        largestOrder = item;
      }
    }

    const ratioLong = totalUSD > 0 ? (longUSD / totalUSD) * 100 : 50;

    return { totalUSD, longUSD, longCount, shortUSD, shortCount, ratioLong, largestOrder };
  })();

  // Prepare chart data: aggregate by symbol
  const coinDistributionData = (() => {
    const map: Record<string, number> = {};
    filteredData.forEach((item) => {
      const symClean = item.symbol.replace("USDT", "");
      map[symClean] = (map[symClean] || 0) + item.usd_value;
    });

    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  })();

  // Prepare chart data: timeline of liquidations (grouped into 1-minute blocks or showing individual bars)
  const timelineData = filteredData.slice(0, 30).reverse().map((item) => ({
    time: item.time.split(" ")[1] || item.time,
    value: item.usd_value,
    type: item.liq_type,
    symbol: item.symbol.replace("USDT", ""),
  }));

  const COLORS_PALETTE = ["#a78bfa", "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#fb923c", "#2dd4bf"];

  return (
    <div className="space-y-4">
      {/* ── Control Panel ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Symbol Filter and Auto-Refresh */}
          <div className="flex flex-wrap items-center gap-3">
            <form onSubmit={handleSymbolSubmit} className="flex items-center gap-1.5 relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Koin (e.g. BTC, SOL, ALL)..."
                  value={symbolFilter}
                  onChange={(e) => {
                    setSymbolFilter(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder-zinc-600 w-40"
                />

                {showSuggestions && symbolFilter.trim() !== "" && (() => {
                  const query = symbolFilter.toLowerCase();
                  const matches = cryptoSuggestions
                    .filter((s) => s.toLowerCase().replace("-", "").includes(query))
                    .slice(0, 5);

                  if (matches.length === 0) return null;

                  return (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl max-h-48 overflow-y-auto divide-y divide-zinc-900/60 w-40">
                      {matches.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onMouseDown={() => {
                            const symName = s.split("-")[0];
                            setSymbolFilter(symName);
                            setActiveSymbol(symName);
                            setShowSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-350 hover:bg-zinc-900 hover:text-emerald-400 transition-colors cursor-pointer block"
                        >
                          {s.split("-")[0]}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button
                type="submit"
                className="px-2.5 py-1 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded text-xs font-mono text-zinc-350 cursor-pointer"
              >
                Terapkan
              </button>
              {activeSymbol && (
                <button
                  type="button"
                  onClick={clearSymbolFilter}
                  className="px-2 py-1 bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 rounded text-xs font-mono text-red-400 cursor-pointer"
                  title="Clear symbol filter"
                >
                  ✕ Clear
                </button>
              )}
            </form>

            {/* Min Size Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Min Size:</span>
              <select
                value={minUsdFilter}
                onChange={(e) => setMinUsdFilter(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 cursor-pointer"
              >
                <option value={0}>Semua Ukuran</option>
                <option value={1000}>&gt; $1K</option>
                <option value={5000}>&gt; $5K</option>
                <option value={10000}>&gt; $10K</option>
                <option value={50000}>&gt; $50K (Whales)</option>
                <option value={100000}>&gt; $100K (Mega-Whales)</option>
              </select>
            </div>
          </div>

          {/* Side Filter, Live Refresh rate */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Side Toggle */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-0.5 inline-flex">
              {(["ALL", "LONG", "SHORT"] as const).map((side) => (
                <button
                  key={side}
                  onClick={() => setSideFilter(side)}
                  className={`px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider rounded transition-all cursor-pointer ${
                    sideFilter === side
                      ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/30"
                      : "text-zinc-500 hover:text-zinc-350 border border-transparent"
                  }`}
                >
                  {side}
                </button>
              ))}
            </div>

            {/* Auto Refresh interval */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-500 uppercase">Live Refresh:</span>
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 cursor-pointer"
              >
                <option value={0}>Mati (Manual)</option>
                <option value={2000}>2 Detik</option>
                <option value={5000}>5 Detik</option>
                <option value={10000}>10 Detik</option>
                <option value={30000}>30 Detik</option>
              </select>
            </div>

            <button
              onClick={() => fetchLiquidations(activeSymbol)}
              disabled={loading}
              className="px-2.5 py-1 rounded border border-zinc-800 hover:border-zinc-650 hover:bg-zinc-850 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40"
            >
              {loading ? "..." : "↺"}
            </button>
          </div>
        </div>

        {apiStatus === "fallback" && (
          <div className="text-[9px] font-mono text-amber-400 bg-amber-950/10 border border-amber-900/20 rounded-md px-3 py-1 flex items-center justify-between">
            <span>⚠️ API Binance Limit/Error. Menampilkan data fallback simulasi live.</span>
            <span className="opacity-75">Fallback active</span>
          </div>
        )}
      </div>

      {/* ── Stats Snapshot Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Total Liquidations */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col justify-between h-20">
          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Total Liquidation Volume</div>
          <div className="text-base font-mono font-bold text-zinc-100 mt-1">{formatLargeNumber(stats.totalUSD)}</div>
          <div className="text-[9px] font-mono text-zinc-400">Dari {filteredData.length} order terekam</div>
        </div>

        {/* Long Liquidations (Forced Sell) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col justify-between h-20">
          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Long Liquidations (Forced Sells)</div>
          <div className="text-base font-mono font-bold text-red-400 mt-1">{formatLargeNumber(stats.longUSD)}</div>
          <div className="text-[9px] font-mono text-zinc-400">{stats.longCount} Posisi Long Hancur</div>
        </div>

        {/* Short Liquidations (Forced Buy) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col justify-between h-20">
          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">Short Liquidations (Forced Buys)</div>
          <div className="text-base font-mono font-bold text-emerald-400 mt-1">{formatLargeNumber(stats.shortUSD)}</div>
          <div className="text-[9px] font-mono text-zinc-400">{stats.shortCount} Posisi Short Hancur</div>
        </div>

        {/* Largest Whale liquidation */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3.5 flex flex-col justify-between h-20">
          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">🔥 Largest Liquidation Alert</div>
          {stats.largestOrder ? (
            <div className="mt-1">
              <div className="text-xs font-mono font-bold text-zinc-200">
                {stats.largestOrder.symbol.replace("USDT", "")} :{" "}
                <span className={stats.largestOrder.liq_type === "LONG" ? "text-red-400" : "text-emerald-400"}>
                  {formatLargeNumber(stats.largestOrder.usd_value)}
                </span>
              </div>
              <div className="text-[8px] font-mono text-zinc-400">At price {formatPrice(stats.largestOrder.price)}</div>
            </div>
          ) : (
            <div className="text-xs font-mono text-zinc-500 mt-1">Belum ada data</div>
          )}
        </div>
      </div>

      {/* Ratio Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 space-y-1.5">
        <div className="flex justify-between items-center text-[9px] font-mono">
          <span className="text-red-400 uppercase font-bold">Long Liquidations: {stats.ratioLong.toFixed(1)}%</span>
          <span className="text-zinc-500 font-bold">Ratio Distribusi Tekanan</span>
          <span className="text-emerald-400 uppercase font-bold">Short Liquidations: {(100 - stats.ratioLong).toFixed(1)}%</span>
        </div>
        <div className="w-full h-2 rounded bg-zinc-950 overflow-hidden flex">
          <div className="h-full bg-red-500/80 transition-all duration-500" style={{ width: `${stats.ratioLong}%` }} />
          <div className="h-full bg-emerald-500/80 transition-all duration-500" style={{ width: `${100 - stats.ratioLong}%` }} />
        </div>
      </div>

      {/* ── Charts ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Timeline Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2 md:col-span-2">
          <div className="text-xs font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2 flex items-center justify-between">
            <span>📈 Recent Liquidation Feed Timeline</span>
            <span className="text-[9px] font-mono text-zinc-500">Sumbu Y: USD Value · Red=Long, Green=Short</span>
          </div>
          <div className="h-56 w-full">
            {timelineData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">Tidak ada data.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={timelineData} margin={{ top: 10, right: 5, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f1f22" />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={8} fontFamily="monospace" />
                  <YAxis stroke="#52525b" fontSize={8} fontFamily="monospace" tickFormatter={(v) => `${(v / 1e3).toFixed(0)}K`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                    labelStyle={{ fontFamily: "monospace", fontSize: 9, color: "#a1a1aa" }}
                    itemStyle={{ fontFamily: "monospace", fontSize: 9 }}
                    formatter={(val: number, name: string, item: any) => {
                      const payload = item.payload;
                      return [`$${val.toLocaleString()}`, `${payload.symbol} (${payload.type})`];
                    }}
                  />
                  <Bar dataKey="value" name="Liq Value">
                    {timelineData.map((entry, index) => (
                      <Cell key={index} fill={entry.type === "LONG" ? COLOR_DOWN : COLOR_UP} fillOpacity={0.65} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Asset Distribution Pie */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-2">
          <div className="text-xs font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2">
            🍕 Top Liquidated Coins
          </div>
          <div className="h-56 w-full flex items-center justify-center">
            {coinDistributionData.length === 0 ? (
              <div className="text-xs font-mono text-zinc-600">Tidak ada data.</div>
            ) : (
              <div className="relative w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={coinDistributionData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={65}
                      fill="#8884d8"
                      stroke="#09090b"
                      strokeWidth={2}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                      style={{ fontSize: 9, fontFamily: "monospace", fill: "#d1d5db" }}
                    >
                      {coinDistributionData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS_PALETTE[index % COLORS_PALETTE.length]} fillOpacity={0.7} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                      itemStyle={{ fontFamily: "monospace", fontSize: 9 }}
                      formatter={(val: number) => [formatLargeNumber(val), "Liq Value"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Live Order List ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold text-zinc-300 uppercase flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            Real-time Liquidation Order Book Feed
          </span>
          <span className="text-[8px] font-mono text-zinc-500">Menampilkan {filteredData.length} records terbaru</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="border-b border-zinc-800/60 bg-zinc-900/40 text-zinc-500">
                <th className="text-left px-3 py-2 uppercase font-semibold">Waktu</th>
                <th className="text-left px-3 py-2 uppercase font-semibold">Koin</th>
                <th className="text-center px-3 py-2 uppercase font-semibold">Tipe</th>
                <th className="text-right px-3 py-2 uppercase font-semibold">Harga Eksekusi</th>
                <th className="text-right px-3 py-2 uppercase font-semibold">Jumlah Koin</th>
                <th className="text-right px-3 py-2 uppercase font-semibold">Nilai USD</th>
                <th className="text-center px-3 py-2 uppercase font-semibold">Whale Alert</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/40">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-xs text-zinc-600">
                    Tidak ada likuidasi yang cocok dengan filter aktif.
                  </td>
                </tr>
              ) : (
                filteredData.map((order, i) => {
                  const isWhale = order.usd_value >= 25000;
                  const isMegaWhale = order.usd_value >= 100000;
                  return (
                    <tr
                      key={i}
                      className={`hover:bg-zinc-900/30 transition-colors ${
                        isMegaWhale
                          ? "bg-red-950/10 border-l-2 border-red-500/80 animate-pulse"
                          : isWhale
                          ? "bg-red-950/5 border-l-2 border-amber-500/40"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-zinc-500">{order.time}</td>
                      <td className="px-3 py-2 font-bold text-zinc-200">
                        {order.symbol.replace("USDT", "")}
                        <span className="text-[8px] text-zinc-600 ml-1">USDT</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className="px-2 py-0.5 rounded text-[8px] font-bold border"
                          style={{
                            color: order.liq_type === "LONG" ? COLOR_DOWN : COLOR_UP,
                            borderColor: order.liq_type === "LONG" ? `${COLOR_DOWN}40` : `${COLOR_UP}40`,
                            backgroundColor: order.liq_type === "LONG" ? `${COLOR_DOWN}08` : `${COLOR_UP}08`,
                          }}
                        >
                          {order.liq_type === "LONG" ? "LONG (FORCED SELL)" : "SHORT (FORCED BUY)"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-300 font-semibold">{formatPrice(order.price)}</td>
                      <td className="px-3 py-2 text-right text-zinc-400">
                        {order.executed_qty.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-bold ${
                          order.liq_type === "LONG" ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {formatLargeNumber(order.usd_value)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isMegaWhale ? (
                          <span className="px-2 py-0.5 rounded bg-red-900/30 border border-red-700/50 text-red-300 text-[8px] font-bold tracking-wider animate-bounce inline-block">
                            🚨 MEGA WHALE
                          </span>
                        ) : isWhale ? (
                          <span className="px-2 py-0.5 rounded bg-amber-950/30 border border-amber-700/40 text-amber-300 text-[8px] font-bold tracking-wider inline-block">
                            🐳 WHALE
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";

interface CoinData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  open_interest?: number;
}

export default function AltcoinScreener() {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  // Filter States
  const [marketType, setMarketType] = useState<"spot" | "futures">("spot");
  const [category, setCategory] = useState<"all" | "large_cap" | "mid_cap" | "small_cap">("mid_cap");
  const [minVolume, setMinVolume] = useState<number>(20000000);
  const [sortBy, setSortBy] = useState<string>("change_24h");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const fetchScreenerData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/crypto/screener?market_type=${marketType}&category=${category}&min_volume=${minVolume}&sort_by=${sortBy}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Gagal mengambil data dari endpoint screener.");
      }
      const data = await res.json();
      if (data.status === "success" || data.status === "fallback") {
        setCoins(data.coins);
        setIsFallback(data.status === "fallback");
      } else {
        throw new Error(data.detail || "Terjadi kesalahan internal.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal memuat data screener.");
    } finally {
      setLoading(false);
    }
  }, [marketType, category, minVolume, sortBy]);

  // Adjust sorting when marketType changes
  useEffect(() => {
    if (marketType === "futures") {
      setSortBy("open_interest_desc");
    } else {
      setSortBy("change_24h");
    }
  }, [marketType]);

  // Initial and reactive fetch
  useEffect(() => {
    fetchScreenerData();
  }, [fetchScreenerData]);

  const handleAddToPortfolio = async (coin: CoinData) => {
    const amountStr = window.prompt(
      `Masukkan jumlah kepemilikan (amount) untuk koin ${coin.name} (${coin.symbol.toUpperCase()}):`,
      "0.0"
    );
    if (amountStr === null) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      alert("Jumlah koin harus berupa angka positif.");
      return;
    }

    try {
      const res = await fetch("/api/crypto/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin_id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          amount: amount,
        }),
      });
      if (!res.ok) throw new Error("Gagal menambahkan koin ke portofolio.");
      const data = await res.json();
      if (data.status === "success") {
        alert(`Berhasil menambahkan ${amount} ${coin.symbol.toUpperCase()} ke portofolio!`);
      } else {
        alert(data.detail || "Terjadi kesalahan.");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    }
  };

  // Client-side search filtering
  const filteredCoins = coins.filter(
    (coin) =>
      coin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      coin.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Numbers formatter helpers
  const formatPrice = (price: number) => {
    if (price >= 1.0) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
  };

  const formatLargeNumber = (num: number) => {
    if (num >= 1e9) {
      return `$${(num / 1e9).toFixed(2)} B`;
    }
    if (num >= 1e6) {
      return `$${(num / 1e6).toFixed(2)} M`;
    }
    return `$${num.toLocaleString()}`;
  };

  return (
    <div className="space-y-4">
      {isFallback && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-xs">⚠️</span>
            <span className="text-[10px] font-mono text-amber-500 font-bold uppercase tracking-wider">
              Fallback Mode: Menampilkan data simulasi realistis (Bybit/Gecko API limit/timeout)
            </span>
          </div>
          <button 
            onClick={fetchScreenerData}
            className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 transition-colors uppercase self-start sm:self-auto cursor-pointer"
          >
            Hubungkan Kembali
          </button>
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          {/* Market Type and Category Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Market Type Toggle */}
            <div className="bg-zinc-950 border border-zinc-855 rounded-lg p-0.5 inline-flex">
              <button
                onClick={() => setMarketType("spot")}
                className={`px-2.5 py-1 text-[9px] font-mono font-semibold uppercase tracking-wider rounded transition-all cursor-pointer ${
                  marketType === "spot"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700/30"
                    : "text-zinc-500 hover:text-zinc-350 border border-transparent"
                }`}
              >
                Spot (Gecko)
              </button>
              <button
                onClick={() => setMarketType("futures")}
                className={`px-2.5 py-1 text-[9px] font-mono font-semibold uppercase tracking-wider rounded transition-all cursor-pointer ${
                  marketType === "futures"
                    ? "bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/30"
                    : "text-zinc-500 hover:text-zinc-350 border border-transparent"
                }`}
              >
                Futures (Bybit)
              </button>
            </div>

            {/* Category Selector (Only for Spot) */}
            {marketType === "spot" && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Market Cap:</span>
                {([
                  { value: "all", label: "All Caps" },
                  { value: "large_cap", label: "Large" },
                  { value: "mid_cap", label: "Mid" },
                  { value: "small_cap", label: "Small" },
                ] as const).map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setCategory(c.value)}
                    className={`px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded border transition-all cursor-pointer ${
                      category === c.value
                        ? "bg-zinc-850 border-zinc-750 text-zinc-200"
                        : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-350"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search bar */}
          <div className="relative w-full md:w-64">
            <input
              type="text"
              placeholder="Search ticker/name..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder-zinc-600"
            />
            {searchQuery ? (
              <button 
                onClick={() => {
                  setSearchQuery("");
                  setShowSuggestions(false);
                }}
                className="absolute right-3 top-2 text-zinc-500 hover:text-zinc-300 text-xs font-mono cursor-pointer"
              >
                ✕
              </button>
            ) : null}

            {/* Suggestions Dropdown */}
            {showSuggestions && searchQuery.trim() !== "" && (() => {
              const matches = coins
                .filter(
                  (c) =>
                    c.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.name.toLowerCase().includes(searchQuery.toLowerCase())
                )
                .slice(0, 6);

              if (matches.length === 0) return null;

              return (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl max-h-48 overflow-y-auto divide-y divide-zinc-900/60">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => {
                        setSearchQuery(c.symbol);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-mono text-zinc-350 hover:bg-zinc-900 hover:text-emerald-400 transition-colors flex justify-between items-center cursor-pointer"
                    >
                      <span className="font-bold text-zinc-200">{c.symbol.toUpperCase()}</span>
                      <span className="text-[10px] text-zinc-500">{c.name}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>

        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-t border-zinc-800/40 pt-3">
          
          {/* Sort By Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Sort By:</span>
            {(marketType === "spot" ? [
              { value: "market_cap", label: "Market Cap ⬇" },
              { value: "volume", label: "24h Volume ⬇" },
              { value: "change_24h", label: "24h Gainers ⬇" },
            ] : [
              { value: "open_interest_desc", label: "OI (Rame) ⬇" },
              { value: "open_interest_asc", label: "OI (Sepi) ⬆" },
              { value: "volume", label: "24h Volume ⬇" },
              { value: "change_24h", label: "24h Gainers ⬇" },
            ]).map((s) => (
              <button
                key={s.value}
                onClick={() => setSortBy(s.value)}
                className={`px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider rounded-md border transition-all cursor-pointer ${
                  sortBy === s.value
                    ? "bg-zinc-800 border-zinc-700 text-zinc-200"
                    : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-355"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Volume Filter and Refresh */}
          <div className="flex items-center gap-4 justify-between md:justify-end">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-mono text-zinc-500 uppercase whitespace-nowrap">Min Vol 24h:</label>
              <select
                value={minVolume}
                onChange={(e) => setMinVolume(Number(e.target.value))}
                className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[10px] font-mono text-zinc-300 focus:outline-none focus:border-zinc-700 cursor-pointer"
              >
                <option value={0}>No Limit</option>
                <option value={1000000}>$1 M</option>
                <option value={5000000}>$5 M</option>
                <option value={10000000}>$10 M</option>
                <option value={20000000}>$20 M</option>
                <option value={50000000}>$50 M</option>
                <option value={100000000}>$100 M</option>
              </select>
            </div>

            <button
              onClick={fetchScreenerData}
              disabled={loading}
              className="px-2.5 py-1 text-[10px] font-mono border border-zinc-800 hover:border-zinc-650 hover:bg-zinc-850 rounded-md text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40"
            >
              {loading ? "..." : "↺ Refresh"}
            </button>
          </div>

        </div>
      </div>

      {/* ── Screener Table ── */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/20 overflow-hidden overflow-x-auto">
        {error && (
          <div className="p-4 text-center font-mono text-xs text-red-400">
            ⚠️ Gagal memuat data screener: {error}
          </div>
        )}

        {loading ? (
          <div className="p-12 space-y-4">
            <div className="h-6 w-full bg-zinc-900/60 rounded animate-pulse" />
            <div className="h-24 w-full bg-zinc-900/40 rounded animate-pulse" />
            <div className="h-24 w-full bg-zinc-900/40 rounded animate-pulse" />
          </div>
        ) : filteredCoins.length === 0 ? (
          <div className="p-12 text-center text-xs font-mono text-zinc-500">
            Tidak ada koin yang sesuai dengan filter pencarian.
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-normal w-12 text-center">Rank</th>
                <th className="px-4 py-3 font-normal">Token</th>
                <th className="px-4 py-3 font-normal text-right">Price</th>
                <th className="px-4 py-3 font-normal text-right font-bold text-zinc-300">
                  {marketType === "spot" ? "Market Cap" : "Open Interest"}
                </th>
                <th className="px-4 py-3 font-normal text-right">Volume (24h)</th>
                <th className="px-4 py-3 font-normal text-right w-32">24h Chg (%)</th>
                <th className="px-4 py-3 font-normal text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/50">
              {filteredCoins.map((coin, index) => {
                const change = coin.price_change_percentage_24h || 0;
                const isPositive = change >= 0;
                return (
                  <tr 
                    key={coin.id} 
                    className="hover:bg-zinc-900/30 transition-colors border-b border-zinc-900/40"
                  >
                    {/* Rank */}
                    <td className="px-4 py-2.5 text-center text-zinc-500 font-semibold">
                      {marketType === "spot" ? coin.market_cap_rank || index + 1 : index + 1}
                    </td>
                    
                    {/* Name & Icon */}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {coin.image && (
                          <img 
                            src={coin.image} 
                            alt={coin.name} 
                            className="w-4 h-4 rounded-full" 
                            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                          />
                        )}
                        <div>
                          <div className="font-bold text-zinc-200">{coin.symbol.toUpperCase()}</div>
                          <div className="text-[10px] text-zinc-500">{coin.name}</div>
                        </div>
                      </div>
                    </td>
                    
                    {/* Price */}
                    <td className="px-4 py-2.5 text-right text-zinc-350 font-bold">
                      {formatPrice(coin.current_price)}
                    </td>
                    
                    {/* Market Cap / Open Interest */}
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {marketType === "spot" 
                        ? formatLargeNumber(coin.market_cap) 
                        : coin.open_interest 
                          ? formatLargeNumber(coin.open_interest) 
                          : "N/A"
                      }
                    </td>
                    
                    {/* Volume */}
                    <td className="px-4 py-2.5 text-right text-zinc-500">
                      {formatLargeNumber(coin.total_volume)}
                    </td>
                    
                    {/* 24h Change */}
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex items-center font-bold px-2 py-0.5 rounded-md ${
                        isPositive 
                          ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" 
                          : "bg-red-950/40 text-red-400 border border-red-900/30"
                      }`}>
                        {isPositive ? "▲" : "▼"}{" "}
                        {Math.abs(change).toFixed(2)}%
                      </span>
                    </td>
                    
                    {/* Add to Portfolio Action */}
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleAddToPortfolio(coin)}
                        className="px-2 py-1 bg-emerald-950/40 hover:bg-emerald-900/40 text-emerald-400 border border-emerald-850 hover:border-emerald-750 rounded text-[10px] font-mono cursor-pointer transition-all"
                        title="Tambah ke Portofolio"
                      >
                        + Port
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

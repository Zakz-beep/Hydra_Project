"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface CexPriceItem {
  price: number | null;
  latency_ms: number;
  status: "success" | "failed";
}

interface CexPricesResponse {
  symbol: string;
  prices: Record<string, CexPriceItem>;
}

export default function CexArbitrage() {
  const [symbol, setSymbol] = useState("BTC-USDT");
  const [data, setData] = useState<CexPricesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [customSymbol, setCustomSymbol] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const cryptoSuggestions = [
    "BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "PEPE-USDT", "ADA-USDT", "LINK-USDT",
    "SUI-USDT", "WIF-USDT", "BONK-USDT", "NEAR-USDT", "FET-USDT", "FTM-USDT", "SHIB-USDT", "AVAX-USDT",
    "DOT-USDT", "MATIC-USDT", "UNI-USDT", "FIL-USDT", "APT-USDT", "OP-USDT", "ARB-USDT", "LTC-USDT",
    "BCH-USDT", "ETC-USDT", "ATOM-USDT", "VET-USDT", "RUNE-USDT", "ICP-USDT", "AAVE-USDT", "LDO-USDT",
    "JASMY-USDT", "RENDER-USDT", "PENDLE-USDT", "TIA-USDT", "MKR-USDT", "CRV-USDT", "DYDX-USDT"
  ];

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const popularTickers = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "DOGE-USDT", "PEPE-USDT", "ADA-USDT", "LINK-USDT"];

  const fetchCexPrices = useCallback(async (sym: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto/cex-prices?symbol=${encodeURIComponent(sym)}`);
      if (!res.ok) throw new Error("Gagal mengambil harga CEX.");
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat mengambil harga CEX.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle auto-refresh
  useEffect(() => {
    fetchCexPrices(symbol);
    
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    
    if (autoRefresh) {
      refreshTimerRef.current = setInterval(() => {
        fetchCexPrices(symbol);
      }, 5000); // refresh setiap 5 detik
    }

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [symbol, autoRefresh, fetchCexPrices]);

  const handleCustomSymbolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSymbol.trim()) return;
    let formatted = customSymbol.trim().toUpperCase();
    if (!formatted.includes("-") && formatted.endsWith("USDT")) {
      formatted = `${formatted.replace("USDT", "")}-USDT`;
    }
    setSymbol(formatted);
    setCustomSymbol("");
  };

  // Hitung metrik arbitrase
  const getArbitrageMetrics = () => {
    if (!data || !data.prices) return null;

    const validPrices = Object.entries(data.prices)
      .filter(([_, item]) => item.status === "success" && item.price !== null)
      .map(([name, item]) => ({ name, price: item.price as number }));

    if (validPrices.length < 2) return null;

    let minPriceItem = validPrices[0];
    let maxPriceItem = validPrices[0];

    validPrices.forEach((item) => {
      if (item.price < minPriceItem.price) minPriceItem = item;
      if (item.price > maxPriceItem.price) maxPriceItem = item;
    });

    const spreadUSD = maxPriceItem.price - minPriceItem.price;
    const spreadPct = (spreadUSD / minPriceItem.price) * 100;
    const avgPrice = validPrices.reduce((sum, item) => sum + item.price, 0) / validPrices.length;

    return {
      minExchange: minPriceItem.name,
      minPrice: minPriceItem.price,
      maxExchange: maxPriceItem.name,
      maxPrice: maxPriceItem.price,
      spreadUSD,
      spreadPct,
      avgPrice,
      validCount: validPrices.length,
    };
  };

  const metrics = getArbitrageMetrics();

  const formatPrice = (price: number) => {
    if (price >= 1.0) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    }
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 })}`;
  };

  return (
    <div className="space-y-4">
      {/* Selector and control panel */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Popular tickers */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Tonton Cepat:</span>
            {popularTickers.map((t) => (
              <button
                key={t}
                onClick={() => setSymbol(t)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-all cursor-pointer ${
                  symbol === t
                    ? "bg-zinc-800 border-zinc-700 text-emerald-400 font-bold"
                    : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-350"
                }`}
              >
                {t.split("-")[0]}
              </button>
            ))}
          </div>

          {/* Form manual search & auto-refresh */}
          <div className="flex flex-wrap items-center gap-3 justify-between md:justify-end">
            <form onSubmit={handleCustomSymbolSubmit} className="flex items-center gap-1 relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Ticker (misal: SOL-USDT)..."
                  value={customSymbol}
                  onChange={(e) => {
                    setCustomSymbol(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-700 placeholder-zinc-600 w-44"
                />
                
                {/* Suggestions Dropdown */}
                {showSuggestions && customSymbol.trim() !== "" && (() => {
                  const query = customSymbol.toLowerCase().replace("-", "");
                  const matches = cryptoSuggestions
                    .filter((s) => s.toLowerCase().replace("-", "").includes(query))
                    .slice(0, 5);

                  if (matches.length === 0) return null;

                  return (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-zinc-950 border border-zinc-800 rounded-lg shadow-xl max-h-48 overflow-y-auto divide-y divide-zinc-900/60 w-44">
                      {matches.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onMouseDown={() => {
                            setSymbol(s);
                            setCustomSymbol("");
                            setShowSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-[10px] font-mono text-zinc-350 hover:bg-zinc-900 hover:text-emerald-400 transition-colors cursor-pointer block"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <button
                type="submit"
                className="px-2.5 py-1 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded text-xs font-mono text-zinc-300 cursor-pointer"
              >
                Cari
              </button>
            </form>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2 py-1 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                  autoRefresh
                    ? "border-emerald-700 text-emerald-400 bg-emerald-950/30"
                    : "border-zinc-700 text-zinc-500"
                }`}
              >
                {autoRefresh ? "● AUTO (5s)" : "○ MANUAL"}
              </button>
              <button
                onClick={() => fetchCexPrices(symbol)}
                disabled={loading}
                className="px-2 py-1 rounded border border-zinc-800 hover:border-zinc-650 hover:bg-zinc-850 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer disabled:opacity-40"
              >
                {loading ? "..." : "↺"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Summary Cards & Detailed Prices */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left Side: Summary Card */}
        <div className="md:col-span-1 space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 h-full flex flex-col justify-between min-h-[200px]">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-bold text-zinc-200 uppercase tracking-wide">
                  Arbitrage Summary
                </span>
                <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                  {symbol}
                </span>
              </div>

              {error && (
                <div className="mt-4 text-xs font-mono text-red-400">
                  ⚠️ Gagal mengambil data: {error}
                </div>
              )}

              {loading && !metrics && (
                <div className="mt-6 space-y-2 animate-pulse">
                  <div className="h-8 bg-zinc-900 rounded" />
                  <div className="h-4 bg-zinc-900/60 rounded w-2/3" />
                </div>
              )}

              {!loading && !error && !metrics && (
                <div className="mt-8 text-center text-xs font-mono text-zinc-600">
                  Data harga bursa tidak cukup untuk menghitung spread.
                </div>
              )}

              {metrics && (
                <div className="mt-4 space-y-4">
                  {/* Spread Big Display */}
                  <div>
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">
                      Max Price Spread
                    </span>
                    <div className="flex items-baseline gap-1.5 mt-0.5">
                      <span className={`text-2xl font-mono font-bold ${metrics.spreadPct >= 0.05 ? "text-emerald-400" : "text-zinc-200"}`}>
                        {metrics.spreadPct.toFixed(3)}%
                      </span>
                      <span className="text-xs font-mono text-zinc-500">
                        ({formatPrice(metrics.spreadUSD)})
                      </span>
                    </div>
                  </div>

                  {/* Recommendation block */}
                  <div className={`p-3 rounded-lg border font-mono text-[11px] ${
                    metrics.spreadPct >= 0.05 
                      ? "bg-emerald-950/20 border-emerald-900/40 text-emerald-400" 
                      : "bg-zinc-900/40 border-zinc-850 text-zinc-400"
                  }`}>
                    <div className="font-bold uppercase tracking-wider text-[9px] mb-1.5">
                      {metrics.spreadPct >= 0.05 ? "⚡ Arbitrage Opportunity Found" : "● No Significant Spread"}
                    </div>
                    <div className="space-y-1">
                      <div>Buy at <strong className="text-zinc-100 uppercase">{metrics.minExchange}</strong> ({formatPrice(metrics.minPrice)})</div>
                      <div>Sell at <strong className="text-zinc-100 uppercase">{metrics.maxExchange}</strong> ({formatPrice(metrics.maxPrice)})</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="text-[9px] font-mono text-zinc-600 border-t border-zinc-900/60 pt-2.5 mt-4">
              * Dihitung secara real-time lintas bursa CEX. Patch DoH aktif mem-bypass blokir ISP.
            </div>
          </div>
        </div>

        {/* Right Side: Detailed Table */}
        <div className="md:col-span-2">
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/20 overflow-hidden h-full flex flex-col">
            <div className="bg-zinc-900/80 border-b border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
              <span className="text-xs font-mono font-bold text-zinc-300 uppercase">Live Prices across Exchanges</span>
              {data && (
                <span className="text-[9px] font-mono text-zinc-500 uppercase">
                  Active exchanges: {Object.values(data.prices).filter(p => p.status === "success").length}/${Object.keys(data.prices).length}
                </span>
              )}
            </div>

            <div className="overflow-x-auto flex-grow">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-900/60 text-[10px] text-zinc-500 uppercase tracking-wider bg-zinc-900/10">
                    <th className="px-4 py-2.5 font-normal">Exchange</th>
                    <th className="px-4 py-2.5 font-normal text-right">Live Price</th>
                    <th className="px-4 py-2.5 font-normal text-right">Avg Price Dev</th>
                    <th className="px-4 py-2.5 font-normal text-center w-24">Latency</th>
                    <th className="px-4 py-2.5 font-normal text-center w-24">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/50">
                  {data && data.prices ? (
                    Object.entries(data.prices).map(([name, item]) => {
                      const isSuccess = item.status === "success";
                      const isMin = metrics && name === metrics.minExchange;
                      const isMax = metrics && name === metrics.maxExchange;

                      // Deviasi harga dari rata-rata
                      let devPct = 0;
                      if (metrics && item.price !== null) {
                        devPct = ((item.price - metrics.avgPrice) / metrics.avgPrice) * 100;
                      }

                      return (
                        <tr key={name} className="hover:bg-zinc-900/20 transition-colors">
                          {/* Exchange Name */}
                          <td className="px-4 py-3 font-semibold text-zinc-300">
                            <div className="flex items-center gap-1.5">
                              <span>{name}</span>
                              {isMin && (
                                <span className="bg-emerald-950/60 border border-emerald-900 text-emerald-400 text-[8px] font-bold px-1 py-0.2 rounded uppercase tracking-wider">
                                  Min/Buy
                                </span>
                              )}
                              {isMax && (
                                <span className="bg-red-950/60 border border-red-900 text-red-400 text-[8px] font-bold px-1 py-0.2 rounded uppercase tracking-wider">
                                  Max/Sell
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Price */}
                          <td className="px-4 py-3 text-right font-bold text-zinc-100">
                            {isSuccess && item.price !== null ? formatPrice(item.price) : "N/A"}
                          </td>

                          {/* Price Dev from Average */}
                          <td className="px-4 py-3 text-right">
                            {isSuccess && item.price !== null && metrics ? (
                              <span className={`font-semibold ${devPct > 0 ? "text-red-400" : devPct < 0 ? "text-emerald-400" : "text-zinc-500"}`}>
                                {devPct > 0 ? "+" : ""}{devPct.toFixed(4)}%
                              </span>
                            ) : (
                              "N/A"
                            )}
                          </td>

                          {/* Latency */}
                          <td className="px-4 py-3 text-center">
                            {isSuccess ? (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                item.latency_ms < 150 
                                  ? "text-emerald-400 bg-emerald-950/20" 
                                  : item.latency_ms < 350 
                                    ? "text-amber-400 bg-amber-950/20" 
                                    : "text-red-400 bg-red-950/20"
                              }`}>
                                {item.latency_ms} ms
                              </span>
                            ) : (
                              <span className="text-zinc-600">-</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center text-[9px] font-bold px-2 py-0.5 rounded-full ${
                              isSuccess 
                                ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30" 
                                : "bg-red-950/40 text-red-400 border border-red-900/30"
                            }`}>
                              {isSuccess ? "ACTIVE" : "FAILED"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="px-4 py-3"><div className="h-3 bg-zinc-900 rounded w-16" /></td>
                        <td className="px-4 py-3"><div className="h-3 bg-zinc-900 rounded w-24 ml-auto" /></td>
                        <td className="px-4 py-3"><div className="h-3 bg-zinc-900 rounded w-12 ml-auto" /></td>
                        <td className="px-4 py-3 text-center"><div className="h-3 bg-zinc-900 rounded w-12 mx-auto" /></td>
                        <td className="px-4 py-3 text-center"><div className="h-3 bg-zinc-900 rounded w-16 mx-auto" /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

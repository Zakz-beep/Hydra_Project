"use client";

import { useState, useEffect, useCallback } from "react";
import AltcoinScreener from "./AltcoinScreener";
import CryptoPortfolio from "./CryptoPortfolio";
import CexArbitrage from "./CexArbitrage";
import OiVolumeDashboard from "./OiVolumeDashboard";
import LiquidationDashboard from "./LiquidationDashboard";
import LongShortDashboard from "./LongShortDashboard";
import GexCryptoDashboard from "./GexCryptoDashboard";
import OnChainDashboard from "./OnChainDashboard";

interface TopCoin {
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  open_interest?: number;
}

interface CexPriceItem {
  price: number | null;
  status: string;
}

export default function CryptoDashboard() {
  const [activeTab, setActiveTab] = useState<"screener" | "portfolio" | "arbitrage" | "oivolume" | "liquidation" | "longshort" | "gex" | "onchain">("screener");
  
  // Widget 1: Top Futures Open Interest Movers
  const [topOiCoins, setTopOiCoins] = useState<TopCoin[]>([]);
  const [oiLoading, setOiLoading] = useState(false);

  // Widget 2: Live CEX Price Arbitrage Mini Tracker
  const [arbSpread, setArbSpread] = useState<{ pct: number; usd: number; minEx: string; maxEx: string } | null>(null);
  const [arbLoading, setArbLoading] = useState(false);

  // Widget 3: Portfolio Summary
  const [portfolioSummary, setPortfolioSummary] = useState<{ totalVal: number; count: number; bestPerf: string; bestPerfPct: number } | null>(null);
  const [portLoading, setPortLoading] = useState(false);

  // Fetch data for widgets
  const fetchWidgetData = useCallback(async () => {
    // 1. Top Futures OI
    setOiLoading(true);
    try {
      const res = await fetch("/api/crypto/screener?market_type=futures&min_volume=0&sort_by=open_interest_desc");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success" && data.coins) {
          setTopOiCoins(data.coins.slice(0, 3));
        }
      }
    } catch (err) {
      console.error("Gagal mengambil data top OI widget:", err);
    } finally {
      setOiLoading(false);
    }

    // 2. Live Arbitrage Spread (menggunakan SOL-USDT sebagai benchmark default di widget)
    setArbLoading(true);
    try {
      const res = await fetch("/api/crypto/cex-prices?symbol=SOL-USDT");
      if (res.ok) {
        const data = await res.json();
        if (data.prices) {
          const validPrices = Object.entries(data.prices)
            .filter(([_, item]: [string, any]) => item.status === "success" && item.price !== null)
            .map(([name, item]: [string, any]) => ({ name, price: item.price as number }));

          if (validPrices.length >= 2) {
            let minP = validPrices[0];
            let maxP = validPrices[0];
            validPrices.forEach((p) => {
              if (p.price < minP.price) minP = p;
              if (p.price > maxP.price) maxP = p;
            });
            const spreadUSD = maxP.price - minP.price;
            const spreadPct = (spreadUSD / minP.price) * 100;
            setArbSpread({
              pct: spreadPct,
              usd: spreadUSD,
              minEx: minP.name,
              maxEx: maxP.name
            });
          }
        }
      }
    } catch (err) {
      console.error("Gagal mengambil data CEX arbitrage widget:", err);
    } finally {
      setArbLoading(false);
    }

    // 3. Portfolio Summary
    setPortLoading(true);
    try {
      const res = await fetch("/api/crypto/portfolio");
      if (res.ok) {
        const data = await res.json();
        if (data.status === "success") {
          const items = data.items || [];
          const best = items.reduce((b: any, c: any) => {
            if (!b) return c;
            return c.change_24h > b.change_24h ? c : b;
          }, null);

          setPortfolioSummary({
            totalVal: data.total_value_usd || 0,
            count: items.length,
            bestPerf: best ? best.symbol : "N/A",
            bestPerfPct: best ? best.change_24h : 0
          });
        }
      }
    } catch (err) {
      console.error("Gagal mengambil data portfolio widget:", err);
    } finally {
      setPortLoading(false);
    }
  }, []);

  // Fetch once on mount, then set interval for 15s to update widgets
  useEffect(() => {
    fetchWidgetData();
    const interval = setInterval(fetchWidgetData, 15000);
    return () => clearInterval(interval);
  }, [fetchWidgetData]);

  return (
    <div className="space-y-6">
      {/* ── Welcome Banner ── */}
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 backdrop-blur-sm p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
            🪙 Live Crypto Workspace
          </div>
          <h2 className="text-lg font-mono font-bold text-zinc-100">
            Crypto Quant Analytics Hub
          </h2>
          <p className="text-xs font-mono text-zinc-400 max-w-2xl leading-relaxed">
            Selamat datang di area analisis kuantitatif aset kripto. Dashboard ini menyediakan screener altcoin dengan data Open Interest dari Bybit, tracker harga antar CEX global secara paralel menggunakan DNS-over-HTTPS (DoH) bypass, dan manajemen portofolio persistent SQLite.
          </p>
        </div>
      </div>

      {/* ── Grid Layout (Interactive Widgets) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        
        {/* Widget 1: Top Open Interest Movers */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 flex flex-col justify-between h-48 group hover:border-zinc-700/60 transition-colors">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">🔥 Top Open Interest (Futures)</span>
              <button 
                onClick={() => { setActiveTab("oivolume"); }} 
                className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
              >
                Analyser →
              </button>
            </div>
            
            {oiLoading && topOiCoins.length === 0 ? (
              <div className="mt-4 space-y-2 animate-pulse">
                <div className="h-4 bg-zinc-800/80 rounded w-full" />
                <div className="h-4 bg-zinc-800/60 rounded w-5/6" />
                <div className="h-4 bg-zinc-800/60 rounded w-4/6" />
              </div>
            ) : topOiCoins.length === 0 ? (
              <div className="mt-8 text-center text-[10px] font-mono text-zinc-600">
                Tidak ada data Open Interest saat ini.
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {topOiCoins.map((c, i) => (
                  <div key={c.symbol} className="flex items-center justify-between font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 font-bold">{i + 1}.</span>
                      <span className="text-zinc-200 font-bold">{c.symbol}</span>
                      <span className={`text-[9px] ${c.price_change_percentage_24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {c.price_change_percentage_24h >= 0 ? "▲" : "▼"}{Math.abs(c.price_change_percentage_24h).toFixed(1)}%
                      </span>
                    </div>
                    <span className="text-zinc-400 font-semibold">
                      {c.open_interest ? `$${(c.open_interest / 1e6).toFixed(1)}M` : "N/A"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 pt-2 border-t border-zinc-900/60 mt-2">
            Sorted by highest active Bybit linear contracts.
          </div>
        </div>

        {/* Widget 2: Live CEX Arbitrage Tracker */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 flex flex-col justify-between h-48 group hover:border-zinc-700/60 transition-colors">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">⚡ Live Arbitrage Spread</span>
              <button 
                onClick={() => { setActiveTab("arbitrage"); }} 
                className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
              >
                CEX Tracker →
              </button>
            </div>

            {arbLoading && !arbSpread ? (
              <div className="mt-6 space-y-2 animate-pulse">
                <div className="h-8 bg-zinc-800 rounded w-2/3" />
                <div className="h-4 bg-zinc-800/60 rounded w-1/2" />
              </div>
            ) : arbSpread ? (
              <div className="mt-3.5 space-y-2 font-mono">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-zinc-400">Pair Benchmark:</span>
                  <span className="text-[10px] bg-zinc-950 px-1.5 py-0.5 border border-zinc-850 rounded text-zinc-300">SOL-USDT</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-xl font-bold ${arbSpread.pct >= 0.05 ? "text-emerald-400" : "text-zinc-200"}`}>
                    {arbSpread.pct.toFixed(3)}%
                  </span>
                  <span className="text-[10px] text-zinc-500">(${arbSpread.usd.toFixed(3)})</span>
                </div>
                <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${arbSpread.pct >= 0.05 ? "bg-emerald-400 animate-ping" : "bg-zinc-600"}`} />
                  <span>
                    Buy: <strong className="text-zinc-350 uppercase">{arbSpread.minEx}</strong> · Sell: <strong className="text-zinc-350 uppercase">{arbSpread.maxEx}</strong>
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-8 text-center text-[10px] font-mono text-zinc-600">
                Gagal memuat metrics arbitrase CEX.
              </div>
            )}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 pt-2 border-t border-zinc-900/60 mt-2">
            * Parallel fetch via DoH bypass. Updated every 15s.
          </div>
        </div>

        {/* Widget 3: Portfolio Summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 flex flex-col justify-between h-48 group hover:border-zinc-700/60 transition-colors">
          <div>
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-wider">💼 My Portfolio Snapshot</span>
              <button 
                onClick={() => { setActiveTab("portfolio"); }} 
                className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
              >
                Portfolio →
              </button>
            </div>

            {portLoading && !portfolioSummary ? (
              <div className="mt-6 space-y-2 animate-pulse">
                <div className="h-6 bg-zinc-800 rounded w-3/4" />
                <div className="h-4 bg-zinc-800/60 rounded w-1/2" />
              </div>
            ) : portfolioSummary ? (
              <div className="mt-3.5 space-y-2.5 font-mono">
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-zinc-500 uppercase">Total Holdings:</span>
                  <span className="text-base font-bold text-zinc-200">
                    ${portfolioSummary.totalVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-zinc-500 uppercase">Assets Count:</span>
                  <span className="text-xs font-bold text-zinc-300">{portfolioSummary.count} coins</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-zinc-500 uppercase">Best Performer:</span>
                  <span className={`text-[10px] font-bold ${portfolioSummary.bestPerfPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {portfolioSummary.bestPerf} ({portfolioSummary.bestPerfPct >= 0 ? "+" : ""}{portfolioSummary.bestPerfPct.toFixed(1)}%)
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-8 text-center text-[10px] font-mono text-zinc-600">
                Portofolio Anda kosong atau tidak terjangkau.
              </div>
            )}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 pt-2 border-t border-zinc-900/60 mt-2">
            Persistent SQLite database storage (`crypto.db`).
          </div>
        </div>

      </div>

      {/* ── Tab Selector ── */}
      <div className="flex gap-1 border-b border-zinc-900 pb-px">
        <button
          onClick={() => setActiveTab("screener")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "screener"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-350"
          }`}
        >
          📊 Altcoin Screener
        </button>
        <button
          onClick={() => setActiveTab("portfolio")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "portfolio"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-355"
          }`}
        >
          💼 My Portfolio
        </button>
        <button
          onClick={() => setActiveTab("arbitrage")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "arbitrage"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-355"
          }`}
        >
          ⚡ CEX Arbitrage
        </button>
        <button
          onClick={() => setActiveTab("oivolume")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "oivolume"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          🔥 OI & Volume Analyser
        </button>
        <button
          onClick={() => setActiveTab("liquidation")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "liquidation"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          💀 Liquidation Feed
        </button>
        <button
          onClick={() => setActiveTab("longshort")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "longshort"
              ? "border-violet-500 text-violet-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          ⚖️ Long/Short Ratio
        </button>
        <button
          onClick={() => setActiveTab("gex")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "gex"
              ? "border-emerald-500 text-emerald-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          🔮 Deribit GEX
        </button>
        <button
          onClick={() => setActiveTab("onchain")}
          className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-px cursor-pointer ${
            activeTab === "onchain"
              ? "border-cyan-500 text-cyan-400 font-bold"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          }`}
        >
          ⛓️ On-Chain
        </button>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "screener" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Menyaring koin potensial berdasarkan Market Cap & Volume
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● DNS-over-HTTPS Bypass Active
            </span>
          </div>
          <AltcoinScreener />
        </div>
      ) : activeTab === "portfolio" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Kelola kepemilikan aset kripto dan pantau alokasi portofolio Anda secara persistent
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● SQLite Database Connected
            </span>
          </div>
          <CryptoPortfolio />
        </div>
      ) : activeTab === "arbitrage" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Pantau harga crypto lintas CEX global (Binance, Bybit, OKX, KuCoin) dan temukan selisih harga
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● Multi-CEX Live Query Enabled
            </span>
          </div>
          <CexArbitrage />
        </div>
      ) : activeTab === "oivolume" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Visualisasi korelasi pergerakan harga historis dan aliran modal Open Interest
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● Binance/Bybit Futures History Enabled
            </span>
          </div>
          <OiVolumeDashboard />
        </div>
      ) : activeTab === "liquidation" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Pantau order likuidasi paksa (forced liquidations) di bursa futures dalam waktu nyata
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● Live Futures ForceOrders Enabled
            </span>
          </div>
          <LiquidationDashboard />
        </div>
      ) : activeTab === "longshort" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Analisis sentimen pasar: rasio posisi long/short global, top trader, dan tekanan taker buy/sell
            </h3>
            <span className="text-[10px] font-mono text-violet-400">
              ● Binance Futures Sentiment Data
            </span>
          </div>
          <LongShortDashboard />
        </div>
      ) : activeTab === "onchain" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Analisis blockchain: MVRV Ratio, NUPL, SOPR, Exchange Flows, dan Holder Cohorts
            </h3>
            <span className="text-[10px] font-mono text-cyan-500">
              ● On-Chain Data Layer Active
            </span>
          </div>
          <OnChainDashboard />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-900/50 pb-2">
            <h3 className="text-xs font-mono text-zinc-400">
              Analisis Gamma Exposure (GEX) opsi BTC, ETH, dan SOL dari Deribit
            </h3>
            <span className="text-[10px] font-mono text-emerald-500">
              ● Deribit Options Data Connected
            </span>
          </div>
          <GexCryptoDashboard />
        </div>
      )}
    </div>
  );
}

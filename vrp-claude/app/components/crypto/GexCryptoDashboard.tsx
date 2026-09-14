"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
  ComposedChart
} from "recharts";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface GexPoint {
  strike: number;
  gex_usd: number;
}

interface ExpiryPoint {
  expiry: string;
  gex_usd: number;
}

interface GexData {
  status: "success" | "fallback";
  currency: string;
  spot_price: number;
  total_gex_usd: number;
  gamma_flip_price: number;
  sentiment: "POSITIVE_GAMMA" | "NEGATIVE_GAMMA";
  gex_by_strike: GexPoint[];
  gex_by_expiry: ExpiryPoint[];
  options_count: number;
}

const COINS = ["BTC", "ETH", "SOL"] as const;
type Coin = (typeof COINS)[number];

/* ─── Helper: Format Large Numbers ─── */
const fmtUSD = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${v >= 0 ? "" : "-"}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${v >= 0 ? "" : "-"}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${v >= 0 ? "" : "-"}$${(abs / 1e3).toFixed(1)}K`;
  return `${v >= 0 ? "" : "-"}$${abs.toFixed(2)}`;
};

/* ─── Custom Tooltip ─────────────────────────────────────────────────────── */
const GexTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 shadow-2xl min-w-[140px]">
      <p className="text-[10px] font-mono text-zinc-400 mb-1.5">
        Strike: <span className="text-zinc-200 font-bold">{label}</span>
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-mono text-zinc-500">Net GEX</span>
        <span className={`text-[10px] font-mono font-bold ${val >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {fmtUSD(val)}
        </span>
      </div>
    </div>
  );
};

export default function GexCryptoDashboard() {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [data, setData] = useState<GexData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchGexData = useCallback(async (selectedCoin: Coin) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto/gex?currency=${selectedCoin}`);
      if (!res.ok) throw new Error("Gagal memuat data GEX dari server.");
      const json = await res.json();
      if (json.status === "error") {
        throw new Error(json.message || "Terjadi kesalahan internal.");
      }
      setData(json);
    } catch (err: any) {
      console.error("[CRYPTO_GEX] Fetch error:", err);
      setError(err.message || "Gagal memuat data options GEX.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGexData(coin);
    timerRef.current = setInterval(() => {
      fetchGexData(coin);
    }, 30000); // refresh every 30 seconds

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [coin, fetchGexData]);

  if (loading && !data) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        <span className="text-xs font-mono text-zinc-500 animate-pulse">Menghitung Gamma Exposure (GEX) Deribit...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-3">
        <div className="text-red-400 text-xl font-mono">⚠️ Error</div>
        <p className="text-xs font-mono text-zinc-500">{error}</p>
        <button
          onClick={() => fetchGexData(coin)}
          className="mt-2 px-3 py-1 text-xs font-mono rounded border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:bg-zinc-900 cursor-pointer"
        >
          Coba Lagi
        </button>
      </div>
    );
  }

  const spot = data?.spot_price ?? 0;
  const flip = data?.gamma_flip_price ?? 0;
  const totalGex = data?.total_gex_usd ?? 0;
  const isFallback = data?.status === "fallback";

  // Calculate distance to flip
  const distFlipPct = spot > 0 ? ((spot - flip) / spot) * 100 : 0;
  const isPositiveGamma = totalGex > 0;

  // Filter GEX Strikes around Spot for better readability
  // e.g. strikes within +- 15% of spot
  const filteredStrikes = (data?.gex_by_strike ?? []).filter((s) => {
    const dev = Math.abs(s.strike - spot) / spot;
    return dev <= 0.15;
  });

  return (
    <div className="space-y-4">
      {/* ── Fallback Warning Banner ── */}
      {isFallback && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-xs">⚠️</span>
            <span className="text-[10px] font-mono text-amber-500 font-bold uppercase tracking-wider">
              Fallback Mode: Menampilkan data simulasi GEX (Koneksi Deribit API Timeout)
            </span>
          </div>
          <button 
            onClick={() => fetchGexData(coin)}
            className="text-[9px] font-mono font-bold px-2 py-0.5 rounded border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 transition-colors uppercase self-start sm:self-auto cursor-pointer"
          >
            Hubungkan Kembali
          </button>
        </div>
      )}

      {/* ── Control Panel ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Pilih Underlying:</span>
          <div className="bg-zinc-950 border border-zinc-855 rounded-lg p-0.5 flex gap-1">
            {COINS.map((c) => (
              <button
                key={c}
                onClick={() => setCoin(c)}
                className={`px-3 py-1 text-[10px] font-mono font-bold uppercase rounded transition-all cursor-pointer ${
                  coin === c
                    ? "bg-zinc-800 text-emerald-400 border border-zinc-700/50 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                {c} Options
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-500">
          <span>Deribit Options Chain Data</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
          <span>Live updates (30s)</span>
        </div>
      </div>

      {/* ── GEX Metrics Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Spot Price */}
        <div className="rounded-xl border border-zinc-800 p-4 space-y-1 bg-zinc-950/20">
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Spot Index Price</div>
          <div className="text-xl font-mono font-bold text-zinc-100">
            {spot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[8px] font-mono text-zinc-600">USDT spot index reference</div>
        </div>

        {/* Total Net GEX */}
        <div 
          className="rounded-xl border p-4 space-y-1"
          style={{ 
            borderColor: isPositiveGamma ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)",
            background: isPositiveGamma ? "rgba(16,185,129,0.03)" : "rgba(239,68,68,0.03)"
          }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Total Net GEX</div>
          <div className={`text-xl font-mono font-bold ${isPositiveGamma ? "text-emerald-400" : "text-red-400"}`}>
            {fmtUSD(totalGex)}
          </div>
          <div className="text-[8px] font-mono text-zinc-500">
            Dealer Gamma exposure sum
          </div>
        </div>

        {/* Gamma Flip Price */}
        <div 
          className="rounded-xl border p-4 space-y-1 bg-zinc-950/20"
          style={{ borderColor: "#6366f130" }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Gamma Flip Price</div>
          <div className="text-xl font-mono font-bold text-indigo-400">
            {flip.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-[8px] font-mono font-bold ${distFlipPct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
            {distFlipPct >= 0 ? "+" : ""}{distFlipPct.toFixed(2)}% dari spot
          </div>
        </div>

        {/* Sentiment Badge Card */}
        <div 
          className="rounded-xl border p-4 space-y-1 flex flex-col justify-between"
          style={{ 
            borderColor: isPositiveGamma ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
            background: isPositiveGamma ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)"
          }}
        >
          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider">Dealer Regime</div>
          <div className={`text-sm font-mono font-bold uppercase ${isPositiveGamma ? "text-emerald-400" : "text-red-400"}`}>
            {isPositiveGamma ? "🟢 Positive Gamma" : "🔴 Negative Gamma"}
          </div>
          <span className="text-[8px] font-mono text-zinc-400 leading-normal">
            {isPositiveGamma 
              ? "Dealer menstabilkan pasar (volatility dampening)." 
              : "Dealer mempercepat tren (volatility acceleration)."}
          </span>
        </div>
      </div>

      {/* ── Gamma Flip Zone Visualizer Bar ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-3">
        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider border-b border-zinc-900 pb-2 flex justify-between">
          <span>⚡ Gamma Flip Zone Visualizer</span>
          <span className="text-zinc-600">Spot vs Flip Level</span>
        </div>

        {/* Bar */}
        <div className="relative pt-6 pb-2">
          {/* Legend labels */}
          <div className="absolute top-0 left-0 text-[8px] font-mono text-red-500">NEGATIVE GAMMA ZONE (VOLATILE)</div>
          <div className="absolute top-0 right-0 text-[8px] font-mono text-emerald-500">POSITIVE GAMMA ZONE (STABLE)</div>

          {/* Background Bar */}
          <div className="w-full h-3 rounded-full bg-gradient-to-r from-red-500/20 via-zinc-800 to-emerald-500/20 overflow-hidden relative flex">
            {/* Center Flip Divider */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-indigo-500 shadow-[0_0_8px_#6366f1]" />
          </div>

          {/* Needle Pin */}
          {(() => {
            // Map percentage distance (-5% to +5% limits) to left position (0% to 100%)
            const limit = 5.0; // +-5% limit
            const percentage = distFlipPct; 
            const clamped = Math.max(-limit, Math.min(limit, percentage));
            const leftOffset = 50 + (clamped / limit) * 50; // map -5..5 to 0..100
            
            return (
              <div 
                className="absolute top-3 -ml-1 flex flex-col items-center transition-all duration-500 ease-out"
                style={{ left: `${leftOffset}%` }}
              >
                <div className="w-2 h-2 rotate-45 bg-indigo-400 border border-zinc-950 shadow-[0_0_6px_#6366f1]" />
                <span className="text-[8px] font-mono font-bold text-zinc-200 bg-zinc-950 border border-zinc-800 rounded px-1 mt-1 shadow-md whitespace-nowrap">
                  Spot: {spot.toLocaleString()}
                </span>
              </div>
            );
          })()}
        </div>

        {/* Analysis Description */}
        <div className="text-[9px] font-mono text-zinc-500 leading-relaxed border-t border-zinc-900/60 pt-2.5">
          {isPositiveGamma ? (
            <p>
              Harga Spot berada di <span className="text-emerald-400 font-bold">atas</span> Gamma Flip Level ({flip.toLocaleString()}). Dealer berada dalam posisi net-long gamma. Dealer cenderung menjual saat harga naik dan membeli saat harga turun, menekan volatilitas dan bertindak sebagai magnet harga di sekitar area strike tinggi.
            </p>
          ) : (
            <p>
              Harga Spot berada di <span className="text-red-400 font-bold">bawah</span> Gamma Flip Level ({flip.toLocaleString()}). Dealer berada dalam posisi net-short gamma. Dealer cenderung mengejar tren (membeli saat harga naik, menjual saat harga turun) untuk hedging, memicu peningkatan volatilitas dan pergerakan harga yang lebih liar (ekstrim).
            </p>
          )}
        </div>
      </div>

      {/* ── Charts Grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: GEX by Strike Chart (Main) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-3 lg:col-span-2">
          <div className="text-[10px] font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2 flex justify-between">
            <span>📊 Dealer Net GEX per Strike Price</span>
            <span className="text-[8px] font-normal text-zinc-500">Rentang ±15% dari spot</span>
          </div>

          <div className="h-72 w-full">
            {filteredStrikes.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">
                Tidak ada data options
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredStrikes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#18181b" />
                  <XAxis 
                    dataKey="strike" 
                    stroke="#3f3f46" 
                    fontSize={8} 
                    fontFamily="monospace"
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="#3f3f46" 
                    fontSize={8} 
                    fontFamily="monospace" 
                    tickLine={false} 
                    tickFormatter={(v) => fmtUSD(v)}
                  />
                  <Tooltip content={<GexTooltip />} />
                  <ReferenceLine x={flip} stroke="#6366f1" strokeWidth={1.5} strokeDasharray="3 3" label={{ value: "Flip Level", fill: "#818cf8", fontSize: 8, fontFamily: "monospace", position: "top" }} />
                  <ReferenceLine x={spot} stroke="#e4e4e7" strokeWidth={1.5} label={{ value: "Spot Price", fill: "#f4f4f5", fontSize: 8, fontFamily: "monospace", position: "top" }} />
                  <Bar dataKey="gex_usd" name="Net GEX ($)">
                    {filteredStrikes.map((entry, index) => {
                      const isBull = entry.gex_usd >= 0;
                      return (
                        <Cell 
                          key={index} 
                          fill={isBull ? "url(#upGex)" : "url(#downGex)"} 
                          fillOpacity={0.8}
                        />
                      );
                    })}
                  </Bar>
                  {/* Gradients definitions */}
                  <defs>
                    <linearGradient id="upGex" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.2} />
                    </linearGradient>
                    <linearGradient id="downGex" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Right: GEX by Expiry Chart */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 p-4 space-y-3">
          <div className="text-[10px] font-mono font-bold text-zinc-300 uppercase border-b border-zinc-900 pb-2">
            📅 Total GEX by Expiration Date
          </div>

          <div className="h-72 w-full">
            {(data?.gex_by_expiry ?? []).length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs font-mono text-zinc-600">
                Tidak ada data expiry
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.gex_by_expiry} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#18181b" />
                  <XAxis 
                    dataKey="expiry" 
                    stroke="#3f3f46" 
                    fontSize={8} 
                    fontFamily="monospace"
                    tickLine={false}
                    tickFormatter={(val) => val.split("-").slice(1).join("/")} // MM/DD format
                  />
                  <YAxis 
                    stroke="#3f3f46" 
                    fontSize={8} 
                    fontFamily="monospace" 
                    tickLine={false}
                    tickFormatter={(v) => fmtUSD(v)}
                  />
                  <Tooltip 
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const val = typeof payload[0].value === "number" ? payload[0].value : 0;
                      return (
                        <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 shadow-2xl">
                          <p className="text-[9px] font-mono text-zinc-400 mb-1.5">{label}</p>
                          <div className="flex justify-between gap-3 text-[10px] font-mono">
                            <span className="text-zinc-500">Net GEX:</span>
                            <span className={val >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {fmtUSD(val)}
                            </span>
                          </div>
                        </div>
                      );
                    }} 
                  />
                  <Bar dataKey="gex_usd">
                    {(data?.gex_by_expiry ?? []).map((entry, index) => {
                      const isBull = entry.gex_usd >= 0;
                      return (
                        <Cell 
                          key={index} 
                          fill={isBull ? "#10b981" : "#ef4444"} 
                          fillOpacity={0.7}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Interpretation Guide ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-900 pb-1">
            💡 Apa itu GEX (Gamma Exposure) Kripto?
          </div>
          <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
            GEX mengukur total sensitivitas posisi dealer opsi terhadap perubahan harga underlying (BTC/ETH/SOL). Ketika dealer menjual opsi ke ritel, dealer harus melakukan lindung nilai (*hedging*) di pasar spot/futures. Arah dan besaran GEX menunjukkan bagaimana tindakan hedging dealer ini akan mempengaruhi pergerakan harga pasar kripto.
          </p>
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-mono font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-900 pb-1">
            🎯 Level Gamma Flip & Support/Resistance
          </div>
          <p className="text-[9px] font-mono text-zinc-500 leading-relaxed">
            Level Gamma Flip bertindak sebagai pivot penting bagi volatilitas pasar. Selain itu, bar hijau tertinggi pada grafik **GEX per Strike** menandakan call walls (resistance kuat), sedangkan bar merah terdalam menandakan put walls (support kuat) tempat dealer terkonsentrasi melakukan hedging beli/jual secara besar-besaran.
          </p>
        </div>
      </div>
    </div>
  );
}

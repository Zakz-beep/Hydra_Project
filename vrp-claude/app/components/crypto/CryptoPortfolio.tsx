"use client";

import { useState, useEffect, useCallback } from "react";

interface PortfolioItem {
  coin_id: string;
  symbol: string;
  name: string;
  amount: number;
  current_price: number;
  change_24h: number;
  total_value_usd: number;
  allocation_pct: number;
  added_at: string;
}

export default function CryptoPortfolio() {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>("");

  const fetchPortfolio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crypto/portfolio");
      if (!res.ok) {
        throw new Error("Gagal memuat data portofolio.");
      }
      const data = await res.json();
      if (data.status === "success") {
        setItems(data.items || []);
        setTotalValue(data.total_value_usd || 0);
      } else {
        throw new Error(data.detail || "Gagal mengambil data.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  const handleRemove = async (coinId: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus ${coinId.toUpperCase()} dari portofolio?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/crypto/portfolio/${coinId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Gagal menghapus koin.");
      const data = await res.json();
      if (data.status === "success") {
        fetchPortfolio();
      } else {
        alert(data.detail || "Gagal menghapus.");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    }
  };

  const handleUpdate = async (coinId: string) => {
    const val = parseFloat(editAmount);
    if (isNaN(val) || val < 0) {
      alert("Jumlah koin harus berupa angka positif.");
      return;
    }
    try {
      const res = await fetch(`/api/crypto/portfolio/${coinId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: val }),
      });
      if (!res.ok) throw new Error("Gagal memperbarui jumlah.");
      const data = await res.json();
      if (data.status === "success") {
        setEditingId(null);
        fetchPortfolio();
      } else {
        alert(data.detail || "Gagal memperbarui.");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    }
  };

  // Find best performer in the portfolio
  const bestPerformer = items.reduce<PortfolioItem | null>((best, current) => {
    if (!best) return current;
    return current.change_24h > best.change_24h ? current : best;
  }, null);

  const formatPrice = (price: number) => {
    if (price >= 1.0) {
      return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
  };

  return (
    <div className="space-y-4">
      {/* ── Portfolio Overview Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Total Value Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24 relative overflow-hidden">
          <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Total Portfolio Value</div>
          <div className="text-xl font-mono font-bold text-zinc-100 mt-1">
            ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[9px] font-mono text-zinc-600 uppercase mt-0.5">Base currency: USD</div>
        </div>

        {/* Total Assets Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24 relative overflow-hidden">
          <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Assets Held</div>
          <div className="text-xl font-mono font-bold text-zinc-100 mt-1">
            {items.length} <span className="text-xs font-normal text-zinc-500">coins</span>
          </div>
          <div className="text-[9px] font-mono text-zinc-600 uppercase mt-0.5">SQLite Persistent Database</div>
        </div>

        {/* Best Performer Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/35 p-4 flex flex-col justify-between h-24 relative overflow-hidden">
          <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Best 24h Performer</div>
          {bestPerformer ? (
            <div className="mt-1">
              <div className="text-sm font-mono font-bold text-zinc-200">
                {bestPerformer.name} ({bestPerformer.symbol})
              </div>
              <div className={`text-xs font-mono font-bold ${bestPerformer.change_24h >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {bestPerformer.change_24h >= 0 ? "▲" : "▼"} {Math.abs(bestPerformer.change_24h).toFixed(2)}%
              </div>
            </div>
          ) : (
            <div className="text-sm font-mono text-zinc-500 mt-1">N/A</div>
          )}
          <div className="text-[9px] font-mono text-zinc-600 uppercase mt-0.5">Based on CoinGecko pricing</div>
        </div>
      </div>

      {/* ── Portfolio Table & Holdings ── */}
      <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/20 overflow-hidden overflow-x-auto">
        {error && (
          <div className="p-4 text-center font-mono text-xs text-red-400">
            ⚠️ Gagal memuat portofolio: {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="p-12 space-y-4">
            <div className="h-6 w-full bg-zinc-900/60 rounded animate-pulse" />
            <div className="h-16 w-full bg-zinc-900/40 rounded animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-xs font-mono text-zinc-500 space-y-3">
            <div>Portofolio Anda masih kosong.</div>
            <div className="text-[10px] text-zinc-600">Pilih koin dari tab "Altcoin Screener" lalu klik tombol portofolio untuk menambahkannya ke sini!</div>
          </div>
        ) : (
          <table className="w-full text-left font-mono text-xs border-collapse min-w-[750px]">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800 text-[10px] text-zinc-500 uppercase tracking-wider">
                <th className="px-4 py-3 font-normal">Token</th>
                <th className="px-4 py-3 font-normal text-right">Price</th>
                <th className="px-4 py-3 font-normal text-right">Holding Amount</th>
                <th className="px-4 py-3 font-normal text-right">Total Value (USD)</th>
                <th className="px-4 py-3 font-normal text-right">Allocation</th>
                <th className="px-4 py-3 font-normal text-right w-24">24h Chg</th>
                <th className="px-4 py-3 font-normal text-center w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/50">
              {items.map((item) => {
                const isPositive = item.change_24h >= 0;
                const isEditing = editingId === item.coin_id;
                return (
                  <tr key={item.coin_id} className="hover:bg-zinc-900/30 transition-colors border-b border-zinc-900/40">
                    
                    {/* Token Name */}
                    <td className="px-4 py-3">
                      <div>
                        <div className="font-bold text-zinc-200">{item.symbol}</div>
                        <div className="text-[10px] text-zinc-500">{item.name}</div>
                      </div>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 text-right text-zinc-350 font-semibold">
                      {formatPrice(item.current_price)}
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1.5">
                          <input
                            type="number"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-right w-20 text-xs font-mono text-zinc-200"
                            step="any"
                            min="0"
                          />
                        </div>
                      ) : (
                        <span className="text-zinc-200 font-semibold">{item.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>
                      )}
                    </td>

                    {/* Value USD */}
                    <td className="px-4 py-3 text-right text-zinc-100 font-bold">
                      ${item.total_value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    {/* Allocation progress bar */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="bg-emerald-500 h-1.5 rounded-full" 
                            style={{ width: `${item.allocation_pct}%` }} 
                          />
                        </div>
                        <span className="text-[10px] text-zinc-400 font-semibold w-8 text-right">
                          {item.allocation_pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* 24h Change */}
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                        {isPositive ? "+" : ""}{item.change_24h.toFixed(2)}%
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <div className="flex justify-center gap-1.5">
                          <button
                            onClick={() => handleUpdate(item.coin_id)}
                            className="px-2 py-0.5 bg-emerald-950/40 hover:bg-emerald-900/40 text-emerald-400 border border-emerald-850 hover:border-emerald-750 rounded text-[10px] font-mono cursor-pointer"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 border border-zinc-800 rounded text-[10px] font-mono cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-center gap-1.5">
                          <button
                            onClick={() => {
                              setEditingId(item.coin_id);
                              setEditAmount(item.amount.toString());
                            }}
                            className="px-2 py-0.5 bg-zinc-900 hover:bg-zinc-850 text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded text-[10px] font-mono cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleRemove(item.coin_id)}
                            className="px-2 py-0.5 bg-red-950/30 hover:bg-red-900/30 text-red-400 border border-red-900/30 hover:border-red-700/40 rounded text-[10px] font-mono cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      )}
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

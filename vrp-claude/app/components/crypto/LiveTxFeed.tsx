"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface LiveTx {
  id?: number;
  tx_hash: string;
  block_number: number;
  timestamp: string;
  timestamp_display?: string;
  tx_type: string;
  from_address: string;
  to_address?: string;
  from_label?: string;
  to_label?: string;
  value_eth: number;
  value_usd: number;
  value_display?: string;
  gas_price_gwei: number;
  method_name?: string;
  is_whale: number | boolean;
  token_symbol?: string;
  token_amount?: number;
  token_usd?: number;
}

interface NetworkStats {
  latest_block?: number;
  gas_price_gwei?: number;
  eth_price_usd?: number;
  network?: string;
}

interface SessionStats {
  total_eth_in_feed?: number;
  whale_count?: number;
  session_whale_count?: number;
}

interface LiveFeedData {
  status: string;
  count: number;
  last_update?: string;
  session_stats?: SessionStats;
  transactions: LiveTx[];
}

interface StatsData {
  network?: NetworkStats;
  eth_price_usd?: number;
  recent_10_blocks?: {
    total_transactions: number;
    total_eth_moved: number;
    total_usd_moved: number;
    whale_count: number;
    avg_gas_gwei: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const TX_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  whale_eth: { label: "🐋 WHALE ETH", color: "#ff6b35", bg: "rgba(255,107,53,0.15)", icon: "🐋" },
  whale_erc20: { label: "🐋 WHALE TOKEN", color: "#ff6b35", bg: "rgba(255,107,53,0.15)", icon: "🐋" },
  erc20_transfer: { label: "⬡ ERC-20", color: "#7c3aed", bg: "rgba(124,58,237,0.12)", icon: "⬡" },
  eth_transfer: { label: "Ξ ETH", color: "#22d3ee", bg: "rgba(34,211,238,0.10)", icon: "Ξ" },
  contract_call: { label: "⚙ Contract", color: "#94a3b8", bg: "rgba(148,163,184,0.10)", icon: "⚙" },
  contract_creation: { label: "✦ Deploy", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: "✦" },
};

function getTxConfig(type: string) {
  return TX_TYPE_CONFIG[type] || TX_TYPE_CONFIG.contract_call;
}

function formatAddress(addr?: string) {
  if (!addr) return "–";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTimestamp(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { hour12: false });
  } catch {
    return "–";
  }
}

function formatUSD(val: number) {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (val > 0) return `$${val.toFixed(2)}`;
  return "–";
}

function formatETH(val: number) {
  if (val === 0) return "0 ETH";
  if (val >= 1000) return `${val.toLocaleString("en-US", { maximumFractionDigits: 0 })} ETH`;
  if (val >= 1) return `${val.toFixed(2)} ETH`;
  if (val >= 0.001) return `${val.toFixed(4)} ETH`;
  return `${val.toFixed(6)} ETH`;
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  glow,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: string;
  glow?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(15,23,42,0.7)",
        border: "1px solid rgba(148,163,184,0.12)",
        borderRadius: 14,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        backdropFilter: "blur(12px)",
        boxShadow: glow ? `0 0 20px ${glow}` : "none",
        flex: 1,
        minWidth: 150,
      }}
    >
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          fontFamily: "monospace",
          color: "#f1f5f9",
          letterSpacing: "-0.5px",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>{label}</span>
      {sub && <span style={{ fontSize: 10, color: "#475569" }}>{sub}</span>}
    </div>
  );
}

function TxTypeBadge({ type }: { type: string }) {
  const cfg = getTxConfig(type);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        border: `1px solid ${cfg.color}33`,
        whiteSpace: "nowrap",
        fontFamily: "monospace",
      }}
    >
      {cfg.label}
    </span>
  );
}

function WhaleCard({ tx, ethPrice }: { tx: LiveTx; ethPrice: number }) {
  const isInbound = !!(tx.to_label);
  const isOutbound = !!(tx.from_label);
  const flowColor = isInbound ? "#ef4444" : isOutbound ? "#22c55e" : "#f59e0b";

  return (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(255,107,53,0.08) 0%, rgba(15,23,42,0.9) 100%)",
        border: "1px solid rgba(255,107,53,0.3)",
        borderRadius: 12,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        position: "relative",
        overflow: "hidden",
        animation: "whaleSlide 0.4s ease-out",
      }}
    >
      {/* Glow top border */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: "linear-gradient(90deg, transparent, #ff6b35, transparent)",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🐋</span>
          <div>
            <div
              style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#ff6b35" }}
            >
              {tx.value_display || formatETH(tx.value_eth)}
            </div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>
              ≈ {formatUSD(tx.value_usd || tx.value_eth * ethPrice)}
            </div>
          </div>
        </div>
        <TxTypeBadge type={tx.tx_type} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "monospace",
          fontSize: 11,
        }}
      >
        <span style={{ color: "#64748b" }}>FROM</span>
        <span
          style={{
            background: isOutbound ? "rgba(34,197,94,0.12)" : "rgba(148,163,184,0.08)",
            border: `1px solid ${isOutbound ? "rgba(34,197,94,0.3)" : "rgba(148,163,184,0.15)"}`,
            borderRadius: 6,
            padding: "2px 8px",
            color: isOutbound ? "#22c55e" : "#94a3b8",
          }}
        >
          {tx.from_label || formatAddress(tx.from_address)}
        </span>
        <span style={{ color: "#475569" }}>→</span>
        <span
          style={{
            background: isInbound ? "rgba(239,68,68,0.12)" : "rgba(148,163,184,0.08)",
            border: `1px solid ${isInbound ? "rgba(239,68,68,0.3)" : "rgba(148,163,184,0.15)"}`,
            borderRadius: 6,
            padding: "2px 8px",
            color: isInbound ? "#ef4444" : "#94a3b8",
          }}
        >
          {tx.to_label || formatAddress(tx.to_address)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#475569",
          fontFamily: "monospace",
        }}
      >
        <span>Block #{tx.block_number}</span>
        <span>Gas: {tx.gas_price_gwei?.toFixed(1)} Gwei</span>
        <span>{formatTimestamp(tx.timestamp)}</span>
      </div>

      {(tx.from_label || tx.to_label) && (
        <div
          style={{
            fontSize: 10,
            color: flowColor,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {isInbound && `🔴 EXCHANGE INFLOW — ${tx.to_label}`}
          {isOutbound && !isInbound && `🟢 EXCHANGE OUTFLOW — dari ${tx.from_label}`}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LiveTxFeed() {
  const [txs, setTxs] = useState<LiveTx[]>([]);
  const [whales, setWhales] = useState<LiveTx[]>([]);
  const [stats, setStats] = useState<StatsData>({});
  const [sessionStats, setSessionStats] = useState<SessionStats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [whaleOnly, setWhaleOnly] = useState(false);
  const [newTxCount, setNewTxCount] = useState(0);
  const [isPulsing, setIsPulsing] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const prevTxHashes = useRef<Set<string>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [liveRes, statsRes] = await Promise.all([
        fetch(`/api/onchain/live?limit=80&whale_only=${whaleOnly}`),
        fetch("/api/onchain/stats"),
      ]);

      if (!liveRes.ok) throw new Error(`Live feed error: ${liveRes.status}`);
      const liveData: LiveFeedData = await liveRes.json();
      const statsData: StatsData = statsRes.ok ? await statsRes.json() : {};

      // Hitung transaksi baru
      const newHashes = liveData.transactions
        .map((t) => t.tx_hash)
        .filter((h) => !prevTxHashes.current.has(h));

      if (newHashes.length > 0 && !loading) {
        setNewTxCount((prev) => prev + newHashes.length);
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 800);
      }

      // Update set hashes
      prevTxHashes.current = new Set(liveData.transactions.map((t) => t.tx_hash));

      setTxs(liveData.transactions);
      setWhales(liveData.transactions.filter((t) => t.is_whale));
      setSessionStats(liveData.session_stats || {});
      setStats(statsData);
      setLastUpdate(liveData.last_update || null);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Gagal memuat data live feed");
    } finally {
      setLoading(false);
    }
  }, [whaleOnly, loading]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 12000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [whaleOnly]);

  const ethPrice = stats.eth_price_usd || stats.network?.eth_price_usd || 3400;
  const networkStats = stats.network || {};
  const blockStats = stats.recent_10_blocks;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <style>{`
        @keyframes whaleSlide {
          from { opacity: 0; transform: translateY(-10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes txSlideIn {
          from { opacity: 0; transform: translateX(-8px); background: rgba(34,211,238,0.06); }
          to   { opacity: 1; transform: translateX(0); background: transparent; }
        }
        @keyframes pulseGlow {
          0%,100% { box-shadow: 0 0 0 rgba(34,211,238,0); }
          50%      { box-shadow: 0 0 24px rgba(34,211,238,0.25); }
        }
        .live-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 8px #22c55e;
          animation: livePulse 1.5s ease-in-out infinite;
          display: inline-block;
        }
        @keyframes livePulse {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(0.8); }
        }
      `}</style>

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span className="live-dot" />
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#f1f5f9" }}>
                Live Transaction Feed
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              Ethereum Mainnet — Update setiap ~12 detik (1 blok)
              {lastUpdate && ` • ${formatTimestamp(lastUpdate)} WIB`}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {newTxCount > 0 && (
            <span
              style={{
                background: "rgba(34,211,238,0.15)",
                color: "#22d3ee",
                border: "1px solid rgba(34,211,238,0.3)",
                borderRadius: 20,
                padding: "4px 12px",
                fontSize: 11,
                fontWeight: 700,
                fontFamily: "monospace",
              }}
            >
              +{newTxCount} tx baru
            </span>
          )}

          {/* Whale Filter Toggle */}
          <button
            onClick={() => { setWhaleOnly(!whaleOnly); setNewTxCount(0); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: whaleOnly ? "rgba(255,107,53,0.15)" : "rgba(15,23,42,0.8)",
              border: whaleOnly ? "1px solid rgba(255,107,53,0.5)" : "1px solid rgba(148,163,184,0.15)",
              color: whaleOnly ? "#ff6b35" : "#94a3b8",
              borderRadius: 8,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              transition: "all 0.2s",
            }}
          >
            🐋 {whaleOnly ? "Whales Only" : "All Tx"}
          </button>

          <button
            onClick={() => { fetchData(); setNewTxCount(0); }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(34,211,238,0.08)",
              border: "1px solid rgba(34,211,238,0.2)",
              color: "#22d3ee",
              borderRadius: 8,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              transition: "all 0.2s",
            }}
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* ─── Stats Bar ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard
          icon="⛓"
          label="Latest Block"
          value={`#${(networkStats.latest_block || 0).toLocaleString()}`}
          sub="Ethereum Mainnet"
          glow="rgba(34,211,238,0.08)"
        />
        <StatCard
          icon="⛽"
          label="Gas Price"
          value={`${(networkStats.gas_price_gwei || 0).toFixed(1)} Gwei`}
          sub="Base fee jaringan"
        />
        <StatCard
          icon="Ξ"
          label="ETH Price"
          value={`$${(ethPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          sub="CoinGecko live"
          glow="rgba(124,58,237,0.08)"
        />
        <StatCard
          icon="🐋"
          label="Whale (session)"
          value={`${sessionStats.session_whale_count || whales.length}`}
          sub={`≥50 ETH atau ≥$500K token`}
          glow="rgba(255,107,53,0.08)"
        />
        {blockStats && (
          <StatCard
            icon="💰"
            label="Volume (10 blok)"
            value={`$${(blockStats.total_usd_moved / 1_000_000).toFixed(1)}M`}
            sub={`${blockStats.total_transactions.toLocaleString()} tx`}
          />
        )}
      </div>

      {/* ─── Error State ─────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10,
            padding: "14px 18px",
            color: "#ef4444",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>⚠</span>
          <div>
            <div style={{ fontWeight: 600 }}>Gagal terhubung ke on-chain engine</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{error}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
              Pastikan backend port 8014 sudah running: <code>uv run python start_servers.py</code>
            </div>
          </div>
        </div>
      )}

      {/* ─── Main Content Grid ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>

        {/* ─── Transaction Table ──────────────────────────────────────── */}
        <div
          style={{
            background: "rgba(10,15,30,0.8)",
            border: "1px solid rgba(148,163,184,0.1)",
            borderRadius: 14,
            overflow: "hidden",
            backdropFilter: "blur(12px)",
            boxShadow: isPulsing ? "0 0 24px rgba(34,211,238,0.15)" : "none",
            transition: "box-shadow 0.5s",
          }}
        >
          {/* Table Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr 1fr 120px 80px 70px",
              padding: "10px 16px",
              borderBottom: "1px solid rgba(148,163,184,0.08)",
              fontSize: 10,
              color: "#475569",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              background: "rgba(15,23,42,0.5)",
            }}
          >
            <span>Type</span>
            <span>From</span>
            <span>To</span>
            <span>Value</span>
            <span>Gas</span>
            <span>Time</span>
          </div>

          {/* Scrollable Body */}
          <div
            ref={feedRef}
            style={{
              overflowY: "auto",
              maxHeight: 520,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(148,163,184,0.15) transparent",
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 60,
                  textAlign: "center",
                  color: "#475569",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div className="live-dot" />
                <div>Menghubungkan ke Ethereum node...</div>
                <div style={{ fontSize: 11, color: "#334155" }}>
                  Polling blok terbaru via public RPC
                </div>
              </div>
            ) : txs.length === 0 ? (
              <div
                style={{ padding: 60, textAlign: "center", color: "#475569", fontSize: 13 }}
              >
                {error ? "⚠ Backend offline" : "Menunggu transaksi baru..."}
              </div>
            ) : (
              txs.map((tx, i) => {
                const cfg = getTxConfig(tx.tx_type);
                const isNew = i < 5;
                return (
                  <div
                    key={tx.tx_hash}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "130px 1fr 1fr 120px 80px 70px",
                      padding: "9px 16px",
                      borderBottom: "1px solid rgba(148,163,184,0.04)",
                      fontSize: 11,
                      fontFamily: "monospace",
                      alignItems: "center",
                      gap: 4,
                      animation: isNew ? "txSlideIn 0.4s ease-out" : "none",
                      background: tx.is_whale
                        ? "rgba(255,107,53,0.03)"
                        : "transparent",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background =
                        "rgba(148,163,184,0.04)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background =
                        tx.is_whale ? "rgba(255,107,53,0.03)" : "transparent")
                    }
                  >
                    {/* Type Badge */}
                    <span>
                      <TxTypeBadge type={tx.tx_type} />
                    </span>

                    {/* From */}
                    <span
                      style={{
                        color: tx.from_label ? "#22c55e" : "#94a3b8",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tx.from_label ? (
                        <span
                          style={{
                            background: "rgba(34,197,94,0.1)",
                            border: "1px solid rgba(34,197,94,0.2)",
                            borderRadius: 4,
                            padding: "1px 6px",
                            color: "#22c55e",
                          }}
                        >
                          {tx.from_label}
                        </span>
                      ) : (
                        formatAddress(tx.from_address)
                      )}
                    </span>

                    {/* To */}
                    <span
                      style={{
                        color: tx.to_label ? "#ef4444" : "#64748b",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tx.to_label ? (
                        <span
                          style={{
                            background: "rgba(239,68,68,0.1)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            borderRadius: 4,
                            padding: "1px 6px",
                            color: "#ef4444",
                          }}
                        >
                          {tx.to_label}
                        </span>
                      ) : (
                        formatAddress(tx.to_address)
                      )}
                    </span>

                    {/* Value */}
                    <span
                      style={{
                        color:
                          tx.value_eth >= 50
                            ? "#ff6b35"
                            : tx.value_eth >= 1
                            ? "#f1f5f9"
                            : "#64748b",
                        fontWeight: tx.value_eth >= 50 ? 700 : 400,
                      }}
                    >
                      {tx.value_display || formatETH(tx.value_eth)}
                    </span>

                    {/* Gas */}
                    <span style={{ color: "#475569" }}>
                      {tx.gas_price_gwei?.toFixed(1)} Gwei
                    </span>

                    {/* Time */}
                    <span style={{ color: "#334155" }}>
                      {formatTimestamp(tx.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─── Whale Alert Panel ──────────────────────────────────────── */}
        <div
          style={{
            background: "rgba(10,15,30,0.8)",
            border: "1px solid rgba(255,107,53,0.2)",
            borderRadius: 14,
            overflow: "hidden",
            backdropFilter: "blur(12px)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Panel Header */}
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "1px solid rgba(255,107,53,0.12)",
              background: "rgba(255,107,53,0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#ff6b35",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                🐋 Whale Alerts
              </div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                ≥ 50 ETH atau ≥ $500K token
              </div>
            </div>
            <span
              style={{
                background: "rgba(255,107,53,0.15)",
                color: "#ff6b35",
                borderRadius: 20,
                padding: "2px 10px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "monospace",
              }}
            >
              {whales.length}
            </span>
          </div>

          {/* Whale Cards */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "12px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              maxHeight: 520,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(148,163,184,0.1) transparent",
            }}
          >
            {loading ? (
              <div
                style={{ padding: 40, textAlign: "center", color: "#475569", fontSize: 12 }}
              >
                Mendeteksi whale...
              </div>
            ) : whales.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 32, opacity: 0.3 }}>🐋</span>
                <span style={{ color: "#475569", fontSize: 12 }}>
                  Tidak ada whale di {txs.length} transaksi terakhir
                </span>
              </div>
            ) : (
              whales.map((tx) => (
                <WhaleCard key={tx.tx_hash} tx={tx} ethPrice={ethPrice} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── Legend ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "rgba(10,15,30,0.6)",
          borderRadius: 10,
          border: "1px solid rgba(148,163,184,0.06)",
          fontSize: 11,
          color: "#475569",
        }}
      >
        <span style={{ color: "#64748b", fontWeight: 600 }}>LEGENDA:</span>
        <span style={{ color: "#22c55e" }}>● Keluar dari Exchange (Akumulasi?)</span>
        <span style={{ color: "#ef4444" }}>● Masuk ke Exchange (Distribusi?)</span>
        <span style={{ color: "#ff6b35" }}>🐋 Whale ≥ 50 ETH / ≥ $500K</span>
        <span style={{ color: "#94a3b8" }}>Data: Ethereum Mainnet via Public RPC</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { GBSResponse, GBSWall, fetchGBS, fmtGex } from "../../lib/greeks";
import { RefreshCw, ShieldAlert, Zap, TrendingDown, TrendingUp, Info, BarChart3 } from "lucide-react";

interface Props {
  ticker: string;
}

const REGIME_CONFIG = {
  EXTREME:  { color: "text-rose-400",   bg: "bg-rose-500/15",   border: "border-rose-500/40",   bar: "bg-rose-500",    label: "EXTREME",  emoji: "🔥" },
  STRONG:   { color: "text-orange-400", bg: "bg-orange-500/15", border: "border-orange-500/40", bar: "bg-orange-500",  label: "STRONG",   emoji: "⚡" },
  MODERATE: { color: "text-yellow-400", bg: "bg-yellow-500/15", border: "border-yellow-500/40", bar: "bg-yellow-500",  label: "MODERATE", emoji: "⚠️" },
  WEAK:     { color: "text-blue-400",   bg: "bg-blue-500/15",   border: "border-blue-500/40",   bar: "bg-blue-500",    label: "WEAK",     emoji: "💧" },
  MINIMAL:  { color: "text-zinc-400",   bg: "bg-zinc-700/20",   border: "border-zinc-700/40",   bar: "bg-zinc-600",    label: "MINIMAL",  emoji: "〰️" },
};

function ScoreGauge({ score, regime }: { score: number; regime: keyof typeof REGIME_CONFIG }) {
  const cfg = REGIME_CONFIG[regime];
  const dashArray = 2 * Math.PI * 54; // r=54
  const dashOffset = dashArray * (1 - score / 100);

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        {/* Track */}
        <circle cx="60" cy="60" r="54" fill="none" stroke="#27272a" strokeWidth="10" />
        {/* Progress */}
        <circle
          cx="60" cy="60" r="54"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeDasharray={dashArray}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className={`${cfg.color} transition-all duration-700`}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-3xl font-mono font-black ${cfg.color}`}>{score}</span>
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">/ 100</span>
        <span className="text-[9px] font-mono mt-0.5">{cfg.emoji}</span>
      </div>
    </div>
  );
}

function ComponentBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300">{value.toFixed(1)} pts</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function WallCard({ wall, isNearest }: { wall: GBSWall; isNearest?: boolean }) {
  const isCall = wall.wall_type === "CALL_WALL";
  const regime = wall.score >= 80 ? "EXTREME" : wall.score >= 60 ? "STRONG" : wall.score >= 40 ? "MODERATE" : wall.score >= 20 ? "WEAK" : "MINIMAL";
  const cfg = REGIME_CONFIG[regime];

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isNearest ? `${cfg.border} ${cfg.bg}` : "border-zinc-800/50 bg-zinc-900/30"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCall
            ? <TrendingDown size={12} className="text-red-400" />
            : <TrendingUp size={12} className="text-emerald-400" />
          }
          <span className="text-sm font-mono font-bold text-zinc-100">${wall.strike.toFixed(2)}</span>
          {isNearest && <span className="text-[9px] font-mono bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 px-1.5 py-0.5 rounded">NEAREST</span>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${cfg.border} ${cfg.bg} ${cfg.color}`}>
            {wall.score}
          </span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase ${isCall ? "bg-red-500/10 text-red-400 border border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"}`}>
            {isCall ? "Resistance" : "Support"}
          </span>
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
          style={{ width: `${wall.score}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px] font-mono text-zinc-500">
        <div>Dist: <span className="text-zinc-300">{wall.dist_pct.toFixed(2)}%</span></div>
        <div>OI: <span className="text-zinc-300">{wall.total_oi.toLocaleString()}</span></div>
        <div>GEX: <span className={isCall ? "text-red-400" : "text-emerald-400"}>{fmtGex(wall.total_gex)}</span></div>
        <div>Vanna: <span className="text-zinc-300">{wall.net_vanna.toFixed(2)}</span></div>
      </div>

      <div className={`text-[9px] font-mono ${isCall ? "text-red-400/70" : "text-emerald-400/70"} mt-1`}>
        {wall.behavior}
      </div>
    </div>
  );
}

export default function GammaBounceScore({ ticker }: Props) {
  const [data, setData] = useState<GBSResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "walls">("overview");
  // track which ticker the current data belongs to
  const [dataTicker, setDataTicker] = useState<string>("");

  const load = useCallback(async (force = false) => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGBS(ticker, force);
      setData(res);
      setDataTicker(ticker);
    } catch (e: any) {
      setError(e.message || "GBS fetch failed");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  // When ticker changes: immediately clear stale data then fetch
  useEffect(() => {
    setData(null);
    setDataTicker("");
    setError(null);
    load();
  }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic refresh (only for same ticker, don't clear data)
  useEffect(() => {
    const iv = setInterval(() => load(), 60_000);
    return () => clearInterval(iv);
  }, [load]);

  const regime = data?.regime ?? "MINIMAL";
  const cfg = REGIME_CONFIG[regime];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-2">
          <ShieldAlert size={15} className="text-indigo-400" />
          <h3 className="text-xs font-mono text-zinc-300 uppercase tracking-wider font-bold">
            Gamma Bounce Score (GBS)
          </h3>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${cfg.border} ${cfg.bg} ${cfg.color}`}>
            {cfg.emoji} {cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600">
            {data ? new Date(data.timestamp).toLocaleTimeString() : "--"}
          </span>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-1.5 rounded-md text-zinc-500 hover:text-indigo-400 hover:bg-zinc-800 transition-all"
          >
            <RefreshCw size={13} className={loading ? "animate-spin text-indigo-400" : ""} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs font-mono text-red-400">{error}</div>
      )}

      {loading && !data && (
        <div className="px-4 py-8 text-center text-zinc-500 text-xs font-mono">
          Menghitung Gamma Bounce Score...
        </div>
      )}

      {data && (
        <div className="p-4 space-y-4">
          {/* Main score row */}
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            {/* Gauge */}
            <ScoreGauge score={data.overall_score} regime={regime} />

            {/* Right info */}
            <div className="flex-1 space-y-3 w-full">
              {/* Score breakdown */}
              {data.nearest_resistance || data.nearest_support ? (
                <div className="space-y-2">
                  {data.nearest_resistance && (
                    <ComponentBar
                      label="GEX Magnitude"
                      value={data.nearest_resistance.components.gex_score}
                      max={40}
                      color="bg-red-500"
                    />
                  )}
                  {data.nearest_resistance && (
                    <ComponentBar
                      label="OI Density"
                      value={data.nearest_resistance.components.oi_score}
                      max={20}
                      color="bg-orange-500"
                    />
                  )}
                  {data.nearest_resistance && (
                    <ComponentBar
                      label="Proximity (spot → wall)"
                      value={data.nearest_resistance.components.prox_score}
                      max={25}
                      color="bg-yellow-500"
                    />
                  )}
                  {data.nearest_resistance && (
                    <ComponentBar
                      label="Vanna / VIX Bonus"
                      value={data.nearest_resistance.components.vanna_bonus}
                      max={15}
                      color="bg-indigo-500"
                    />
                  )}
                  {data.nearest_resistance && data.nearest_resistance.components.rvol_penalty > 0 && (
                    <ComponentBar
                      label="⚠ RVOL Penalty (kontra)"
                      value={data.nearest_resistance.components.rvol_penalty}
                      max={20}
                      color="bg-rose-600"
                    />
                  )}
                </div>
              ) : null}

              {/* VIX + RVOL indicators */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                  <Zap size={11} />
                  <span>VIX Δ:</span>
                  <span className={(data.vix_change || 0) > 0 ? "text-red-400" : (data.vix_change || 0) < 0 ? "text-emerald-400" : "text-zinc-400"}>
                    {(data.vix_change || 0) > 0 ? "+" : ""}{data.vix_change?.toFixed ? data.vix_change.toFixed(2) : "0.00"} pts
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                  <BarChart3 size={11} />
                  <span>RVOL:</span>
                  <span className={`font-bold ${
                    (data.rvol || 0) >= 2.0 ? "text-rose-400" :
                    (data.rvol || 0) >= 1.5 ? "text-orange-400" :
                    (data.rvol || 0) >= 0.8 ? "text-zinc-300" : "text-blue-400"
                  }`}>
                    {data.rvol?.toFixed ? data.rvol.toFixed(2) : "N/A"}x
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${
                    data.rvol_regime === "EXTREME_VOL" ? "bg-rose-500/15 border-rose-500/30 text-rose-400" :
                    data.rvol_regime === "HIGH" ? "bg-orange-500/15 border-orange-500/30 text-orange-400" :
                    data.rvol_regime === "LOW" ? "bg-blue-500/15 border-blue-500/30 text-blue-400" :
                    "bg-zinc-700/20 border-zinc-600/30 text-zinc-400"
                  }`}>
                    {data.rvol_regime ? data.rvol_regime.replace("_", " ") : "UNKNOWN"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-600">
                  <span>Vol: {data.today_volume ? (data.today_volume / 1e6).toFixed(1) : "N/A"}M</span>
                  <span>/</span>
                  <span>Avg: {data.avg_volume_20 ? (data.avg_volume_20 / 1e6).toFixed(1) : "N/A"}M</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interpretation */}
          <div className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}>
            <p className={`text-xs font-mono font-bold ${cfg.color} mb-1`}>
              {cfg.emoji} Hedging Pressure: {cfg.label}
            </p>
            <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
              {regime === "EXTREME" && "Market Maker hedging sangat agresif. Probabilitas bounce dari level terdekat sangat tinggi. MM akan jual/beli secara masif saat harga mendekati wall."}
              {regime === "STRONG"  && "Dinding GEX solid dengan OI tebal. High probability bounce. MM harus hedge signifikan — harga kemungkinan terpental kembali."}
              {regime === "MODERATE" && "Ada resistensi dari MM hedging tapi tidak ekstrim. Bisa ditembus dengan volume tinggi (RVOL > 2x). Perhatikan OI dan GEX change."}
              {regime === "WEAK"   && "Dinding GEX tipis. Momentum trader lebih dominan. MM hedging minimal — potensi breakout lebih besar dari bounce."}
              {regime === "MINIMAL" && "Hampir tidak ada gamma hedging pressure. Harga bergerak bebas. Perhatikan aliran opsi baru (flow) untuk sinyal arah."}
            </p>
          </div>

          {/* Tabs: nearest walls */}
          <div className="flex gap-1">
            {(["overview", "walls"] as const).map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1 text-[10px] font-mono uppercase rounded transition-colors ${activeTab === t ? "bg-zinc-800 text-indigo-400" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {t === "overview" ? "Support / Resistance" : `All Walls (${data.walls.length})`}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase mb-2 flex items-center gap-1">
                  <TrendingDown size={10} className="text-red-400" /> Nearest Resistance
                </p>
                {data.nearest_resistance
                  ? <WallCard wall={data.nearest_resistance} isNearest />
                  : <div className="text-zinc-600 text-xs font-mono">Tidak ada call wall di atas spot</div>
                }
              </div>
              <div>
                <p className="text-[10px] font-mono text-zinc-500 uppercase mb-2 flex items-center gap-1">
                  <TrendingUp size={10} className="text-emerald-400" /> Nearest Support
                </p>
                {data.nearest_support
                  ? <WallCard wall={data.nearest_support} isNearest />
                  : <div className="text-zinc-600 text-xs font-mono">Tidak ada put wall di bawah spot</div>
                }
              </div>
            </div>
          )}

          {activeTab === "walls" && (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {data.walls.length === 0 ? (
                <p className="text-xs font-mono text-zinc-500 text-center py-4">Tidak ada GEX walls signifikan</p>
              ) : (
                data.walls.map((w, i) => (
                  <WallCard key={i} wall={w} />
                ))
              )}
            </div>
          )}

          {/* Legend */}
          <div className="flex gap-x-4 gap-y-1 flex-wrap mt-1">
            {(Object.entries(REGIME_CONFIG) as [keyof typeof REGIME_CONFIG, typeof REGIME_CONFIG[keyof typeof REGIME_CONFIG]][]).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1 text-[9px] font-mono">
                <div className={`w-2 h-2 rounded-full ${v.bar}`} />
                <span className="text-zinc-500">{v.emoji} {k}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

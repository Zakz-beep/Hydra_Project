"use client";

import React, { useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface VixSnapshot {
  vix9d?: number; vix_spot?: number; vix3m?: number; vix6m?: number;
  vix9d_vix?: number; vix_vix3m?: number; vix_curve_slope?: number;
  backwardation?: boolean; error?: string;
}
interface ShapFeature { feature: string; importance: number; }
interface RegimeBar { timestamp: string; regime: string; regime_id: number; confidence: number; }

interface LGBMResult {
  ticker: string; timestamp: string; total_bars: number; n_features: number;
  current_regime: string; current_regime_id: number;
  dominant_regime: string; confidence: number; high_confidence: boolean;
  regime_probabilities: Record<string, number>;
  signal: string; conviction: string; position_size: number; signal_notes: string;
  cv_accuracy: number; cv_accuracy_std: number; fold_scores: number[];
  regime_distribution: Record<string, number>;
  regime_pct: Record<string, number>;
  vix_term_structure: VixSnapshot;
  shap_importance: ShapFeature[];
  regime_history: RegimeBar[];
}

// ── Constants ─────────────────────────────────────────────────────────────────
const REGIME_STYLE: Record<number, { bg: string; border: string; text: string; dot: string; label: string }> = {
  0: { bg: "bg-emerald-950/40", border: "border-emerald-500/40", text: "text-emerald-300", dot: "bg-emerald-400", label: "Trending Up" },
  1: { bg: "bg-red-950/40",     border: "border-red-500/40",     text: "text-red-300",     dot: "bg-red-400",     label: "Trending Down" },
  2: { bg: "bg-blue-950/40",    border: "border-blue-500/40",    text: "text-blue-300",    dot: "bg-blue-400",    label: "Mean-Reverting" },
  3: { bg: "bg-zinc-900/40",    border: "border-zinc-700/40",    text: "text-zinc-400",    dot: "bg-zinc-500",    label: "Choppy/Low Vol" },
};
const REGIME_ICON = ["🟢", "🔴", "🔵", "⚪"];
const SIGNAL_COLOR: Record<string, string> = {
  MOMENTUM_LONG: "text-emerald-300", MOMENTUM_SHORT: "text-red-300",
  MEAN_REVERT: "text-blue-300", FLAT: "text-zinc-400",
};
const CONVICTION_COLOR: Record<string, string> = {
  HIGH: "text-emerald-400", MEDIUM: "text-yellow-400", LOW: "text-zinc-500",
};

// ── Sub-components ────────────────────────────────────────────────────────────
function RegimeCard({ result }: { result: LGBMResult }) {
  const s = REGIME_STYLE[result.current_regime_id] ?? REGIME_STYLE[3];
  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} px-5 py-4`}>
      <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">LightGBM Regime</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-2xl">{REGIME_ICON[result.current_regime_id] ?? "⚪"}</span>
        <p className={`text-xl font-mono font-bold ${s.text}`}>{result.current_regime}</p>
      </div>
      <div className="mt-3 space-y-1.5">
        {Object.entries(result.regime_probabilities).map(([name, prob]) => {
          const rid = Object.values(REGIME_STYLE).findIndex(r => r.label === name);
          const rs = REGIME_STYLE[rid >= 0 ? rid : 3];
          const pct = (prob * 100).toFixed(1);
          return (
            <div key={name}>
              <div className="flex justify-between text-[10px] font-mono mb-0.5">
                <span className={rs.text}>{name}</span>
                <span className="text-zinc-300 font-bold">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800">
                <div className={`h-full rounded-full ${rs.dot} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] font-mono">
        <span className={result.high_confidence ? "text-emerald-400" : "text-yellow-400"}>
          {result.high_confidence ? "✓ HIGH CONF" : "○ LOW CONF"}
        </span>
        <span className="text-zinc-600">·</span>
        <span className="text-zinc-400">{(result.confidence * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function SignalCard({ result }: { result: LGBMResult }) {
  const sig = result.signal;
  const sigColor = SIGNAL_COLOR[sig] ?? "text-zinc-300";
  const convColor = CONVICTION_COLOR[result.conviction] ?? "text-zinc-400";
  const pctSize = (result.position_size * 100).toFixed(0);
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 px-5 py-4">
      <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Strategy Signal</p>
      <p className={`text-xl font-mono font-bold mt-2 ${sigColor}`}>🎯 {sig}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div><span className="text-zinc-600">Conviction</span><br /><span className={convColor}>{result.conviction}</span></div>
        <div><span className="text-zinc-600">Position Size</span><br /><span className="text-zinc-200">{pctSize}%</span></div>
        <div className="col-span-2"><span className="text-zinc-600">CV Accuracy</span>
          <span className="ml-2 text-cyan-300">{(result.cv_accuracy * 100).toFixed(2)}%</span>
          <span className="text-zinc-600 ml-1">± {(result.cv_accuracy_std * 100).toFixed(2)}%</span>
        </div>
      </div>
      <p className="mt-3 text-[10px] font-mono text-zinc-500 leading-relaxed">{result.signal_notes}</p>
    </div>
  );
}

function VixTermCard({ vix }: { vix: VixSnapshot }) {
  if (vix.error) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">VIX Term Structure</p>
        <p className="text-[11px] font-mono text-zinc-600 mt-2">{vix.error}</p>
      </div>
    );
  }
  const isBack = vix.backwardation;
  const structColor = isBack ? "text-red-400" : "text-emerald-400";
  const borderColor = isBack ? "border-red-500/40" : "border-emerald-500/40";
  const bgColor = isBack ? "bg-red-950/20" : "bg-emerald-950/20";
  const items = [
    { label: "VIX9D", val: vix.vix9d },
    { label: "VIX", val: vix.vix_spot },
    { label: "VIX3M", val: vix.vix3m },
    { label: "VIX6M", val: vix.vix6m },
  ].filter(x => x.val !== undefined);
  const maxVix = Math.max(...items.map(x => x.val as number), 1);
  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} px-5 py-4`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">VIX Term Structure</p>
        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${isBack ? "border-red-500/50 bg-red-950/40 text-red-300" : "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"}`}>
          {isBack ? "⚠ BACKWARDATION" : "✓ CONTANGO"}
        </span>
      </div>
      {/* Term curve bars */}
      <div className="flex items-end gap-2 h-16 mb-3">
        {items.map(({ label, val }) => {
          const h = ((val as number) / maxVix * 100).toFixed(0);
          const isSpike = (val as number) > (vix.vix3m ?? 21) && label !== "VIX3M" && label !== "VIX6M";
          return (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[9px] font-mono text-zinc-400">{(val as number).toFixed(1)}</span>
              <div className="w-full rounded-t" style={{ height: `${h}%`, background: isSpike && isBack ? "rgba(239,68,68,0.6)" : "rgba(99,102,241,0.5)" }} />
              <span className="text-[9px] font-mono text-zinc-500">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono mt-1">
        {vix.vix9d_vix !== undefined && (
          <div><span className="text-zinc-600">9D/VIX</span><br />
            <span className={vix.vix9d_vix > 1 ? "text-red-400" : "text-emerald-400"}>{vix.vix9d_vix.toFixed(3)}</span>
          </div>
        )}
        {vix.vix_vix3m !== undefined && (
          <div><span className="text-zinc-600">VIX/3M</span><br />
            <span className={`font-bold ${vix.vix_vix3m > 1 ? "text-red-300" : "text-emerald-300"}`}>{vix.vix_vix3m.toFixed(3)}</span>
          </div>
        )}
        {vix.vix_curve_slope !== undefined && (
          <div><span className="text-zinc-600">Curve Slope</span><br />
            <span className={structColor}>{vix.vix_curve_slope.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ShapChart({ features }: { features: ShapFeature[] }) {
  if (!features.length) return null;
  const max = features[0].importance;
  const vixFeatures = ["vix_level_z", "vix_vix3m_ratio", "vix9d_vix_ratio", "vix_backwardation", "vix_curve_slope", "vix_roc_12", "vix3m_vix6m_ratio"];
  const vannaFeatures = ["vanna_exp", "vanna_z", "charm_exp", "charm_z", "vanna_sign", "charm_sign", "greek_flow_composite"];
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
      <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-4">SHAP Feature Importance (Top {features.length})</p>
      <div className="space-y-2">
        {features.map(({ feature, importance }) => {
          const pct = max > 0 ? (importance / max * 100) : 0;
          const isVix    = vixFeatures.some(f => feature.includes(f.replace("vix_", "vix")));
          const isVanna  = vannaFeatures.includes(feature);
          const barColor = isVix ? "bg-orange-500/60" : isVanna ? "bg-purple-500/60" : "bg-indigo-500/50";
          const tagColor = isVix ? "text-orange-400" : isVanna ? "text-purple-400" : "";
          return (
            <div key={feature} className="flex items-center gap-2">
              <span className={`text-[10px] font-mono w-36 truncate ${tagColor || "text-zinc-400"}`}>{feature}</span>
              <div className="flex-1 h-4 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-zinc-500 w-14 text-right">{importance.toFixed(4)}</span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-[10px] font-mono">
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500/60" /><span className="text-zinc-500">VIX</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-purple-500/60" /><span className="text-zinc-500">Vanna/Charm</span></div>
        <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-500/50" /><span className="text-zinc-500">Price/Vol</span></div>
      </div>
    </div>
  );
}

function RegimeTimeline({ history }: { history: RegimeBar[] }) {
  if (!history.length) return null;
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
      <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">Regime Timeline — Last Session</p>
      <div className="flex h-8 rounded-full overflow-hidden gap-0.5">
        {history.map((bar, i) => {
          const s = REGIME_STYLE[bar.regime_id] ?? REGIME_STYLE[3];
          return (
            <div key={i} className={`flex-1 ${s.dot} opacity-70 hover:opacity-100 transition-opacity`}
              title={`${bar.timestamp} · ${bar.regime} (${(bar.confidence * 100).toFixed(0)}%)`} />
          );
        })}
      </div>
      <div className="flex gap-4 mt-2">
        {Object.entries(REGIME_STYLE).map(([id, rs]) => (
          <div key={id} className="flex items-center gap-1.5 text-[10px] font-mono">
            <div className={`w-2 h-2 rounded-full ${rs.dot}`} />
            <span className={rs.text}>{rs.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegimeDistribution({ dist, pct }: { dist: Record<string, number>; pct: Record<string, number> }) {
  const order = ["Trending Up", "Trending Down", "Mean-Reverting", "Choppy/Low Vol"];
  const styleMap: Record<string, { s: typeof REGIME_STYLE[0]; id: number }> = {
    "Trending Up":    { s: REGIME_STYLE[0], id: 0 },
    "Trending Down":  { s: REGIME_STYLE[1], id: 1 },
    "Mean-Reverting": { s: REGIME_STYLE[2], id: 2 },
    "Choppy/Low Vol": { s: REGIME_STYLE[3], id: 3 },
  };
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
      <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">Historical Regime Distribution</p>
      <div className="flex h-5 rounded-full overflow-hidden gap-0.5 mb-3">
        {order.map(name => {
          const p = pct[name] ?? 0;
          const { s } = styleMap[name] ?? { s: REGIME_STYLE[3] };
          return p > 0 ? (
            <div key={name} className={`h-full ${s.dot}`} style={{ width: `${p}%` }}
              title={`${name}: ${p}%`} />
          ) : null;
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {order.map(name => {
          const { s } = styleMap[name] ?? { s: REGIME_STYLE[3] };
          const count = dist[name] ?? 0;
          const p = pct[name] ?? 0;
          return (
            <div key={name} className="flex items-center justify-between text-[10px] font-mono">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                <span className={s.text}>{name}</span>
              </div>
              <span className="text-zinc-400">{count.toLocaleString()} <span className="text-zinc-600">({p}%)</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const PERIOD_OPTIONS = [
  { value: "5d", label: "5 Days" },
  { value: "30d", label: "30 Days" },
  { value: "60d", label: "60 Days" },
];

export default function LGBMRegimeDashboard({ initialTicker }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker ?? "SPY");
  const [period, setPeriod] = useState("60d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LGBMResult | null>(null);

  const handleRun = useCallback(async () => {
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8006/api/vol/lgbm-regime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase(), period }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [ticker, period]);

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 px-5 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Ticker (US Equities, 5-min)</label>
            <input type="text" value={ticker} onChange={e => setTicker(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRun()}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2.5 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-indigo-500/60 transition-colors w-full"
              placeholder="SPY, QQQ, AAPL…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">History</label>
            <select value={period} onChange={e => setPeriod(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2.5 text-sm font-mono text-zinc-200
                focus:outline-none focus:border-indigo-500/60 transition-colors">
              {PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={handleRun} disabled={loading}
            className="px-6 py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800
              text-white font-mono text-sm font-semibold transition-colors shadow-lg shadow-indigo-500/20">
            {loading ? "⏳ Running…" : "▶ Run Classifier"}
          </button>
        </div>
        <p className="text-[10px] font-mono text-zinc-600 mt-3">
          53-feature LightGBM · Price/Vol + Microstructure + Vanna/Charm + VIX Term Structure + Calendar
          · Walk-forward CV · SHAP interpretability
        </p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm font-mono text-red-400">
          ⚠ {error}
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-52 rounded-xl bg-zinc-800/40 animate-pulse" />
            ))}
          </div>
          <div className="h-40 rounded-xl bg-zinc-800/40 animate-pulse" />
          <div className="h-40 rounded-xl bg-zinc-800/40 animate-pulse" />
          <div className="text-[11px] font-mono text-zinc-600 text-center py-2 animate-pulse">
            ⚙ Training LightGBM walk-forward CV — estimasi 30-90 detik…
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && !loading && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">

          {/* Info strip */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] font-mono text-zinc-600">
            <span>📌 {result.ticker}</span>
            <span>🕒 {result.timestamp}</span>
            <span>📊 {result.total_bars.toLocaleString()} bars</span>
            <span>🔢 {result.n_features} features</span>
            <span>✓ CV {(result.cv_accuracy * 100).toFixed(2)}%</span>
          </div>

          {/* Top 3 cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <RegimeCard result={result} />
            <SignalCard result={result} />
            <VixTermCard vix={result.vix_term_structure} />
          </div>

          {/* SHAP + Distribution */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ShapChart features={result.shap_importance} />
            <RegimeDistribution dist={result.regime_distribution} pct={result.regime_pct} />
          </div>

          {/* Fold scores */}
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
            <p className="text-[11px] font-mono text-zinc-500 uppercase tracking-wider mb-3">Walk-Forward CV Fold Scores</p>
            <div className="flex gap-3 flex-wrap">
              {result.fold_scores.map((score, i) => (
                <div key={i} className="text-center">
                  <div className="text-[10px] font-mono text-zinc-600 mb-1">Fold {i + 1}</div>
                  <div className={`px-3 py-1.5 rounded-md font-mono text-sm font-bold border
                    ${score >= 0.65 ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                    : score >= 0.55 ? "bg-yellow-950/40 border-yellow-500/40 text-yellow-300"
                    : "bg-red-950/40 border-red-500/40 text-red-300"}`}>
                    {(score * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
              <div className="text-center">
                <div className="text-[10px] font-mono text-zinc-600 mb-1">Mean</div>
                <div className="px-3 py-1.5 rounded-md font-mono text-sm font-bold border bg-indigo-950/40 border-indigo-500/40 text-indigo-300">
                  {(result.cv_accuracy * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <RegimeTimeline history={result.regime_history} />
        </div>
      )}

      {/* ── Empty state ── */}
      {!result && !loading && !error && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 px-6 py-12 text-center">
          <p className="text-4xl mb-4">🤖</p>
          <p className="text-zinc-400 font-mono text-sm">Click "Run Classifier" to start</p>
          <p className="text-zinc-600 font-mono text-[11px] mt-2 max-w-lg mx-auto">
            LightGBM akan download 5-menit OHLCV + VIX term structure, build 53 fitur
            (Vanna/Charm + VIX kurva + microstructure), train walk-forward CV,
            dan menghasilkan sinyal regime + SHAP importance real-time.
          </p>
          <p className="text-zinc-700 font-mono text-[10px] mt-2">⚠ Hanya support US equities (Yahoo Finance 5-min)</p>
        </div>
      )}
    </div>
  );
}

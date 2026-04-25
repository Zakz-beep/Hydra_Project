// app/components/RVBreakdown.tsx
// NEW — Visualisasi detail rv_engine: Approach 2 (Blended) + Approach 3 (HAR+Intraday)

"use client";

import { RVEngineData, fmtPct } from "../lib/vrp";

interface RVBreakdownProps {
  rv: RVEngineData;
}

// ── Horizontal bar helper ──────────────────────────────────────
function Bar({
  value,
  max = 60,
  color = "bg-zinc-600",
  label,
  sub,
}: {
  value: number;
  max?:  number;
  color?: string;
  label: string;
  sub?:  string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0">
        <span className="text-[11px] font-mono text-zinc-400 leading-none">{label}</span>
        {sub && <div className="text-[9px] font-mono text-zinc-600 leading-none mt-0.5">{sub}</div>}
      </div>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 text-right font-mono text-xs text-zinc-300">
        {fmtPct(value)}
      </span>
    </div>
  );
}

// ── Session progress arc ───────────────────────────────────────
function SessionArc({ pct }: { pct: number }) {
  const r = 20, cx = 26, cy = 26;
  const circumference = Math.PI * r; // half circle
  const offset = circumference * (1 - Math.min(pct, 1));

  return (
    <svg width="52" height="30" viewBox="0 0 52 30">
      {/* Track */}
      <path
        d={`M 6 26 A ${r} ${r} 0 0 1 46 26`}
        fill="none" stroke="#27272a" strokeWidth="4" strokeLinecap="round"
      />
      {/* Progress */}
      <path
        d={`M 6 26 A ${r} ${r} 0 0 1 46 26`}
        fill="none"
        stroke={pct > 0.7 ? "#34d399" : pct > 0.3 ? "#fbbf24" : "#60a5fa"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${circumference}`}
        strokeDashoffset={`${offset}`}
        style={{ transition: "stroke-dashoffset 0.5s ease" }}
      />
      <text
        x={cx} y={cy - 2}
        textAnchor="middle" fontSize="7" fill="#a1a1aa"
        fontFamily="monospace" fontWeight="600"
      >
        {(pct * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

// ── HAR coefficient display ────────────────────────────────────
function HARCoefs({ coefs }: { coefs: RVEngineData["har_coefficients"] }) {
  const items = [
    { key: "β_d (daily)",   val: coefs.beta_d },
    { key: "β_w (weekly)",  val: coefs.beta_w },
    { key: "β_m (monthly)", val: coefs.beta_m },
    { key: "c (intercept)", val: coefs.c },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
      {items.map(({ key, val }) => (
        <div key={key} className="flex justify-between text-[10px] font-mono">
          <span className="text-zinc-500">{key}</span>
          <span className="text-zinc-300">{val.toFixed(4)}</span>
        </div>
      ))}
      {coefs.r2 !== undefined && (
        <div className="flex justify-between text-[10px] font-mono col-span-2">
          <span className="text-zinc-500">R² (fit quality)</span>
          <span className={coefs.r2 > 0.4 ? "text-emerald-400" : "text-amber-400"}>
            {(coefs.r2 * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────
export default function RVBreakdown({ rv }: RVBreakdownProps) {
  const maxRV = Math.max(
    rv.rv_intraday_raw_pct, rv.rv_yesterday_pct,
    rv.hv20_pct, rv.rv_blended_pct,
    rv.rv_har_base_pct, rv.rv_har_updated_pct,
    rv.rv_display_15m_pct, 40
  ) * 1.2;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm p-4 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-mono uppercase tracking-widest text-zinc-400">
            RV Engine Breakdown
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            5m calc · 15m display · {rv.is_market_open ? "market open" : "market closed"}
          </p>
        </div>

        {/* Session progress */}
        <div className="flex flex-col items-center gap-0.5">
          <SessionArc pct={rv.session_elapsed_pct} />
          <span className="text-[9px] font-mono text-zinc-600">NY Session</span>
        </div>
      </div>

      {/* Candle count badges */}
      <div className="flex gap-2">
        {[
          { label: "5m candles", val: rv.n_candles_5m,  desc: "RV calc" },
          { label: "15m candles", val: rv.n_candles_15m, desc: "display" },
        ].map(({ label, val, desc }) => (
          <div key={label} className="flex-1 bg-zinc-800/50 rounded-lg px-3 py-2 text-center border border-zinc-700/40">
            <div className="text-lg font-mono font-bold text-zinc-200 leading-none">{val}</div>
            <div className="text-[9px] font-mono text-zinc-500 mt-0.5">{label}</div>
            <div className="text-[9px] font-mono text-zinc-600">{desc}</div>
          </div>
        ))}
        <div className="flex-1 bg-zinc-800/50 rounded-lg px-3 py-2 text-center border border-zinc-700/40">
          <div className="text-lg font-mono font-bold text-zinc-200 leading-none">
            {(rv.blend_weight * 100).toFixed(0)}%
          </div>
          <div className="text-[9px] font-mono text-zinc-500 mt-0.5">blend weight</div>
          <div className="text-[9px] font-mono text-zinc-600">intraday</div>
        </div>
      </div>

      {/* ── Divider: Approach 2 ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Approach 2 — Blended RV
          </span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
        <div className="space-y-2">
          <Bar
            label="RV Intraday"
            sub="5m accumulated"
            value={rv.rv_intraday_raw_pct}
            max={maxRV}
            color="bg-blue-500"
          />
          <Bar
            label="RV Yesterday"
            sub="r² × 252 proxy"
            value={rv.rv_yesterday_pct}
            max={maxRV}
            color="bg-zinc-500"
          />
          <Bar
            label="HV20"
            sub="20-day baseline"
            value={rv.hv20_pct}
            max={maxRV}
            color="bg-zinc-600"
          />
          <div className="border-t border-zinc-800 pt-2 mt-1">
            <Bar
              label="RV Blended"
              sub={`w=${(rv.blend_weight).toFixed(2)} intraday`}
              value={rv.rv_blended_pct}
              max={maxRV}
              color="bg-orange-500"
            />
          </div>
        </div>

        {/* Blend formula visual */}
        <div className="mt-2 bg-zinc-800/40 rounded-lg px-3 py-2 font-mono text-[10px] text-zinc-500">
          <span className="text-zinc-400">RV_blend</span> ={" "}
          <span className="text-blue-400">{(rv.blend_weight).toFixed(2)}</span>
          <span className="text-zinc-600"> × RV_intraday</span> +{" "}
          <span className="text-zinc-400">{(1 - rv.blend_weight).toFixed(2)}</span>
          <span className="text-zinc-600"> × RV_yesterday</span>
          {" = "}
          <span className="text-orange-400">{fmtPct(rv.rv_blended_pct)}</span>
        </div>
      </div>

      {/* ── Divider: Approach 3 ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
            Approach 3 — HAR-RV + Intraday
          </span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>
        <div className="space-y-2">
          <Bar
            label="HAR Base"
            sub="OLS forecast"
            value={rv.rv_har_base_pct}
            max={maxRV}
            color="bg-violet-500"
          />
          <Bar
            label="RV 15m"
            sub="display candles"
            value={rv.rv_display_15m_pct}
            max={maxRV}
            color="bg-zinc-500"
          />
          <div className="border-t border-zinc-800 pt-2 mt-1">
            <Bar
              label="HAR Updated"
              sub="base + intraday blend"
              value={rv.rv_har_updated_pct}
              max={maxRV}
              color="bg-emerald-500"
            />
          </div>
        </div>

        {/* HAR coefficients */}
        <div className="mt-3 bg-zinc-800/40 rounded-lg px-3 py-2">
          <div className="text-[10px] font-mono text-zinc-600 mb-1.5 uppercase tracking-wider">
            HAR Coefficients (OLS-fitted)
          </div>
          <HARCoefs coefs={rv.har_coefficients} />
        </div>
      </div>

      {/* Data source badge */}
      <div className="flex justify-end">
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border
          ${rv.data_source === "live"
            ? "text-emerald-400 border-emerald-800 bg-emerald-950/40"
            : "text-amber-400 border-amber-800 bg-amber-950/40"}`}>
          {rv.data_source === "live" ? "● live data" : "◐ synthetic"}
        </span>
      </div>
    </div>
  );
}

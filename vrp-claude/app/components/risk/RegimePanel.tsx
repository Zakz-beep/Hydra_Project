"use client";

import { RegimeInfo, fmtPctRisk, fmtRatio } from "../../lib/risk";

interface Props {
  regime: RegimeInfo | null;
  loading?: boolean;
}

const REGIME_COLORS: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  "Low Vol":    { bg: "bg-emerald-950/40", text: "text-emerald-400", border: "border-emerald-600/40", glow: "shadow-emerald-500/10" },
  "Medium Vol": { bg: "bg-amber-950/40",   text: "text-amber-400",   border: "border-amber-600/40",   glow: "shadow-amber-500/10" },
  "High Vol":   { bg: "bg-red-950/40",     text: "text-red-400",     border: "border-red-600/40",     glow: "shadow-red-500/10" },
};

function getRegimeStyle(regime: string) {
  for (const [key, style] of Object.entries(REGIME_COLORS)) {
    if (regime.includes(key) || regime.toLowerCase().includes(key.toLowerCase())) return style;
  }
  // Fallback by index
  if (regime.includes("0")) return REGIME_COLORS["Low Vol"];
  if (regime.includes("2") || regime.includes("3")) return REGIME_COLORS["High Vol"];
  return REGIME_COLORS["Medium Vol"];
}

export default function RegimePanel({ regime, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 bg-zinc-800 rounded" />
          <div className="h-12 bg-zinc-800/60 rounded-lg" />
          <div className="h-20 bg-zinc-800/40 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!regime) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 text-center">
        <p className="text-zinc-600 font-mono text-sm">Run pipeline to see regime data</p>
      </div>
    );
  }

  const style = getRegimeStyle(regime.current_regime);
  const confidence = regime.confidence * 100;

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800/40">
        <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
          <span className="text-violet-400">🔬</span> Regime Detection
          <span className="text-[10px] text-zinc-600 font-normal">HMM · {regime.n_states} states</span>
        </h3>
      </div>

      {/* Current regime badge + confidence */}
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-4">
          <div className={`px-4 py-2.5 rounded-lg border ${style.bg} ${style.text} ${style.border} shadow-lg ${style.glow}`}>
            <span className="text-lg font-mono font-bold">{regime.current_regime}</span>
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-zinc-500">
              <span>Confidence</span>
              <span className={style.text}>{confidence.toFixed(1)}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ease-out ${
                  confidence > 70 ? "bg-emerald-500" : confidence > 40 ? "bg-amber-500" : "bg-red-500"
                }`}
                style={{ width: `${confidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* Regime probabilities */}
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(regime.regime_probs).map(([key, prob]) => {
            const pct = (prob as number) * 100;
            const isActive = key === regime.current_regime;
            return (
              <div
                key={key}
                className={`rounded-lg border px-3 py-2 text-center transition-all
                  ${isActive
                    ? `${style.bg} ${style.border} ${style.text}`
                    : "bg-zinc-900/60 border-zinc-800/40 text-zinc-500"
                  }`}
              >
                <div className="text-[10px] font-mono uppercase truncate">{key}</div>
                <div className={`text-sm font-mono font-semibold ${isActive ? style.text : "text-zinc-400"}`}>
                  {pct.toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Regime stats table */}
        {regime.regime_stats && Object.keys(regime.regime_stats).length > 0 && (
          <div className="rounded-lg border border-zinc-800/40 overflow-hidden">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  {["Regime", "Vol%", "Sharpe", "Skew", "Kurt", "Avg Days"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left text-zinc-600 uppercase font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(regime.regime_stats).map(([key, s]) => {
                  const stat = s as RegimeInfo["regime_stats"][string];
                  const rowStyle = getRegimeStyle(stat?.label || key);
                  return (
                    <tr key={key} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                      <td className={`px-2 py-1.5 ${rowStyle.text} font-semibold`}>
                        {stat?.label || key}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-300">{fmtPctRisk(stat?.vol_annualized)}</td>
                      <td className={`px-2 py-1.5 ${(stat?.sharpe_approx ?? 0) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtRatio(stat?.sharpe_approx)}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-400">{fmtRatio(stat?.skewness)}</td>
                      <td className="px-2 py-1.5 text-zinc-400">{fmtRatio(stat?.excess_kurtosis)}</td>
                      <td className="px-2 py-1.5 text-zinc-400">{stat?.avg_duration_days?.toFixed(0) ?? "N/A"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Transition matrix */}
        {regime.transition_matrix && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-mono text-zinc-600 uppercase">Transition Matrix</span>
            <div className="rounded-lg border border-zinc-800/40 overflow-hidden">
              <table className="w-full text-[10px] font-mono text-center">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-2 py-1.5 text-zinc-600">From \ To</th>
                    {Object.keys(regime.transition_matrix).map((k) => (
                      <th key={k} className="px-2 py-1.5 text-zinc-500 truncate max-w-[60px]">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(regime.transition_matrix).map(([from, toMap]) => (
                    <tr key={from} className="border-b border-zinc-800/30">
                      <td className="px-2 py-1.5 text-zinc-500 font-semibold text-left truncate max-w-[60px]">{from}</td>
                      {Object.values(toMap as Record<string, number>).map((val, i) => {
                        const v = val as number;
                        const opacity = Math.max(0.15, v);
                        return (
                          <td key={i} className="px-2 py-1.5">
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-zinc-200"
                              style={{ backgroundColor: `rgba(99, 102, 241, ${opacity})` }}
                            >
                              {(v * 100).toFixed(1)}%
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

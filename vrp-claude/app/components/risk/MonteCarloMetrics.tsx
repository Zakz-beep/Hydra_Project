"use client";

import { useState } from "react";
import {
  MetricsCompare,
  ModelMetrics,
  fmtPctRisk,
  fmtMoney,
  fmtRatio,
} from "../../lib/risk";

interface Props {
  metrics: MetricsCompare | null;
  loading?: boolean;
}

type MetricTab = "returns" | "risk" | "propfirm";

export default function MonteCarloMetrics({ metrics, loading }: Props) {
  const [activeTab, setActiveTab] = useState<MetricTab>("returns");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-40 bg-zinc-800 rounded" />
          <div className="h-32 bg-zinc-800/40 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!metrics || Object.keys(metrics.models).length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-5 text-center">
        <p className="text-zinc-600 font-mono text-sm">Run pipeline to see Monte Carlo metrics</p>
      </div>
    );
  }

  const modelNames = Object.keys(metrics.models);
  const active = selectedModel || modelNames[0];

  const tabs: { key: MetricTab; label: string; icon: string }[] = [
    { key: "returns", label: "Returns", icon: "📈" },
    { key: "risk", label: "Risk", icon: "⚠" },
    { key: "propfirm", label: "Prop Firm", icon: "🏆" },
  ];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-mono font-semibold text-zinc-200 flex items-center gap-2">
          <span className="text-indigo-400">📊</span> Monte Carlo Metrics
          <span className="text-[10px] text-zinc-600 font-normal">{metrics.ticker}</span>
        </h3>

        {/* Model selector */}
        <div className="flex gap-1">
          {modelNames.map((m) => (
            <button
              key={m}
              onClick={() => setSelectedModel(m)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-md cursor-pointer transition-all
                ${active === m
                  ? "bg-indigo-950/60 text-indigo-300 border border-indigo-600/40"
                  : "text-zinc-600 hover:text-zinc-400 border border-transparent"
                }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="px-5 pt-3 flex gap-1">
        {tabs.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-[10px] font-mono uppercase rounded-t-md cursor-pointer transition-all
              ${activeTab === key
                ? "bg-zinc-800/80 text-zinc-200 border-t border-x border-zinc-700/40"
                : "text-zinc-600 hover:text-zinc-400"
              }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-5 pb-4">
        {activeTab === "returns" && <ReturnsView model={metrics.models[active]} />}
        {activeTab === "risk" && <RiskView model={metrics.models[active]} />}
        {activeTab === "propfirm" && <PropFirmView model={metrics.models[active]} />}
      </div>

      {/* Cross-model comparison bar */}
      <div className="border-t border-zinc-800/40 px-5 py-3">
        <span className="text-[9px] font-mono text-zinc-600 uppercase block mb-2">Cross-Model Comparison</span>
        <div className="grid grid-cols-4 gap-2">
          {modelNames.map((m) => {
            const mm = metrics.models[m];
            const probProfit = mm.return_metrics.prob_profit * 100;
            const passRate = mm.prop_firm_metrics.pass_rate * 100;
            return (
              <div
                key={m}
                onClick={() => setSelectedModel(m)}
                className={`rounded-lg border px-3 py-2 cursor-pointer transition-all hover:border-indigo-600/40
                  ${active === m ? "border-indigo-600/40 bg-indigo-950/20" : "border-zinc-800/40 bg-zinc-900/40"}`}
              >
                <div className="text-[10px] font-mono text-zinc-500 truncate">{m}</div>
                <div className="text-xs font-mono font-semibold text-zinc-200 mt-0.5">
                  {probProfit.toFixed(1)}% <span className="text-zinc-600 font-normal">profit</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400">
                  {passRate.toFixed(1)}% pass
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-views ────────────────────────────────────── */

function MetricRow({ label, value, highlight }: { label: string; value: string; highlight?: "green" | "red" | "neutral" }) {
  const color = highlight === "green" ? "text-emerald-400"
    : highlight === "red" ? "text-red-400"
    : "text-zinc-300";
  return (
    <div className="flex justify-between py-1 border-b border-zinc-800/20 last:border-0">
      <span className="text-[10px] font-mono text-zinc-500">{label}</span>
      <span className={`text-[11px] font-mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function ReturnsView({ model }: { model: ModelMetrics }) {
  const r = model.return_metrics;
  return (
    <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/60 p-3 mt-2 space-y-0">
      <MetricRow label="Mean Return (Ann.)" value={fmtPctRisk(r.mean_return_annualized)} />
      <MetricRow label="Std Dev (Ann.)" value={fmtPctRisk(r.std_return_annualized)} />
      <MetricRow label="Median Return" value={fmtPctRisk(r.median_return)} />
      <MetricRow label="Mean PnL" value={fmtMoney(r.mean_pnl)} highlight={r.mean_pnl > 0 ? "green" : "red"} />
      <MetricRow label="Median PnL" value={fmtMoney(r.median_pnl)} highlight={r.median_pnl > 0 ? "green" : "red"} />
      <MetricRow label="P(Profit)" value={`${(r.prob_profit * 100).toFixed(1)}%`} highlight={r.prob_profit > 0.5 ? "green" : "red"} />
      <MetricRow label="P(Target)" value={`${(r.prob_target * 100).toFixed(1)}%`} />
      <MetricRow label="P(Loss > 5%)" value={`${(r.prob_loss_gt_5pct * 100).toFixed(1)}%`} highlight="red" />
      <MetricRow label="P(Loss > 10%)" value={`${(r.prob_loss_gt_10pct * 100).toFixed(1)}%`} highlight="red" />
      <MetricRow label="EV/$ Risked" value={fmtRatio(r.ev_per_dollar_risked)} highlight={r.ev_per_dollar_risked > 0 ? "green" : "red"} />
      <MetricRow label="Skewness" value={fmtRatio(r.skewness)} />
      <MetricRow label="Excess Kurtosis" value={fmtRatio(r.excess_kurtosis)} />
      <div className="pt-2 grid grid-cols-5 gap-1">
        {[10, 25, 50, 75, 90].map((p) => {
          const key = `P${p}_return` as keyof typeof r;
          return (
            <div key={p} className="text-center rounded bg-zinc-800/40 py-1">
              <div className="text-[8px] font-mono text-zinc-600">P{p}</div>
              <div className="text-[10px] font-mono text-zinc-300">{fmtPctRisk(r[key] as number)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskView({ model }: { model: ModelMetrics }) {
  const r = model.risk_metrics;
  return (
    <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/60 p-3 mt-2 space-y-0">
      <MetricRow label="VaR 95%" value={fmtPctRisk(r.VaR_95pct)} highlight="red" />
      <MetricRow label="CVaR 95%" value={fmtPctRisk(r.CVaR_95pct)} highlight="red" />
      <MetricRow label="VaR 95% ($)" value={fmtMoney(r.VaR_95pct_dollar)} />
      <MetricRow label="CVaR 95% ($)" value={fmtMoney(r.CVaR_95pct_dollar)} />
      <MetricRow label="VaR 99%" value={fmtPctRisk(r.VaR_99pct)} highlight="red" />
      <MetricRow label="CVaR 99%" value={fmtPctRisk(r.CVaR_99pct)} highlight="red" />
      <MetricRow label="Max DD (Mean)" value={fmtPctRisk(r.max_dd_mean)} />
      <MetricRow label="Max DD (P90)" value={fmtPctRisk(r.max_dd_P90)} highlight="red" />
      <MetricRow label="Max DD (Worst)" value={fmtPctRisk(r.max_dd_worst)} highlight="red" />
      <MetricRow label="DD Duration (Mean)" value={`${r.dd_duration_mean?.toFixed(0) ?? "N/A"} days`} />
      <MetricRow label="DD Duration (Worst)" value={`${r.dd_duration_worst?.toFixed(0) ?? "N/A"} days`} />
      <MetricRow label="Sharpe (Mean)" value={fmtRatio(r.sharpe_mean)} highlight={r.sharpe_mean > 1 ? "green" : "neutral"} />
      <MetricRow label="Sortino (Mean)" value={fmtRatio(r.sortino_mean)} highlight={r.sortino_mean > 1 ? "green" : "neutral"} />
      <MetricRow label="Calmar (Mean)" value={fmtRatio(r.calmar_mean)} />
    </div>
  );
}

function PropFirmView({ model }: { model: ModelMetrics }) {
  const p = model.prop_firm_metrics;
  return (
    <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/60 p-3 mt-2 space-y-0">
      <MetricRow label="Pass Rate" value={`${(p.pass_rate * 100).toFixed(1)}%`} highlight={p.pass_rate > 0.5 ? "green" : "red"} />
      <MetricRow label="Fail Rate" value={`${(p.fail_rate * 100).toFixed(1)}%`} highlight="red" />
      <MetricRow label="Passed / Total" value={`${p.n_pass} / ${p.n_pass + p.n_fail}`} />
      <MetricRow label="Expected Attempts" value={p.expected_attempts?.toFixed(1) ?? "N/A"} />
      <MetricRow label="Pass Mean Profit" value={fmtPctRisk(p.pass_mean_profit_pct)} highlight="green" />
      <MetricRow label="Pass Median Profit" value={fmtPctRisk(p.pass_median_profit_pct)} />
      <MetricRow label="Fail Mean Loss" value={fmtPctRisk(p.fail_mean_loss_pct)} highlight="red" />
      <MetricRow label="Fail Day (Mean)" value={p.fail_day_mean?.toFixed(0) ?? "N/A"} />
      <MetricRow label="Fail Day (Median)" value={p.fail_day_median?.toFixed(0) ?? "N/A"} />
      <MetricRow label="Max Trailing DD Rule" value={fmtPctRisk(p.max_trailing_dd_rule)} />
      <MetricRow label="Daily Loss Rule" value={fmtPctRisk(p.daily_loss_rule)} />
      <MetricRow label="Challenge Target" value={fmtPctRisk(p.challenge_target)} />
    </div>
  );
}

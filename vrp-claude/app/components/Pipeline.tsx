// app/components/Pipeline.tsx
"use client";

import { VRPResult } from "../lib/vrp";

interface PipelineProps {
  data: VRPResult;
}

interface Step {
  id:     string;
  label:  string;
  value:  string;
  sub?:   string;
  color:  string;
  arrow?: boolean;
}

export default function Pipeline({ data }: PipelineProps) {
  const rv = data.rv_engine;

  const steps: Step[] = [
    {
      id: "fetch",
      label: "Data Fetch",
      value: data.data_source === "live" ? "Yahoo Finance" : "Synthetic",
      sub: `spot $${data.spot.toLocaleString()}`,
      color: data.data_source === "live" ? "border-emerald-800 text-emerald-400" : "border-amber-800 text-amber-400",
      arrow: true,
    },
    {
      id: "rv",
      label: "RV Calc",
      value: rv ? `${rv.rv_blended_pct.toFixed(2)}%` : `${data.rv_pct.toFixed(2)}%`,
      sub: rv ? `blended (w=${rv.blend_weight.toFixed(2)})` : "blended",
      color: "border-blue-800 text-blue-400",
      arrow: true,
    },
    {
      id: "har",
      label: "HAR-RV",
      value: rv ? `${rv.rv_har_updated_pct.toFixed(2)}%` : `${data.rv_har_pct.toFixed(2)}%`,
      sub: rv ? "OLS + intraday" : "forecast",
      color: "border-violet-800 text-violet-400",
      arrow: true,
    },
    {
      id: "iv",
      label: "IV",
      value: `${data.iv_pct.toFixed(2)}%`,
      sub: "VIX proxy",
      color: "border-indigo-800 text-indigo-400",
      arrow: true,
    },
    {
      id: "vrp",
      label: "VRP",
      value: `${data.vrp_raw_pct >= 0 ? "+" : ""}${data.vrp_raw_pct.toFixed(2)}%`,
      sub: `z = ${data.vrp_z >= 0 ? "+" : ""}${data.vrp_z.toFixed(2)}σ`,
      color: data.vrp_z > 0.5
        ? "border-emerald-700 text-emerald-400"
        : data.vrp_z < -0.5
          ? "border-red-800 text-red-400"
          : "border-zinc-700 text-zinc-400",
      arrow: true,
    },
    {
      id: "signal",
      label: "Signal",
      value: data.signal.replace(/_/g, " "),
      sub: undefined,
      color: data.vrp_z > 1.5
        ? "border-emerald-600 text-emerald-300"
        : data.vrp_z < -1.5
          ? "border-red-700 text-red-300"
          : "border-zinc-600 text-zinc-300",
    },
  ];

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 backdrop-blur-sm px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-600 mb-3">
        Computation Pipeline
      </div>
      <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center shrink-0">
            {/* Step box */}
            <div className={`rounded-lg border px-3 py-2 min-w-[80px] ${step.color.split(" ")[0]} bg-zinc-900/80`}>
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-600 mb-0.5">
                {step.label}
              </div>
              <div className={`text-xs font-mono font-semibold leading-none ${step.color.split(" ")[1]}`}>
                {step.value}
              </div>
              {step.sub && (
                <div className="text-[9px] font-mono text-zinc-600 mt-0.5 leading-none">
                  {step.sub}
                </div>
              )}
            </div>

            {/* Arrow connector */}
            {step.arrow && i < steps.length - 1 && (
              <div className="text-zinc-700 font-mono text-xs px-1">→</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

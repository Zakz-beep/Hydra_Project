// vrp-claude/app/components/greeks/GammaSimulator.tsx
"use client";

import React, { useState, useEffect } from "react";
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { fetchGreeksSimulator, GreeksSimulatorResponse, fmtGex } from "@/app/lib/greeks";

type Profile = "gex" | "vanna" | "charm";

interface ProfileConfig {
  label: string;
  origKey: "orig_gex" | "orig_vanna" | "orig_charm";
  simKey: "sim_gex" | "sim_vanna" | "sim_charm";
  totalOrig: "total_orig_gex" | "total_orig_vanna" | "total_orig_charm";
  totalSim: "total_sim_gex" | "total_sim_vanna" | "total_sim_charm";
  origColor: string;
  simColor: string;
  origFill: string;
  simFill: string;
  unit: string;
  description: string;
  icon: string;
  accentBg: string;
  accentBorder: string;
  accentText: string;
  glowColor: string;
}

const PROFILES: Record<Profile, ProfileConfig> = {
  gex: {
    label: "GEX Profile",
    origKey: "orig_gex",
    simKey: "sim_gex",
    totalOrig: "total_orig_gex",
    totalSim: "total_sim_gex",
    origColor: "#475569",
    simColor: "#38bdf8",
    origFill: "#334155",
    simFill: "#0ea5e9",
    unit: "GEX",
    description: "Dealer Gamma Exposure — hedging flow per 1% spot move",
    icon: "γ",
    accentBg: "rgba(14,165,233,0.08)",
    accentBorder: "rgba(14,165,233,0.25)",
    accentText: "#38bdf8",
    glowColor: "0 0 20px rgba(14,165,233,0.15)",
  },
  vanna: {
    label: "Vanna Profile",
    origKey: "orig_vanna",
    simKey: "sim_vanna",
    totalOrig: "total_orig_vanna",
    totalSim: "total_sim_vanna",
    origColor: "#4c1d95",
    simColor: "#a78bfa",
    origFill: "#4c1d95",
    simFill: "#7c3aed",
    unit: "Vanna",
    description: "Delta sensitivity per 1% IV move — amplified by IV shift",
    icon: "ν",
    accentBg: "rgba(124,58,237,0.08)",
    accentBorder: "rgba(124,58,237,0.25)",
    accentText: "#a78bfa",
    glowColor: "0 0 20px rgba(124,58,237,0.15)",
  },
  charm: {
    label: "Charm Profile",
    origKey: "orig_charm",
    simKey: "sim_charm",
    totalOrig: "total_orig_charm",
    totalSim: "total_sim_charm",
    origColor: "#78350f",
    simColor: "#fbbf24",
    origFill: "#78350f",
    simFill: "#d97706",
    unit: "Charm",
    description: "Delta decay per day — accelerates near expiry",
    icon: "Χ",
    accentBg: "rgba(217,119,6,0.08)",
    accentBorder: "rgba(217,119,6,0.25)",
    accentText: "#fbbf24",
    glowColor: "0 0 20px rgba(217,119,6,0.15)",
  },
};

function CustomTooltip({ active, payload, label, profile }: any) {
  if (!active || !payload?.length) return null;
  const cfg = PROFILES[profile as Profile];
  return (
    <div style={{
      background: "rgba(9,9,11,0.97)",
      border: `1px solid ${cfg.accentBorder}`,
      borderRadius: 12,
      padding: "10px 14px",
      boxShadow: cfg.glowColor,
      fontFamily: "monospace",
    }}>
      <p style={{ color: "#71717a", fontSize: 10, marginBottom: 8 }}>
        Strike: <span style={{ color: "#e4e4e7", fontWeight: 700 }}>{label}</span>
      </p>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.color, flexShrink: 0, display: "inline-block" }} />
          <span style={{ color: "#71717a", fontSize: 10 }}>{p.name}</span>
          <span style={{ marginLeft: "auto", fontWeight: 700, color: p.color, fontSize: 11 }}>{fmtGex(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function SliderControl({
  label, sublabel, value, min, max, step, onChange, accentColor, displayFn, icon,
}: {
  label: string; sublabel?: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; accentColor: string;
  displayFn: (v: number) => string; icon: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13 }}>{icon}</span>
          <div>
            <p style={{ color: "#d4d4d8", fontSize: 11, fontWeight: 600, fontFamily: "monospace" }}>{label}</p>
            {sublabel && <p style={{ color: "#52525b", fontSize: 9, fontFamily: "monospace" }}>{sublabel}</p>}
          </div>
        </div>
        <div style={{
          background: `${accentColor}18`,
          border: `1px solid ${accentColor}40`,
          borderRadius: 8,
          padding: "3px 10px",
          fontFamily: "monospace",
          fontSize: 12,
          fontWeight: 700,
          color: accentColor,
          minWidth: 54,
          textAlign: "center",
        }}>
          {displayFn(value)}
        </div>
      </div>
      <div style={{ position: "relative", height: 6 }}>
        <div style={{
          position: "absolute", top: 1, left: 0, right: 0, height: 4,
          borderRadius: 4, background: "#27272a",
        }} />
        <div style={{
          position: "absolute", top: 1, left: 0, width: `${pct}%`, height: 4,
          borderRadius: 4, background: `linear-gradient(90deg, ${accentColor}60, ${accentColor})`,
          transition: "width 0.1s ease",
        }} />
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            opacity: 0, cursor: "pointer", margin: 0,
          }}
        />
        <div style={{
          position: "absolute", top: "50%", left: `${pct}%`,
          transform: "translate(-50%, -50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: accentColor,
          boxShadow: `0 0 8px ${accentColor}80`,
          border: "2px solid #09090b",
          transition: "left 0.1s ease",
          pointerEvents: "none",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#3f3f46", fontFamily: "monospace" }}>
        <span>{min}{min === 0 ? "d" : "%"}</span>
        {min < 0 && <span>0%</span>}
        <span>{max > 0 && max !== 30 ? "+" : ""}{max}{max === 30 ? "d" : "%"}</span>
      </div>
    </div>
  );
}

function MetricBadge({ label, orig, sim }: { label: string; orig: number; sim: number }) {
  const delta = sim - orig;
  const isPos = delta > 0;
  const isZero = Math.abs(delta) < 1e-8;
  return (
    <div style={{
      background: "rgba(24,24,27,0.9)",
      border: "1px solid #27272a",
      borderRadius: 12,
      padding: "10px 14px",
      minWidth: 110,
    }}>
      <p style={{ color: "#52525b", fontSize: 9, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</p>
      <p style={{ color: "#f4f4f5", fontSize: 14, fontFamily: "monospace", fontWeight: 700, marginBottom: 2 }}>{fmtGex(sim)}</p>
      {!isZero && (
        <p style={{ color: isPos ? "#34d399" : "#f87171", fontSize: 10, fontFamily: "monospace", fontWeight: 600 }}>
          {isPos ? "▲" : "▼"} {fmtGex(Math.abs(delta))}
        </p>
      )}
      <p style={{ color: "#3f3f46", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>base: {fmtGex(orig)}</p>
    </div>
  );
}

export default function GammaSimulator({ ticker }: { ticker: string }) {
  const [data, setData] = useState<GreeksSimulatorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<Profile>("gex");
  const [spotShift, setSpotShift] = useState(0);
  const [ivShift, setIvShift] = useState(0);
  const [daysForward, setDaysForward] = useState(0);

  const anyShifted = spotShift !== 0 || ivShift !== 0 || daysForward !== 0;
  const cfg = PROFILES[activeProfile];

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      fetchGreeksSimulator(ticker, spotShift, ivShift, daysForward)
        .then((res) => { if (active) { setData(res); setLoading(false); setError(null); } })
        .catch((err) => { if (active) { console.error(err); setError("Failed to fetch simulator data"); setLoading(false); } });
    }, 320);
    return () => { active = false; clearTimeout(timer); };
  }, [ticker, spotShift, ivShift, daysForward]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: cfg.accentBg,
              backgroundColor: cfg.accentBg,
              border: `1px solid ${cfg.accentBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: cfg.accentText,
              boxShadow: cfg.glowColor,
              transition: "all 0.3s ease",
            }}>⚡</div>
            <div>
              <h2 style={{ color: "#f4f4f5", fontSize: 15, fontWeight: 700, margin: 0, fontFamily: "monospace" }}>
                Greeks Scenario Simulator
              </h2>
              <p style={{ color: "#52525b", fontSize: 10, fontFamily: "monospace", margin: 0 }}>
                BSM re-computation · {ticker}
              </p>
            </div>
          </div>
        </div>

        {/* Profile Tabs */}
        <div style={{ display: "flex", gap: 4, background: "rgba(24,24,27,0.8)", border: "1px solid #27272a", borderRadius: 12, padding: 4 }}>
          {(Object.entries(PROFILES) as [Profile, ProfileConfig][]).map(([key, pcfg]) => {
            const isActive = activeProfile === key;
            return (
              <button
                key={key}
                onClick={() => setActiveProfile(key)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 8,
                  fontFamily: "monospace", fontSize: 11, fontWeight: 600,
                  border: isActive ? `1px solid ${pcfg.accentBorder}` : "1px solid transparent",
                  background: isActive ? pcfg.accentBg : "transparent",
                  color: isActive ? pcfg.accentText : "#52525b",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  boxShadow: isActive ? pcfg.glowColor : "none",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ fontSize: 14 }}>{pcfg.icon}</span>
                <span>{pcfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 3fr", gap: 16 }}>

        {/* ── Controls Panel ── */}
        <div style={{
          background: "rgba(9,9,11,0.7)",
          border: "1px solid #1c1c1f",
          borderRadius: 16,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          backdropFilter: "blur(8px)",
        }}>

          {/* Profile description chip */}
          <div style={{
            background: cfg.accentBg,
            border: `1px solid ${cfg.accentBorder}`,
            borderRadius: 10,
            padding: "10px 12px",
            boxShadow: cfg.glowColor,
            transition: "all 0.3s ease",
          }}>
            <p style={{ color: cfg.accentText, fontSize: 11, fontFamily: "monospace", fontWeight: 700, marginBottom: 4 }}>{cfg.label}</p>
            <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", lineHeight: 1.5 }}>{cfg.description}</p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <SliderControl
              label="Spot Shift" sublabel="Price scenario" icon="📈"
              value={spotShift} min={-10} max={10} step={0.5}
              onChange={setSpotShift} accentColor="#38bdf8"
              displayFn={(v) => `${v > 0 ? "+" : ""}${v}%`}
            />
            <SliderControl
              label="IV Shift" sublabel="Volatility scenario" icon="📊"
              value={ivShift} min={-50} max={50} step={1}
              onChange={setIvShift} accentColor="#a78bfa"
              displayFn={(v) => `${v > 0 ? "+" : ""}${v}%`}
            />
            <SliderControl
              label="Days Forward" sublabel="Time decay scenario" icon="⏱"
              value={daysForward} min={0} max={30} step={1}
              onChange={setDaysForward} accentColor="#fbbf24"
              displayFn={(v) => `+${v}d`}
            />
          </div>

          {/* Active scenario pills */}
          {anyShifted && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {spotShift !== 0 && (
                <span style={{
                  background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.25)",
                  borderRadius: 20, padding: "3px 10px", color: "#38bdf8",
                  fontSize: 9, fontFamily: "monospace",
                }}>
                  Spot {spotShift > 0 ? "+" : ""}{spotShift}%{data?.new_spot ? ` → $${data.new_spot.toFixed(2)}` : ""}
                </span>
              )}
              {ivShift !== 0 && (
                <span style={{
                  background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)",
                  borderRadius: 20, padding: "3px 10px", color: "#a78bfa",
                  fontSize: 9, fontFamily: "monospace",
                }}>
                  IV {ivShift > 0 ? "+" : ""}{ivShift}%
                </span>
              )}
              {daysForward > 0 && (
                <span style={{
                  background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
                  borderRadius: 20, padding: "3px 10px", color: "#fbbf24",
                  fontSize: 9, fontFamily: "monospace",
                }}>
                  +{daysForward}d
                </span>
              )}
            </div>
          )}

          {/* Reset button */}
          <button
            onClick={() => { setSpotShift(0); setIvShift(0); setDaysForward(0); }}
            disabled={!anyShifted}
            style={{
              marginTop: "auto",
              width: "100%",
              padding: "10px 0",
              background: anyShifted ? "rgba(39,39,42,0.9)" : "rgba(24,24,27,0.5)",
              border: anyShifted ? "1px solid #3f3f46" : "1px solid #27272a",
              borderRadius: 10,
              color: anyShifted ? "#d4d4d8" : "#3f3f46",
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 600,
              cursor: anyShifted ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
            }}
          >
            ↺ Reset to Baseline
          </button>
        </div>

        {/* ── Chart Panel ── */}
        <div style={{
          background: "rgba(9,9,11,0.7)",
          border: "1px solid #1c1c1f",
          borderRadius: 16,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          position: "relative",
          minHeight: 460,
          backdropFilter: "blur(8px)",
        }}>

          {/* Loading overlay */}
          {loading && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(9,9,11,0.7)", backdropFilter: "blur(4px)",
              borderRadius: 16, flexDirection: "column", gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                border: `2px solid ${cfg.accentText}`,
                borderTopColor: "transparent",
                animation: "spin 0.8s linear infinite",
              }} />
              <span style={{ color: "#52525b", fontSize: 10, fontFamily: "monospace" }}>Recalculating BSM…</span>
            </div>
          )}

          {/* Chart header with metrics */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h3 style={{ color: "#f4f4f5", fontSize: 13, fontWeight: 700, margin: 0, fontFamily: "monospace" }}>
                {cfg.label} — Strike Distribution
              </h3>
              <p style={{ color: "#3f3f46", fontSize: 10, fontFamily: "monospace", marginTop: 3 }}>
                Baseline <span style={{ color: "#52525b" }}>vs</span> Simulated exposure across all active strikes
              </p>
            </div>
            {data && (
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <MetricBadge label="Net Shift" orig={data[cfg.totalOrig]} sim={data[cfg.totalSim]} />
                {activeProfile === "gex" && (
                  <MetricBadge label="γ-Flip" orig={data.orig_gamma_flip ?? 0} sim={data.sim_gamma_flip ?? 0} />
                )}
              </div>
            )}
          </div>

          {/* Chart */}
          <div style={{ flex: 1, minHeight: 300 }}>
            {error && !data && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#f87171", fontSize: 11, fontFamily: "monospace" }}>
                ⚠ {error}
              </div>
            )}
            {data?.chart_data && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.chart_data} margin={{ top: 10, right: 16, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradOrig" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cfg.origFill} stopOpacity={0.5} />
                      <stop offset="95%" stopColor={cfg.origFill} stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="gradSim" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cfg.simFill} stopOpacity={0.75} />
                      <stop offset="95%" stopColor={cfg.simFill} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#18181b" vertical={false} />
                  <XAxis
                    dataKey="strike" type="number"
                    domain={["dataMin", "dataMax"]}
                    stroke="#27272a"
                    tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                    tickFormatter={(v) => v.toLocaleString()} tickLine={false}
                  />
                  <YAxis
                    stroke="#27272a"
                    tick={{ fill: "#52525b", fontSize: 10, fontFamily: "monospace" }}
                    tickLine={false} axisLine={false}
                    tickFormatter={(v) => fmtGex(v)} width={72}
                  />
                  <Tooltip content={<CustomTooltip profile={activeProfile} />} cursor={{ stroke: "#3f3f46", strokeWidth: 1, strokeDasharray: "4 4" }} />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace", color: "#52525b", paddingTop: 8 }} />

                  <ReferenceLine y={0} stroke="#27272a" strokeWidth={1} />
                  {data.orig_spot && (
                    <ReferenceLine x={data.orig_spot} stroke="#3f3f46" strokeDasharray="4 4"
                      label={{ value: "Orig Spot", position: "top", fill: "#52525b", fontSize: 9, fontFamily: "monospace" }} />
                  )}
                  {data.new_spot && spotShift !== 0 && (
                    <ReferenceLine x={data.new_spot} stroke="#38bdf8" strokeDasharray="3 3"
                      label={{ value: "Sim Spot", position: "top", fill: "#38bdf8", fontSize: 9, fontFamily: "monospace" }} />
                  )}
                  {activeProfile === "gex" && data.orig_gamma_flip && (
                    <ReferenceLine x={data.orig_gamma_flip} stroke="#b45309" strokeDasharray="3 3"
                      label={{ value: "Orig Flip", position: "insideBottomRight", fill: "#d97706", fontSize: 9, fontFamily: "monospace" }} />
                  )}
                  {activeProfile === "gex" && data.sim_gamma_flip && anyShifted && (
                    <ReferenceLine x={data.sim_gamma_flip} stroke="#fbbf24"
                      label={{ value: "Sim Flip", position: "insideBottomLeft", fill: "#fef08a", fontSize: 9, fontFamily: "monospace" }} />
                  )}

                  <Area type="monotone" dataKey={cfg.origKey}
                    name={`Baseline ${cfg.unit}`}
                    stroke={cfg.origColor} fill="url(#gradOrig)"
                    fillOpacity={1} strokeWidth={1.5} dot={false}
                    activeDot={{ r: 3, fill: cfg.origColor }}
                  />
                  <Area type="monotone" dataKey={cfg.simKey}
                    name={`Simulated ${cfg.unit}`}
                    stroke={cfg.simColor} fill="url(#gradSim)"
                    fillOpacity={1} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, fill: cfg.simColor }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #18181b", paddingTop: 10 }}>
            <span style={{ color: "#27272a", fontSize: 9, fontFamily: "monospace" }}>
              Source: BSM re-compute · options chain snapshot
            </span>
            {data?.timestamp && (
              <span style={{ color: "#27272a", fontSize: 9, fontFamily: "monospace" }}>
                snap: {new Date(data.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

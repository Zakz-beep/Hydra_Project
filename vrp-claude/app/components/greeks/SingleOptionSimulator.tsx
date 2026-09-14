"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { GreeksSnapshot, StrikeGreeks, fetchBSM, SingleBSMResponse, fetchBSMCurve, BSMCurveResponse } from "@/app/lib/greeks";

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

function GreekCard({ label, orig, sim, color }: { label: string; orig: number; sim: number; color: string }) {
  const delta = sim - orig;
  const isPos = delta > 0;
  const isZero = Math.abs(delta) < 1e-8;

  // Formatting for small/large values
  const fmt = (v: number) => {
    if (v === undefined || v === null || isNaN(v)) return "--";
    if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2);
    if (Math.abs(v) > 1000) return v.toFixed(0);
    return v.toFixed(4);
  };

  return (
    <div style={{
      background: "rgba(24,24,27,0.7)",
      border: `1px solid ${color}40`,
      borderRadius: 12,
      padding: "12px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      position: "relative",
      overflow: "hidden"
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: color
      }} />
      <p style={{ color: "#a1a1aa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 8 }}>{label}</p>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingLeft: 8 }}>
        <div>
          <p style={{ color: "#f4f4f5", fontSize: 16, fontFamily: "monospace", fontWeight: 700 }}>{fmt(sim)}</p>
          <p style={{ color: "#52525b", fontSize: 10, fontFamily: "monospace", marginTop: 2 }}>base: {fmt(orig)}</p>
        </div>
        
        {!isZero && (
          <div style={{ 
            background: isPos ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
            color: isPos ? "#34d399" : "#f87171",
            padding: "2px 6px",
            borderRadius: 6,
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4
          }}>
            <span>{isPos ? "▲" : "▼"}</span>
            <span>{fmt(Math.abs(delta))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SingleOptionSimulator({ greeksData }: { greeksData: GreeksSnapshot | null }) {
  const [selectedBucket, setSelectedBucket] = useState<string>("");
  const [selectedStrike, setSelectedStrike] = useState<number>(0);
  const [selectedType, setSelectedType] = useState<string>("call");

  const [spotShift, setSpotShift] = useState(0);
  const [ivShift, setIvShift] = useState(0);
  const [daysForward, setDaysForward] = useState(0);

  const [simResult, setSimResult] = useState<SingleBSMResponse | null>(null);
  const [curveData, setCurveData] = useState<BSMCurveResponse | null>(null);
  const [selectedGreek, setSelectedGreek] = useState<keyof SingleBSMResponse>("delta");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live Mode states
  const [isLive, setIsLive] = useState(false);
  const [liveSpot, setLiveSpot] = useState<number | null>(null);

  const buckets = useMemo(() => {
    if (!greeksData?.by_expiry) return [];
    return Object.entries(greeksData.by_expiry).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [greeksData]);

  // Set defaults when data arrives
  useEffect(() => {
    if (buckets.length > 0 && !selectedBucket) {
      const first = buckets[0];
      setSelectedBucket(first[0]);
      const strikes = first[1].strikes || [];
      if (strikes.length > 0) {
        // Find ATM strike (closest to spot)
        const spot = greeksData?.spot || 0;
        const atm = strikes.reduce((prev, curr) => 
          Math.abs(curr.strike - spot) < Math.abs(prev.strike - spot) ? curr : prev
        );
        setSelectedStrike(atm.strike);
      }
    }
  }, [buckets, selectedBucket, greeksData?.spot]);

  const activeStrikes = useMemo(() => {
    if (!selectedBucket || !greeksData?.by_expiry) return [];
    return greeksData.by_expiry[selectedBucket]?.strikes || [];
  }, [selectedBucket, greeksData]);

  const availableStrikePrices = useMemo(() => {
    const unique = Array.from(new Set(activeStrikes.map(s => s.strike)));
    return unique.sort((a, b) => a - b);
  }, [activeStrikes]);

  const currentOption = useMemo(() => {
    return activeStrikes.find(s => s.strike === selectedStrike && s.option_type === selectedType);
  }, [activeStrikes, selectedStrike, selectedType]);

  const anyShifted = spotShift !== 0 || ivShift !== 0 || daysForward !== 0;

  useEffect(() => {
    let active = true;
    
    if (!currentOption || !greeksData) {
      setSimResult(null);
      setCurveData(null);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      const newSpot = greeksData.spot * (1 + spotShift / 100);
      const newIv = Math.max(currentOption.iv * (1 + ivShift / 100), 0.01);
      const newDte = Math.max(currentOption.dte - daysForward, 0.001);

      const pBsm = anyShifted ? fetchBSM(newSpot, currentOption.strike, newDte, newIv, currentOption.option_type) : Promise.resolve({
        price: currentOption.mid_price,
        delta: currentOption.delta,
        gamma: currentOption.gamma,
        theta: currentOption.theta,
        vega: currentOption.vega,
        rho: currentOption.rho,
        vanna: currentOption.vanna,
        charm: currentOption.charm,
      });

      const pCurve = fetchBSMCurve(newSpot, currentOption.strike, newDte, newIv, currentOption.option_type, 0.15, 30);

      Promise.all([pBsm, pCurve])
        .then(([resBSM, resCurve]) => {
          if (active) {
            setSimResult(resBSM);
            setCurveData(resCurve);
            setLoading(false);
            setError(null);
          }
        })
        .catch(err => {
          if (active) {
            console.error(err);
            setError("Failed to simulate option");
            setLoading(false);
          }
        });
    }, 320);

    return () => { active = false; clearTimeout(timer); };
  }, [currentOption, greeksData, spotShift, ivShift, daysForward, anyShifted]);

  // Live Mode Effect
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLive && greeksData?.ticker) {
      const fetchLive = async () => {
        try {
          const res = await fetch(`/api/yahoo?ticker=${greeksData.ticker}&range=1d&interval=1m`, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          const currentPrice = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (currentPrice && greeksData.spot) {
            setLiveSpot(currentPrice);
            // Auto-adjust spotShift based on live price vs base spot
            const newShift = ((currentPrice / greeksData.spot) - 1) * 100;
            setSpotShift(parseFloat(newShift.toFixed(2)));
          }
        } catch (err) {
          console.error("Failed to fetch live spot", err);
        }
      };
      
      // Fetch immediately, then every 3 seconds
      fetchLive();
      interval = setInterval(fetchLive, 3000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLive, greeksData?.ticker, greeksData?.spot]);

  if (!greeksData) return <div style={{ color: "#a1a1aa", fontSize: 12, padding: 20 }}>Waiting for data...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Selection Bar ── */}
      <div style={{ 
        display: "flex", flexWrap: "wrap", gap: 16, 
        background: "rgba(9,9,11,0.7)", border: "1px solid #27272a", 
        padding: "16px 20px", borderRadius: 16, alignItems: "center"
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Expiry Bucket</label>
          <select 
            value={selectedBucket} 
            onChange={e => {
              setSelectedBucket(e.target.value);
              // reset strike logic can go here if needed, but keeping it simple
            }}
            style={{ 
              background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5", 
              padding: "6px 12px", borderRadius: 8, fontFamily: "monospace", fontSize: 13, outline: "none"
            }}
          >
            {buckets.map(([key, b]) => (
              <option key={key} value={key}>{key}DTE ({b.expiry_dates[0] || 'Mixed'})</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Strike Price</label>
          <select 
            value={selectedStrike} 
            onChange={e => setSelectedStrike(Number(e.target.value))}
            style={{ 
              background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5", 
              padding: "6px 12px", borderRadius: 8, fontFamily: "monospace", fontSize: 13, outline: "none"
            }}
          >
            {availableStrikePrices.map(k => (
              <option key={k} value={k}>${k ? k.toFixed(1) : k} {k === Math.round(greeksData.spot || 0) ? '(ATM)' : ''}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Option Type</label>
          <div style={{ display: "flex", background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, padding: 2 }}>
            <button
              onClick={() => setSelectedType("call")}
              style={{
                padding: "4px 16px", borderRadius: 6, fontFamily: "monospace", fontSize: 13, fontWeight: 600,
                background: selectedType === "call" ? "#34d399" : "transparent",
                color: selectedType === "call" ? "#022c22" : "#a1a1aa",
                border: "none", cursor: "pointer", transition: "all 0.2s ease"
              }}
            >
              CALL
            </button>
            <button
              onClick={() => setSelectedType("put")}
              style={{
                padding: "4px 16px", borderRadius: 6, fontFamily: "monospace", fontSize: 13, fontWeight: 600,
                background: selectedType === "put" ? "#f87171" : "transparent",
                color: selectedType === "put" ? "#450a0a" : "#a1a1aa",
                border: "none", cursor: "pointer", transition: "all 0.2s ease"
              }}
            >
              PUT
            </button>
          </div>
        </div>

        {/* Selected Option Summary */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Spot Price</p>
            <p style={{ color: "#38bdf8", fontSize: 15, fontFamily: "monospace", fontWeight: 700 }}>${greeksData.spot ? greeksData.spot.toFixed(2) : "--"}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Selected IV</p>
            <p style={{ color: "#a78bfa", fontSize: 15, fontFamily: "monospace", fontWeight: 700 }}>
              {currentOption?.iv !== undefined ? (currentOption.iv * 100).toFixed(1) + "%" : "--"}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Mid Price</p>
            <p style={{ color: "#fbbf24", fontSize: 15, fontFamily: "monospace", fontWeight: 700 }}>
              {currentOption?.mid_price !== undefined ? "$" + currentOption.mid_price.toFixed(2) : "--"}
            </p>
          </div>
        </div>
      </div>

      {!currentOption ? (
        <div style={{ padding: 40, textAlign: "center", background: "rgba(9,9,11,0.5)", border: "1px dashed #27272a", borderRadius: 16, color: "#71717a", fontFamily: "monospace" }}>
          Selected contract is not available in the active snapshot. Try changing Strike or Option Type.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
          
          {/* ── Controls Panel ── */}
          <div style={{
            background: "rgba(9,9,11,0.7)", border: "1px solid #1c1c1f", borderRadius: 16,
            padding: 20, display: "flex", flexDirection: "column", gap: 24, backdropFilter: "blur(8px)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ color: "#f4f4f5", fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", fontFamily: "monospace" }}>
                  Simulation Controls
                </h3>
                <p style={{ color: "#71717a", fontSize: 11, fontFamily: "monospace", margin: 0 }}>
                  Adjust parameters to see how first-order Greeks react.
                </p>
              </div>
              
              {/* Live Mode Toggle */}
              <button 
                onClick={() => {
                  setIsLive(!isLive);
                  if (isLive) {
                    // Reset when turning off
                    setLiveSpot(null);
                    setSpotShift(0);
                    setIvShift(0);
                    setDaysForward(0);
                  } else {
                    // Reset IV and DTE when turning on
                    setIvShift(0);
                    setDaysForward(0);
                  }
                }}
                style={{
                  background: isLive ? "rgba(52,211,153,0.15)" : "rgba(39,39,42,0.8)",
                  border: isLive ? "1px solid rgba(52,211,153,0.4)" : "1px solid #3f3f46",
                  color: isLive ? "#34d399" : "#a1a1aa",
                  padding: "4px 12px", borderRadius: 8, fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s"
                }}
              >
                <div style={{ 
                  width: 6, height: 6, borderRadius: "50%", 
                  background: isLive ? "#34d399" : "#52525b",
                  boxShadow: isLive ? "0 0 8px #34d399" : "none",
                  animation: isLive ? "pulse 1.5s infinite" : "none"
                }} />
                {isLive ? "LIVE TICK" : "MANUAL"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 24, opacity: isLive ? 0.6 : 1, pointerEvents: isLive ? "none" : "auto" }}>
              <SliderControl
                label="Spot Shift" sublabel={`Base: $${greeksData.spot ? greeksData.spot.toFixed(2) : 0}`} icon="📈"
                value={spotShift} min={-10} max={10} step={0.5}
                onChange={setSpotShift} accentColor="#38bdf8"
                displayFn={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <SliderControl
                label="IV Shift" sublabel={`Base: ${currentOption?.iv !== undefined ? (currentOption.iv * 100).toFixed(1) : 0}%`} icon="📊"
                value={ivShift} min={-50} max={50} step={1}
                onChange={setIvShift} accentColor="#a78bfa"
                displayFn={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <SliderControl
                label="Days Forward" sublabel={`Base: ${currentOption.dte} DTE`} icon="⏱"
                value={daysForward} min={0} max={Math.max(1, currentOption.dte)} step={1}
                onChange={setDaysForward} accentColor="#fbbf24"
                displayFn={(v) => `+${v}d`}
              />
            </div>

            <button
              onClick={() => { setSpotShift(0); setIvShift(0); setDaysForward(0); }}
              disabled={!anyShifted}
              style={{
                marginTop: "auto", width: "100%", padding: "10px 0",
                background: anyShifted ? "rgba(39,39,42,0.9)" : "rgba(24,24,27,0.5)",
                border: anyShifted ? "1px solid #3f3f46" : "1px solid #27272a",
                borderRadius: 10, color: anyShifted ? "#d4d4d8" : "#3f3f46",
                fontFamily: "monospace", fontSize: 11, fontWeight: 600,
                cursor: anyShifted ? "pointer" : "not-allowed", transition: "all 0.2s ease",
              }}
            >
              ↺ Reset to Baseline
            </button>
          </div>

          {/* ── Results Panel ── */}
          <div style={{
            background: "rgba(9,9,11,0.7)", border: "1px solid #1c1c1f", borderRadius: 16,
            padding: 24, position: "relative", backdropFilter: "blur(8px)",
          }}>
            {loading && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(9,9,11,0.7)", backdropFilter: "blur(4px)",
                borderRadius: 16, flexDirection: "column", gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%",
                  border: `2px solid #a78bfa`, borderTopColor: "transparent",
                  animation: "spin 0.8s linear infinite",
                }} />
                <span style={{ color: "#a78bfa", fontSize: 10, fontFamily: "monospace" }}>Re-pricing BSM Engine...</span>
              </div>
            )}

            <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ color: "#f4f4f5", fontSize: 15, fontWeight: 700, margin: "0 0 4px 0", fontFamily: "monospace" }}>
                  First-Order Greeks
                </h3>
                <p style={{ color: "#71717a", fontSize: 11, fontFamily: "monospace", margin: 0 }}>
                  <span style={{ color: "#38bdf8" }}>{selectedType.toUpperCase()} {selectedStrike}</span> • {currentOption.expiry.substring(0,10)}
                </p>
              </div>
              {anyShifted && (
                <div style={{ display: "flex", gap: 8 }}>
                   <div style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 6, padding: "4px 8px", color: "#38bdf8", fontSize: 10, fontFamily: "monospace" }}>
                     S: ${(greeksData.spot ? greeksData.spot * (1 + spotShift / 100) : 0).toFixed(2)}
                   </div>
                   <div style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6, padding: "4px 8px", color: "#a78bfa", fontSize: 10, fontFamily: "monospace" }}>
                     IV: {currentOption?.iv !== undefined ? (currentOption.iv * 100 + ivShift).toFixed(1) : 0}%
                   </div>
                   <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "4px 8px", color: "#fbbf24", fontSize: 10, fontFamily: "monospace" }}>
                     DTE: {Math.max(currentOption.dte - daysForward, 0)}
                   </div>
                </div>
              )}
            </div>

            {error ? (
              <div style={{ padding: 20, color: "#f87171", fontFamily: "monospace", fontSize: 12 }}>{error}</div>
            ) : simResult ? (
              <>
                <div style={{ marginBottom: 16 }}>
                  <GreekCard label="Theoretical Price" orig={currentOption.mid_price} sim={simResult.price ?? currentOption.mid_price} color="#fbbf24" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <GreekCard label="Δ Delta" orig={currentOption.delta} sim={simResult.delta} color="#3b82f6" />
                  <GreekCard label="Γ Gamma" orig={currentOption.gamma} sim={simResult.gamma} color="#8b5cf6" />
                  <GreekCard label="Θ Theta" orig={currentOption.theta} sim={simResult.theta} color="#f59e0b" />
                  <GreekCard label="ν Vega" orig={currentOption.vega} sim={simResult.vega} color="#10b981" />
                  <GreekCard label="ρ Rho" orig={currentOption.rho} sim={simResult.rho} color="#6366f1" />
                </div>
              </>
            ) : null}

            {simResult && (
              <div style={{ marginTop: 24, borderTop: "1px solid #27272a", paddingTop: 16 }}>
                <h4 style={{ color: "#a1a1aa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Second-Order Exposures</h4>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <GreekCard label="Vanna (dΔ/dIV)" orig={currentOption.vanna} sim={simResult.vanna} color="#d946ef" />
                  <GreekCard label="Charm (dΔ/dT)" orig={currentOption.charm} sim={simResult.charm} color="#f43f5e" />
                </div>
              </div>
            )}

            {curveData && (
              <div style={{ marginTop: 24, borderTop: "1px solid #27272a", paddingTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <h4 style={{ color: "#a1a1aa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Greeks Curve Profile</h4>
                  <select
                    value={selectedGreek}
                    onChange={e => setSelectedGreek(e.target.value as keyof SingleBSMResponse)}
                    style={{
                      background: "rgba(39,39,42,0.5)", border: "1px solid #3f3f46", color: "#d4d4d8",
                      padding: "2px 8px", borderRadius: 6, fontFamily: "monospace", fontSize: 11, outline: "none"
                    }}
                  >
                    <option value="price">Price ($)</option>
                    <option value="delta">Delta (Δ)</option>
                    <option value="gamma">Gamma (Γ)</option>
                    <option value="theta">Theta (Θ)</option>
                    <option value="vega">Vega (ν)</option>
                    <option value="rho">Rho (ρ)</option>
                    <option value="vanna">Vanna</option>
                    <option value="charm">Charm</option>
                  </select>
                </div>
                
                <div style={{ height: 220, width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curveData.curve} margin={{ top: 10, right: 5, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                      <XAxis 
                        dataKey="spot" 
                        stroke="#52525b" 
                        fontSize={10} 
                        tickFormatter={(val) => `$${val}`}
                        domain={['dataMin', 'dataMax']}
                        type="number"
                      />
                      <YAxis 
                        stroke="#52525b" 
                        fontSize={10} 
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => Math.abs(val) < 0.01 && val !== 0 ? val.toExponential(1) : val.toFixed(3)}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'rgba(24,24,27,0.9)', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                        formatter={(value: number) => [value.toFixed(6), selectedGreek.toUpperCase()]}
                        labelFormatter={(label) => `Spot: $${label.toFixed(2)}`}
                      />
                      <ReferenceLine x={curveData.base_spot} stroke="#38bdf8" strokeDasharray="3 3" />
                      <Line 
                        type="monotone" 
                        dataKey={selectedGreek} 
                        stroke={{
                          price: "#fbbf24", delta: "#3b82f6", gamma: "#8b5cf6", theta: "#f59e0b",
                          vega: "#10b981", rho: "#6366f1", vanna: "#d946ef", charm: "#f43f5e"
                        }[selectedGreek] || "#a78bfa"} 
                        strokeWidth={2} 
                        dot={false} 
                        activeDot={{ 
                          r: 4, 
                          fill: {
                            price: "#fbbf24", delta: "#3b82f6", gamma: "#8b5cf6", theta: "#f59e0b",
                            vega: "#10b981", rho: "#6366f1", vanna: "#d946ef", charm: "#f43f5e"
                          }[selectedGreek] || "#a78bfa", 
                          stroke: '#fff' 
                        }} 
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
      `}</style>
    </div>
  );
}

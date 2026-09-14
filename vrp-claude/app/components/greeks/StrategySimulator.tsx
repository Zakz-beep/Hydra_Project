"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";
import { GreeksSnapshot, StrikeGreeks, fetchBSM, SingleBSMResponse, fetchBSMCurve, BSMCurveResponse } from "@/app/lib/greeks";

function SliderControl({
  label, sublabel, value, min, max, step, onChange, accentColor, displayFn, icon, disabled
}: {
  label: string; sublabel?: string; value: number; min: number; max: number;
  step: number; onChange: (v: number) => void; accentColor: string;
  displayFn: (v: number) => string; icon: string; disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? "none" : "auto" }}>
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
            opacity: 0, cursor: disabled ? "not-allowed" : "pointer", margin: 0,
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

type Leg = { 
  strike: number; 
  type: "call" | "put"; 
  side: 1 | -1; 
  quantity: number;
  enabled: boolean;
  premiumOverride: number | null;
};

function getStrategyLegs(strategy: string, baseStrike: number, strikeOffset: number, availableStrikes: number[], singleType: "call" | "put"): Leg[] {
  const baseIdx = availableStrikes.indexOf(baseStrike);
  if (baseIdx === -1) return [];

  const getStrike = (offset: number) => {
    const idx = Math.max(0, Math.min(availableStrikes.length - 1, baseIdx + offset));
    return availableStrikes[idx];
  };

  const makeLeg = (strike: number, type: "call" | "put", side: 1 | -1, quantity: number): Leg => ({
    strike, type, side, quantity, enabled: true, premiumOverride: null
  });

  switch (strategy) {
    case "single":
      return [makeLeg(baseStrike, singleType, 1, 1)];
    case "straddle":
      return [
        makeLeg(baseStrike, "call", 1, 1),
        makeLeg(baseStrike, "put", 1, 1)
      ];
    case "strangle":
      return [
        makeLeg(getStrike(strikeOffset), "call", 1, 1),
        makeLeg(getStrike(-strikeOffset), "put", 1, 1)
      ];
    case "bull_call":
      return [
        makeLeg(baseStrike, "call", 1, 1),
        makeLeg(getStrike(strikeOffset), "call", -1, 1)
      ];
    case "bear_put":
      return [
        makeLeg(baseStrike, "put", 1, 1),
        makeLeg(getStrike(-strikeOffset), "put", -1, 1)
      ];
    case "iron_condor":
      return [
        makeLeg(getStrike(strikeOffset), "call", -1, 1),
        makeLeg(getStrike(strikeOffset + 1), "call", 1, 1),
        makeLeg(getStrike(-strikeOffset), "put", -1, 1),
        makeLeg(getStrike(-strikeOffset - 1), "put", 1, 1)
      ];
    case "iron_butterfly":
      return [
        makeLeg(baseStrike, "call", -1, 1),
        makeLeg(baseStrike, "put", -1, 1),
        makeLeg(getStrike(strikeOffset), "call", 1, 1),
        makeLeg(getStrike(-strikeOffset), "put", 1, 1)
      ];
    default:
      return [];
  }
}

// Standard normal cumulative distribution function approximation
function cdfNormal(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// Black-Scholes-Merton Option Pricing Model
function priceBSM(S: number, K: number, t: number, sigma: number, type: "call" | "put", r: number = 0.05): number {
  if (t <= 0) {
    return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  if (sigma <= 0) sigma = 0.001; // prevent division by zero
  
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * t) / (sigma * Math.sqrt(t));
  const d2 = d1 - sigma * Math.sqrt(t);
  
  if (type === "call") {
    return S * cdfNormal(d1) - K * Math.exp(-r * t) * cdfNormal(d2);
  } else {
    return K * Math.exp(-r * t) * cdfNormal(-d2) - S * cdfNormal(-d1);
  }
}

interface ExpirationMetrics {
  maxProfit: number | "Unlimited";
  maxLoss: number | "Unlimited";
  breakevens: number[];
  initialPremium: number;
}

function calculateExpirationMetrics(
  legs: Leg[],
  initialNetPremium: number,
  baseSpot: number
): ExpirationMetrics {
  if (legs.length === 0) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], initialPremium: 0 };
  }

  const getPayoff = (S: number) => {
    let payoff = 0;
    legs.forEach(leg => {
      const intrinsic = leg.type === "call" 
        ? Math.max(S - leg.strike, 0)
        : Math.max(leg.strike - S, 0);
      payoff += leg.side * leg.quantity * intrinsic;
    });
    return payoff - initialNetPremium;
  };

  const strikes = legs.map(l => l.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);

  const criticalSpots = Array.from(new Set([
    0,
    ...strikes,
    maxStrike * 3
  ])).sort((a, b) => a - b);

  const payoffs = criticalSpots.map(S => ({ spot: S, pnl: getPayoff(S) }));

  let maxP = -Infinity;
  let maxL = Infinity;
  
  const leftSlope = (payoffs[1].pnl - payoffs[0].pnl) / (payoffs[1].spot - payoffs[0].spot);
  const rightIdx = payoffs.length - 1;
  const rightSlope = (payoffs[rightIdx].pnl - payoffs[rightIdx - 1].pnl) / (payoffs[rightIdx].spot - payoffs[rightIdx - 1].spot);

  let isMaxProfitUnlimited = false;
  let isMaxLossUnlimited = false;

  if (leftSlope < -1e-4) {
    isMaxProfitUnlimited = true;
  } else if (leftSlope > 1e-4) {
    isMaxLossUnlimited = true;
  }

  if (rightSlope > 1e-4) {
    isMaxProfitUnlimited = true;
  } else if (rightSlope < -1e-4) {
    isMaxLossUnlimited = true;
  }

  payoffs.forEach((pt, i) => {
    if (i === rightIdx) {
      if (!isMaxProfitUnlimited && pt.pnl > maxP) maxP = pt.pnl;
      if (!isMaxLossUnlimited && pt.pnl < maxL) maxL = pt.pnl;
      return;
    }
    if (pt.pnl > maxP) maxP = pt.pnl;
    if (pt.pnl < maxL) maxL = pt.pnl;
  });

  const breakevens: number[] = [];
  for (let i = 0; i < payoffs.length - 1; i++) {
    const p1 = payoffs[i];
    const p2 = payoffs[i + 1];

    if ((p1.pnl <= 0 && p2.pnl >= 0) || (p1.pnl >= 0 && p2.pnl <= 0)) {
      const diffP = p2.pnl - p1.pnl;
      if (Math.abs(diffP) > 1e-8) {
        const t = -p1.pnl / diffP;
        const S_be = p1.spot + t * (p2.spot - p1.spot);
        if (S_be >= 0 && S_be < maxStrike * 2.5) {
          breakevens.push(S_be);
        }
      } else if (Math.abs(p1.pnl) < 1e-8) {
        if (p1.spot >= 0) breakevens.push(p1.spot);
      }
    }
  }

  const uniqueBE = Array.from(new Set(breakevens.map(val => parseFloat(val.toFixed(2))))).sort((a, b) => a - b);

  return {
    maxProfit: isMaxProfitUnlimited ? "Unlimited" : maxP,
    maxLoss: isMaxLossUnlimited ? "Unlimited" : maxL,
    breakevens: uniqueBE,
    initialPremium: initialNetPremium
  };
}

export default function StrategySimulator({ greeksData }: { greeksData: GreeksSnapshot | null }) {
  const [selectedBucket, setSelectedBucket] = useState<string>("");
  const [selectedStrike, setSelectedStrike] = useState<number>(0);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("single");
  const [selectedType, setSelectedType] = useState<"call" | "put">("call");
  const [strikeOffset, setStrikeOffset] = useState<number>(1);

  const [spotShift, setSpotShift] = useState(0);
  const [ivShift, setIvShift] = useState(0);
  const [daysForward, setDaysForward] = useState(0);

  const [simResult, setSimResult] = useState<any>(null);
  const [baseResult, setBaseResult] = useState<any>(null);
  const [curveData, setCurveData] = useState<BSMCurveResponse | null>(null);
  const [baselineCurveData, setBaselineCurveData] = useState<BSMCurveResponse | null>(null);
  const [activeLegs, setActiveLegs] = useState<Leg[]>([]);
  
  const [selectedCurveMetric, setSelectedCurveMetric] = useState<string>("pnl");

  // Reset sliders when underlying selections change to ensure baseline is re-fetched
  useEffect(() => {
    setSpotShift(0);
    setIvShift(0);
    setDaysForward(0);
  }, [selectedStrategy, selectedStrike, strikeOffset, selectedType, selectedBucket]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isLive, setIsLive] = useState(false);
  const [liveSpot, setLiveSpot] = useState<number | null>(null);
  const [showStressMatrix, setShowStressMatrix] = useState(false);

  // ── Derived States (hoisted to the top) ──
  const buckets = useMemo(() => {
    if (!greeksData?.by_expiry) return [];
    return Object.entries(greeksData.by_expiry).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [greeksData]);

  useEffect(() => {
    if (buckets.length > 0 && !selectedBucket) {
      const first = buckets[0];
      setSelectedBucket(first[0]);
      const strikes = first[1].strikes || [];
      if (strikes.length > 0) {
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

  const expMetrics = useMemo(() => {
    if (!activeLegs || activeLegs.length === 0 || !baseResult || !greeksData) return null;
    return calculateExpirationMetrics(activeLegs, baseResult.price, greeksData.spot);
  }, [activeLegs, baseResult?.price, greeksData?.spot]);

  const anyShifted = spotShift !== 0 || ivShift !== 0 || daysForward !== 0;

  // ── Implied Volatility & Spot Stress Matrix calculation ──
  const stressMatrixData = useMemo(() => {
    if (!activeLegs || activeLegs.length === 0 || !greeksData) return null;
    
    const spotShifts = [-5, -3, -1, 0, 1, 3, 5];
    const ivShifts = [15, 10, 5, 0, -5, -10, -15];
    
    const rows = ivShifts.map(ivShiftVal => {
      const cols = spotShifts.map(spotShiftVal => {
        let cellPnl = 0;
        activeLegs.forEach(leg => {
          if (!leg.enabled) return;
          const optionData = activeStrikes.find(s => s.strike === leg.strike && s.option_type === leg.type);
          if (!optionData) return;
          
          const S_shifted = greeksData.spot * (1 + spotShiftVal / 100);
          const iv_shifted = Math.max(optionData.iv * (1 + ivShiftVal / 100), 0.01);
          const dte_shifted = Math.max(optionData.dte - daysForward, 0.001);
          
          const price_sim = priceBSM(S_shifted, leg.strike, dte_shifted / 365, iv_shifted, leg.type, 0.05);
          const price_init = leg.premiumOverride !== null ? leg.premiumOverride : (optionData.mid_price ?? 0);
          
          cellPnl += leg.side * leg.quantity * (price_sim - price_init) * 100;
        });
        return {
          spotShift: spotShiftVal,
          ivShift: ivShiftVal,
          pnl: cellPnl
        };
      });
      return { ivShift: ivShiftVal, cols };
    });
    
    const allPnls = rows.flatMap(r => r.cols.map(c => c.pnl));
    const maxVal = Math.max(...allPnls, 1);
    const minVal = Math.min(...allPnls, -1);
    
    return { rows, maxVal, minVal, spotShifts, ivShifts };
  }, [activeLegs, activeStrikes, greeksData, daysForward]);

  // ── Helper functions for Interactive Leg Manager ──
  const toggleLegEnabled = (index: number) => {
    setActiveLegs(prev => prev.map((leg, idx) => idx === index ? { ...leg, enabled: !leg.enabled } : leg));
  };

  const toggleLegSide = (index: number) => {
    setActiveLegs(prev => prev.map((leg, idx) => idx === index ? { ...leg, side: leg.side > 0 ? -1 : 1 } : leg));
  };

  const adjustLegQty = (index: number, delta: number) => {
    setActiveLegs(prev => prev.map((leg, idx) => idx === index ? { ...leg, quantity: Math.max(1, leg.quantity + delta) } : leg));
  };

  const toggleLegType = (index: number) => {
    setActiveLegs(prev => prev.map((leg, idx) => idx === index ? { ...leg, type: leg.type === "call" ? "put" : "call" } : leg));
  };

  const adjustLegStrike = (index: number, direction: "up" | "down") => {
    setActiveLegs(prev => prev.map((leg, idx) => {
      if (idx !== index) return leg;
      const currentIdx = availableStrikePrices.indexOf(leg.strike);
      if (currentIdx === -1) return leg;
      const nextIdx = direction === "up" 
        ? Math.min(availableStrikePrices.length - 1, currentIdx + 1)
        : Math.max(0, currentIdx - 1);
      return { ...leg, strike: availableStrikePrices[nextIdx] };
    }));
  };

  const setLegPremiumOverride = (index: number, val: string) => {
    const parsed = val === "" ? null : parseFloat(val);
    setActiveLegs(prev => prev.map((leg, idx) => idx === index ? { ...leg, premiumOverride: isNaN(parsed as number) ? null : parsed } : leg));
  };

  // Template construction effect
  useEffect(() => {
    if (!selectedStrike || availableStrikePrices.length === 0) return;
    const template = getStrategyLegs(selectedStrategy, selectedStrike, strikeOffset, availableStrikePrices, selectedType);
    setActiveLegs(template);
  }, [selectedStrategy, selectedStrike, strikeOffset, selectedType, availableStrikePrices]);

  useEffect(() => {
    let active = true;
    
    if (activeLegs.length === 0 || !greeksData) {
      setSimResult(null);
      setCurveData(null);
      return;
    }

    const enabledLegs = activeLegs.filter(l => l.enabled);
    if (enabledLegs.length === 0) {
      setSimResult({ price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 });
      setBaseResult({ price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 });
      setCurveData({ base_spot: greeksData.spot, curve: [] } as any);
      return;
    }

    const timer = setTimeout(() => {
      setLoading(true);
      
      const legPromises = enabledLegs.map(leg => {
         const optionData = activeStrikes.find(s => s.strike === leg.strike && s.option_type === leg.type);
         if (!optionData) return Promise.resolve(null);
         
         const newSpot = greeksData.spot * (1 + spotShift / 100);
         const newIv = Math.max(optionData.iv * (1 + ivShift / 100), 0.01);
         const newDte = Math.max(optionData.dte - daysForward, 0.001);
         
         const pBsm = anyShifted ? fetchBSM(newSpot, leg.strike, newDte, newIv, leg.type) : Promise.resolve({
            price: optionData.mid_price,
            delta: optionData.delta,
            gamma: optionData.gamma,
            theta: optionData.theta,
            vega: optionData.vega,
            rho: optionData.rho,
            vanna: optionData.vanna,
            charm: optionData.charm,
         });
         
         const pCurve = fetchBSMCurve(newSpot, leg.strike, newDte, newIv, leg.type, 0.15, 30);
         
         return Promise.all([pBsm, pCurve]).then(([bsm, curve]) => ({ leg, bsm, curve, base: optionData }));
      });

      Promise.all(legPromises)
        .then((results) => {
          if (!active) return;
          if (results.some(r => r === null)) {
             setError("One or more required legs are not available for this strike combination.");
             setLoading(false);
             return;
          }
          
          const validResults = results as { leg: Leg; bsm: any; curve: BSMCurveResponse; base: StrikeGreeks }[];
          
          const netBsm = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 };
          const netBase = { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 };
          
          validResults.forEach(({ leg, bsm, base }) => {
             const m = leg.side * leg.quantity;
             const basePrice = leg.premiumOverride !== null ? leg.premiumOverride : (base.mid_price ?? 0);

             netBsm.price += (bsm.price ?? 0) * m;
             netBsm.delta += (bsm.delta ?? 0) * m;
             netBsm.gamma += (bsm.gamma ?? 0) * m;
             netBsm.theta += (bsm.theta ?? 0) * m;
             netBsm.vega += (bsm.vega ?? 0) * m;
             netBsm.rho += (bsm.rho ?? 0) * m;
             netBsm.vanna += (bsm.vanna ?? 0) * m;
             netBsm.charm += (bsm.charm ?? 0) * m;
             
             netBase.price += basePrice * m;
             netBase.delta += (base.delta ?? 0) * m;
             netBase.gamma += (base.gamma ?? 0) * m;
             netBase.theta += (base.theta ?? 0) * m;
             netBase.vega += (base.vega ?? 0) * m;
             netBase.rho += (base.rho ?? 0) * m;
             netBase.vanna += (base.vanna ?? 0) * m;
             netBase.charm += (base.charm ?? 0) * m;
          });
          
          const curveMap = new Map<string, any>();
          validResults.forEach(({ leg, curve }) => {
             const m = leg.side * leg.quantity;
             curve.curve.forEach(pt => {
                const s = pt.spot.toFixed(2);
                if (!curveMap.has(s)) {
                   curveMap.set(s, { spot: pt.spot, price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 });
                }
                const agg = curveMap.get(s);
                agg.price += (pt.price ?? 0) * m;
                agg.delta += (pt.delta ?? 0) * m;
                agg.gamma += (pt.gamma ?? 0) * m;
                agg.theta += (pt.theta ?? 0) * m;
                agg.vega += (pt.vega ?? 0) * m;
                agg.rho += (pt.rho ?? 0) * m;
                agg.vanna += (pt.vanna ?? 0) * m;
                agg.charm += (pt.charm ?? 0) * m;
             });
          });
          
          const netCurveList = Array.from(curveMap.values()).sort((a,b) => a.spot - b.spot);
          
          netCurveList.forEach(pt => {
             pt.pnl = pt.price - netBase.price;
          });
          
          setSimResult(netBsm);
          setBaseResult(netBase);
          setCurveData({ base_spot: validResults[0].curve.base_spot, curve: netCurveList } as BSMCurveResponse);
          if (!anyShifted) {
             setBaselineCurveData({ base_spot: validResults[0].curve.base_spot, curve: netCurveList } as BSMCurveResponse);
          }
          setLoading(false);
          setError(null);
        })
        .catch(err => {
          if (active) {
            console.error(err);
            setError("Failed to simulate strategy.");
            setLoading(false);
          }
        });
    }, 320);

    return () => { active = false; clearTimeout(timer); };
  }, [activeLegs, activeStrikes, spotShift, ivShift, daysForward, anyShifted, greeksData]);

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
            const newShift = ((currentPrice / greeksData.spot) - 1) * 100;
            setSpotShift(parseFloat(newShift.toFixed(2)));
          }
        } catch (err) {
          console.error("Failed to fetch live spot", err);
        }
      };
      fetchLive();
      interval = setInterval(fetchLive, 3000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isLive, greeksData?.ticker, greeksData?.spot]);

  if (!greeksData) {
    return <div style={{ color: "#a1a1aa", fontSize: 12, padding: 20 }}>Waiting for data...</div>;
  }

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
            onChange={e => setSelectedBucket(e.target.value)}
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
          <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Strategy</label>
          <select 
            value={selectedStrategy} 
            onChange={e => setSelectedStrategy(e.target.value)}
            style={{ 
              background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5", 
              padding: "6px 12px", borderRadius: 8, fontFamily: "monospace", fontSize: 13, outline: "none"
            }}
          >
            <option value="single">Single Leg</option>
            <option value="straddle">Straddle</option>
            <option value="strangle">Strangle</option>
            <option value="bull_call">Bull Call Spread</option>
            <option value="bear_put">Bear Put Spread</option>
            <option value="iron_condor">Iron Condor</option>
            <option value="iron_butterfly">Iron Butterfly</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Base Strike (ATM)</label>
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

        {selectedStrategy === "single" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Type</label>
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
        ) : selectedStrategy !== "straddle" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Strike Width</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, padding: "2px 8px" }}>
              <input 
                type="range" min="1" max="10" step="1" 
                value={strikeOffset} onChange={e => setStrikeOffset(Number(e.target.value))} 
                style={{ width: 80, cursor: "pointer" }}
              />
              <span style={{ color: "#f4f4f5", fontFamily: "monospace", fontSize: 13 }}>{strikeOffset}</span>
            </div>
          </div>
        ) : null}

        <div style={{ marginLeft: "auto", display: "flex", gap: 16 }}>
          <div style={{ textAlign: "right" }}>
            <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Spot Price</p>
            <p style={{ color: "#38bdf8", fontSize: 15, fontFamily: "monospace", fontWeight: 700 }}>${greeksData.spot ? greeksData.spot.toFixed(2) : "--"}</p>
          </div>
          {selectedStrategy === "single" && baseResult && (
            <div style={{ textAlign: "right" }}>
              <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase" }}>Mid Price</p>
              <p style={{ color: "#fbbf24", fontSize: 15, fontFamily: "monospace", fontWeight: 700 }}>
                ${baseResult.price?.toFixed(2)}
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        
        {/* ── Controls Panel ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{
            background: "rgba(9,9,11,0.7)", border: "1px solid #1c1c1f", borderRadius: 16,
            padding: 20, display: "flex", flexDirection: "column", gap: 24, backdropFilter: "blur(8px)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ color: "#f4f4f5", fontSize: 14, fontWeight: 700, margin: "0 0 4px 0", fontFamily: "monospace" }}>
                  Simulation Controls
                </h3>
              </div>
              
              <button 
                onClick={() => {
                  setIsLive(!isLive);
                  if (isLive) {
                    setLiveSpot(null);
                    setSpotShift(0);
                    setIvShift(0);
                    setDaysForward(0);
                  } else {
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
                label="IV Shift" sublabel={`Global IV Offset`} icon="📊"
                value={ivShift} min={-50} max={50} step={1}
                onChange={setIvShift} accentColor="#a78bfa"
                displayFn={(v) => `${v > 0 ? "+" : ""}${v}%`}
              />
              <SliderControl
                label="Days Forward" sublabel={`Time Decay`} icon="⏱"
                value={daysForward} min={0} max={30} step={1}
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

          {/* Interactive Leg Manager */}
          <div style={{
            background: "rgba(9,9,11,0.7)", border: "1px solid #1c1c1f", borderRadius: 16,
            padding: 20, display: "flex", flexDirection: "column", gap: 12
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ color: "#a1a1aa", fontSize: 11, fontWeight: 700, margin: 0, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Interactive Leg Manager ({activeLegs.length})
              </h3>
              {activeLegs.some(l => l.premiumOverride !== null || !l.enabled) && (
                <button
                  onClick={() => {
                    const template = getStrategyLegs(selectedStrategy, selectedStrike, strikeOffset, availableStrikePrices, selectedType);
                    setActiveLegs(template);
                  }}
                  style={{
                    background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)",
                    color: "#a78bfa", borderRadius: 6, padding: "2px 8px", fontSize: 9, fontFamily: "monospace", cursor: "pointer"
                  }}
                >
                  Reset Custom
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeLegs.map((leg, i) => {
                const optionData = activeStrikes.find(s => s.strike === leg.strike && s.option_type === leg.type);
                const baseMid = optionData?.mid_price ?? 0;
                
                return (
                  <div key={i} style={{ 
                    display: "flex", 
                    flexDirection: "column",
                    gap: 10,
                    background: leg.enabled ? "rgba(24,24,27,0.4)" : "rgba(12,12,14,0.2)", 
                    padding: "12px 14px", 
                    borderRadius: 12, 
                    border: leg.enabled ? "1px solid #27272a" : "1px solid #1c1c1f",
                    opacity: leg.enabled ? 1 : 0.5,
                    transition: "all 0.2s ease"
                  }}>
                    {/* Header: Enable Switch, Side, Qty */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Custom Round Checkbox */}
                        <button
                          onClick={() => toggleLegEnabled(i)}
                          style={{
                            width: 18, height: 18, borderRadius: "50%",
                            border: leg.enabled ? "2px solid #38bdf8" : "2px solid #52525b",
                            background: leg.enabled ? "rgba(56,189,248,0.15)" : "transparent",
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 9, color: "#38bdf8", padding: 0, outline: "none"
                          }}
                        >
                          {leg.enabled && "●"}
                        </button>
                        
                        {/* Side Toggle Button */}
                        <button
                          onClick={() => toggleLegSide(i)}
                          style={{
                            color: leg.side > 0 ? "#34d399" : "#f87171", 
                            background: leg.side > 0 ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                            border: leg.side > 0 ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(248,113,113,0.3)",
                            padding: "2px 8px", borderRadius: 6, fontSize: 10, fontFamily: "monospace", fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          {leg.side > 0 ? "LONG" : "SHORT"}
                        </button>

                        {/* Qty Adjustment */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#18181b", borderRadius: 6, border: "1px solid #27272a", padding: "1px 4px" }}>
                          <button 
                            onClick={() => adjustLegQty(i, -1)}
                            style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, width: 14, fontSize: 11 }}
                          >
                            -
                          </button>
                          <span style={{ color: "#f4f4f5", fontFamily: "monospace", fontSize: 11, fontWeight: 700, minWidth: 12, textAlign: "center" }}>
                            {leg.quantity}
                          </span>
                          <button 
                            onClick={() => adjustLegQty(i, 1)}
                            style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, width: 14, fontSize: 11 }}
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Premium override input */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "#71717a", fontSize: 9, fontFamily: "monospace" }}>Fill:</span>
                        <input
                          type="number"
                          step="0.05"
                          min="0"
                          value={leg.premiumOverride !== null ? leg.premiumOverride : ""}
                          onChange={(e) => setLegPremiumOverride(i, e.target.value)}
                          placeholder={baseMid ? baseMid.toFixed(2) : "0.00"}
                          style={{
                            background: "#18181b", border: "1px solid #3f3f46", color: "#f4f4f5",
                            padding: "3px 6px", width: 62, borderRadius: 6, fontFamily: "monospace", fontSize: 11,
                            textAlign: "right", outline: "none"
                          }}
                        />
                      </div>
                    </div>

                    {/* Footer: Strike adjustment & Option Type */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #27272a", paddingTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace" }}>Strike:</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#18181b", borderRadius: 6, border: "1px solid #27272a", padding: "1px 4px" }}>
                          <button 
                            onClick={() => adjustLegStrike(i, "down")}
                            style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, width: 14, fontSize: 11 }}
                          >
                            ‹
                          </button>
                          <span style={{ color: "#f4f4f5", fontFamily: "monospace", fontSize: 11, fontWeight: 700, minWidth: 42, textAlign: "center" }}>
                            ${leg.strike}
                          </span>
                          <button 
                            onClick={() => adjustLegStrike(i, "up")}
                            style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", fontFamily: "monospace", fontWeight: 700, width: 14, fontSize: 11 }}
                          >
                            ›
                          </button>
                        </div>
                      </div>

                      {/* Type Toggle C / P */}
                      <button
                        onClick={() => toggleLegType(i)}
                        style={{
                          color: leg.type === "call" ? "#3b82f6" : "#f43f5e",
                          background: leg.type === "call" ? "rgba(59,130,246,0.1)" : "rgba(244,63,94,0.1)",
                          border: leg.type === "call" ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(244,63,94,0.3)",
                          padding: "2px 8px", borderRadius: 6, fontSize: 9, fontFamily: "monospace", fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        {leg.type.toUpperCase()}
                      </button>
                    </div>
                  </div>
                );
              })}
              {activeLegs.length === 0 && !loading && (
                <span style={{ color: "#71717a", fontSize: 12, fontFamily: "monospace" }}>No legs constructed.</span>
              )}
            </div>
          </div>
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
              <span style={{ color: "#a78bfa", fontSize: 10, fontFamily: "monospace" }}>Simulating Multi-Leg BSM...</span>
            </div>
          )}

          <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ color: "#f4f4f5", fontSize: 15, fontWeight: 700, margin: "0 0 4px 0", fontFamily: "monospace" }}>
                Net Exposures
              </h3>
              <p style={{ color: "#71717a", fontSize: 11, fontFamily: "monospace", margin: 0 }}>
                Aggregated Strategy Greeks
              </p>
            </div>
            {anyShifted && (
              <div style={{ display: "flex", gap: 8 }}>
                 <div style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: 6, padding: "4px 8px", color: "#38bdf8", fontSize: 10, fontFamily: "monospace" }}>
                   S: ${(greeksData.spot ? greeksData.spot * (1 + spotShift / 100) : 0).toFixed(2)}
                 </div>
                 <div style={{ background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 6, padding: "4px 8px", color: "#a78bfa", fontSize: 10, fontFamily: "monospace" }}>
                   IV: +{ivShift}%
                 </div>
                 <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 6, padding: "4px 8px", color: "#fbbf24", fontSize: 10, fontFamily: "monospace" }}>
                   DTE: -{daysForward}d
                 </div>
              </div>
            )}
          </div>

          {error ? (
            <div style={{ padding: 20, color: "#f87171", fontFamily: "monospace", fontSize: 12 }}>{error}</div>
          ) : simResult && baseResult ? (
            <>
              <div style={{ marginBottom: 16 }}>
                <GreekCard label="Net Theoretical Value" orig={baseResult.price} sim={simResult.price} color="#fbbf24" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <GreekCard label="Net Δ Delta" orig={baseResult.delta} sim={simResult.delta} color="#3b82f6" />
                <GreekCard label="Net Γ Gamma" orig={baseResult.gamma} sim={simResult.gamma} color="#8b5cf6" />
                <GreekCard label="Net Θ Theta" orig={baseResult.theta} sim={simResult.theta} color="#f59e0b" />
                <GreekCard label="Net ν Vega" orig={baseResult.vega} sim={simResult.vega} color="#10b981" />
                <GreekCard label="Net ρ Rho" orig={baseResult.rho} sim={simResult.rho} color="#6366f1" />
              </div>
            </>
          ) : null}

          {simResult && baseResult && (
            <div style={{ marginTop: 24, borderTop: "1px solid #27272a", paddingTop: 16 }}>
              <h4 style={{ color: "#a1a1aa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Second-Order Exposures</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <GreekCard label="Net Vanna (dΔ/dIV)" orig={baseResult.vanna} sim={simResult.vanna} color="#d946ef" />
                <GreekCard label="Net Charm (dΔ/dT)" orig={baseResult.charm} sim={simResult.charm} color="#f43f5e" />
              </div>
            </div>
          )}

          {/* Expiration Risk-Reward Summary Cards */}
          {expMetrics && (
            <div style={{ 
              marginTop: 24, 
              borderTop: "1px solid #27272a", 
              paddingTop: 20,
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", 
              gap: 16 
            }}>
              {/* Max Profit Card */}
              <div style={{
                background: "rgba(24,24,27,0.7)",
                border: "1px solid rgba(52,211,153,0.25)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                position: "relative"
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: "#34d399" }} />
                <span style={{ color: "#a1a1aa", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 8 }}>Max Profit (Expiry)</span>
                <span style={{ 
                  color: expMetrics.maxProfit === "Unlimited" ? "#34d399" : "#10b981", 
                  fontSize: 15, 
                  fontFamily: "monospace", 
                  fontWeight: 700,
                  paddingLeft: 8,
                  marginTop: 4
                }}>
                  {expMetrics.maxProfit === "Unlimited" ? "Unlimited ♾️" : `$${(expMetrics.maxProfit * 100).toFixed(2)}`}
                </span>
                <span style={{ color: "#52525b", fontSize: 9, fontFamily: "monospace", paddingLeft: 8 }}>
                  {expMetrics.maxProfit === "Unlimited" ? "No upside cap" : `$${expMetrics.maxProfit.toFixed(2)} / share`}
                </span>
              </div>

              {/* Max Loss Card */}
              <div style={{
                background: "rgba(24,24,27,0.7)",
                border: "1px solid rgba(248,113,113,0.25)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                position: "relative"
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: "#f87171" }} />
                <span style={{ color: "#a1a1aa", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 8 }}>Max Loss (Expiry)</span>
                <span style={{ 
                  color: expMetrics.maxLoss === "Unlimited" ? "#f87171" : "#ef5350", 
                  fontSize: 15, 
                  fontFamily: "monospace", 
                  fontWeight: 700,
                  paddingLeft: 8,
                  marginTop: 4
                }}>
                  {expMetrics.maxLoss === "Unlimited" ? "Unlimited ♾️" : `$${Math.abs(expMetrics.maxLoss * 100).toFixed(2)}`}
                </span>
                <span style={{ color: "#52525b", fontSize: 9, fontFamily: "monospace", paddingLeft: 8 }}>
                  {expMetrics.maxLoss === "Unlimited" ? "No downside protection" : `$${Math.abs(expMetrics.maxLoss).toFixed(2)} / share`}
                </span>
              </div>

              {/* Breakeven Point(s) Card */}
              <div style={{
                background: "rgba(24,24,27,0.7)",
                border: "1px solid rgba(56,189,248,0.25)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                position: "relative"
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: "#38bdf8" }} />
                <span style={{ color: "#a1a1aa", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 8 }}>Breakeven (Expiry)</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", paddingLeft: 8, marginTop: 2 }}>
                  {expMetrics.breakevens.length > 0 ? (
                    expMetrics.breakevens.map((be, idx) => (
                      <span key={idx} style={{ 
                        background: "rgba(56,189,248,0.1)", 
                        border: "1px solid rgba(56,189,248,0.3)",
                        color: "#38bdf8",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        fontSize: 11,
                        fontWeight: 700
                      }}>
                        ${be.toFixed(2)}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "#a1a1aa", fontSize: 13, fontFamily: "monospace", fontWeight: 600 }}>None</span>
                  )}
                </div>
                <span style={{ color: "#52525b", fontSize: 9, fontFamily: "monospace", paddingLeft: 8 }}>Levels where PnL = 0</span>
              </div>

              {/* Strategy Profile Card */}
              <div style={{
                background: "rgba(24,24,27,0.7)",
                border: "1px solid rgba(167,139,250,0.25)",
                borderRadius: 12,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                position: "relative"
              }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: "#a78bfa" }} />
                <span style={{ color: "#a1a1aa", fontSize: 10, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", paddingLeft: 8 }}>Initial Cost / Credit</span>
                <span style={{ color: "#f4f4f5", fontSize: 14, fontFamily: "monospace", fontWeight: 700, paddingLeft: 8, marginTop: 4 }}>
                  {expMetrics.initialPremium > 0 ? (
                    <span style={{ color: "#f87171" }}>Debit: ${(expMetrics.initialPremium * 100).toFixed(2)}</span>
                  ) : (
                    <span style={{ color: "#34d399" }}>Credit: ${Math.abs(expMetrics.initialPremium * 100).toFixed(2)}</span>
                  )}
                </span>
                <span style={{ color: "#a78bfa", fontSize: 10, fontFamily: "monospace", paddingLeft: 8 }}>
                  {expMetrics.maxProfit !== "Unlimited" && expMetrics.maxLoss !== "Unlimited" && expMetrics.maxLoss !== 0 ? (
                    `R:R Ratio: 1 : ${(Math.abs(expMetrics.maxProfit) / Math.abs(expMetrics.maxLoss)).toFixed(2)}`
                  ) : (
                    `R:R Ratio: --`
                  )}
                </span>
              </div>
            </div>
          )}

          {curveData && curveData.curve.length > 0 && (() => {
            const maxPnl = Math.max(...curveData.curve.map((d: any) => d.pnl || 0));
            const minPnl = Math.min(...curveData.curve.map((d: any) => d.pnl || 0));
            let off = 0;
            if (maxPnl <= 0) off = 0;
            else if (minPnl >= 0) off = 1;
            else off = maxPnl / (maxPnl - minPnl);

            const enrichedCurve = curveData.curve.map((pt: any) => {
               // 1. Expiration payoff PnL
               let expPayoff = 0;
               activeLegs.forEach(leg => {
                 const intrinsic = leg.type === "call"
                   ? Math.max(pt.spot - leg.strike, 0)
                   : Math.max(leg.strike - pt.spot, 0);
                 expPayoff += leg.side * leg.quantity * intrinsic;
               });
               const expPnl = expPayoff - (baseResult?.price || 0);

               // 2. T+0 payoff PnL (from baseline)
               let t0Pnl = pt.pnl;
               if (baselineCurveData?.curve) {
                  const basePt = baselineCurveData.curve.find(b => Math.abs(b.spot - pt.spot) < 0.05);
                  if (basePt) {
                     t0Pnl = basePt.pnl;
                  }
               }

               return {
                  ...pt,
                  expPnl,
                  t0Pnl
               };
            });
            
            return (
            <div style={{ marginTop: 24, borderTop: "1px solid #27272a", paddingTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <h4 style={{ color: "#a1a1aa", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Strategy Profile Curve</h4>
                  
                  {/* Premium Payoff Curve Legend */}
                  {selectedCurveMetric === "pnl" && (
                    <div style={{ display: "flex", gap: 12, fontSize: 9, fontFamily: "monospace", color: "#71717a", marginTop: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 3, background: "linear-gradient(90deg, #f87171, #34d399)", borderRadius: 1 }} />
                        <span>T+N (Simulated)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 3, background: "#38bdf8", opacity: 0.6, borderRadius: 1 }} />
                        <span>T+0 (Today)</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 8, height: 0, borderTop: "2px dashed #71717a" }} />
                        <span>Expiration</span>
                      </div>
                    </div>
                  )}
                </div>

                <select
                  value={selectedCurveMetric}
                  onChange={e => setSelectedCurveMetric(e.target.value)}
                  style={{
                    background: "rgba(39,39,42,0.5)", border: "1px solid #3f3f46", color: "#d4d4d8",
                    padding: "2px 8px", borderRadius: 6, fontFamily: "monospace", fontSize: 11, outline: "none"
                  }}
                >
                  <option value="pnl">Net P&L ($)</option>
                  <option value="price">Net Value ($)</option>
                  <option value="delta">Net Delta (Δ)</option>
                  <option value="gamma">Net Gamma (Γ)</option>
                  <option value="theta">Net Theta (Θ)</option>
                  <option value="vega">Net Vega (ν)</option>
                  <option value="vanna">Net Vanna (dΔ/dIV)</option>
                  <option value="charm">Net Charm (dΔ/dT)</option>
                </select>
              </div>
              
              <div style={{ height: 260, width: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={enrichedCurve} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="splitColor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor="#34d399" stopOpacity={1} />
                        <stop offset={off} stopColor="#f87171" stopOpacity={1} />
                      </linearGradient>
                      <linearGradient id="splitFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={off} stopColor="#34d399" stopOpacity={0.15} />
                        <stop offset={off} stopColor="#f87171" stopOpacity={0.15} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    
                    {/* Profit / Loss Zones for PnL */}
                    {selectedCurveMetric === "pnl" && (
                      <>
                        <ReferenceArea y1={0} y2={99999} fill="#34d399" fillOpacity={0.04} />
                        <ReferenceArea y1={-99999} y2={0} fill="#f87171" fillOpacity={0.04} />
                        <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} />
                      </>
                    )}

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
                      tickFormatter={(val) => Math.abs(val) < 0.01 && val !== 0 ? val.toExponential(1) : val.toFixed(2)}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(24,24,27,0.9)', border: '1px solid #3f3f46', borderRadius: '8px', fontSize: '11px', fontFamily: 'monospace' }}
                      formatter={(value: number, name: string) => {
                         const prefix = selectedCurveMetric === "pnl" && value > 0 ? "+" : "";
                         const displayName = name === "pnl" ? "T+N (SIM)" : (name === "t0Pnl" ? "T+0 (TODAY)" : (name === "expPnl" ? "EXPIRATION" : name.toUpperCase()));
                         return [prefix + value.toFixed(4), displayName];
                      }}
                      labelFormatter={(label) => `Spot: $${label.toFixed(2)}`}
                    />
                    
                    {/* Base Spot Line */}
                    <ReferenceLine x={curveData.base_spot} stroke="#38bdf8" strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'Base Spot', fill: '#38bdf8', fontSize: 9 }} />
                    
                    {/* Active Legs Strike Lines */}
                    {activeLegs.map((leg, i) => (
                       <ReferenceLine 
                         key={i} 
                         x={leg.strike} 
                         stroke="#a1a1aa" 
                         strokeDasharray="4 4" 
                         strokeOpacity={0.5}
                         label={{ 
                           position: leg.side > 0 ? 'top' : 'bottom', 
                           value: `${leg.side>0?'+':'-'}${leg.quantity} ${leg.type.substring(0,1).toUpperCase()}`, 
                           fill: leg.side > 0 ? '#34d399' : '#f87171', 
                           fontSize: 9 
                         }} 
                       />
                    ))}

                    {selectedCurveMetric === "pnl" ? (
                      <>
                        {/* Expiration Payoff line */}
                        <Line 
                          type="monotone" 
                          dataKey="expPnl" 
                          stroke="#52525b" 
                          strokeWidth={1.5} 
                          strokeDasharray="4 4"
                          dot={false}
                          name="expPnl"
                        />
                        {/* T+0 Today Baseline line */}
                        <Line 
                          type="monotone" 
                          dataKey="t0Pnl" 
                          stroke="#38bdf8" 
                          strokeWidth={1.5} 
                          strokeOpacity={0.5}
                          dot={false}
                          name="t0Pnl"
                        />
                        {/* T+N Active Simulated Area */}
                        <Area 
                          type="monotone" 
                          dataKey="pnl" 
                          stroke="url(#splitColor)" 
                          fill="url(#splitFill)"
                          strokeWidth={2} 
                          activeDot={{ r: 4, fill: "#34d399", stroke: '#fff' }} 
                          name="pnl"
                        />
                      </>
                    ) : (
                      <Line 
                        type="monotone" 
                        dataKey={selectedCurveMetric} 
                        stroke={{
                          price: "#fbbf24", delta: "#3b82f6", gamma: "#8b5cf6", theta: "#f59e0b",
                          vega: "#10b981", vanna: "#d946ef", charm: "#f43f5e"
                        }[selectedCurveMetric] || "#a78bfa"} 
                        strokeWidth={2} 
                        dot={false} 
                        activeDot={{ 
                          r: 4, 
                          fill: {
                            price: "#fbbf24", delta: "#3b82f6", gamma: "#8b5cf6", theta: "#f59e0b",
                            vega: "#10b981", vanna: "#d946ef", charm: "#f43f5e"
                          }[selectedCurveMetric] || "#a78bfa", 
                          stroke: '#fff' 
                        }} 
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            );
          })()}
        </div>
      </div>

      {/* Collapsible Risk Stress Matrix (Spot vs IV Heatmap) */}
      {stressMatrixData && (
        <div style={{
          background: "rgba(9,9,11,0.7)", border: "1px solid #1c1c1f", borderRadius: 16,
          padding: 20, marginTop: 16, backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", gap: 16
        }}>
          <div 
            onClick={() => setShowStressMatrix(!showStressMatrix)}
            style={{ 
              display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer",
              userSelect: "none"
            }}
          >
            <div>
              <h3 style={{ color: "#f4f4f5", fontSize: 13, fontWeight: 700, margin: "0 0 4px 0", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 8 }}>
                <span>📊</span>
                <span>RISK STRESS MATRIX (SPOT SHIFT VS IMPLIED VOLATILITY SHIFT)</span>
              </h3>
              <p style={{ color: "#71717a", fontSize: 10, fontFamily: "monospace", margin: 0 }}>
                Theoretical strategy payoff (PnL USD) across simultaneous spot price and volatility shock scenarios (1 contract)
              </p>
            </div>
            <span style={{ color: "#a78bfa", fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>
              {showStressMatrix ? "[ COLLAPSE - ]" : "[ EXPAND + ]"}
            </span>
          </div>

          {showStressMatrix && (
            <div style={{ overflowX: "auto", borderTop: "1px solid #27272a", paddingTop: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={{ 
                      border: "1px solid #27272a", padding: "8px 10px", 
                      fontFamily: "monospace", fontSize: 10, color: "#71717a",
                      background: "#09090b", width: 90, textAlign: "center"
                    }}>
                      IV \ SPOT
                    </th>
                    {stressMatrixData.spotShifts.map((sh, idx) => (
                      <th key={idx} style={{ 
                        border: "1px solid #27272a", padding: "8px 10px", 
                        fontFamily: "monospace", fontSize: 10, color: sh === 0 ? "#38bdf8" : "#d4d4d8",
                        background: sh === 0 ? "rgba(56,189,248,0.05)" : "#09090b", textAlign: "center"
                      }}>
                        {sh > 0 ? `+${sh}%` : `${sh}%`}
                        <div style={{ fontSize: 8, color: "#52525b", marginTop: 2 }}>
                          ${(greeksData.spot * (1 + sh / 100)).toFixed(2)}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stressMatrixData.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      <td style={{ 
                        border: "1px solid #27272a", padding: "8px 10px", 
                        fontFamily: "monospace", fontSize: 10, color: row.ivShift === 0 ? "#a78bfa" : "#d4d4d8",
                        background: row.ivShift === 0 ? "rgba(167,139,250,0.05)" : "#09090b", 
                        fontWeight: 600, textAlign: "center"
                      }}>
                        {row.ivShift > 0 ? `+${row.ivShift}%` : `${row.ivShift}%`}
                      </td>
                      {row.cols.map((cell, cIdx) => {
                        const isPositive = cell.pnl > 0;
                        const isZero = Math.abs(cell.pnl) < 1e-4;
                        
                        let bg = "transparent";
                        let textCol = "#a1a1aa";
                        if (!isZero) {
                          if (isPositive) {
                            const intensity = Math.min(Math.abs(cell.pnl) / Math.max(stressMatrixData.maxVal, 1), 1);
                            bg = `rgba(52,211,153, ${0.05 + intensity * 0.3})`;
                            textCol = "#34d399";
                          } else {
                            const intensity = Math.min(Math.abs(cell.pnl) / Math.max(Math.abs(stressMatrixData.minVal), 1), 1);
                            bg = `rgba(248,113,113, ${0.05 + intensity * 0.3})`;
                            textCol = "#f87171";
                          }
                        }
                        
                        const isBase = cell.spotShift === 0 && cell.ivShift === 0;
                        const border = isBase ? "2px solid #a78bfa" : "1px solid #27272a";

                        return (
                          <td 
                            key={cIdx} 
                            title={`Spot Shift: ${cell.spotShift}%, IV Shift: ${cell.ivShift}%`}
                            style={{ 
                              border, 
                              padding: "10px 6px", 
                              background: bg,
                              color: textCol,
                              fontFamily: "monospace", 
                              fontSize: 11, 
                              fontWeight: isBase || !isZero ? 700 : 400,
                              textAlign: "center",
                              transition: "all 0.15s ease",
                              cursor: "default"
                            }}
                          >
                            {isZero ? "$0" : `${isPositive ? "+" : "-"}$${Math.abs(Math.round(cell.pnl))}`}
                            {isBase && (
                              <div style={{ fontSize: 7, color: "#a78bfa", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                CURRENT
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
      `}</style>
    </div>
  );
}

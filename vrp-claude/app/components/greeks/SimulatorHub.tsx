"use client";

import React, { useState } from "react";
import { GreeksSnapshot } from "@/app/lib/greeks";
import GammaSimulator from "./GammaSimulator";
import StrategySimulator from "./StrategySimulator";

export default function SimulatorHub({ ticker, greeksData }: { ticker: string; greeksData: GreeksSnapshot | null }) {
  const [activeTab, setActiveTab] = useState<"single" | "chain">("single");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      
      {/* ── Segmented Control ── */}
      <div style={{ display: "flex", gap: 4, background: "rgba(24,24,27,0.8)", border: "1px solid #27272a", borderRadius: 12, padding: 4, alignSelf: "flex-start" }}>
        <button
          onClick={() => setActiveTab("single")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            fontFamily: "monospace", fontSize: 11, fontWeight: 600,
            border: activeTab === "single" ? `1px solid rgba(167,139,250,0.25)` : "1px solid transparent",
            background: activeTab === "single" ? "rgba(167,139,250,0.08)" : "transparent",
            color: activeTab === "single" ? "#a78bfa" : "#52525b",
            cursor: "pointer", transition: "all 0.2s ease",
            boxShadow: activeTab === "single" ? "0 0 20px rgba(167,139,250,0.15)" : "none",
          }}
        >
          <span style={{ fontSize: 14 }}>🎯</span>
          <span>Strategy Simulator</span>
        </button>
        <button
          onClick={() => setActiveTab("chain")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8,
            fontFamily: "monospace", fontSize: 11, fontWeight: 600,
            border: activeTab === "chain" ? `1px solid rgba(14,165,233,0.25)` : "1px solid transparent",
            background: activeTab === "chain" ? "rgba(14,165,233,0.08)" : "transparent",
            color: activeTab === "chain" ? "#38bdf8" : "#52525b",
            cursor: "pointer", transition: "all 0.2s ease",
            boxShadow: activeTab === "chain" ? "0 0 20px rgba(14,165,233,0.15)" : "none",
          }}
        >
          <span style={{ fontSize: 14 }}>⛓️</span>
          <span>Chain Profile (GEX)</span>
        </button>
      </div>

      {/* ── Content ── */}
      {activeTab === "single" ? (
        <StrategySimulator greeksData={greeksData} />
      ) : (
        <GammaSimulator ticker={ticker} />
      )}
    </div>
  );
}

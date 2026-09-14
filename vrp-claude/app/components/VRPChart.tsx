// app/components/VRPChart.tsx
"use client";

import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { VRPSnapshot } from "../lib/vrp";
import ChartWatermarkOverlay from "./bloomberg/ChartWatermarkOverlay";
import WatermarkSettingsModal from "./bloomberg/WatermarkSettingsModal";
import ExportHDModal from "./bloomberg/ExportHDModal";
import {
  WatermarkConfig,
  getStoredWatermarkConfig,
  saveStoredWatermarkConfig,
  svgToCanvas,
  exportChartAsHDImage,
  copyChartToClipboard,
  ChartExportMetadata,
} from "../lib/chartExportEngine";

interface VRPChartProps {
  history: VRPSnapshot[];
  ticker?: string;
  spot?: number;
  iv?: number;
  rv?: number;
  vrp?: number;
  vrpZ?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#090d16] border border-amber-500/40 rounded-lg px-3 py-2 text-xs font-mono shadow-2xl backdrop-blur-md">
      <p className="text-zinc-400 mb-1 border-b border-zinc-800 pb-1 font-bold">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex gap-4 justify-between items-center py-0.5">
          <span className="flex items-center gap-1.5" style={{ color: p.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <span className="text-zinc-100 font-bold">{p.value?.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
};

export default function VRPChart({
  history,
  ticker = "SPY",
  spot,
  iv,
  rv,
  vrp,
  vrpZ,
}: VRPChartProps) {
  const [timeRange, setTimeRange] = useState<"ALL" | "30D" | "7D">("ALL");
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(getStoredWatermarkConfig);
  const [isWatermarkModalOpen, setIsWatermarkModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const cachedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync watermark changes to localStorage
  const handleWatermarkChange = (newConfig: WatermarkConfig) => {
    setWatermarkConfig(newConfig);
    saveStoredWatermarkConfig(newConfig);
  };

  // Filter history data based on selected time range
  const filteredData = useMemo(() => {
    if (!history || history.length === 0) return [];
    if (timeRange === "7D") return history.slice(-7);
    if (timeRange === "30D") return history.slice(-30);
    return history;
  }, [history, timeRange]);

  // Quant metrics for overlay & export
  const quantMetrics = useMemo(() => {
    const list: { label: string; value: string }[] = [];
    if (iv !== undefined) list.push({ label: "IV", value: `${iv.toFixed(1)}%` });
    if (rv !== undefined) list.push({ label: "RV", value: `${rv.toFixed(1)}%` });
    if (vrp !== undefined) list.push({ label: "VRP", value: `${vrp >= 0 ? "+" : ""}${vrp.toFixed(2)}%` });
    if (vrpZ !== undefined) list.push({ label: "Z-SCORE", value: vrpZ.toFixed(2) });
    return list;
  }, [iv, rv, vrp, vrpZ]);

  const exportMetadata: ChartExportMetadata = useMemo(() => {
    return {
      ticker: ticker.toUpperCase(),
      interval: timeRange === "ALL" ? "HISTORICAL" : timeRange,
      provider: "BLOOMBERG QUANT / VRP HAR ENGINE",
      lastPrice: spot ? `$${spot.toLocaleString()}` : undefined,
      quantMetrics: quantMetrics.length > 0 ? quantMetrics : [
        { label: "ENGINE", value: "HAR-RV + BSM" },
        { label: "REGIME", value: "VOL SPREAD" }
      ],
      timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
    };
  }, [ticker, timeRange, spot, quantMetrics]);

  // Generate canvas from current chart SVG for HD export
  const prepareChartCanvas = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    if (!chartContainerRef.current) return null;
    const svg = chartContainerRef.current.querySelector("svg");
    if (!svg) return null;
    try {
      const canvas = await svgToCanvas(svg as SVGSVGElement, 1280, 480);
      cachedCanvasRef.current = canvas;
      return canvas;
    } catch (err) {
      console.error("Failed to generate canvas from SVG:", err);
      return null;
    }
  }, []);

  // Quick 1-click copy HD chart to clipboard
  const handleQuickCopy = async () => {
    try {
      setIsCopying(true);
      setCopyFeedback("Rendering...");
      const canvas = await prepareChartCanvas();
      if (!canvas) throw new Error("Chart canvas not ready");

      const success = await copyChartToClipboard({
        chartCanvas: canvas,
        resolution: "1440p",
        metadata: exportMetadata,
        watermark: watermarkConfig,
        includeHeader: true,
        includeFooter: true,
      });

      if (success) {
        setCopyFeedback("✓ Copied HD!");
      } else {
        setCopyFeedback("Failed to copy");
      }
    } catch (e) {
      console.error(e);
      setCopyFeedback("Error copying");
    } finally {
      setIsCopying(false);
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  // Quick 1-click download HD PNG
  const handleQuickDownload = async () => {
    try {
      setCopyFeedback("Downloading...");
      const canvas = await prepareChartCanvas();
      if (!canvas) throw new Error("Chart canvas not ready");

      await exportChartAsHDImage({
        chartCanvas: canvas,
        resolution: "1440p",
        metadata: exportMetadata,
        watermark: watermarkConfig,
        includeHeader: true,
        includeFooter: true,
      });
      setCopyFeedback("✓ Downloaded!");
    } catch (e) {
      console.error(e);
      setCopyFeedback("Download failed");
    } finally {
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  };

  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-xl border border-zinc-800 bg-[#090d16] text-zinc-500 font-mono text-xs">
        Belum ada history data untuk {ticker}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-[#080c14] overflow-hidden shadow-2xl font-mono">
      {/* ── Top Interactive Bloomberg Chart Toolbar ──────────── */}
      <div className="px-4 py-2.5 bg-[#05080f] border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 select-none">
        {/* Left: Chart Title & Range Filter */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-zinc-200 tracking-wider">
              {ticker.toUpperCase()} · VRP VOLATILITY DYNAMICS
            </span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded border border-zinc-800 text-[10px]">
            {(["ALL", "30D", "7D"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  timeRange === r
                    ? "bg-amber-500/20 text-amber-300 font-bold border border-amber-500/50"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Watermark & HD Export Action Buttons */}
        <div className="flex items-center gap-2">
          {copyFeedback && (
            <span className="text-[10px] text-amber-400 font-bold animate-pulse px-2 py-0.5 rounded bg-amber-950/40 border border-amber-700/50">
              {copyFeedback}
            </span>
          )}

          {/* Watermark (WM) Config Button */}
          <button
            onClick={() => setIsWatermarkModalOpen(true)}
            className={`px-2.5 py-1 rounded text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              watermarkConfig.enabled
                ? "bg-amber-500/15 border-amber-500/60 text-amber-300 hover:bg-amber-500/25"
                : "bg-zinc-900 border-zinc-700/80 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
            title="Configure Chart Watermark (Handle, Opacity, Position)"
          >
            <span>💧</span>
            <span>WM</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                watermarkConfig.enabled ? "bg-amber-400" : "bg-zinc-600"
              }`}
            />
          </button>

          {/* Quick Copy HD Button */}
          <button
            onClick={handleQuickCopy}
            disabled={isCopying}
            className="px-2.5 py-1 rounded text-xs font-semibold bg-zinc-900 border border-zinc-700/80 hover:border-cyan-500/60 hover:text-cyan-300 text-zinc-300 transition-all flex items-center gap-1 cursor-pointer"
            title="Copy High-Definition Chart to Clipboard (1440p 2K)"
          >
            <span>📋</span>
            <span className="hidden sm:inline">COPY</span>
          </button>

          {/* Quick Download PNG Button */}
          <button
            onClick={handleQuickDownload}
            className="px-2.5 py-1 rounded text-xs font-semibold bg-zinc-900 border border-zinc-700/80 hover:border-emerald-500/60 hover:text-emerald-300 text-zinc-300 transition-all flex items-center gap-1 cursor-pointer"
            title="Download HD Chart Image (PNG)"
          >
            <span>💾</span>
            <span className="hidden sm:inline">PNG</span>
          </button>

          {/* HD Export Studio Modal Button */}
          <button
            onClick={async () => {
              await prepareChartCanvas();
              setIsExportModalOpen(true);
            }}
            className="px-3 py-1 rounded text-xs font-bold bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black border border-amber-400 transition-all shadow-md active:scale-95 flex items-center gap-1.5 cursor-pointer"
            title="Open HD Chart Export Studio (1080p, 1440p 2K, 4K UHD)"
          >
            <span>📷</span>
            <span>HD EXPORT</span>
          </button>
        </div>
      </div>

      {/* ── Chart Container with Watermark Overlay ────────────── */}
      <div
        ref={chartContainerRef}
        className="relative w-full p-3 bg-gradient-to-b from-[#080c14] to-[#05080f]"
        style={{ minHeight: "260px" }}
      >
        {/* On-Chart Watermark Overlay */}
        <ChartWatermarkOverlay
          ticker={ticker}
          interval={timeRange}
          provider="BLOOMBERG QUANT / VRP HAR"
          config={watermarkConfig}
          quantMetrics={quantMetrics}
        />

        {/* Recharts SVG Line Chart */}
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={filteredData} margin={{ top: 12, right: 12, left: -18, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#182234" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={{ stroke: "#1e293b" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v.toFixed(1)}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#94a3b8",
                paddingTop: 6,
              }}
            />
            <ReferenceLine y={0} stroke="#334155" strokeDasharray="4 4" />

            <Line
              type="monotone"
              dataKey="iv"
              name="IV (Implied)"
              stroke="#818cf8"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#818cf8" }}
            />
            <Line
              type="monotone"
              dataKey="rv"
              name="RV (Realized)"
              stroke="#fb923c"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#fb923c" }}
            />
            <Line
              type="monotone"
              dataKey="vrp"
              name="VRP Spread"
              stroke="#34d399"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "#34d399" }}
              strokeDasharray="5 2"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Modals ───────────────────────────────────────────── */}
      {/* 1. Watermark Settings Modal */}
      <WatermarkSettingsModal
        isOpen={isWatermarkModalOpen}
        onClose={() => setIsWatermarkModalOpen(false)}
        config={watermarkConfig}
        onChange={handleWatermarkChange}
      />

      {/* 2. HD Chart Export Studio Modal */}
      <ExportHDModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        getChartCanvas={() => cachedCanvasRef.current}
        metadata={exportMetadata}
        watermark={watermarkConfig}
      />
    </div>
  );
}

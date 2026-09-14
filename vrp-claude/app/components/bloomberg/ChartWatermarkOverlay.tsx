'use client';

import React from 'react';
import { WatermarkConfig } from '../../lib/chartExportEngine';

interface ChartWatermarkOverlayProps {
  ticker: string;
  interval?: string;
  provider?: string;
  config: WatermarkConfig;
  quantMetrics?: { label: string; value: string }[];
}

export default function ChartWatermarkOverlay({
  ticker,
  interval = '1D',
  provider = 'YAHOO FINANCE',
  config,
  quantMetrics = [],
}: ChartWatermarkOverlayProps) {
  if (!config.enabled) return null;

  const isCenter = config.position === 'center';

  if (isCenter) {
    return (
      <div
        className="absolute inset-0 pointer-events-none select-none flex flex-col items-center justify-center z-10 font-mono transition-opacity duration-200"
        style={{ opacity: config.opacity }}
      >
        <div className="text-6xl md:text-8xl font-black tracking-widest text-amber-500/90 drop-shadow-sm">
          {ticker.toUpperCase()}
        </div>
        <div className="text-xs md:text-sm tracking-widest text-zinc-300 font-bold uppercase mt-1">
          {config.userSignature || 'VRP QUANT TERMINAL'}
        </div>
        <div className="text-[10px] tracking-wider text-zinc-400 mt-1">
          {interval} · {provider.toUpperCase()}
        </div>
        {config.showMetrics && quantMetrics.length > 0 && (
          <div className="flex items-center gap-3 text-[10px] tracking-wider text-amber-400 mt-2 bg-black/40 px-3 py-1 rounded border border-amber-500/20">
            {quantMetrics.map((m, i) => (
              <span key={i}>
                <span className="text-zinc-400">{m.label}:</span> {m.value}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Corner Badge (Bottom Right or Top Right)
  const isTopRight = config.position === 'top-right';

  return (
    <div
      className={`absolute ${isTopRight ? 'top-4 right-4' : 'bottom-6 right-4'} pointer-events-none select-none z-10 font-mono transition-opacity duration-200`}
      style={{ opacity: config.opacity * 2 }}
    >
      <div className="bg-[#05080f]/80 backdrop-blur-sm border border-amber-500/30 px-3 py-1.5 rounded shadow-lg text-right">
        <div className="text-xs font-bold text-amber-400">
          {ticker.toUpperCase()} · {interval}
        </div>
        <div className="text-[10px] text-zinc-300 font-medium">
          {config.userSignature || 'VRP QUANT TERMINAL'}
        </div>
        <div className="text-[9px] text-zinc-500">
          {provider.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

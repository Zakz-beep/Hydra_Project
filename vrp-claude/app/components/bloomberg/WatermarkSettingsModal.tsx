'use client';

import React from 'react';
import { WatermarkConfig } from '../../lib/chartExportEngine';

interface WatermarkSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: WatermarkConfig;
  onChange: (newConfig: WatermarkConfig) => void;
}

export default function WatermarkSettingsModal({
  isOpen,
  onClose,
  config,
  onChange,
}: WatermarkSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 font-mono">
      <div className="w-full max-w-md bg-[#090d16] border border-amber-500/40 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#05080f] border-b border-amber-500/30">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-amber-400 font-bold text-xs uppercase tracking-wider">
              WATERMARK (WM) DATA SETTINGS
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xs px-2 py-0.5 rounded border border-zinc-800 transition-colors"
          >
            CLOSE
          </button>
        </div>

        {/* Form Controls */}
        <div className="p-4 space-y-4 text-xs">
          {/* Enable Watermark Toggle */}
          <div className="flex items-center justify-between p-2.5 rounded bg-zinc-950 border border-zinc-850">
            <div>
              <div className="text-zinc-200 font-bold">Chart Watermark</div>
              <div className="text-zinc-500 text-[10px]">Show watermark data on chart canvas</div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          {/* Custom Signature Text */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-[11px] font-bold">CUSTOM SIGNATURE / HANDLE</label>
            <input
              type="text"
              value={config.userSignature}
              onChange={(e) => onChange({ ...config, userSignature: e.target.value })}
              placeholder="@HydraQuant / YourDeskName"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-zinc-200 font-mono text-xs focus:border-amber-400 focus:outline-none"
            />
            <div className="text-[10px] text-zinc-500">Shown alongside ticker and market data in watermark</div>
          </div>

          {/* Position Selector */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-[11px] font-bold">WATERMARK POSITION</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'center', label: 'Center Fader' },
                { id: 'bottom-right', label: 'Bottom Right' },
                { id: 'top-right', label: 'Top Right' },
              ].map((pos) => (
                <button
                  key={pos.id}
                  type="button"
                  onClick={() => onChange({ ...config, position: pos.id as any })}
                  className={`py-1.5 px-2 rounded border text-center font-bold text-[11px] transition-colors ${
                    config.position === pos.id
                      ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                  }`}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opacity Slider */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <label className="text-zinc-400 text-[11px] font-bold">OPACITY</label>
              <span className="text-amber-400 font-bold">{Math.round(config.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.04"
              max="0.40"
              step="0.02"
              value={config.opacity}
              onChange={(e) => onChange({ ...config, opacity: parseFloat(e.target.value) })}
              className="w-full accent-amber-500 bg-zinc-800 h-1.5 rounded cursor-pointer"
            />
          </div>

          {/* Show Quantitative Metrics in Watermark */}
          <div className="flex items-center justify-between p-2 rounded bg-zinc-950 border border-zinc-850">
            <div>
              <div className="text-zinc-300 font-medium">Include Quant Metrics</div>
              <div className="text-zinc-500 text-[10px]">Show VRP/IV/Regime snippet in watermark</div>
            </div>
            <input
              type="checkbox"
              checked={config.showMetrics}
              onChange={(e) => onChange({ ...config, showMetrics: e.target.checked })}
              className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-[#05080f] border-t border-zinc-900 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs rounded transition-colors"
          >
            APPLY CHANGES
          </button>
        </div>
      </div>
    </div>
  );
}

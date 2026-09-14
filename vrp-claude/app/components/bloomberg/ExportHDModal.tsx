'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ChartExportMetadata,
  WatermarkConfig,
  composeHDChartCanvas,
  exportChartAsHDImage,
  copyChartToClipboard,
} from '../../lib/chartExportEngine';

interface ExportHDModalProps {
  isOpen: boolean;
  onClose: () => void;
  getChartCanvas: () => HTMLCanvasElement | null;
  getDrawingSvg?: () => SVGSVGElement | null;
  metadata: ChartExportMetadata;
  watermark: WatermarkConfig;
}

export default function ExportHDModal({
  isOpen,
  onClose,
  getChartCanvas,
  getDrawingSvg,
  metadata,
  watermark,
}: ExportHDModalProps) {
  const [resolution, setResolution] = useState<'1080p' | '1440p' | '2160p'>('1440p');
  const [includeHeader, setIncludeHeader] = useState(true);
  const [includeFooter, setIncludeFooter] = useState(true);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Generate preview when options change
  useEffect(() => {
    if (!isOpen) return;
    const canvas = getChartCanvas();
    if (!canvas) return;

    let isMounted = true;
    composeHDChartCanvas({
      chartCanvas: canvas,
      drawingSvg: getDrawingSvg ? getDrawingSvg() : null,
      resolution: '1080p', // preview at 1080p for performance
      metadata,
      watermark: { ...watermark, enabled: includeWatermark },
      includeHeader,
      includeFooter,
    }).then((composed) => {
      if (isMounted) {
        setPreviewUrl(composed.toDataURL('image/jpeg', 0.85));
      }
    }).catch((err) => console.error('Preview error:', err));

    return () => {
      isMounted = false;
    };
  }, [isOpen, resolution, includeHeader, includeFooter, includeWatermark, metadata, watermark, getChartCanvas, getDrawingSvg]);

  if (!isOpen) return null;

  const handleDownload = async () => {
    const canvas = getChartCanvas();
    if (!canvas) {
      setStatusMsg('Error: Chart canvas not ready');
      return;
    }

    try {
      setIsProcessing(true);
      setStatusMsg('Rendering HD Chart (High DPI)...');
      await exportChartAsHDImage({
        chartCanvas: canvas,
        drawingSvg: getDrawingSvg ? getDrawingSvg() : null,
        resolution,
        metadata,
        watermark: { ...watermark, enabled: includeWatermark },
        includeHeader,
        includeFooter,
      });
      setStatusMsg('HD Chart downloaded successfully!');
      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 1200);
    } catch (e) {
      console.error(e);
      setStatusMsg('Export failed. Please retry.');
      setIsProcessing(false);
    }
  };

  const handleCopy = async () => {
    const canvas = getChartCanvas();
    if (!canvas) return;

    try {
      setIsProcessing(true);
      setStatusMsg('Copying HD Image to Clipboard...');
      const success = await copyChartToClipboard({
        chartCanvas: canvas,
        drawingSvg: getDrawingSvg ? getDrawingSvg() : null,
        resolution,
        metadata,
        watermark: { ...watermark, enabled: includeWatermark },
        includeHeader,
        includeFooter,
      });

      if (success) {
        setStatusMsg('Copied to clipboard! Ready to paste into Discord/X/Telegram.');
      } else {
        setStatusMsg('Copy failed. Browser may restrict clipboard access.');
      }
      setTimeout(() => setIsProcessing(false), 2000);
    } catch (e) {
      console.error(e);
      setStatusMsg('Copy failed.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-mono">
      <div className="w-full max-w-4xl bg-[#090d16] border border-amber-500/50 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#05080f] border-b border-amber-500/30">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-amber-400 font-bold text-sm uppercase tracking-wider">
              EXPORT HD CHART &amp; WATERMARK DATA
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 text-xs px-2.5 py-1 rounded border border-zinc-800 transition-colors"
          >
            ESC / CLOSE
          </button>
        </div>

        {/* Body (Preview + Options) */}
        <div className="p-5 flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left Column: Live Composite Preview */}
          <div className="lg:col-span-2 flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400 font-bold">
              <span>COMPOSITE PREVIEW</span>
              <span className="text-amber-400">{resolution.toUpperCase()}</span>
            </div>
            <div className="relative flex-1 min-h-[260px] bg-black rounded-lg border border-zinc-800 overflow-hidden flex items-center justify-center p-2">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="HD Chart Preview"
                  className="max-h-full max-w-full object-contain rounded shadow-lg"
                />
              ) : (
                <div className="text-zinc-600 text-xs">Generating preview...</div>
              )}
            </div>
            {statusMsg && (
              <div className="text-center py-1.5 px-3 rounded bg-amber-950/40 border border-amber-800/40 text-amber-300 text-xs font-semibold animate-pulse">
                {statusMsg}
              </div>
            )}
          </div>

          {/* Right Column: Export Options */}
          <div className="space-y-4 text-xs">
            {/* Resolution Selector */}
            <div className="space-y-1.5">
              <label className="text-zinc-300 font-bold tracking-wide">EXPORT RESOLUTION</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: '1080p', label: '1080p', sub: 'FHD' },
                  { id: '1440p', label: '2K QHD', sub: 'Retina' },
                  { id: '2160p', label: '4K UHD', sub: 'Ultra' },
                ].map((res) => (
                  <button
                    key={res.id}
                    type="button"
                    onClick={() => setResolution(res.id as any)}
                    className={`p-2 rounded border text-center transition-all ${
                      resolution === res.id
                        ? 'border-amber-500 bg-amber-500/20 text-amber-300 font-bold'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    <div>{res.label}</div>
                    <div className="text-[9px] opacity-70">{res.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Layout Inclusions */}
            <div className="space-y-2 pt-2 border-t border-zinc-850">
              <label className="text-zinc-300 font-bold tracking-wide">COMPOSITE ELEMENTS</label>

              <label className="flex items-center justify-between p-2 rounded bg-zinc-950 border border-zinc-850 cursor-pointer">
                <div>
                  <div className="text-zinc-200 font-medium">Bloomberg Header</div>
                  <div className="text-zinc-500 text-[10px]">Symbol, OHLC, Net Change &amp; Interval</div>
                </div>
                <input
                  type="checkbox"
                  checked={includeHeader}
                  onChange={(e) => setIncludeHeader(e.target.checked)}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded bg-zinc-950 border border-zinc-850 cursor-pointer">
                <div>
                  <div className="text-zinc-200 font-medium">Watermark (WM) Data</div>
                  <div className="text-zinc-500 text-[10px]">Custom handle &amp; high-res data stamp</div>
                </div>
                <input
                  type="checkbox"
                  checked={includeWatermark}
                  onChange={(e) => setIncludeWatermark(e.target.checked)}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded bg-zinc-950 border border-zinc-850 cursor-pointer">
                <div>
                  <div className="text-zinc-200 font-medium">Terminal Footer</div>
                  <div className="text-zinc-500 text-[10px]">Quant metrics &amp; UTC timestamp</div>
                </div>
                <input
                  type="checkbox"
                  checked={includeFooter}
                  onChange={(e) => setIncludeFooter(e.target.checked)}
                  className="accent-amber-500 w-4 h-4 rounded cursor-pointer"
                />
              </label>
            </div>

            {/* Export Details */}
            <div className="p-2.5 rounded bg-amber-950/20 border border-amber-800/30 text-[11px] text-amber-300/80 space-y-1">
              <div>• Format: <span className="text-zinc-200 font-semibold">Lossless PNG (High-DPI)</span></div>
              <div>• Output: <span className="text-zinc-200 font-semibold">{resolution === '2160p' ? '3840 × 2160' : resolution === '1440p' ? '2560 × 1440' : '1920 × 1080'}</span></div>
              <div>• Color space: <span className="text-zinc-200 font-semibold">sRGB Full Dynamic Range</span></div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-[#05080f] border-t border-zinc-900 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-500">
            Export ready for Twitter / X, Discord, Telegram, and research decks
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={handleCopy}
              disabled={isProcessing}
              className="flex-1 sm:flex-none px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-bold text-xs rounded border border-zinc-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>📋</span>
              <span>COPY TO CLIPBOARD</span>
            </button>
            <button
              onClick={handleDownload}
              disabled={isProcessing}
              className="flex-1 sm:flex-none px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-black font-extrabold text-xs rounded shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              <span>📥</span>
              <span>DOWNLOAD HD PNG</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

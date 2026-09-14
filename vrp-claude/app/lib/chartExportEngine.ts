'use client';

export interface ChartExportMetadata {
  ticker: string;
  interval?: string;
  provider?: string;
  lastPrice?: string | number;
  priceChange?: string | number;
  priceChangePercent?: string | number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  volume?: string | number;
  timestamp?: string;
  quantMetrics?: { label: string; value: string }[];
}

export interface WatermarkConfig {
  enabled: boolean;
  userSignature: string;
  showMetrics: boolean;
  opacity: number; // 0.05 - 0.50
  position: 'center' | 'bottom-right' | 'top-right';
  theme: 'bloomberg' | 'monochrome' | 'faint';
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: true,
  userSignature: '@HYDRA_TERMINAL',
  showMetrics: true,
  opacity: 0.18,
  position: 'center',
  theme: 'bloomberg',
};

export function getStoredWatermarkConfig(): WatermarkConfig {
  if (typeof window === 'undefined') return DEFAULT_WATERMARK_CONFIG;
  try {
    const saved = localStorage.getItem('bloomberg_watermark_config');
    if (saved) return { ...DEFAULT_WATERMARK_CONFIG, ...JSON.parse(saved) };
  } catch (e) {
    // ignore
  }
  return DEFAULT_WATERMARK_CONFIG;
}

export function saveStoredWatermarkConfig(config: WatermarkConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('bloomberg_watermark_config', JSON.stringify(config));
  } catch (e) {
    // ignore
  }
}

export interface ExportOptions {
  chartCanvas: HTMLCanvasElement;
  drawingSvg?: SVGSVGElement | null;
  resolution: '1080p' | '1440p' | '2160p';
  metadata: ChartExportMetadata;
  watermark: WatermarkConfig;
  includeHeader: boolean;
  includeFooter: boolean;
}

/**
 * Convert any SVG element (e.g. from Recharts, D3, custom SVG charts) into an HTMLCanvasElement
 */
export async function svgToCanvas(
  svgElement: SVGSVGElement,
  targetWidth?: number,
  targetHeight?: number
): Promise<HTMLCanvasElement> {
  const rect = svgElement.getBoundingClientRect();
  const w = targetWidth || Math.max(Math.round(rect.width), 800);
  const h = targetHeight || Math.max(Math.round(rect.height), 400);

  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));

  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const canvas = document.createElement('canvas');
  canvas.width = w * 2; // 2x high dpi retina
  canvas.height = h * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  ctx.scale(2, 2);

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, w, h);
      resolve(canvas);
    };
    img.src = url;
  });
}

export async function composeHDChartCanvas(options: ExportOptions): Promise<HTMLCanvasElement> {
  const { chartCanvas, drawingSvg, resolution, metadata, watermark, includeHeader, includeFooter } = options;

  // Multiplier for HD scaling
  let scale = 1;
  let targetWidth = 1920;
  if (resolution === '1440p') {
    scale = 1.33;
    targetWidth = 2560;
  } else if (resolution === '2160p') {
    scale = 2.0;
    targetWidth = 3840;
  }

  // Calculate proportional height based on source chart aspect ratio
  const sourceAspect = chartCanvas.height / chartCanvas.width;
  const targetChartHeight = Math.round(targetWidth * sourceAspect);

  const headerHeight = includeHeader ? Math.round(110 * scale) : 0;
  const footerHeight = includeFooter ? Math.round(50 * scale) : 0;
  const totalHeight = headerHeight + targetChartHeight + footerHeight;

  // Create offscreen canvas for high-DPI composition
  const offscreen = document.createElement('canvas');
  offscreen.width = targetWidth;
  offscreen.height = totalHeight;
  const ctx = offscreen.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Enable high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Background Fill (Onyx Terminal Dark)
  ctx.fillStyle = '#070a0e';
  ctx.fillRect(0, 0, targetWidth, totalHeight);

  // 2. Render Bloomberg Header
  if (includeHeader) {
    // Header background
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, targetWidth, headerHeight);

    // Amber divider line
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(0, headerHeight - Math.round(2 * scale), targetWidth, Math.round(2 * scale));

    // Terminal Title & Brand
    ctx.font = `bold ${Math.round(14 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('VRP QUANT TERMINAL · BLOOMBERG PRO EDITION', Math.round(24 * scale), Math.round(32 * scale));

    // Security Symbol & Name
    ctx.font = `900 ${Math.round(28 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#ffffff';
    const tickerText = metadata.ticker.toUpperCase();
    ctx.fillText(tickerText, Math.round(24 * scale), Math.round(72 * scale));

    const symbolWidth = ctx.measureText(tickerText).width;

    // Timeframe & Provider Badge
    ctx.font = `bold ${Math.round(12 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(
      `[${metadata.interval || '1D'}] · ${metadata.provider || 'YAHOO FINANCE'}`,
      Math.round(34 * scale) + symbolWidth,
      Math.round(62 * scale)
    );

    // Current Price & Net Change
    const priceStr = metadata.lastPrice !== undefined ? `$${metadata.lastPrice}` : '';
    const chgStr = metadata.priceChangePercent !== undefined ? `${metadata.priceChangePercent}%` : '';
    const isUp = !String(chgStr).startsWith('-');

    const rightAlignX = targetWidth - Math.round(24 * scale);

    if (priceStr) {
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.round(26 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = isUp ? '#10b981' : '#ef4444';
      ctx.fillText(`${priceStr}  ${chgStr}`, rightAlignX, Math.round(68 * scale));

      // OHLC Stats Subline
      ctx.font = `${Math.round(12 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = '#94a3b8';
      const ohlcText = `O: ${metadata.open || '—'}  H: ${metadata.high || '—'}  L: ${metadata.low || '—'}  VOL: ${metadata.volume || '—'}`;
      ctx.fillText(ohlcText, rightAlignX, Math.round(92 * scale));
      ctx.textAlign = 'left';
    }
  }

  // 3. Draw Chart Canvas onto Target Area
  const chartOffsetY = headerHeight;
  ctx.drawImage(chartCanvas, 0, chartOffsetY, targetWidth, targetChartHeight);

  // 4. Draw Vector Drawings from SVG (if present)
  if (drawingSvg) {
    try {
      const clone = drawingSvg.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll('[data-handle],.cs-drawing-hit').forEach(el => el.remove());
      clone.setAttribute('width', String(drawingSvg.clientWidth));
      clone.setAttribute('height', String(drawingSvg.clientHeight));
      const svgBlob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, chartOffsetY, targetWidth, targetChartHeight);
      URL.revokeObjectURL(url);
    } catch {
      // Ignore drawing SVG serialization errors gracefully
    }
  }

  // 5. Draw Watermark Data onto Chart Canvas
  if (watermark.enabled) {
    ctx.save();
    const watermarkOpacity = Math.max(0.04, Math.min(0.6, watermark.opacity));

    if (watermark.position === 'center') {
      const centerX = targetWidth / 2;
      const centerY = chartOffsetY + (targetChartHeight / 2);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Big subtle primary watermark (Ticker Symbol)
      ctx.font = `900 ${Math.round(90 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(245, 158, 11, ${watermarkOpacity})`;
      ctx.fillText(metadata.ticker.toUpperCase(), centerX, centerY - Math.round(25 * scale));

      // Secondary watermark text
      const subText = watermark.userSignature || 'VRP QUANT DASHBOARD';
      ctx.font = `bold ${Math.round(18 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(255, 255, 255, ${watermarkOpacity * 1.5})`;
      ctx.fillText(subText.toUpperCase(), centerX, centerY + Math.round(40 * scale));

      // Timestamp
      ctx.font = `${Math.round(12 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(148, 163, 184, ${watermarkOpacity * 1.2})`;
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      ctx.fillText(`LIVE QUANT CAPTURE · ${nowStr}`, centerX, centerY + Math.round(65 * scale));
    } else {
      // Corner stamp (Bottom Right)
      const posX = targetWidth - Math.round(30 * scale);
      const posY = chartOffsetY + targetChartHeight - Math.round(40 * scale);

      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.round(16 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(245, 158, 11, ${watermarkOpacity * 1.8})`;
      ctx.fillText(`PROMPT: ${metadata.ticker} · ${watermark.userSignature || '@HydraQuant'}`, posX, posY - Math.round(20 * scale));

      ctx.font = `${Math.round(11 * scale)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = `rgba(255, 255, 255, ${watermarkOpacity * 1.5})`;
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      ctx.fillText(`VRP QUANT SUITE · ${nowStr}`, posX, posY);
    }
    ctx.restore();
  }

  // 6. Render Bloomberg Footer
  if (includeFooter) {
    const footerY = headerHeight + targetChartHeight;

    // Footer background
    ctx.fillStyle = '#06090e';
    ctx.fillRect(0, footerY, targetWidth, footerHeight);

    // Top border line
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, footerY, targetWidth, Math.round(1 * scale));

    // Footer Quant metrics (if provided)
    ctx.font = `${Math.round(11 * scale)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#f59e0b';
    let metricOffset = Math.round(24 * scale);

    if (metadata.quantMetrics && metadata.quantMetrics.length > 0) {
      metadata.quantMetrics.forEach((m) => {
        const text = `${m.label}: ${m.value}`;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${m.label}: `, metricOffset, footerY + Math.round(30 * scale));
        metricOffset += ctx.measureText(`${m.label}: `).width;

        ctx.fillStyle = '#38bdf8';
        ctx.fillText(m.value, metricOffset, footerY + Math.round(30 * scale));
        metricOffset += ctx.measureText(m.value).width + Math.round(20 * scale);
      });
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillText('MODELS: HAR-RV · BSM SOLVER · GEX INVENTORY · GRU REGIME', metricOffset, footerY + Math.round(30 * scale));
    }

    // Right-side legal/terminal stamp
    ctx.textAlign = 'right';
    ctx.fillStyle = '#475569';
    ctx.fillText('VRP FINANCIAL ANALYTICS · CONFIDENTIAL & PROPRIETARY', targetWidth - Math.round(24 * scale), footerY + Math.round(30 * scale));
    ctx.textAlign = 'left';
  }

  return offscreen;
}

export async function exportChartAsHDImage(options: ExportOptions, filename?: string): Promise<string> {
  const canvas = await composeHDChartCanvas(options);
  const dataUrl = canvas.toDataURL('image/png', 1.0);

  const finalName = filename || `${options.metadata.ticker.toUpperCase()}_${options.metadata.interval || '1D'}_${new Date().toISOString().slice(0, 10)}_HD.png`;

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = finalName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return dataUrl;
}

export async function copyChartToClipboard(options: ExportOptions): Promise<boolean> {
  try {
    const canvas = await composeHDChartCanvas(options);
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob failed'));
          return;
        }
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      }, 'image/png', 1.0);
    });
  } catch (err) {
    console.error('Copy to clipboard failed:', err);
    return false;
  }
}
